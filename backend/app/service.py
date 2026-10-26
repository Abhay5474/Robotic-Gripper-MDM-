"""Application logic: prediction with calibration reuse, calibration workflow, operations."""
from __future__ import annotations

import math
from typing import Any, Optional

from pydantic import ValidationError

from .config import Settings
from .config_key import configuration_key, normalize_configuration
from .llm import LLMClient, LLMError, extract_json_object
from .prompts import PROMPT_VERSION, SYSTEM_PROMPT, build_user_prompt
from .rtdb import RtdbError
from .safety import assess
from .schemas import (
    CANONICAL_FORCE_DEFINITION,
    FORCE_UNIT,
    CalibrationLookup,
    CalibrationRecord,
    ConfirmRequest,
    LookupItem,
    ForceCommandRequest,
    GripperLimits,
    LLMForceResponse,
    ObjectProperties,
    OperationRequest,
    PredictGripRequest,
    PredictGripResponse,
    PredictionRecord,
    StartCalibrationRequest,
    TelemetrySample,
    TestEventRequest,
)
from .store import Store, new_id
from .telemetry import corroborates_success, normalize_telemetry

DAY_MS = 86_400_000


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, retryable: bool = False, **extra: Any):
        super().__init__(message)
        self.status, self.code, self.message, self.retryable, self.extra = status, code, message, retryable, extra

    def body(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, "retryable": self.retryable, **self.extra}


def limits_from_settings(s: Settings) -> GripperLimits:
    return GripperLimits(
        gripper_id=s.gripper_id,
        finger_count=s.gripper_finger_count,
        contact_pad_material=s.gripper_contact_pad_material,
        force_definition=CANONICAL_FORCE_DEFINITION,  # type: ignore[arg-type]
        force_unit=FORCE_UNIT,
        min_force_n=s.gripper_min_force_n,
        max_force_n=s.gripper_max_force_n,
        force_step_n=s.gripper_force_step_n,
        max_opening_mm=s.gripper_max_opening_mm,
        lift_acceleration_m_s2=s.lift_acceleration_m_s2,
        holding_safety_factor=s.holding_safety_factor,
        limits_source=s.gripper_limits_source,
    )


def _store_call(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except RtdbError as e:
        raise ApiError(503, "store_unavailable", f"Firebase RTDB is unavailable: {e}", retryable=True) from e


class Service:
    def __init__(self, settings: Settings, store: Store, llm: LLMClient):
        self.settings, self.store, self.llm = settings, store, llm
        self.limits = limits_from_settings(settings)

    # ------------------------------------------------------------ helpers --
    def _key(self, obj: ObjectProperties) -> tuple[str, dict]:
        norm = normalize_configuration(obj, self.limits)
        return configuration_key(norm), norm

    # ----------------------------------------------------- calibration lookup --
    def _evaluate_active(self, mode: str, key: str, obj: ObjectProperties) -> CalibrationLookup:
        active = self.store.get_active(mode, key)
        if not active:
            return CalibrationLookup(state="not_found")
        if active.get("calibration_status", "calibrated") != "calibrated":
            return CalibrationLookup(state="invalidated", reason="The active calibration for this configuration was invalidated.")
        raw = self.store.get_calibration(mode, active.get("calibration_id", "")) if active.get("calibration_id") else None
        if not raw:
            return CalibrationLookup(state="inconsistent", reason="Active index points to a missing calibration record.")
        try:
            rec = CalibrationRecord(**raw)
        except ValidationError:
            return CalibrationLookup(state="inconsistent", reason="Calibration record is malformed.")
        if rec.calibration_status == "invalidated":
            return CalibrationLookup(state="invalidated", reason=rec.invalidation_reason or "Invalidated by a user.", record=rec)
        if (
            rec.calibration_status != "calibrated" or rec.configuration_key != key or rec.calibrated_force is None
            or rec.calibrated_force != active.get("calibrated_force")
            or rec.force_definition != self.limits.force_definition or rec.force_unit != self.limits.force_unit
        ):
            return CalibrationLookup(state="inconsistent", reason="Record does not match its index entry or the current force definition.", record=rec)
        max_age = self.settings.calibration_max_age_days
        if max_age > 0 and rec.confirmed_at_ms and self.store.clock() - rec.confirmed_at_ms > max_age * DAY_MS:
            return CalibrationLookup(state="stale", reason=f"Calibration is older than {max_age} days.", record=rec)
        sa = assess(obj, self.limits, rec.calibrated_force, rec.force_definition, rec.force_unit)
        if sa.status not in ("ok", "marginal"):
            return CalibrationLookup(state="safety_failed", reason=f"Saved force fails current safety checks: {sa.summary}", record=rec)
        return CalibrationLookup(state="found_valid", record=rec)

    def lookup(self, mode: str, objects: list[ObjectProperties]) -> list[LookupItem]:
        """Calibration status for each configuration, using the same rules as prediction. No LLM call."""
        out = []
        for obj in objects:
            key, _ = self._key(obj)
            lk = _store_call(self._evaluate_active, mode, key, obj)
            rec = lk.record
            out.append(LookupItem(
                object_id=obj.object_id, configuration_key=key, state=lk.state, reason=lk.reason,
                calibrated_force=rec.calibrated_force if rec else None, calibration_id=rec.calibration_id if rec else None,
                confirmed_at=rec.confirmed_at if rec else None, confirmation_method=rec.confirmation_method if rec else None,
            ))
        return out

    # ------------------------------------------------------------ LLM --
    def _recommend(self, obj: ObjectProperties) -> LLMForceResponse:
        user = build_user_prompt(obj, self.limits)
        last_problem = "unknown"
        for _ in range(max(1, self.settings.llm_max_attempts)):
            try:
                text = self.llm.complete(SYSTEM_PROMPT, user)
            except LLMError as e:
                status = 503 if e.code in ("llm_unavailable", "llm_not_configured") else 502
                raise ApiError(status, e.code, e.message, retryable=e.retryable) from e
            try:
                resp = LLMForceResponse(**extract_json_object(text))
            except (ValueError, ValidationError) as e:
                last_problem = f"malformed response ({type(e).__name__})"
                continue
            problem = self._semantic_problem(resp)
            if problem is None:
                return resp
            last_problem = problem
        raise ApiError(502, "llm_invalid_response", f"LLM output rejected: {last_problem}. No force was fabricated.", retryable=True)

    def _semantic_problem(self, r: LLMForceResponse) -> Optional[str]:
        if r.force_definition != self.limits.force_definition:
            return f"force_definition '{r.force_definition}' is not '{self.limits.force_definition}'"
        if r.force_unit != self.limits.force_unit:
            return f"force_unit '{r.force_unit}' is not '{self.limits.force_unit}'"
        if not math.isfinite(r.recommended_force) or r.recommended_force <= 0:
            return "force is not a positive finite number"
        if r.recommended_force > 10 * self.limits.max_force_n:
            return f"force {r.recommended_force:g} N is nonsensical for a gripper limited to {self.limits.max_force_n:g} N"
        return None

    # ---------------------------------------------------------- predict --
    def predict(self, mode: str, req: PredictGripRequest) -> PredictGripResponse:
        obj = req.object
        key, norm = self._key(obj)
        messages: list[str] = []
        try:
            lookup = self._evaluate_active(mode, key, obj)
        except RtdbError as e:
            if not req.allow_without_calibration_check:
                raise ApiError(
                    503, "store_unavailable",
                    f"Cannot check Firebase for a saved calibration: {e}. No force was recommended.",
                    retryable=True, fallback_available=True,
                ) from e
            lookup = CalibrationLookup(state="unavailable", reason="Firebase unreachable; calibration check skipped by explicit user authorisation.")
            messages.append("Calibration check was SKIPPED because Firebase is unreachable (explicitly authorised). A saved calibration may exist.")

        if lookup.state == "found_valid" and not req.regenerate:
            assert lookup.record and lookup.record.calibrated_force is not None
            force = lookup.record.calibrated_force
            messages.append("Calibrated force loaded from Firebase.")
            messages.append("LLM was not queried.")
            return PredictGripResponse(
                configuration_key=key, normalized_configuration=norm, source="calibration", calibration_status="calibrated",
                calibration_lookup=lookup, llm_called=False, prediction=None, selected_force_n=force,
                safety=assess(obj, self.limits, force), limits=self.limits, messages=messages, mode=mode,  # type: ignore[arg-type]
            )

        if lookup.state in ("stale", "invalidated", "safety_failed", "inconsistent"):
            messages.append(f"A saved calibration exists but was NOT reused ({lookup.state}): {lookup.reason}")
        if req.regenerate and lookup.state == "found_valid":
            messages.append("New LLM recommendation requested; the saved calibration is unchanged.")

        llm = self._recommend(obj)
        ms = self.store.clock()
        pred = PredictionRecord(
            prediction_id=new_id("pred", ms), configuration_key=key, object_id=obj.object_id,
            input_properties=obj.model_dump(), gripper_configuration=norm["gripper"],
            llm_recommended_force=llm.recommended_force, force_definition=llm.force_definition, force_unit=llm.force_unit,
            confidence=llm.confidence, rationale=llm.rationale, assumptions=llm.assumptions, llm_warnings=llm.warnings,
            model_identifier=self.llm.model_identifier, prompt_version=PROMPT_VERSION,
            created_at=self.store.stamp()["at"], created_at_ms=ms, mode=mode,  # type: ignore[arg-type]
        )
        try:
            self.store.save_prediction(mode, pred.model_dump())
        except RtdbError:
            pred.persisted = False
            messages.append("The LLM recommendation could not be saved to Firebase (it is shown but not recorded).")

        raw = llm.recommended_force
        force = min(max(raw, self.limits.min_force_n), self.limits.max_force_n)
        note = None
        if force != raw:
            note = (f"LLM suggested {raw:g} N, outside the gripper range "
                    f"{self.limits.min_force_n:g}-{self.limits.max_force_n:g} N; slider clamped to {force:g} N.")
            messages.append(note)
        messages.append("Initial LLM recommendation only - not validated or guaranteed safe. Not yet calibrated.")
        return PredictGripResponse(
            configuration_key=key, normalized_configuration=norm, source="llm",
            calibration_status="calibrated" if lookup.state == "found_valid" else "uncalibrated",
            calibration_lookup=lookup, llm_called=True, prediction=pred, selected_force_n=force, selected_force_note=note,
            safety=assess(obj, self.limits, force), limits=self.limits, messages=messages, mode=mode,  # type: ignore[arg-type]
        )

    # ------------------------------------------------------ calibrations --
    def start_calibration(self, mode: str, req: StartCalibrationRequest) -> CalibrationRecord:
        obj = req.object
        key, norm = self._key(obj)
        sa = assess(obj, self.limits, req.initial_force_n)
        if not sa.can_test:
            raise ApiError(422, "infeasible_force", f"Force cannot be tested: {sa.summary}", safety=sa.model_dump())
        original = pred_id = model_id = prompt_v = None
        if req.prediction_id:
            pred = _store_call(self.store.get_prediction, mode, req.prediction_id)
            if not pred or pred.get("configuration_key") != key:
                raise ApiError(409, "prediction_mismatch", "Prediction does not exist for this exact configuration.")
            original, pred_id, model_id, prompt_v = pred["llm_recommended_force"], pred["prediction_id"], pred["model_identifier"], pred["prompt_version"]
        if req.based_on_calibration_id:
            base = _store_call(self.store.get_calibration, mode, req.based_on_calibration_id)
            if not base or base.get("configuration_key") != key:
                raise ApiError(409, "calibration_mismatch", "Base calibration does not exist for this exact configuration.")
            if original is None:
                original, pred_id = base.get("original_llm_force"), base.get("prediction_id")
                model_id, prompt_v = base.get("model_identifier"), base.get("prompt_version")
        stamp = self.store.stamp()
        rec = CalibrationRecord(
            calibration_id=new_id("cal", stamp["ms"]), configuration_key=key, object_id=obj.object_id,
            input_properties=obj.model_dump(), gripper_configuration=norm["gripper"], prediction_id=pred_id,
            based_on_calibration_id=req.based_on_calibration_id, original_llm_force=original,
            model_identifier=model_id, prompt_version=prompt_v, initial_force=req.initial_force_n,
            force_definition=self.limits.force_definition, force_unit=self.limits.force_unit,
            calibration_status="in_progress", created_at=stamp["at"], created_at_ms=stamp["ms"], mode=mode,  # type: ignore[arg-type]
        )
        _store_call(self.store.create_calibration, mode, rec.model_dump(exclude_none=True))
        return rec

    def _load_calibration(self, mode: str, cid: str) -> dict:
        rec = _store_call(self.store.get_calibration, mode, cid)
        if not rec:
            raise ApiError(404, "calibration_not_found", "No such calibration record.")
        return rec

    @staticmethod
    def _events(rec: dict) -> list[dict]:
        return sorted((rec.get("tests") or {}).values(), key=lambda e: e.get("seq", 0))

    def _live_telemetry(self, mode: str) -> TelemetrySample:
        if mode == "demo":
            return TelemetrySample(available=False, stale=True, reason="Demo mode: simulated telemetry is not stored in Firebase.")
        try:
            raw = self.store.read_telemetry_raw()
        except RtdbError as e:
            return TelemetrySample(available=False, stale=True, reason=f"Telemetry read failed: {e}")
        return normalize_telemetry(raw, self.settings.telemetry_stale_after_s, self.store.clock())

    def record_test(self, mode: str, cid: str, req: TestEventRequest) -> dict:
        rec = self._load_calibration(mode, cid)
        if rec.get("calibration_status") != "in_progress":
            raise ApiError(409, "calibration_closed", f"Calibration is already {rec.get('calibration_status')}.")
        obj = ObjectProperties(**rec["input_properties"])
        sa = assess(obj, self.limits, req.force_n)
        if req.event == "test_started" and not sa.can_test:
            raise ApiError(422, "infeasible_force", f"Force rejected: {sa.summary}", safety=sa.model_dump())
        stamp = self.store.stamp()
        tel = self._live_telemetry(mode)
        event = {"event": req.event, "force_n": round(req.force_n, 6), "at": stamp["at"], "at_ms": stamp["ms"],
                 "note": req.note, "safety_status": sa.status,
                 "sensor_snapshot": tel.model_dump() if tel.available else None}
        tid = _store_call(self.store.append_test, mode, cid, {k: v for k, v in event.items() if v is not None})
        return {"test_id": tid, "event": event, "safety": sa.model_dump()}

    def confirm(self, mode: str, cid: str, req: ConfirmRequest) -> dict:
        raw = self._load_calibration(mode, cid)
        status = raw.get("calibration_status")
        if status == "calibrated" and req.outcome == "success" and raw.get("calibrated_force") is not None \
                and req.final_force_n is not None and round(req.final_force_n, 6) == round(raw["calibrated_force"], 6):
            # idempotent retry: finish a confirm whose index update may have failed
            committed, active = _store_call(self.store.promote_active, mode, raw)
            return {"record": raw, "active_updated": committed, "active": active, "retry": True}
        if status != "in_progress":
            raise ApiError(409, "calibration_closed", f"Calibration is already {status}.")
        stamp = self.store.stamp()

        if req.outcome in ("failed", "cancelled"):
            vals = {"calibration_status": req.outcome, "calibration_outcome": req.outcome, "notes": req.notes,
                    "finished_at": stamp["at"], "finished_at_ms": stamp["ms"]}
            _store_call(self.store.update_calibration, mode, cid, {k: v for k, v in vals.items() if v is not None})
            return {"record": self._load_calibration(mode, cid), "active_updated": False, "active": None}

        assert req.final_force_n is not None and req.user_confirmation is not None
        uc = req.user_confirmation
        if not (uc.held_and_lifted and uc.no_slip and uc.no_damage):
            raise ApiError(422, "confirmation_incomplete",
                           "Success requires explicit confirmation that the object was held and lifted without slipping or damage.")
        events = self._events(raw)
        last = events[-1] if events else None
        if not last or last["event"] != "test_started" or round(last["force_n"], 6) != round(req.final_force_n, 6):
            raise ApiError(409, "untested_force",
                           "The final force must be the most recent force that was tested on the gripper; test it before confirming.")
        obj = ObjectProperties(**raw["input_properties"])
        sa = assess(obj, self.limits, req.final_force_n)
        override = None
        if not sa.can_save_as_calibrated:
            if not sa.requires_override:
                raise ApiError(422, "infeasible_force", f"Cannot be saved as calibrated: {sa.summary}", safety=sa.model_dump())
            if not self.settings.allow_safety_override:
                raise ApiError(422, "override_not_allowed", "Force is below the estimated holding requirement and the override policy is disabled.", safety=sa.model_dump())
            if not req.override_reason:
                raise ApiError(422, "override_required", "An override reason is required for a force below the estimated holding requirement.", safety=sa.model_dump())
            override = {"used": True, "reason": req.override_reason, "overridden_status": sa.status}

        tel = self._live_telemetry(mode)
        ok, why = corroborates_success(tel)
        if tel.available and not tel.stale and tel.slip_detected:
            raise ApiError(409, "sensor_slip_detected", "Telemetry reports slip_detected=true; the grasp cannot be confirmed. Re-test.")
        method = "sensor_assisted" if ok else "manual"
        sensor_summary = {"available": tel.available, "corroborated": ok, "reason": None if ok else why,
                          "data_source": "simulated_or_none" if mode == "demo" else "firebase_live",
                          **({"snapshot": tel.model_dump()} if tel.available else {})}
        warnings = [c.message for c in sa.checks if not c.passed and c.severity == "warning"]
        if method == "manual":
            warnings.append("Manually confirmed: no reliable sensor-based success signal.")
        if mode == "demo":
            warnings.append("DEMO MODE record: not a hardware calibration.")
        vals = {
            "calibration_status": "calibrated", "calibration_outcome": "success", "calibrated_force": req.final_force_n,
            "confirmation_method": method, "confirmed_at": stamp["at"], "confirmed_at_ms": stamp["ms"],
            "last_verified_at": stamp["at"], "sensor_summary": sensor_summary, "safety_assessment": sa.model_dump(),
            "warnings": warnings, "override": override, "notes": req.notes,
        }
        _store_call(self.store.update_calibration, mode, cid, {k: v for k, v in vals.items() if v is not None})
        final = self._load_calibration(mode, cid)
        committed, active = _store_call(self.store.promote_active, mode, final)
        return {"record": final, "active_updated": committed, "active": active,
                "note": None if committed else "A newer calibration for this configuration already holds the active index."}

    def invalidate(self, mode: str, cid: str, reason: str) -> dict:
        raw = self._load_calibration(mode, cid)
        if raw.get("calibration_status") != "calibrated":
            raise ApiError(409, "not_calibrated", f"Only calibrated records can be invalidated (status: {raw.get('calibration_status')}).")
        stamp = self.store.stamp()
        _store_call(self.store.update_calibration, mode, cid, {
            "calibration_status": "invalidated", "invalidated_at": stamp["at"], "invalidation_reason": reason})
        cleared = _store_call(self.store.invalidate_active_if, mode, raw["configuration_key"], cid, stamp["ms"])
        return {"record": self._load_calibration(mode, cid), "active_cleared": cleared}

    # ------------------------------------------------------------ queries --
    def active_for_key(self, mode: str, key: str) -> dict:
        active = _store_call(self.store.get_active, mode, key)
        if not active or active.get("calibration_status", "calibrated") != "calibrated":
            raise ApiError(404, "no_active_calibration", "No successful calibration is active for this configuration.")
        return {"active": active, "record": _store_call(self.store.get_calibration, mode, active["calibration_id"])}

    def history(self, mode: str, key: str) -> dict:
        recs = _store_call(self.store.list_calibrations_for_key, mode, key)
        active = _store_call(self.store.get_active, mode, key)
        live = active if active and active.get("calibration_status", "calibrated") == "calibrated" else None
        return {"configuration_key": key, "active_calibration_id": (live or {}).get("calibration_id"), "records": recs}

    def recent_calibrations(self, mode: str, limit: int) -> list[dict]:
        return _store_call(self.store.list_recent_calibrations, mode, limit)

    def telemetry_latest(self) -> TelemetrySample:
        try:
            raw = self.store.read_telemetry_raw()
        except RtdbError as e:
            raise ApiError(503, "store_unavailable", f"Cannot read telemetry: {e}", retryable=True) from e
        return normalize_telemetry(raw, self.settings.telemetry_stale_after_s, self.store.clock())

    # --------------------------------------------------------- operations --
    def record_operation(self, mode: str, req: OperationRequest) -> dict:
        stamp = self.store.stamp()
        if req.data_source == "simulated" and mode != "demo":
            raise ApiError(422, "mode_mismatch", "Simulated operations may only be recorded in demo mode.")
        if mode == "demo" and req.data_source == "firebase_live":
            raise ApiError(422, "mode_mismatch", "Live data cannot be recorded as a demo operation.")
        op = req.model_dump(exclude_none=True)
        op.update(operation_id=new_id("op", stamp["ms"]), timestamp=stamp["at"], timestamp_ms=stamp["ms"], mode=mode)
        _store_call(self.store.save_operation, mode, op)
        return op

    def operations(self, mode: str, limit: int) -> list[dict]:
        return _store_call(self.store.list_operations, mode, limit)

    # ------------------------------------------------------------ command --
    def force_command(self, mode: str, req: ForceCommandRequest) -> dict:
        if self.settings.command_channel == "none":
            raise ApiError(501, "command_channel_not_configured",
                           "No hardware command channel has been agreed with the hardware team. The slider value is a software target only; the gripper has NOT received it.")
        if mode == "demo":
            raise ApiError(422, "mode_mismatch", "Commands are never sent in demo mode.")
        key, _ = self._key(req.object)
        if key != req.configuration_key:
            raise ApiError(409, "key_mismatch", "configuration_key does not match the supplied object.")
        sa = assess(req.object, self.limits, req.target_force_n)
        if not sa.can_test:
            raise ApiError(422, "infeasible_force", f"Command rejected: {sa.summary}", safety=sa.model_dump())
        stamp = self.store.stamp()
        cid = new_id("op", stamp["ms"]).replace("op_", "cmd_")
        cmd = {"command_id": cid, "type": "set_force_target", "target_force_n": req.target_force_n,
               "force_definition": self.limits.force_definition, "force_unit": self.limits.force_unit,
               "configuration_key": key, "status": "pending", "created_at": stamp["at"], "created_at_ms": stamp["ms"]}
        _store_call(self.store.write_command, self.settings.command_path, cid, cmd)
        return {"command": cmd, "delivery": "queued_in_rtdb", "acknowledged_by_hardware": False}
