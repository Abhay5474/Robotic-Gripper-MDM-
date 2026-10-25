"""LLM validation, Firebase / LLM failure handling, telemetry, auth, operations (scenarios 15-17 + misc)."""
import json
import time

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.llm import LLMError, extract_json_object
from app.main import create_app
from app.rtdb import MemoryRtdb, RtdbError
from app.telemetry import normalize_telemetry
from conftest import BOTTLE, FakeLLM, calibrate, predict


# --------------------------------------------------------------- LLM output
@pytest.mark.parametrize("bad", [
    "I think about 8 newtons",
    FakeLLM.ok(8, definition="total_actuator_force"),
    FakeLLM.ok(8, unit="lbf"),
    FakeLLM.ok(-3),
    FakeLLM.ok(0),
    FakeLLM.ok(100000),  # nonsensical vs 40 N gripper
    json.dumps({"recommended_force": "lots", "force_definition": "normal_force_per_finger", "force_unit": "N"}),
    json.dumps({"recommended_force": 5}),
])
def test_invalid_llm_output_is_rejected_not_fabricated(client, llm, bad):
    llm.responses = [bad, bad]
    r = predict(client, BOTTLE)
    assert r.status_code == 502 and r.json()["detail"]["code"] == "llm_invalid_response"
    assert llm.calls == 2  # one retry then give up


def test_malformed_then_valid_retries_once(client, llm):
    llm.responses = ["garbage", FakeLLM.ok(9)]
    r = predict(client, BOTTLE)
    assert r.status_code == 200 and r.json()["selected_force_n"] == 9 and llm.calls == 2


def test_fenced_json_is_accepted():
    assert extract_json_object('```json\n{"a": 1}\n```') == {"a": 1}
    assert extract_json_object('Sure! {"a": 1} hope that helps') == {"a": 1}


def test_out_of_range_but_plausible_force_is_flagged_not_hidden(client, llm):
    llm.force = 60.0  # > 40 N gripper max, < 10x
    body = predict(client, BOTTLE).json()
    assert body["prediction"]["llm_recommended_force"] == 60.0  # raw value preserved
    assert body["selected_force_n"] == 40.0 and body["selected_force_note"]
    assert body["safety"]["status"] == "exceeds_limit"  # bottle limit is 20 N


# ---------------------------------------------------------- scenario 15: failures
def test_llm_unavailable_returns_error_without_force(client, llm):
    llm.responses = [LLMError("llm_unavailable", "down")]
    r = predict(client, BOTTLE)
    assert r.status_code == 503 and r.json()["detail"]["code"] == "llm_unavailable"
    assert "selected_force_n" not in r.json()


def test_unconfigured_llm_reports_configuration_error(db):
    app = create_app(Settings(store_backend="memory", llm_provider="anthropic", llm_api_key=None, _env_file=None), db=db)
    c = TestClient(app, headers={"X-GripSense-Mode": "live"})
    r = predict(c, BOTTLE)
    assert r.status_code == 503 and r.json()["detail"]["code"] == "llm_not_configured"
    assert c.get("/api/health").json()["llm"]["configured"] is False


def test_firebase_down_blocks_prediction_and_offers_explicit_fallback(client, llm, db):
    db.fail_with = RtdbError("connection refused")
    r = predict(client, BOTTLE)
    assert r.status_code == 503
    d = r.json()["detail"]
    assert d["code"] == "store_unavailable" and d["retryable"] and d["fallback_available"]
    assert llm.calls == 0, "must not query the LLM when a calibration might exist"
    ok = predict(client, BOTTLE, allow_without_calibration_check=True)
    assert ok.status_code == 200
    b = ok.json()
    assert llm.calls == 1 and b["calibration_lookup"]["state"] == "unavailable"
    assert b["prediction"]["persisted"] is False
    assert any("SKIPPED" in m for m in b["messages"])
    assert b["calibration_status"] == "uncalibrated"  # never claims a calibration it did not retrieve


def test_firebase_down_during_confirm_is_reported(client, db, bottle=None):
    pred = predict(client, BOTTLE).json()
    cid, _ = calibrate(client, BOTTLE, pred, 9.0, confirm=False)
    db.fail_with = RtdbError("timeout")
    r = client.post(f"/api/calibrations/{cid}/confirm", json={
        "outcome": "success", "final_force_n": 9.0,
        "user_confirmation": {"held_and_lifted": True, "no_slip": True, "no_damage": True}})
    assert r.status_code == 503 and r.json()["detail"]["code"] == "store_unavailable"
    db.fail_with = None
    assert db.get(f"active_calibrations/{pred['configuration_key']}") is None  # nothing half-saved as active


def test_index_confirm_retry_is_idempotent(client, db):
    pred = predict(client, BOTTLE).json()
    cid, r = calibrate(client, BOTTLE, pred, 9.0)
    db.delete(f"active_calibrations/{pred['configuration_key']}")  # simulate lost index write
    body = {"outcome": "success", "final_force_n": 9.0,
            "user_confirmation": {"held_and_lifted": True, "no_slip": True, "no_damage": True}}
    again = client.post(f"/api/calibrations/{cid}/confirm", json=body)
    assert again.status_code == 200 and again.json()["retry"] is True
    assert db.get(f"active_calibrations/{pred['configuration_key']}")["calibration_id"] == cid


def test_inconsistent_index_is_not_trusted(client, db, llm):
    pred = predict(client, BOTTLE).json()
    db.set(f"active_calibrations/{pred['configuration_key']}", {"calibration_id": "cal_0000000000001_aaaaaa", "calibrated_force": 9.0})
    b = predict(client, BOTTLE).json()
    assert b["calibration_lookup"]["state"] == "inconsistent" and b["source"] == "llm" and b["calibration_status"] == "uncalibrated"


def test_health_reports_store_failure(client, db):
    db.fail_with = RtdbError("x")
    h = client.get("/api/health").json()
    assert h["status"] == "degraded" and h["store"]["reachable"] is False
    assert h["limits"]["limits_source"] == "demo"


# ------------------------------------------------------- scenario 16: telemetry
NOW = 1_700_000_000_000


def test_fresh_and_stale_telemetry():
    raw = {"measured_force_n": 5.2, "finger_opening_mm": 60, "object_detected": True, "slip_detected": False,
           "operation_state": "holding", "timestamp": NOW - 1000}
    fresh = normalize_telemetry(raw, 5.0, NOW)
    assert not fresh.stale and fresh.age_s == 1.0 and fresh.measured_force_n == 5.2
    stale = normalize_telemetry({**raw, "timestamp": NOW - 30_000}, 5.0, NOW)
    assert stale.stale and "30.0s" in stale.reason


def test_missing_fields_are_none_not_fabricated():
    t = normalize_telemetry({"timestamp": (NOW - 100) / 1000}, 5.0, NOW)  # epoch seconds
    assert t.available and not t.stale
    assert t.measured_force_n is None and t.slip_detected is None and t.object_detected is None
    assert normalize_telemetry(None, 5.0, NOW).available is False
    assert normalize_telemetry({"measured_force_n": 3}, 5.0, NOW).stale  # no timestamp => freshness unknown


def test_bad_values_are_discarded():
    t = normalize_telemetry({"measured_force_n": "abc", "object_detected": "yes", "slip_detected": 1, "timestamp": NOW}, 5, NOW)
    assert t.measured_force_n is None and t.object_detected is None and t.slip_detected is True


def test_telemetry_endpoint(client, db):
    assert client.get("/api/telemetry/latest").json()["available"] is False
    db.set("gripper_telemetry", {"measured_force_n": 4.0, "timestamp": int(time.time() * 1000)})
    t = client.get("/api/telemetry/latest").json()
    assert t["available"] and not t["stale"] and t["measured_force_n"] == 4.0 and t["slip_detected"] is None
    db.fail_with = RtdbError("x")
    assert client.get("/api/telemetry/latest").status_code == 503


# ---------------------------------------------- sensor-assisted confirmation
def _confirm(client, cid, f):
    return client.post(f"/api/calibrations/{cid}/confirm", json={
        "outcome": "success", "final_force_n": f,
        "user_confirmation": {"held_and_lifted": True, "no_slip": True, "no_damage": True}})


def _telemetry(db, **kw):
    db.set("gripper_telemetry", {"measured_force_n": 9.0, "finger_opening_mm": 65, "object_detected": True,
                                 "slip_detected": False, "operation_state": "holding", "timestamp": int(time.time() * 1000), **kw})


def test_sensor_assisted_when_fresh_telemetry_corroborates(client, db):
    pred = predict(client, BOTTLE).json()
    cid, _ = calibrate(client, BOTTLE, pred, 9.0, confirm=False)
    _telemetry(db)
    rec = _confirm(client, cid, 9.0).json()["record"]
    assert rec["confirmation_method"] == "sensor_assisted" and rec["sensor_summary"]["snapshot"]["measured_force_n"] == 9.0


def test_manual_when_telemetry_stale_or_missing(client, db):
    pred = predict(client, BOTTLE).json()
    cid, r = calibrate(client, BOTTLE, pred, 9.0)  # no telemetry at all
    rec = r.json()["record"]
    assert rec["confirmation_method"] == "manual" and rec["sensor_summary"]["corroborated"] is False
    assert any("Manually confirmed" in w for w in rec["warnings"])
    cid2, _ = calibrate(client, BOTTLE, None, 10.0, confirm=False, based_on=cid)
    _telemetry(db, timestamp=int(time.time() * 1000) - 60_000)
    assert _confirm(client, cid2, 10.0).json()["record"]["confirmation_method"] == "manual"


def test_sensor_slip_blocks_confirmation(client, db):
    pred = predict(client, BOTTLE).json()
    cid, _ = calibrate(client, BOTTLE, pred, 9.0, confirm=False)
    _telemetry(db, slip_detected=True)
    r = _confirm(client, cid, 9.0)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "sensor_slip_detected"
    assert db.get(f"active_calibrations/{pred['configuration_key']}") is None


def test_reaching_target_force_alone_does_not_confirm(client, db):
    """Measured force == target is not a success signal; explicit user confirmation is mandatory."""
    pred = predict(client, BOTTLE).json()
    cid, _ = calibrate(client, BOTTLE, pred, 9.0, confirm=False)
    _telemetry(db, measured_force_n=9.0)
    assert client.get(f"/api/calibrations/{pred['configuration_key']}").status_code == 404


def test_demo_mode_confirmation_is_manual_and_flagged(client):
    h = {"X-GripSense-Mode": "demo"}
    pred = client.post("/api/predict-grip", json={"object": BOTTLE}, headers=h).json()
    cid = client.post("/api/calibrations", json={"object": BOTTLE, "initial_force_n": 9.0, "prediction_id": pred["prediction"]["prediction_id"]}, headers=h).json()["calibration_id"]
    client.post(f"/api/calibrations/{cid}/tests", json={"event": "test_started", "force_n": 9.0}, headers=h)
    rec = client.post(f"/api/calibrations/{cid}/confirm", headers=h, json={
        "outcome": "success", "final_force_n": 9.0,
        "user_confirmation": {"held_and_lifted": True, "no_slip": True, "no_damage": True}}).json()["record"]
    assert rec["mode"] == "demo" and rec["confirmation_method"] == "manual"
    assert any("DEMO MODE" in w for w in rec["warnings"])


# ---------------------------------------------------------------- operations
def _op(key, **kw):
    return {"object_id": "plastic-bottle", "configuration_key": key, "selected_force_n": 9.0, "calibration_status": "uncalibrated",
            "operation_result": "success", "data_source": "manual", **kw}


def test_operations_roundtrip_and_mode_rules(client):
    key = predict(client, BOTTLE).json()["configuration_key"]
    assert client.post("/api/operations", json=_op(key)).status_code == 201
    assert client.post("/api/operations", json=_op(key, data_source="simulated")).status_code == 422  # sim in live
    demo = client.post("/api/operations", json=_op(key, data_source="simulated"), headers={"X-GripSense-Mode": "demo"})
    assert demo.status_code == 201
    assert len(client.get("/api/operations").json()["operations"]) == 1
    assert len(client.get("/api/operations", headers={"X-GripSense-Mode": "demo"}).json()["operations"]) == 1
    assert client.post("/api/operations", json=_op("bad-key")).status_code == 422


# ----------------------------------------------------- command channel / auth
def test_command_channel_not_configured_by_default(client):
    key = predict(client, BOTTLE).json()["configuration_key"]
    r = client.post("/api/commands/force-target", json={"configuration_key": key, "object": BOTTLE, "target_force_n": 9})
    assert r.status_code == 501 and "has NOT received" in r.json()["detail"]["message"]


def test_command_channel_rtdb_validates_and_never_claims_ack(db, llm):
    s = Settings(store_backend="memory", llm_provider="mock", command_channel="rtdb", _env_file=None)
    c = TestClient(create_app(s, db=db, llm=llm), headers={"X-GripSense-Mode": "live"})
    key = predict(c, BOTTLE).json()["configuration_key"]
    ok = c.post("/api/commands/force-target", json={"configuration_key": key, "object": BOTTLE, "target_force_n": 9}).json()
    assert ok["acknowledged_by_hardware"] is False and list(db.get("gripper_commands").values())[0]["status"] == "pending"
    assert c.post("/api/commands/force-target", json={"configuration_key": key, "object": BOTTLE, "target_force_n": 30}).status_code == 422


def test_bearer_auth(db, llm):
    s = Settings(store_backend="memory", llm_provider="mock", auth_mode="bearer", api_bearer_token="s3cret", _env_file=None)
    c = TestClient(create_app(s, db=db, llm=llm), headers={"X-GripSense-Mode": "live"})
    assert c.get("/api/health").status_code == 200
    assert "s3cret" not in c.get("/api/health").text
    assert predict(c, BOTTLE).status_code == 401
    r = c.post("/api/predict-grip", json={"object": BOTTLE}, headers={"Authorization": "Bearer wrong"})
    assert r.status_code == 401
    r = c.post("/api/predict-grip", json={"object": BOTTLE}, headers={"Authorization": "Bearer s3cret"})
    assert r.status_code == 200


def test_production_refuses_dev_backends(db):
    with pytest.raises(RuntimeError):
        create_app(Settings(app_env="production", store_backend="memory", llm_provider="anthropic", _env_file=None), db=db)


def test_objects_endpoint_lists_all_presets(client):
    names = [p["name"] for p in client.get("/api/objects").json()["presets"]]
    assert names == ["Plastic bottle", "Aluminum can", "Wooden block", "Cardboard box", "Rubber ball", "Ceramic cup", "Fragile object", "Custom object"]


def test_object_validation(client):
    for bad in ({"mass_g": 0}, {"mass_g": -5}, {"friction_coefficient": 3}, {"width_mm": 0}, {"fragility": "tough"},
                {"object_id": "Bad Id!"}, {"max_contact_force_n": 0}, {"name": ""}):
        assert predict(client, {**BOTTLE, **bad}).status_code == 422, bad
    assert predict(client, {**BOTTLE, "unknown": 1}).status_code == 422


# ------------------------------------------------------- Firebase adapter
def test_firebase_adapter_wraps_sdk_errors_and_aborts():
    from app.rtdb import FirebaseRtdb, TransactionAbort

    class Ref:
        def get(self, **kw): raise ConnectionError("net down")
        def transaction(self, fn): return fn({"v": 1})

    class FakeDb:
        def reference(self, path, app=None): return Ref()

    f = object.__new__(FirebaseRtdb)
    f._db, f._app = FakeDb(), None
    with pytest.raises(RtdbError):
        f.get("a/b")
    assert f.transaction("a", lambda cur: {"v": cur["v"] + 1}) == (True, {"v": 2})

    def abort(cur): raise TransactionAbort()
    class Ref2(Ref):
        def get(self, **kw): return {"v": 9}
        def transaction(self, fn): return fn({"v": 9})
    FakeDb.reference = lambda self, path, app=None: Ref2()
    assert f.transaction("a", abort) == (False, {"v": 9})
