"""Deterministic configuration keys.

The key covers every property that materially changes the force a grasp needs:
object id, mass, dimensions, material, friction estimate, fragility and the
gripper identity / force definition. Display names are NOT part of the key.
Limits (gripper max force, object max contact force) are re-checked at lookup
time instead of being keyed, so tightening a limit invalidates reuse explicitly.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from .schemas import GripperLimits, ObjectProperties

SCHEMA = "gripsense.config.v1"


def _norm_text(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip().lower())


def normalize_configuration(obj: ObjectProperties, limits: GripperLimits) -> dict[str, Any]:
    return normalize_with_gripper(obj, limits.configuration())


def normalize_with_gripper(obj: ObjectProperties, gripper_configuration: dict[str, Any]) -> dict[str, Any]:
    """Same normalisation from a stored gripper_configuration (used to re-verify records read from the DB)."""
    return {
        "schema": SCHEMA,
        "object_id": obj.object_id,
        "mass_g": round(obj.mass_g, 1),
        "width_mm": round(obj.width_mm, 1),
        "height_mm": round(obj.height_mm, 1),
        "depth_mm": round(obj.depth_mm, 1),
        "material": _norm_text(obj.material),
        "friction_coefficient": round(obj.friction_coefficient, 2),
        "fragility": obj.fragility,
        "gripper": gripper_configuration,
    }


def configuration_key(normalized: dict[str, Any]) -> str:
    canonical = json.dumps(normalized, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return "cfg_" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:32]
