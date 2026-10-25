"""Feasibility / safety assessment for a selected gripping force.

Model: vertical pick of a rigid object held by `finger_count` friction contacts.
    N_required = m * (g + a) / (finger_count * mu)      [N per finger]
with a safety factor applied for the recommended minimum. This is a simplified
estimate: it does not model torque, pad compliance, dynamic loads or object
deformation. It is NOT a validation of safety; hardware validation is required.

Mirrored in frontend/src/lib/safety.ts; both are verified against
shared/safety_cases.json.
"""
from __future__ import annotations

import math
from typing import Optional

from .schemas import (
    CANONICAL_FORCE_DEFINITION,
    FORCE_UNIT,
    GripperLimits,
    ObjectProperties,
    SafetyAssessment,
    SafetyCheck,
)

G = 9.80665
EPS = 1e-9
DISCLAIMER = (
    "Estimate based on a simplified friction model and unvalidated inputs. "
    "Not a guarantee of safety; the hardware team must validate force ranges on the real gripper."
)


def required_min_force_n(obj: ObjectProperties, limits: GripperLimits) -> float:
    mass_kg = obj.mass_g / 1000.0
    return mass_kg * (G + limits.lift_acceleration_m_s2) / (limits.finger_count * obj.friction_coefficient)


def _r(x: float) -> float:
    return round(x, 3)


def assess(
    obj: ObjectProperties,
    limits: GripperLimits,
    force_n: Optional[float],
    force_definition: str = CANONICAL_FORCE_DEFINITION,
    force_unit: str = FORCE_UNIT,
) -> SafetyAssessment:
    checks: list[SafetyCheck] = []

    def add(id_: str, passed: bool, severity: str, message: str) -> None:
        checks.append(SafetyCheck(id=id_, passed=passed, severity=severity, message=message))  # type: ignore[arg-type]

    def result(status: str, summary: str, **kw) -> SafetyAssessment:
        base = dict(
            selected_force_n=None if force_n is None or not math.isfinite(force_n) else _r(force_n),
            required_min_force_n=None,
            recommended_min_force_n=None,
            upper_limit_n=None,
            upper_limit_source=None,
            safe_range_n=None,
            can_test=False,
            can_save_as_calibrated=False,
            requires_override=False,
        )
        base.update(kw)
        return SafetyAssessment(status=status, checks=checks, summary=summary, disclaimer=DISCLAIMER, **base)  # type: ignore[arg-type]

    # ---- definition / unit / numeric validity
    def_ok = force_definition == limits.force_definition
    unit_ok = force_unit == limits.force_unit == FORCE_UNIT
    add("force_definition", def_ok, "blocking",
        f"Force is '{force_definition}'; gripper expects '{limits.force_definition}'." if not def_ok
        else f"Force definition: {force_definition}.")
    add("force_unit", unit_ok, "blocking",
        f"Force unit '{force_unit}' is not supported (expected {FORCE_UNIT})." if not unit_ok
        else f"Force unit: {force_unit}.")
    valid_number = force_n is not None and math.isfinite(force_n) and force_n > 0
    add("force_numeric", valid_number, "blocking", "Force must be a finite positive number." if not valid_number else "Force is a valid number.")
    if not (def_ok and unit_ok and valid_number):
        return result("invalid", "Force value, unit or definition is invalid.")
    assert force_n is not None

    # ---- geometry
    fits = obj.width_mm <= limits.max_opening_mm + EPS
    add("object_fits", fits, "blocking",
        f"Object width {obj.width_mm:g} mm exceeds the gripper opening {limits.max_opening_mm:g} mm." if not fits
        else f"Object width {obj.width_mm:g} mm fits the {limits.max_opening_mm:g} mm opening.")

    # ---- limits and holding requirement
    req = required_min_force_n(obj, limits)
    rec = req * limits.holding_safety_factor
    upper, upper_src = limits.max_force_n, "gripper_max"
    if obj.max_contact_force_n is not None and obj.max_contact_force_n < upper:
        upper, upper_src = obj.max_contact_force_n, "object_max_contact"
    lower_hard = max(limits.min_force_n, req)
    lower_margin = max(limits.min_force_n, rec)
    ctx = dict(
        required_min_force_n=_r(req), recommended_min_force_n=_r(rec),
        upper_limit_n=_r(upper), upper_limit_source=upper_src,
    )

    if obj.max_contact_force_n is None:
        add("contact_limit_known", False, "warning" if obj.fragility != "robust" else "info",
            "No maximum allowable contact force was provided; only the gripper maximum is enforced.")
    else:
        add("contact_limit_known", True, "info", f"Object contact-force limit: {obj.max_contact_force_n:g} N.")

    range_exists = fits and lower_hard <= upper + EPS
    add("safe_range_exists", range_exists, "blocking",
        f"Estimated minimum {_r(lower_hard)} N exceeds the permitted maximum {_r(upper)} N ({upper_src.replace('_', ' ')}); no safe range can be established."
        if fits and not range_exists else
        ("Cannot assess range: object does not fit the gripper." if not fits else
         f"Estimated permitted range {_r(lower_hard)}-{_r(upper)} N."))
    if not range_exists:
        return result("no_safe_range", "No safe operating range can be established for this object and gripper.", **ctx)

    margin_ok = lower_margin <= upper + EPS
    safe_range = (_r(lower_margin if margin_ok else lower_hard), _r(upper))
    ctx["safe_range_n"] = safe_range
    add("safety_margin_available", margin_ok, "warning",
        f"Safety factor {limits.holding_safety_factor:g} cannot be met within the permitted maximum; margin is reduced." if not margin_ok
        else f"Safety factor {limits.holding_safety_factor:g} is achievable.")

    below_min = force_n < limits.min_force_n - EPS
    above = force_n > upper + EPS
    add("above_gripper_minimum", not below_min, "blocking", f"Force {_r(force_n)} N vs gripper minimum {limits.min_force_n:g} N.")
    add("below_upper_limit", not above, "blocking",
        f"Force {_r(force_n)} N exceeds the {upper_src.replace('_', ' ')} limit of {_r(upper)} N." if above
        else f"Force is within the {upper_src.replace('_', ' ')} limit of {_r(upper)} N.")
    holds = force_n >= req - EPS
    add("meets_holding_requirement", holds, "warning",
        f"Force {_r(force_n)} N is below the estimated holding requirement {_r(req)} N (the object is likely to slip)." if not holds
        else f"Force meets the estimated holding requirement {_r(req)} N.")
    has_margin = force_n >= lower_margin - EPS
    add("meets_safety_margin", has_margin, "warning",
        f"Force {_r(force_n)} N is below the recommended {_r(lower_margin)} N (holding requirement x {limits.holding_safety_factor:g})." if not has_margin
        else "Force includes the configured safety margin.")

    if below_min:
        return result("below_minimum", f"Below the gripper minimum of {limits.min_force_n:g} N.", **ctx)
    if above:
        return result("exceeds_limit", f"Exceeds the permitted maximum of {_r(upper)} N ({upper_src.replace('_', ' ')}).", **ctx)
    if not holds:
        return result("below_required", "Below the estimated holding requirement; likely to slip.",
                      can_test=True, requires_override=True, **ctx)
    if not has_margin:
        return result("marginal", "Meets the holding estimate but not the full safety margin.",
                      can_test=True, can_save_as_calibrated=True, **ctx)
    return result("ok", "Within the estimated permitted range (unvalidated).",
                  can_test=True, can_save_as_calibrated=True, **ctx)
