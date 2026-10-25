"""End-to-end calibration workflow (spec scenarios 1-14, 18) against mocked Firebase + LLM."""
import copy
import threading

from app.rtdb import MemoryRtdb
from app.safety import required_min_force_n
from app.schemas import ObjectProperties
from conftest import BOTTLE, FakeLLM, calibrate, predict


# --- 1-3: first selection -> LLM -> slider default
def test_first_selection_calls_llm_and_defaults_to_recommendation(client, llm, bottle):
    r = predict(client, bottle)
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "llm" and body["llm_called"] is True and llm.calls == 1
    assert body["calibration_status"] == "uncalibrated"
    assert body["calibration_lookup"]["state"] == "not_found"
    assert body["selected_force_n"] == 8.0 == body["prediction"]["llm_recommended_force"]
    assert body["prediction"]["force_definition"] == "normal_force_per_finger"
    assert body["prediction"]["prompt_version"] and body["prediction"]["model_identifier"] == "fake-llm-1"
    assert any("not validated" in m for m in body["messages"])


# --- 4-7: adjust, confirm, save, original LLM value untouched
def test_confirm_saves_separate_record_and_keeps_prediction(client, db, bottle):
    pred = predict(client, bottle).json()
    pid = pred["prediction"]["prediction_id"]
    before = copy.deepcopy(db.get(f"grip_predictions/{pid}"))
    cid, r = calibrate(client, bottle, pred, 9.5)  # user moved the slider from 8.0 to 9.5
    assert r.status_code == 200, r.text
    rec = r.json()["record"]
    assert rec["calibration_status"] == "calibrated" and rec["calibrated_force"] == 9.5
    assert rec["original_llm_force"] == 8.0 and rec["prediction_id"] == pid
    assert rec["confirmation_method"] == "manual" and rec["prompt_version"] and rec["model_identifier"] == "fake-llm-1"
    assert rec["created_at"] and rec["confirmed_at"] and rec["force_unit"] == "N"
    active = db.get(f"active_calibrations/{pred['configuration_key']}")
    assert active["calibration_id"] == cid and active["calibrated_force"] == 9.5 and active["version"] == 1
    assert db.get(f"grip_predictions/{pid}") == before  # LLM recommendation unchanged
    assert db.get(f"grip_calibrations/{cid}")["original_llm_force"] == 8.0


# --- 8-10: reuse, and no LLM call on a cache hit
def test_cache_hit_populates_slider_and_never_calls_llm(client, llm, bottle):
    pred = predict(client, bottle).json()
    calibrate(client, bottle, pred, 9.5)
    assert llm.calls == 1
    again = predict(client, bottle).json()
    assert llm.calls == 1, "LLM must not be queried when a valid calibration exists"
    assert again["source"] == "calibration" and again["llm_called"] is False and again["prediction"] is None
    assert again["selected_force_n"] == 9.5 and again["calibration_status"] == "calibrated"
    assert again["calibration_lookup"]["state"] == "found_valid"
    assert again["calibration_lookup"]["record"]["calibration_id"]
    assert "Calibrated force loaded from Firebase." in again["messages"]


def test_display_name_alone_is_not_the_key(client, llm, bottle):
    pred = predict(client, bottle).json()
    calibrate(client, bottle, pred, 9.5)
    renamed = {**bottle, "name": "Totally different label"}
    assert predict(client, renamed).json()["source"] == "calibration"  # same physical config
    other_id = {**bottle, "object_id": "plastic-bottle-2"}
    assert predict(client, other_id).json()["source"] == "llm"


# --- 11-12: incompatible configurations never reuse
def test_different_mass_does_not_reuse(client, llm, bottle):
    pred = predict(client, bottle).json()
    calibrate(client, bottle, pred, 9.5)
    heavier = {**bottle, "mass_g": 500}
    r = predict(client, heavier).json()
    assert r["source"] == "llm" and r["configuration_key"] != pred["configuration_key"]
    assert r["calibration_lookup"]["state"] == "not_found" and llm.calls == 2


def test_different_friction_does_not_reuse(client, llm, bottle):
    pred = predict(client, bottle).json()
    calibrate(client, bottle, pred, 9.5)
    r = predict(client, {**bottle, "friction_coefficient": 0.6}).json()
    assert r["source"] == "llm" and r["calibration_lookup"]["state"] == "not_found" and llm.calls == 2


# --- 13: failed calibration never becomes active
def test_failed_calibration_is_not_active(client, db, bottle):
    pred = predict(client, bottle).json()
    cid, _ = calibrate(client, bottle, pred, 9.5, confirm=False)
    client.post(f"/api/calibrations/{cid}/tests", json={"event": "slipped", "force_n": 9.5})
    r = client.post(f"/api/calibrations/{cid}/confirm", json={"outcome": "failed", "notes": "slipped"})
    assert r.json()["record"]["calibration_status"] == "failed"
    assert db.get(f"active_calibrations/{pred['configuration_key']}") is None
    assert predict(client, bottle).json()["source"] == "llm"


def test_failed_attempt_does_not_replace_existing_active(client, db, bottle):
    pred = predict(client, bottle).json()
    good, _ = calibrate(client, bottle, pred, 9.5)
    cid, _ = calibrate(client, bottle, None, 12.0, confirm=False, based_on=good)
    client.post(f"/api/calibrations/{cid}/confirm", json={"outcome": "failed"})
    assert db.get(f"active_calibrations/{pred['configuration_key']}")["calibration_id"] == good


# --- 14: invalid / infeasible / untested / unconfirmed forces are rejected
def test_infeasible_forces_rejected(client, bottle):
    pred = predict(client, bottle).json()
    over_object = client.post("/api/calibrations", json={"object": bottle, "initial_force_n": 25})  # object limit 20 N
    assert over_object.status_code == 422 and over_object.json()["detail"]["code"] == "infeasible_force"
    over_gripper = client.post("/api/calibrations", json={"object": {**bottle, "max_contact_force_n": None}, "initial_force_n": 45})
    assert over_gripper.status_code == 422
    assert client.post("/api/calibrations", json={"object": bottle, "initial_force_n": -1}).status_code == 422
    assert client.post("/api/calibrations", json={"object": bottle, "initial_force_n": 0.2}).status_code == 422  # < gripper min
    assert pred["selected_force_n"] > 0


def test_untested_force_cannot_be_confirmed(client, bottle):
    pred = predict(client, bottle).json()
    cid, _ = calibrate(client, bottle, pred, 9.0, confirm=False)  # tested at 9.0
    r = client.post(f"/api/calibrations/{cid}/confirm", json={
        "outcome": "success", "final_force_n": 10.0,
        "user_confirmation": {"held_and_lifted": True, "no_slip": True, "no_damage": True}})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "untested_force"


def test_force_after_slip_must_be_retested(client, bottle):
    pred = predict(client, bottle).json()
    cid, _ = calibrate(client, bottle, pred, 9.0, confirm=False)
    client.post(f"/api/calibrations/{cid}/tests", json={"event": "slipped", "force_n": 9.0})
    r = client.post(f"/api/calibrations/{cid}/confirm", json={
        "outcome": "success", "final_force_n": 9.0,
        "user_confirmation": {"held_and_lifted": True, "no_slip": True, "no_damage": True}})
    assert r.status_code == 409


def test_incomplete_user_confirmation_rejected(client, bottle):
    pred = predict(client, bottle).json()
    cid, _ = calibrate(client, bottle, pred, 9.0, confirm=False)
    r = client.post(f"/api/calibrations/{cid}/confirm", json={
        "outcome": "success", "final_force_n": 9.0,
        "user_confirmation": {"held_and_lifted": True, "no_slip": False, "no_damage": True}})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "confirmation_incomplete"
    assert client.post(f"/api/calibrations/{cid}/confirm", json={"outcome": "success"}).status_code == 422


def test_below_required_needs_override_policy(app, client, bottle):
    pred = predict(client, bottle).json()
    low = 3.0  # below the ~5.2 N physics requirement but above gripper minimum
    assert low < required_min_force_n(ObjectProperties(**bottle), app.state.service.limits)
    cid, _ = calibrate(client, bottle, pred, low, confirm=False)
    body = {"outcome": "success", "final_force_n": low, "override_reason": "verified manually on rig",
            "user_confirmation": {"held_and_lifted": True, "no_slip": True, "no_damage": True}}
    r = client.post(f"/api/calibrations/{cid}/confirm", json=body)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "override_not_allowed"
    app.state.service.settings.allow_safety_override = True
    r = client.post(f"/api/calibrations/{cid}/confirm", json={k: v for k, v in body.items() if k != "override_reason"})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "override_required"
    ok = client.post(f"/api/calibrations/{cid}/confirm", json=body)
    assert ok.status_code == 200 and ok.json()["record"]["override"]["used"] is True


def test_no_safe_range_cannot_be_calibrated(client, bottle):
    impossible = {**bottle, "mass_g": 3000, "max_contact_force_n": 5}
    r = predict(client, impossible).json()
    assert r["safety"]["status"] == "no_safe_range" and r["safety"]["can_save_as_calibrated"] is False
    assert client.post("/api/calibrations", json={"object": impossible, "initial_force_n": 4}).status_code == 422


def test_new_force_after_success_needs_new_session(client, bottle):
    pred = predict(client, bottle).json()
    cid, _ = calibrate(client, bottle, pred, 9.0)
    r = client.post(f"/api/calibrations/{cid}/tests", json={"event": "test_started", "force_n": 11.0})
    assert r.status_code == 409  # closed
    cid2, r2 = calibrate(client, bottle, None, 11.0, based_on=cid)
    assert r2.status_code == 200
    assert predict(client, bottle).json()["selected_force_n"] == 11.0  # replaced
    assert len(client.get(f"/api/calibration-history/{pred['configuration_key']}").json()["records"]) == 2


# --- invalidation and recalibration
def test_invalidate_clears_active_and_forces_new_llm(client, llm, bottle):
    pred = predict(client, bottle).json()
    cid, _ = calibrate(client, bottle, pred, 9.0)
    r = client.post(f"/api/calibrations/{cid}/invalidate", json={"reason": "gripper pads replaced"})
    assert r.status_code == 200 and r.json()["active_cleared"] is True
    assert client.get(f"/api/calibrations/{pred['configuration_key']}").status_code == 404
    again = predict(client, bottle).json()
    assert again["source"] == "llm" and llm.calls == 2


def test_invalidating_old_record_keeps_newer_active(client, bottle):
    pred = predict(client, bottle).json()
    old, _ = calibrate(client, bottle, pred, 9.0)
    new, _ = calibrate(client, bottle, None, 10.0, based_on=old)
    r = client.post(f"/api/calibrations/{old}/invalidate", json={"reason": "obsolete"})
    assert r.json()["active_cleared"] is False
    assert client.get(f"/api/calibrations/{pred['configuration_key']}").json()["active"]["calibration_id"] == new


def test_regenerate_calls_llm_without_touching_calibration(client, llm, db, bottle):
    pred = predict(client, bottle).json()
    calibrate(client, bottle, pred, 9.0)
    llm.force = 12.0
    r = predict(client, bottle, regenerate=True).json()
    assert r["source"] == "llm" and llm.calls == 2 and r["calibration_status"] == "calibrated"
    assert r["calibration_lookup"]["state"] == "found_valid"
    assert db.get(f"active_calibrations/{pred['configuration_key']}")["calibrated_force"] == 9.0
    assert predict(client, bottle).json()["selected_force_n"] == 9.0


# --- 18: concurrency
def test_concurrent_confirmations_keep_index_consistent(client, db, bottle):
    pred = predict(client, bottle).json()
    key = pred["configuration_key"]
    sessions = []
    for f in (8.0, 9.0, 10.0, 11.0, 12.0, 13.0):
        cid, _ = calibrate(client, bottle, pred, f, confirm=False)
        sessions.append((cid, f))
    results = []

    def confirm(cid, f):
        results.append(client.post(f"/api/calibrations/{cid}/confirm", json={
            "outcome": "success", "final_force_n": f,
            "user_confirmation": {"held_and_lifted": True, "no_slip": True, "no_damage": True}}).status_code)

    threads = [threading.Thread(target=confirm, args=s) for s in sessions]
    [t.start() for t in threads]; [t.join() for t in threads]
    assert results == [200] * 6
    active = db.get(f"active_calibrations/{key}")
    recs = [r for r in db.get("grip_calibrations").values() if r["calibration_status"] == "calibrated"]
    winner = max(recs, key=lambda r: (r["confirmed_at_ms"], r["calibration_id"]))
    assert active["calibration_id"] == winner["calibration_id"] and active["calibrated_force"] == winner["calibrated_force"]
    assert active["version"] >= 1 and len(recs) == 6  # audit trail intact


def test_older_confirmation_cannot_overwrite_newer_index(db):
    from app.store import Store
    s = Store(db)
    base = {"configuration_key": "cfg_" + "a" * 32, "force_definition": "normal_force_per_finger", "force_unit": "N"}
    new = {**base, "calibration_id": "cal_0000000000002_aaaaaa", "calibrated_force": 11.0, "confirmed_at_ms": 2000, "last_verified_at": "t2"}
    old = {**base, "calibration_id": "cal_0000000000001_bbbbbb", "calibrated_force": 9.0, "confirmed_at_ms": 1000, "last_verified_at": "t1"}
    assert s.promote_active("live", new)[0] is True
    assert s.promote_active("live", old)[0] is False
    assert db.get(f"active_calibrations/{base['configuration_key']}")["calibrated_force"] == 11.0


# --- staleness and safety re-check on reuse
def test_stale_calibration_is_not_silently_reused(app, client, llm, bottle):
    pred = predict(client, bottle).json()
    calibrate(client, bottle, pred, 9.0)
    svc = app.state.service
    svc.store.clock = lambda: int(4e12)  # far future (year ~2096)
    r = predict(client, bottle).json()
    assert r["source"] == "llm" and r["calibration_lookup"]["state"] == "stale"
    assert r["calibration_lookup"]["record"]["calibrated_force"] == 9.0
    assert any("NOT reused" in m for m in r["messages"])


def test_reuse_rechecked_against_tightened_object_limit(client, llm, bottle):
    pred = predict(client, bottle).json()
    calibrate(client, bottle, pred, 15.0)
    tighter = {**bottle, "max_contact_force_n": 10}  # same key, new constraint
    r = predict(client, tighter).json()
    assert r["calibration_lookup"]["state"] == "safety_failed" and r["source"] == "llm"


# --- demo data is segregated from live data
def test_demo_mode_is_namespaced(client, db, bottle):
    pred = predict(client, bottle).json()
    calibrate(client, bottle, pred, 9.0)
    demo = client.post("/api/predict-grip", json={"object": bottle}, headers={"X-GripSense-Mode": "demo"}).json()
    assert demo["source"] == "llm" and demo["mode"] == "demo"
    assert db.get("demo/grip_predictions") and db.get("grip_predictions")
    assert client.post("/api/predict-grip", json={"object": bottle}, headers={"X-GripSense-Mode": "bogus"}).status_code == 400
