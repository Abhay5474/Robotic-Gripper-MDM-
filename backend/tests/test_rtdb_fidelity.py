"""The in-memory RTDB must behave like the real one, or tests prove nothing about Firebase."""
import pytest

from app.rtdb import FirebaseRtdb, MemoryRtdb, RtdbError, TransactionAbort, from_rtdb, to_rtdb
from app.store import Store
from conftest import BOTTLE


def test_nulls_and_empty_containers_are_not_stored():
    db = MemoryRtdb()
    db.set("a", {"x": 1, "n": None, "e": {}, "l": [], "deep": {"only_null": None}})
    assert db.get("a") == {"x": 1}
    db.set("a/x", None)
    assert db.get("a") is None and db.get("") is None  # empty ancestors vanish too


def test_lists_round_trip_as_arrays_but_sparse_or_named_keys_stay_objects():
    db = MemoryRtdb()
    db.set("w", ["a", "b", "c"])
    assert db.get("w") == ["a", "b", "c"]
    assert db.get("w/1") == "b"
    db.set("s", {"0": "a", "2": "c"})
    assert db.get("s") == {"0": "a", "2": "c"}
    db.set("t", {"t_0001": {"event": "x"}})
    assert isinstance(db.get("t"), dict)


@pytest.mark.parametrize("bad", ["a.b", "a$", "a#b", "a[0]", "a/b", "", "x" * 800, "tab\tkey"])
def test_illegal_keys_are_rejected(bad):
    with pytest.raises(RtdbError):
        MemoryRtdb().set("n", {bad: 1})


def test_non_finite_numbers_rejected():
    with pytest.raises(RtdbError):
        to_rtdb({"v": float("nan")})


def test_transaction_returning_none_is_rejected_like_the_admin_sdk():
    db = MemoryRtdb()
    db.set("a", {"x": 1})
    with pytest.raises(RtdbError):
        db.transaction("a", lambda cur: None)
    assert db.get("a") == {"x": 1}


def test_object_with_unknown_contact_limit_survives_storage():
    """max_contact_force_n=None is dropped by RTDB; the app must read it back as 'unknown'."""
    from app.schemas import ObjectProperties
    db = MemoryRtdb()
    props = ObjectProperties(**{**BOTTLE, "max_contact_force_n": None}).model_dump()
    db.set("rec", {"input_properties": props})
    back = db.get("rec/input_properties")
    assert "max_contact_force_n" not in back
    assert ObjectProperties(**back).max_contact_force_n is None


def test_invalidation_uses_a_tombstone_and_never_a_null_transaction():
    db = MemoryRtdb()
    s = Store(db)
    rec = {"configuration_key": "cfg_" + "a" * 32, "calibration_id": "cal_0000000000001_aaaaaa", "calibrated_force": 9.0,
           "force_definition": "normal_force_per_finger", "force_unit": "N", "confirmed_at_ms": 5, "last_verified_at": "t"}
    assert s.promote_active("live", rec)[0]
    assert s.invalidate_active_if("live", rec["configuration_key"], rec["calibration_id"], 9)
    tomb = db.get(f"active_calibrations/{rec['configuration_key']}")
    assert tomb["calibration_status"] == "invalidated" and "calibrated_force" not in tomb and tomb["version"] == 2
    assert not s.invalidate_active_if("live", rec["configuration_key"], rec["calibration_id"], 10)  # already invalid
    newer = {**rec, "calibration_id": "cal_0000000000002_bbbbbb", "calibrated_force": 11.0, "confirmed_at_ms": 7}
    assert s.promote_active("live", newer)[0]  # a tombstone never blocks a fresh calibration
    assert db.get(f"active_calibrations/{rec['configuration_key']}")["calibrated_force"] == 11.0
    older = {**rec, "calibration_id": "cal_0000000000000_cccccc", "calibrated_force": 7.0, "confirmed_at_ms": 1}
    assert not s.promote_active("live", older)[0]  # but an older one still cannot overwrite a valid newer entry


def test_firebase_adapter_falls_back_when_the_index_rule_is_missing():
    class Q:
        def __init__(self, data): self.data = data
        def order_by_child(self, c): return self
        def equal_to(self, v): return self
        def limit_to_last(self, n): return self
        def get(self):
            raise RuntimeError('Index not defined, add ".indexOn": "configuration_key"')

    class Ref(Q):
        def get(self, **kw):
            if kw.get("q"): raise RuntimeError
            return self.data

    data = {"a": {"configuration_key": "k", "created_at_ms": 2}, "b": {"configuration_key": "z", "created_at_ms": 1}, "c": {"configuration_key": "k", "created_at_ms": 3}}

    class Root:
        def get(self, **kw): return data
        def order_by_child(self, c): return Missing()
    class Missing:
        def equal_to(self, v): return self
        def limit_to_last(self, n): return self
        def get(self): raise RuntimeError('Index not defined, add ".indexOn": "configuration_key"')
    class FakeDb:
        def reference(self, path, app=None): return Root()

    f = object.__new__(FirebaseRtdb)
    f._db, f._app = FakeDb(), None
    assert set(f.query_equal("grip_calibrations", "configuration_key", "k")) == {"a", "c"}
    assert list(f.query_last("grip_calibrations", "created_at_ms", 2)) == ["a", "c"]
    # unrelated errors are still surfaced
    class Boom(Missing):
        def get(self): raise RuntimeError("permission denied")
    class Root2(Root):
        def order_by_child(self, c): return Boom()
    class FakeDb2:
        def reference(self, path, app=None): return Root2()
    f._db = FakeDb2()
    with pytest.raises(RtdbError):
        f.query_equal("grip_calibrations", "configuration_key", "k")


def test_falsy_values_are_real_values():
    db = MemoryRtdb()
    db.set("z", {"zero": 0, "off": False, "blank": "", "f": 0.0})
    assert db.get("z/zero") == 0 and db.get("z/off") is False and db.get("z/blank") == "" and db.get("z/f") == 0.0
