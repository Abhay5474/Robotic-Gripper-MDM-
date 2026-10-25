"""Versioned LLM prompt for the initial force recommendation."""
from __future__ import annotations

import json

from .safety import G
from .schemas import GripperLimits, ObjectProperties

PROMPT_VERSION = "force-estimate-v1"

SYSTEM_PROMPT = """You are a robotics grasp-planning assistant. You estimate an INITIAL nominal gripping force \
for a two-finger parallel gripper that will pick up, hold and release a single object.

Rules:
- Your number is only a starting point that a human will test and adjust on real hardware. It is not validated and not guaranteed safe.
- The force quantity MUST be the normal (squeeze) force applied by EACH finger pad, in newtons. \
Declare this as force_definition = "normal_force_per_finger" and force_unit = "N". Never report total actuator force.
- Respect the gripper force limits and the object's maximum allowable contact force when it is given. \
If the constraints cannot be satisfied together, say so in "warnings" and still give your best estimate within the gripper limits.
- Account for friction (Coulomb model), the object's weight, the lift acceleration and a reasonable safety margin, and prefer lower forces for fragile objects.
- Respond with ONE JSON object and nothing else (no prose, no markdown fences) using exactly these keys:
  {"recommended_force": number, "force_definition": "normal_force_per_finger", "force_definition_note": string,
   "force_unit": "N", "confidence": "low"|"medium"|"high", "rationale": string (<= 600 chars),
   "assumptions": [string], "warnings": [string]}"""


def build_user_prompt(obj: ObjectProperties, limits: GripperLimits) -> str:
    weight_n = obj.mass_g / 1000.0 * G
    design_load_n = obj.mass_g / 1000.0 * (G + limits.lift_acceleration_m_s2)
    payload = {
        "object": {
            "name": obj.name,
            "mass_g": obj.mass_g,
            "dimensions_mm": {"width_between_finger_pads": obj.width_mm, "height": obj.height_mm, "depth": obj.depth_mm},
            "material": obj.material,
            "estimated_friction_coefficient": obj.friction_coefficient,
            "fragility": obj.fragility,
            "max_allowable_contact_force_n_per_finger": obj.max_contact_force_n,
        },
        "gripper": {
            "type": "two-finger parallel gripper" if limits.finger_count == 2 else f"{limits.finger_count}-finger gripper",
            "finger_count": limits.finger_count,
            "contact_pad_material": limits.contact_pad_material,
            "force_range_n_per_finger": {"min": limits.min_force_n, "max": limits.max_force_n},
            "max_opening_mm": limits.max_opening_mm,
        },
        "lifting": {
            "task": "vertical lift, hold, then release",
            "weight_n": round(weight_n, 3),
            "lift_acceleration_m_s2": limits.lift_acceleration_m_s2,
            "design_vertical_load_n": round(design_load_n, 3),
        },
    }
    return (
        "Estimate the initial gripping force (normal force per finger, in newtons) for this task.\n"
        + json.dumps(payload, indent=2)
    )
