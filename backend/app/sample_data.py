"""Sample RTDB dataset: generate it, validate any export against this app, or seed a database.

    python -m app.sample_data generate [--out ../samples/firebase_sample_data.json]
    python -m app.sample_data check FILE.json
    python -m app.sample_data seed --file FILE.json [--prefix demo] [--no-rebase] [--include-telemetry] [--force] [--dry-run]

The generated file is produced by running the REAL application workflow (Service + Store) against an
in-memory RTDB emulation with a fixed clock and fixed ids, so it contains exactly what the app writes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from unittest.mock import patch

from pydantic import ValidationError

from .config import Settings
from .config_key import configuration_key, normalize_with_gripper
from .rtdb import FirebaseRtdb, MemoryRtdb, from_rtdb, to_rtdb
from .schemas import (
    ConfirmRequest, GripperLimits, ObjectProperties, OperationRequest, PredictGripRequest, PredictionRecord,
    CalibrationRecord, StartCalibrationRequest, TestEventRequest, UserConfirmation,
)
from .service import Service, limits_from_settings
from .store import Store, iso
from .telemetry import normalize_telemetry

BRANCHES = ("grip_predictions", "grip_calibrations", "active_calibrations", "operations", "gripper_telemetry")
OPTIONAL_BRANCHES = ("gripper_commands",)
SAMPLE_PATH = Path(__file__).resolve().parents[2] / "samples" / "firebase_sample_data.json"
PRESETS = Path(__file__).resolve().parents[2] / "shared" / "object_presets.json"

T0 = int(datetime(2026, 10, 20, 9, 0, 0, tzinfo=timezone.utc).timestamp() * 1000)  # "now" of the sample
MIN, HOUR, DAY = 60_000, 3_600_000, 86_400_000


# ============================================================ generation ==
class _SampleLLM:
    """Deterministic stand-in so the sample is reproducible. Labelled as illustrative in the records."""

    model_identifier = "sample-llm-v1 (illustrative, not a real model output)"

    def __init__(self) -> None:
        self.next_force = 0.0

    def complete(self, system: str, user: str) -> str:
        return json.dumps({
            "recommended_force": self.next_force, "force_definition": "normal_force_per_finger",
            "force_definition_note": "Normal force applied by each finger pad.", "force_unit": "N", "confidence": "medium",
            "rationale": "Sample record: Coulomb friction with a 1.5x margin for a vertical lift.",
            "assumptions": ["Vertical lift", "Two symmetric friction contacts"],
            "warnings": [],
        })


def _presets() -> dict[str, dict]:
    return {p["object_id"]: p for p in json.loads(PRESETS.read_text())["presets"]}


def generate(gripper_id: str = "demo-parallel-gripper", pad_material: str = "silicone", finger_count: int = 2) -> dict[str, Any]:
    # Every setting that influences the records is explicit, so shell environment variables cannot change the output.
    settings = Settings(
        _env_file=None, store_backend="memory", llm_provider="mock", telemetry_stale_after_s=5.0, telemetry_path="gripper_telemetry",
        gripper_id=gripper_id, gripper_contact_pad_material=pad_material, gripper_finger_count=finger_count,
        gripper_min_force_n=1.0, gripper_max_force_n=40.0, gripper_force_step_n=0.5, gripper_max_opening_mm=120.0,
        lift_acceleration_m_s2=2.0, holding_safety_factor=1.5, calibration_max_age_days=365, allow_safety_override=False,
    )
    db = MemoryRtdb()
    store = Store(db, settings.telemetry_path)
    llm = _SampleLLM()
    svc = Service(settings, store, llm)
    clock = {"now": T0}
    store.clock = lambda: clock["now"]
    pre = _presets()
    pre["steel-bracket"] = {"object_id": "steel-bracket", "name": "Steel bracket", "mass_g": 850, "width_mm": 40, "height_mm": 120,
                            "depth_mm": 25, "material": "steel", "friction_coefficient": 0.35, "fragility": "robust", "max_contact_force_n": None}

    def at(days: float = 0, hours: float = 0, minutes: float = 0) -> None:
        clock["now"] = int(T0 + days * DAY + hours * HOUR + minutes * MIN)

    def tick(seconds: int = 30) -> None:
        clock["now"] += seconds * 1000

    def telemetry(force: float, opening: float, slip: bool = False, state: str = "holding", detected: bool = True) -> None:
        db.set("gripper_telemetry", {"measured_force_n": force, "finger_opening_mm": opening, "object_detected": detected,
                                     "slip_detected": slip, "operation_state": state, "timestamp": clock["now"]})

    def predict(obj_id: str, llm_force: float) -> dict:
        llm.next_force = llm_force
        obj = ObjectProperties(**pre[obj_id])
        return svc.predict("live", PredictGripRequest(object=obj, regenerate=True)).model_dump()

    def session(obj_id: str, pred: Optional[dict], initial: float, events: list[tuple[str, float]], outcome: Optional[tuple] = None,
                based_on: Optional[str] = None) -> str:
        obj = ObjectProperties(**pre[obj_id])
        rec = svc.start_calibration("live", StartCalibrationRequest(
            object=obj, initial_force_n=initial, prediction_id=pred["prediction"]["prediction_id"] if pred else None, based_on_calibration_id=based_on))
        cid = rec.calibration_id
        for ev, f in events:
            tick(40)
            svc.record_test("live", cid, TestEventRequest(event=ev, force_n=f))  # type: ignore[arg-type]
        if outcome:
            tick(60)
            kind = outcome[0]
            if kind == "success":
                svc.confirm("live", cid, ConfirmRequest(outcome="success", final_force_n=outcome[1], notes=outcome[2] if len(outcome) > 2 else None,
                                                        user_confirmation=UserConfirmation(held_and_lifted=True, no_slip=True, no_damage=True)))
            else:
                svc.confirm("live", cid, ConfirmRequest(outcome=kind, notes=outcome[1] if len(outcome) > 1 else None))  # type: ignore[arg-type]
        return cid

    def ops(cid: str, obj_id: str, key: str, force: float, calibrated: bool, results: list[tuple[float, str]],
            first_trace: Optional[list] = None) -> None:
        """results: (days_ago, result). The first successful run may carry a recorded trace."""
        for i, (days_ago, result) in enumerate(results):
            at(-days_ago)
            svc.record_operation("live", OperationRequest(
                object_id=obj_id, configuration_key=key, selected_force_n=force, calibration_id=cid if calibrated else None,
                calibration_status="calibrated" if calibrated else "uncalibrated", operation_result=result,  # type: ignore[arg-type]
                duration_s=7.7, peak_measured_force_n=round(force * 1.02, 2), data_source="firebase_live",
                trace=first_trace if i == 0 else None))

    # --- 1. plastic bottle: LLM 7.75 -> sensor-assisted calibration at 9.0, later recalibrated manually at 9.5 (active)
    at(-9, 1)
    p = predict("plastic-bottle", 7.75); key_bottle = p["configuration_key"]
    at(-9, 1.1)
    telemetry(7.8, 65.2, slip=True, state="slipped")
    a = session("plastic-bottle", p, 7.75, [("test_started", 7.75), ("slipped", 7.75), ("test_started", 9.0)], None)
    telemetry(9.03, 65.0, state="holding")
    tick(30)
    telemetry(9.04, 65.0, state="holding")
    svc.confirm("live", a, ConfirmRequest(outcome="success", final_force_n=9.0, notes="Held and lifted twice, no creep.",
                                          user_confirmation=UserConfirmation(held_and_lifted=True, no_slip=True, no_damage=True)))
    at(-2, 3)
    db.set("gripper_telemetry", None)  # no sensor data when this one was confirmed -> recorded as manual
    b = session("plastic-bottle", None, 9.0, [("test_started", 9.5)], ("success", 9.5, "Re-verified after pad cleaning."), based_on=a)

    # --- 2. aluminum can: LLM 9.62 -> 12.0 (manual)
    at(-6, 2)
    p = predict("aluminum-can", 9.62); key_can = p["configuration_key"]
    can = session("aluminum-can", p, 9.62, [("test_started", 9.62), ("slipped", 9.62), ("test_started", 12.0)], ("success", 12.0))

    # --- 3. wooden block: calibrated 5.5, plus a recalibration still in progress
    at(-5, 4)
    p = predict("wooden-block", 3.94); key_wood = p["configuration_key"]
    wood = session("wooden-block", p, 3.94, [("test_started", 3.94), ("slipped", 3.94), ("test_started", 5.5)], ("success", 5.5))
    at(0, -1)
    wood2 = session("wooden-block", None, 5.5, [("test_started", 6.0)], None, based_on=wood)

    # --- 4. ceramic cup: slip, damage risk, then a marginal-but-held 4.5 N
    at(-4, 5)
    p = predict("ceramic-cup", 5.31); key_cup = p["configuration_key"]
    cup = session("ceramic-cup", p, 5.31, [("test_started", 3.0), ("slipped", 3.0), ("test_started", 5.5), ("damage_risk", 5.5), ("test_started", 4.5)],
                  ("success", 4.5, "Cup flexed at 5.5 N; 4.5 N holds with margin of safety reduced."))

    # --- 5. fragile object: a failed session only (never active)
    at(-3, 6)
    p = predict("fragile-object", 2.36); key_frag = p["configuration_key"]
    frag = session("fragile-object", p, 2.36, [("test_started", 2.5), ("failed", 2.5)], ("failed", "Gripper jaw stalled before contact."))

    # --- 6. rubber ball: calibrated, later invalidated (pads replaced)
    at(-8, 2)
    p = predict("rubber-ball", 1.48); key_ball = p["configuration_key"]
    ball = session("rubber-ball", p, 1.48, [("test_started", 1.5)], ("success", 1.5))
    at(-7, 1)
    svc.invalidate("live", ball, "Gripper pads replaced with softer silicone; previous force no longer valid.")

    # --- 7. cardboard box: calibrated 400 days ago -> stale; plus a cancelled session yesterday
    at(-400)
    p = predict("cardboard-box", 4.43); key_box = p["configuration_key"]
    box = session("cardboard-box", p, 4.43, [("test_started", 4.0)], ("success", 4.0))
    at(-1, 2)
    box_cancel = session("cardboard-box", None, 4.0, [("test_started", 4.0)], ("cancelled", "Operator stopped: box was wet."), based_on=box)

    # --- 8. custom steel bracket: sensor-assisted calibration
    at(-2, 6)
    p = predict("steel-bracket", 19.0); key_br = p["configuration_key"]
    tick(20)
    br = session("steel-bracket", p, 19.0, [("test_started", 19.0), ("slipped", 19.0), ("test_started", 22.0)], None)
    telemetry(22.05, 40.1, state="holding"); tick(2); telemetry(22.06, 40.1, state="holding")
    svc.confirm("live", br, ConfirmRequest(outcome="success", final_force_n=22.0,
                                           user_confirmation=UserConfirmation(held_and_lifted=True, no_slip=True, no_damage=True)))

    # --- operations (some with a recorded trace)
    trace = [{"t": round(i * 0.25, 2), "f": round(min(9.5, i * 1.2), 2) if i < 12 else (9.5 if i < 28 else round(max(0, 9.5 - (i - 27) * 1.6), 2)),
              "o": round(max(65, 100 - i * 3.1), 1) if i < 12 else (65.0 if i < 28 else round(min(100, 65 + (i - 27) * 5), 1)),
              "s": 0, "st": "closing" if i < 12 else "holding" if i < 20 else "lifting" if i < 28 else "releasing"} for i in range(36)]
    ops(b, "plastic-bottle", key_bottle, 9.5, True, [(1.5, "success"), (1.0, "success"), (0.5, "success")], trace)
    ops(can, "aluminum-can", key_can, 12.0, True, [(5.0, "success"), (4.0, "success")])
    ops(wood, "wooden-block", key_wood, 5.5, True, [(3.0, "success")])
    ops(cup, "ceramic-cup", key_cup, 4.5, True, [(2.5, "success"), (2.0, "slipped")])
    ops(br, "steel-bracket", key_br, 22.0, True, [(1.0, "success")])
    ops(box, "cardboard-box", key_box, 4.0, False, [(0.5, "slipped")])

    # --- the hardware team's live telemetry node, as it would look right now
    at(0)
    telemetry(9.52, 65.1, state="holding")
    _ = (frag, ball, wood2, box_cancel, key_frag, key_ball)  # created for their side effects (history / index)
    return from_rtdb(db._root)


def generate_deterministic(**gripper: Any) -> dict[str, Any]:
    """generate() with deterministic record ids (otherwise ids contain random hex)."""
    counter = {"n": 0}

    def det_id(prefix: str, ms: int | None = None) -> str:
        counter["n"] += 1
        h = hashlib.sha1(f"{prefix}:{ms}:{counter['n']}".encode()).hexdigest()[:6]
        return f"{prefix}_{ms:013d}_{h}"

    with patch("app.service.new_id", det_id):
        return generate(**gripper)


# ============================================================ validation ==
class Report:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.stats: dict[str, int] = {}

    def err(self, m: str) -> None: self.errors.append(m)
    def warn(self, m: str) -> None: self.warnings.append(m)


def _parse_iso_ms(s: str) -> Optional[int]:
    try:
        return int(datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() * 1000)
    except (ValueError, AttributeError):
        return None


def validate_dataset(data: dict[str, Any], stale_after_s: float = 5.0) -> Report:
    """Check a database export against everything this application reads. Never mutates `data`."""
    r = Report()
    if not isinstance(data, dict):
        r.err("root must be a JSON object")
        return r
    # 1) RTDB storage rules: no nulls / empty containers / illegal keys (they would not survive an import)
    try:
        if from_rtdb(to_rtdb(data)) != data:
            r.err("contains values RTDB would not store (null, empty object/array) or changes shape on storage")
    except Exception as e:  # RtdbError
        r.err(f"not storable in RTDB: {e}")
    roots: list[tuple[str, dict]] = [("", data)]
    if isinstance(data.get("demo"), dict):
        roots.append(("demo/", data["demo"]))
    for k in data:
        if k not in BRANCHES + OPTIONAL_BRANCHES + ("demo",):
            r.warn(f"unknown top-level branch '{k}' (ignored by this application)")
    for prefix, root in roots:
        _validate_root(prefix, root, r, stale_after_s)
    return r


def _validate_root(prefix: str, root: dict, r: Report, stale_after_s: float) -> None:
    preds = root.get("grip_predictions") or {}
    cals = root.get("grip_calibrations") or {}
    active = root.get("active_calibrations") or {}
    ops = root.get("operations") or {}
    r.stats[f"{prefix}grip_predictions"] = len(preds)
    r.stats[f"{prefix}grip_calibrations"] = len(cals)
    r.stats[f"{prefix}active_calibrations"] = len(active)
    r.stats[f"{prefix}operations"] = len(ops)

    def key_of(props: dict, gripper: dict) -> Optional[str]:
        try:
            return configuration_key(normalize_with_gripper(ObjectProperties(**props), gripper))
        except (ValidationError, TypeError) as e:
            r.err(f"{prefix}: cannot recompute configuration key: {str(e).splitlines()[0]}")
            return None

    for pid, raw in preds.items():
        w = f"{prefix}grip_predictions/{pid}"
        try:
            rec = PredictionRecord(**raw)
        except (ValidationError, TypeError) as e:
            r.err(f"{w}: invalid prediction record ({str(e).splitlines()[0]})"); continue
        if rec.prediction_id != pid: r.err(f"{w}: prediction_id does not match its key")
        if key_of(rec.input_properties, rec.gripper_configuration) != rec.configuration_key:
            r.err(f"{w}: configuration_key does not match the key recomputed from its properties")
        if _parse_iso_ms(rec.created_at) != rec.created_at_ms: r.err(f"{w}: created_at and created_at_ms disagree")

    by_key: dict[str, list[CalibrationRecord]] = {}
    for cid, raw in cals.items():
        w = f"{prefix}grip_calibrations/{cid}"
        try:
            rec = CalibrationRecord(**raw)
        except (ValidationError, TypeError) as e:
            r.err(f"{w}: invalid calibration record ({str(e).splitlines()[0]})"); continue
        if rec.calibration_id != cid: r.err(f"{w}: calibration_id does not match its key")
        if key_of(rec.input_properties, rec.gripper_configuration) != rec.configuration_key:
            r.err(f"{w}: configuration_key does not match the key recomputed from its properties")
        if _parse_iso_ms(rec.created_at) != rec.created_at_ms: r.err(f"{w}: created_at and created_at_ms disagree")
        if rec.prediction_id and rec.prediction_id not in preds: r.warn(f"{w}: prediction_id {rec.prediction_id} not found in grip_predictions")
        if rec.based_on_calibration_id and rec.based_on_calibration_id not in cals: r.warn(f"{w}: based_on_calibration_id not found")
        st = rec.calibration_status
        if st in ("calibrated", "invalidated"):
            for f in ("calibrated_force", "confirmed_at", "confirmed_at_ms", "confirmation_method", "last_verified_at"):
                if getattr(rec, f) is None: r.err(f"{w}: status '{st}' requires {f}")
            if rec.confirmed_at and _parse_iso_ms(rec.confirmed_at) != rec.confirmed_at_ms: r.err(f"{w}: confirmed_at and confirmed_at_ms disagree")
        else:
            if rec.calibrated_force is not None: r.err(f"{w}: status '{st}' must not carry a calibrated_force")
        if st == "invalidated" and not rec.invalidation_reason: r.err(f"{w}: invalidated record needs invalidation_reason")
        seqs = []
        for tid, t in (rec.tests or {}).items():
            if not isinstance(t, dict) or t.get("event") not in ("test_started", "slipped", "damage_risk", "failed") or not isinstance(t.get("force_n"), (int, float)):
                r.err(f"{w}/tests/{tid}: malformed test event")
            else:
                seqs.append(t.get("seq"))
        if seqs and sorted(seqs) != list(range(1, len(seqs) + 1)): r.err(f"{w}: test seq values must be 1..n")
        if st == "calibrated" and rec.calibrated_force is not None:
            ev = sorted((rec.tests or {}).values(), key=lambda e: e.get("seq", 0))
            if ev and (ev[-1]["event"] != "test_started" or round(ev[-1]["force_n"], 6) != round(rec.calibrated_force, 6)):
                r.warn(f"{w}: calibrated force was not the last force tested (the app enforces this on new confirmations)")
        by_key.setdefault(rec.configuration_key, []).append(rec)

    for key, entry in active.items():
        w = f"{prefix}active_calibrations/{key}"
        rec_raw = cals.get(entry.get("calibration_id", ""))
        if rec_raw is None:
            r.err(f"{w}: points to a missing calibration record"); continue
        if rec_raw.get("configuration_key") != key: r.err(f"{w}: record belongs to a different configuration_key")
        if entry.get("calibration_status", "calibrated") == "calibrated":
            if rec_raw.get("calibration_status") != "calibrated": r.err(f"{w}: points to a record that is '{rec_raw.get('calibration_status')}', not calibrated")
            if entry.get("calibrated_force") != rec_raw.get("calibrated_force"): r.err(f"{w}: calibrated_force differs from the record")
            for f in ("force_definition", "force_unit"):
                if entry.get(f) != rec_raw.get(f): r.err(f"{w}: {f} differs from the record")
            if not isinstance(entry.get("confirmed_at_ms"), int) or not isinstance(entry.get("version"), int):
                r.err(f"{w}: needs integer confirmed_at_ms and version")
            good = [c for c in by_key.get(key, []) if c.calibration_status == "calibrated"]
            if good:
                newest = max(good, key=lambda c: (c.confirmed_at_ms or 0, c.calibration_id))
                if newest.calibration_id != entry.get("calibration_id"): r.warn(f"{w}: index is not the newest calibrated record ({newest.calibration_id})")
        elif entry.get("calibration_status") == "invalidated":
            if rec_raw.get("calibration_status") != "invalidated": r.err(f"{w}: tombstone but the record is '{rec_raw.get('calibration_status')}'")
            if "calibrated_force" in entry: r.err(f"{w}: a tombstone must not carry calibrated_force")
        else:
            r.err(f"{w}: unknown calibration_status '{entry.get('calibration_status')}'")
    for key, recs in by_key.items():
        if any(c.calibration_status == "calibrated" for c in recs) and key not in active:
            r.warn(f"{prefix}active_calibrations/{key}: calibrated records exist but the index entry is missing (the app will not reuse them)")

    for oid, raw in ops.items():
        w = f"{prefix}operations/{oid}"
        try:
            body = {k: v for k, v in raw.items() if k not in ("operation_id", "timestamp", "timestamp_ms", "mode")}
            OperationRequest(**body)
        except (ValidationError, TypeError) as e:
            r.err(f"{w}: invalid operation ({str(e).splitlines()[0]})"); continue
        if raw.get("operation_id") != oid: r.err(f"{w}: operation_id does not match its key")
        if not isinstance(raw.get("timestamp_ms"), int) or _parse_iso_ms(raw.get("timestamp", "")) != raw.get("timestamp_ms"):
            r.err(f"{w}: timestamp / timestamp_ms missing or disagree")
        if raw.get("calibration_id") and raw["calibration_id"] not in cals: r.warn(f"{w}: calibration_id not found")

    if "gripper_telemetry" in root and not prefix:
        t = normalize_telemetry(root["gripper_telemetry"], stale_after_s, now_ms=None)
        if t.timestamp_ms is None: r.warn("gripper_telemetry has no usable timestamp (freshness will be 'unknown')")
        missing = [f for f in ("measured_force_n", "finger_opening_mm", "object_detected", "slip_detected", "operation_state") if getattr(t, f) is None]
        if missing: r.warn("gripper_telemetry lacks: " + ", ".join(missing) + " (shown as unavailable)")


# ================================================================ rebase ==
ISO_KEYS = {"created_at", "confirmed_at", "last_verified_at", "invalidated_at", "finished_at", "at", "timestamp"}


def newest_ms(data: Any) -> int:
    best = 0
    def walk(v: Any, k: str = "") -> None:
        nonlocal best
        if isinstance(v, dict):
            for kk, x in v.items(): walk(x, kk)
        elif isinstance(v, list):
            for x in v: walk(x, k)
        elif isinstance(v, (int, float)) and not isinstance(v, bool) and (k.endswith("_ms") or k == "timestamp") and v > 1e11:
            best = max(best, int(v))
    walk(data)
    return best


def rebase(data: dict[str, Any], now_ms: int) -> dict[str, Any]:
    """Shift every timestamp by one constant so the newest one becomes `now_ms` (relative ages are preserved)."""
    delta = now_ms - newest_ms(data)
    def walk(v: Any, k: str = "") -> Any:
        if isinstance(v, dict): return {kk: walk(x, kk) for kk, x in v.items()}
        if isinstance(v, list): return [walk(x, k) for x in v]
        if isinstance(v, (int, float)) and not isinstance(v, bool) and (k.endswith("_ms") or k == "timestamp") and v > 1e11: return int(v) + delta
        if isinstance(v, str) and k in ISO_KEYS and (ms := _parse_iso_ms(v)) is not None: return iso(ms + delta)
        return v
    return walk(data)


def load_into_memory(db: MemoryRtdb, data: dict[str, Any], namespaces: str = "live,demo", do_rebase: bool = True, now_ms: Optional[int] = None) -> None:
    """Preload an export into the in-memory store (development). Telemetry is only loaded for the live root."""
    import time
    rep = validate_dataset(data)
    if rep.errors:
        raise ValueError("seed file is not compatible with this application: " + "; ".join(rep.errors[:3]))
    if do_rebase:
        data = rebase(data, now_ms if now_ms is not None else int(time.time() * 1000))
    wanted = {n.strip() for n in namespaces.split(",") if n.strip()}
    for b in BRANCHES:
        if b not in data:
            continue
        if "live" in wanted:
            db.set(b, data[b])
        if "demo" in wanted and b != "gripper_telemetry":
            db.set(f"demo/{b}", data[b])


# ===================================================================== CLI ==
def _cmd_generate(a: argparse.Namespace) -> int:
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    data = generate_deterministic(gripper_id=a.gripper_id, pad_material=a.pad_material, finger_count=a.fingers)
    rep = validate_dataset(data)
    if rep.errors:
        print("generated data failed validation:\n  " + "\n  ".join(rep.errors)); return 1
    out.write_text(json.dumps(data, indent=2, sort_keys=True, ensure_ascii=True) + "\n")
    print(f"wrote {out} ({out.stat().st_size} bytes): " + ", ".join(f"{k}={v}" for k, v in rep.stats.items()))
    return 0


def _cmd_check(a: argparse.Namespace) -> int:
    rep = validate_dataset(json.loads(Path(a.file).read_text()))
    print("records: " + ", ".join(f"{k}={v}" for k, v in rep.stats.items()))
    for m in rep.warnings: print("WARN ", m)
    for m in rep.errors: print("ERROR", m)
    print("OK: compatible with this application" if not rep.errors else f"{len(rep.errors)} problem(s) found")
    return 1 if rep.errors else 0


def _cmd_seed(a: argparse.Namespace) -> int:
    import time
    data = json.loads(Path(a.file).read_text())
    rep = validate_dataset(data)
    if rep.errors:
        print("refusing to write: the file is not compatible with this application:\n  " + "\n  ".join(rep.errors)); return 1
    if not a.no_rebase:
        data = rebase(data, int(time.time() * 1000))
    branches = [b for b in BRANCHES if b in data and (b != "gripper_telemetry" or a.include_telemetry)]
    prefix = (a.prefix.strip("/") + "/") if a.prefix else ""
    print(f"target: {'(root)' if not prefix else prefix} · branches: {', '.join(branches)}" + (" · timestamps rebased to now" if not a.no_rebase else ""))
    if a.dry_run:
        print("dry run: nothing written"); return 0
    db = FirebaseRtdb(Settings())
    existing = [b for b in branches if db.get(prefix + b) is not None]
    if existing and not a.force:
        print(f"refusing to overwrite existing branches: {', '.join(existing)} (use --force, or --prefix demo)"); return 1
    for b in branches:
        db.set(prefix + b, data[b])
        print(f"wrote {prefix}{b}")
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m app.sample_data")
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("generate"); g.add_argument("--out", default=str(SAMPLE_PATH))
    g.add_argument("--gripper-id", default="demo-parallel-gripper", help="must equal GRIPPER_ID so the keys match your backend")
    g.add_argument("--pad-material", default="silicone", help="must equal GRIPPER_CONTACT_PAD_MATERIAL")
    g.add_argument("--fingers", type=int, default=2, help="must equal GRIPPER_FINGER_COUNT")
    g.set_defaults(fn=_cmd_generate)
    c = sub.add_parser("check"); c.add_argument("file"); c.set_defaults(fn=_cmd_check)
    s = sub.add_parser("seed")
    s.add_argument("--file", default=str(SAMPLE_PATH)); s.add_argument("--prefix", default="")
    s.add_argument("--no-rebase", action="store_true"); s.add_argument("--include-telemetry", action="store_true")
    s.add_argument("--force", action="store_true"); s.add_argument("--dry-run", action="store_true"); s.set_defaults(fn=_cmd_seed)
    a = ap.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
