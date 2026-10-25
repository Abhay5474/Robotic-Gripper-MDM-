import json
from pathlib import Path

import pytest

from app.config_key import configuration_key, normalize_configuration
from app.safety import assess
from app.schemas import GripperLimits, ObjectProperties
from app.service import limits_from_settings
from app.config import Settings
from conftest import BOTTLE

DATA = json.loads((Path(__file__).parents[2] / "shared" / "safety_cases.json").read_text())
LIMITS = GripperLimits(**DATA["limits"])


@pytest.mark.parametrize("case", DATA["cases"], ids=lambda c: c["name"])
def test_shared_safety_cases(case):
    a = assess(ObjectProperties(**case["object"]), LIMITS, case["force_n"])
    for field, expected in case["expected"].items():
        assert getattr(a, field) == expected, field
    assert a.disclaimer and "guarantee" in a.disclaimer


def test_infeasible_force_is_never_ok():
    obj = ObjectProperties(**{**BOTTLE, "max_contact_force_n": 5})  # needs >=5.17 N but may not exceed 5 N
    for f in (1.0, 3.0, 5.0, 8.0, 40.0):
        a = assess(obj, LIMITS, f)
        assert a.status == "no_safe_range" and not a.can_save_as_calibrated and not a.can_test


def test_wrong_force_definition_or_unit_is_invalid():
    obj = ObjectProperties(**BOTTLE)
    assert assess(obj, LIMITS, 8, force_definition="total_actuator_force").status == "invalid"
    assert assess(obj, LIMITS, 8, force_unit="lbf").status == "invalid"
    assert assess(obj, LIMITS, float("nan")).status == "invalid"


def test_fragile_without_known_limit_is_warned():
    obj = ObjectProperties(**{**BOTTLE, "fragility": "fragile", "max_contact_force_n": None})
    a = assess(obj, LIMITS, 8)
    assert any(c.id == "contact_limit_known" and not c.passed and c.severity == "warning" for c in a.checks)


# --- configuration key
def test_key_is_deterministic_and_property_sensitive():
    lim = limits_from_settings(Settings(_env_file=None))
    k = lambda **o: configuration_key(normalize_configuration(ObjectProperties(**{**BOTTLE, **o}), lim))
    base = k()
    assert base == k() and base.startswith("cfg_") and len(base) == 36
    assert k(name="Other label", max_contact_force_n=3) == base  # name & limits are not keyed
    assert k(material="  pet   PLASTIC ") == base  # normalised text
    assert k(mass_g=350.04) == base  # sub-resolution noise
    for change in ({"mass_g": 351}, {"width_mm": 66}, {"height_mm": 211}, {"depth_mm": 66}, {"material": "glass"},
                   {"friction_coefficient": 0.41}, {"fragility": "fragile"}, {"object_id": "other"}):
        assert k(**change) != base, change
    other_gripper = limits_from_settings(Settings(_env_file=None, gripper_id="other", gripper_contact_pad_material="rubber"))
    assert configuration_key(normalize_configuration(ObjectProperties(**BOTTLE), other_gripper)) != base
