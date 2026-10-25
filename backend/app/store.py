"""Domain persistence on top of an RtdbClient.

Branches (see docs/FIREBASE_INTEGRATION.md):
  grip_predictions/{id}      immutable LLM recommendations
  grip_calibrations/{id}     calibration sessions + confirmed results (audit trail)
  active_calibrations/{key}  index -> latest valid calibration (transactional)
  operations/{id}            pick-and-place operation history
  <telemetry_path>           written by the hardware team (read-only here)
Demo-mode data lives under the `demo/` prefix so it can never be mistaken for hardware data.
"""
from __future__ import annotations

import re
import secrets
import time
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from .rtdb import RtdbClient, TransactionAbort

KEY_RE = re.compile(r"^cfg_[0-9a-f]{32}$")
ID_RE = re.compile(r"^(cal|pred|op)_[0-9]{10,}_[0-9a-f]{6}$")


def now_ms() -> int:
    return int(time.time() * 1000)


def iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat(timespec="milliseconds")


def new_id(prefix: str, ms: Optional[int] = None) -> str:
    return f"{prefix}_{ms or now_ms():013d}_{secrets.token_hex(3)}"


class Store:
    def __init__(self, db: RtdbClient, telemetry_path: str = "gripper_telemetry", clock: Callable[[], int] = now_ms):
        self.db, self.telemetry_path, self.clock = db, telemetry_path, clock

    # -------------------------------------------------------------- paths --
    @staticmethod
    def _p(mode: str, branch: str, *parts: str) -> str:
        for part in parts:
            if not re.fullmatch(r"[A-Za-z0-9_-]+", part):
                raise ValueError(f"illegal path segment {part!r}")
        prefix = "demo/" if mode == "demo" else ""
        return prefix + "/".join((branch, *parts))

    def stamp(self) -> dict[str, Any]:
        ms = self.clock()
        return {"at": iso(ms), "ms": ms}

    def ping(self) -> None:
        self.db.ping()

    # -------------------------------------------------------- predictions --
    def save_prediction(self, mode: str, rec: dict) -> None:
        self.db.set(self._p(mode, "grip_predictions", rec["prediction_id"]), rec)

    def get_prediction(self, mode: str, pid: str) -> Optional[dict]:
        return self.db.get(self._p(mode, "grip_predictions", pid))

    # ------------------------------------------------------- calibrations --
    def get_active(self, mode: str, key: str) -> Optional[dict]:
        return self.db.get(self._p(mode, "active_calibrations", key))

    def get_calibration(self, mode: str, cid: str) -> Optional[dict]:
        return self.db.get(self._p(mode, "grip_calibrations", cid))

    def create_calibration(self, mode: str, rec: dict) -> None:
        self.db.set(self._p(mode, "grip_calibrations", rec["calibration_id"]), rec)

    def update_calibration(self, mode: str, cid: str, values: dict) -> None:
        self.db.update(self._p(mode, "grip_calibrations", cid), values)

    def append_test(self, mode: str, cid: str, event: dict) -> str:
        """Atomically append to the ordered test log; returns the new test id (t_0001, ...)."""
        holder: dict[str, str] = {}

        def fn(cur: Optional[dict]) -> dict:
            cur = dict(cur or {})
            holder["id"] = f"t_{len(cur) + 1:04d}"
            cur[holder["id"]] = {**event, "seq": len(cur) + 1}
            return cur

        self.db.transaction(self._p(mode, "grip_calibrations", cid, "tests"), fn)
        return holder["id"]

    def list_calibrations_for_key(self, mode: str, key: str) -> list[dict]:
        found = self.db.query_equal(self._p(mode, "grip_calibrations"), "configuration_key", key)
        return sorted(found.values(), key=lambda r: r.get("created_at_ms", 0), reverse=True)

    def list_recent_calibrations(self, mode: str, limit: int) -> list[dict]:
        found = self.db.query_last(self._p(mode, "grip_calibrations"), "created_at_ms", limit)
        return sorted(found.values(), key=lambda r: r.get("created_at_ms", 0), reverse=True)

    def promote_active(self, mode: str, record: dict) -> tuple[bool, dict]:
        """Point active_calibrations/{key} at `record` unless a newer calibration already holds it.

        Atomic (RTDB transaction). Ordering is (confirmed_at_ms, calibration_id) so concurrent
        confirmations converge on the same winner regardless of arrival order.
        """
        new_rank = (record["confirmed_at_ms"], record["calibration_id"])

        def fn(cur: Optional[dict]) -> dict:
            if cur and cur.get("calibration_id") != record["calibration_id"]:
                if (cur.get("confirmed_at_ms", 0), cur.get("calibration_id", "")) > new_rank:
                    raise TransactionAbort()
            return {
                "calibration_id": record["calibration_id"],
                "calibrated_force": record["calibrated_force"],
                "force_definition": record["force_definition"],
                "force_unit": record["force_unit"],
                "calibration_status": "calibrated",
                "last_verified_at": record["last_verified_at"],
                "confirmed_at_ms": record["confirmed_at_ms"],
                "version": int((cur or {}).get("version", 0)) + 1,
            }

        return self.db.transaction(self._p(mode, "active_calibrations", record["configuration_key"]), fn)

    def clear_active_if(self, mode: str, key: str, cid: str) -> bool:
        def fn(cur: Optional[dict]):
            if not cur or cur.get("calibration_id") != cid:
                raise TransactionAbort()
            return None

        committed, _ = self.db.transaction(self._p(mode, "active_calibrations", key), fn)
        return committed

    # --------------------------------------------------------- operations --
    def save_operation(self, mode: str, rec: dict) -> None:
        self.db.set(self._p(mode, "operations", rec["operation_id"]), rec)

    def list_operations(self, mode: str, limit: int) -> list[dict]:
        found = self.db.query_last(self._p(mode, "operations"), "timestamp_ms", limit)
        return sorted(found.values(), key=lambda r: r.get("timestamp_ms", 0), reverse=True)

    # ---------------------------------------------- telemetry / commands --
    def read_telemetry_raw(self) -> Any:
        return self.db.get(self.telemetry_path)

    def write_command(self, path: str, cmd_id: str, cmd: dict) -> None:
        self.db.set(f"{path}/{cmd_id}", cmd)
