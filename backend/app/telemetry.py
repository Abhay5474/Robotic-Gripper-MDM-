"""Normalisation of the hardware team's gripper_telemetry node. Never invents readings."""
from __future__ import annotations

import math
import time
from datetime import datetime
from typing import Any, Optional

from .schemas import TelemetrySample

HOLDING_HINTS = ("hold", "grip", "lift")


def parse_timestamp_ms(v: Any) -> Optional[int]:
    """Accepts epoch seconds, epoch milliseconds or an ISO-8601 string."""
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        if not math.isfinite(v) or v <= 0:
            return None
        return int(v * 1000) if v < 1e11 else int(v)
    if isinstance(v, str):
        try:
            return int(datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp() * 1000)
        except ValueError:
            return None
    return None


def _num(v: Any) -> Optional[float]:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        return None
    return float(v)


def _flag(v: Any) -> Optional[bool]:
    if isinstance(v, bool):
        return v
    if v in (0, 1) and isinstance(v, int):
        return bool(v)
    return None


def normalize_telemetry(raw: Any, stale_after_s: float, now_ms: Optional[int] = None) -> TelemetrySample:
    if not isinstance(raw, dict):
        return TelemetrySample(available=False, stale=True, reason="No telemetry node found in Firebase.")
    now_ms = int(time.time() * 1000) if now_ms is None else now_ms
    ts = parse_timestamp_ms(raw.get("timestamp"))
    age = None if ts is None else max(0.0, (now_ms - ts) / 1000.0)
    state = raw.get("operation_state")
    stale = age is None or age > stale_after_s
    reason = None
    if ts is None:
        reason = "Telemetry has no usable timestamp; freshness cannot be established."
    elif age is not None and age > stale_after_s:
        reason = f"Last telemetry is {age:.1f}s old (limit {stale_after_s:g}s)."
    return TelemetrySample(
        measured_force_n=_num(raw.get("measured_force_n")),
        finger_opening_mm=_num(raw.get("finger_opening_mm")),
        object_detected=_flag(raw.get("object_detected")),
        slip_detected=_flag(raw.get("slip_detected")),
        operation_state=state if isinstance(state, str) and state else None,
        timestamp_ms=ts,
        age_s=None if age is None else round(age, 2),
        stale=stale,
        available=True,
        reason=reason,
    )


def corroborates_success(t: TelemetrySample) -> tuple[bool, Optional[str]]:
    """True when fresh sensor data positively supports a held, non-slipping object."""
    if not t.available or t.stale:
        return False, t.reason or "Telemetry unavailable or stale."
    missing = [n for n in ("measured_force_n", "object_detected", "slip_detected") if getattr(t, n) is None]
    if missing:
        return False, "Telemetry missing: " + ", ".join(missing)
    if t.slip_detected:
        return False, "slip_detected is true"
    if not t.object_detected:
        return False, "object_detected is false"
    if t.measured_force_n is not None and t.measured_force_n <= 0:
        return False, "measured force is zero"
    return True, None
