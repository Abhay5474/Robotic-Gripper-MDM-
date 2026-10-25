"""The shipped sample dataset must stay byte-for-byte what this app writes, and the app must work on it."""
import copy
import json
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.rtdb import MemoryRtdb, from_rtdb
from app.sample_data import (SAMPLE_PATH, T0, generate_deterministic, newest_ms, rebase, validate_dataset)
from conftest import FakeLLM

DATA = json.loads(SAMPLE_PATH.read_text())
NOW = T0 + 1000  # one second after the sample's live telemetry reading


def cal_by(object_id, status=None):
    return [r for r in DATA["grip_calibrations"].values() if r["object_id"] == object_id and (status is None or r["calibration_status"] == status)]


@pytest.fixture
def env():
    db = MemoryRtdb()
    db.set("", copy.deepcopy(DATA))
    llm = FakeLLM()
    app = create_app(Settings(store_backend="memory", llm_provider="mock", _env_file=None), db=db, llm=llm)
    app.state.service.store.clock = lambda: NOW
    return TestClient(app, headers={"X-GripSense-Mode": "live"}), db, llm


def predict(client, record, **kw):
    return client.post("/api/predict-grip", json={"object": record["input_properties"], **kw})


# ------------------------------------------------------------------ the file
def test_committed_sample_is_exactly_what_the_app_generates():
    assert generate_deterministic() == DATA, "run: python -m app.sample_data generate"


def test_sample_validates_cleanly_and_has_every_record_kind():
    rep = validate_dataset(DATA)
    assert rep.errors == [] and rep.warnings == []
    assert rep.stats == {"grip_predictions": 8, "grip_calibrations": 11, "active_calibrations": 7, "operations": 10}
    statuses = {r["calibration_status"] for r in DATA["grip_calibrations"].values()}
    assert statuses == {"calibrated", "failed", "cancelled", "invalidated", "in_progress"}
    methods = {r.get("confirmation_method") for r in DATA["grip_calibrations"].values() if r["calibration_status"] == "calibrated"}
    assert methods == {"manual", "sensor_assisted"}
    assert any(a["calibration_status"] == "invalidated" for a in DATA["active_calibrations"].values())  # tombstone


def test_file_is_importable_into_the_firebase_console():
    assert set(DATA) == {"grip_predictions", "grip_calibrations", "active_calibrations", "operations", "gripper_telemetry"}
    assert from_rtdb(__import__("app.rtdb", fromlist=["to_rtdb"]).to_rtdb(DATA)) == DATA  # nothing RTDB would drop or reshape
    json.dumps(DATA)  # plain JSON


@pytest.mark.parametrize("mutate,expect", [
    (lambda d: d["grip_calibrations"][next(iter(d["grip_calibrations"]))].update(configuration_key="cfg_" + "0" * 32), "recomputed"),
    (lambda d: d["grip_calibrations"][next(iter(d["grip_calibrations"]))].update(note=None), "RTDB would not store"),
    (lambda d: d["active_calibrations"][next(iter(d["active_calibrations"]))].update(calibrated_force=99.0), "differs from the record"),
    (lambda d: d["active_calibrations"].update({"cfg_" + "f" * 32: {"calibration_id": "cal_0000000000001_aaaaaa", "calibration_status": "calibrated"}}), "missing calibration record"),
    (lambda d: d["grip_calibrations"].update({"cal.bad": {}}), "not storable"),
    (lambda d: d["operations"][next(iter(d["operations"]))].update(operation_result="great"), "invalid operation"),
    (lambda d: d["grip_predictions"][next(iter(d["grip_predictions"]))].pop("llm_recommended_force"), "invalid prediction"),
    (lambda d: d["grip_calibrations"][next(k for k, v in d["grip_calibrations"].items() if v["calibration_status"] == "failed")].update(calibrated_force=5.0), "must not carry"),
])
def test_validator_detects_incompatible_data(mutate, expect):
    bad = copy.deepcopy(DATA)
    mutate(bad)
    assert any(expect in e for e in validate_dataset(bad).errors), validate_dataset(bad).errors


def test_rebase_moves_everything_consistently():
    now = 1_900_000_000_000
    moved = rebase(DATA, now)
    assert newest_ms(moved) == now
    assert validate_dataset(moved).errors == []  # ISO strings and *_ms still agree
    delta = now - T0
    box = cal_by("cardboard-box", "calibrated")[0]
    moved_box = moved["grip_calibrations"][box["calibration_id"]]
    assert moved_box["confirmed_at_ms"] == box["confirmed_at_ms"] + delta
    assert (now - moved_box["confirmed_at_ms"]) > 365 * 86_400_000  # still stale relative to "now"
    assert DATA["gripper_telemetry"]["timestamp"] == T0  # input not mutated


def test_cli_check_and_dry_run_seed():
    py = [sys.executable, "-m", "app.sample_data"]
    cwd = Path(__file__).resolve().parents[1]
    ok = subprocess.run([*py, "check", str(SAMPLE_PATH)], cwd=cwd, capture_output=True, text=True)
    assert ok.returncode == 0 and "OK: compatible" in ok.stdout
    dry = subprocess.run([*py, "seed", "--dry-run"], cwd=cwd, capture_output=True, text=True)
    assert dry.returncode == 0 and "nothing written" in dry.stdout and "gripper_telemetry" not in dry.stdout  # telemetry excluded by default


# ----------------------------------------------------- the app on this data
def test_every_calibrated_object_is_reused_without_calling_the_llm(env):
    client, _, llm = env
    expected = {"plastic-bottle": 9.5, "aluminum-can": 12.0, "wooden-block": 5.5, "ceramic-cup": 4.5, "steel-bracket": 22.0}
    for oid, force in expected.items():
        newest = max(cal_by(oid, "calibrated"), key=lambda r: r["confirmed_at_ms"])
        r = predict(client, newest).json()
        assert r["source"] == "calibration" and r["llm_called"] is False, oid
        assert r["selected_force_n"] == force and r["calibration_lookup"]["record"]["calibration_id"] == newest["calibration_id"], oid
        assert r["configuration_key"] == newest["configuration_key"], "stored key must equal the key the app computes now"
        assert "Calibrated force loaded from Firebase." in r["messages"]
    assert llm.calls == 0


def test_ceramic_cup_is_reused_with_its_marginal_status_visible(env):
    client, _, _ = env
    r = predict(client, cal_by("ceramic-cup", "calibrated")[0]).json()
    assert r["safety"]["status"] == "marginal"
    assert any("below the recommended" in c["message"] for c in r["safety"]["checks"] if not c["passed"])


def test_non_reusable_states_fall_back_to_the_llm_with_the_right_reason(env):
    client, _, llm = env
    frag = predict(client, cal_by("fragile-object")[0]).json()            # only a failed session exists
    ball = predict(client, cal_by("rubber-ball", "invalidated")[0]).json()  # invalidated -> tombstone
    box = predict(client, cal_by("cardboard-box", "calibrated")[0]).json()  # 400 days old
    assert frag["source"] == ball["source"] == box["source"] == "llm" and llm.calls == 3
    assert frag["calibration_lookup"]["state"] == "not_found" and frag["calibration_status"] == "uncalibrated"
    assert ball["calibration_lookup"]["state"] == "invalidated"
    assert box["calibration_lookup"]["state"] == "stale" and box["calibration_lookup"]["record"]["calibrated_force"] == 4.0
    assert all(any("NOT reused" in m for m in r["messages"]) for r in (ball, box))


def test_history_shows_superseded_records_and_the_active_one(env):
    client, _, _ = env
    key = cal_by("plastic-bottle", "calibrated")[0]["configuration_key"]
    h = client.get(f"/api/calibration-history/{key}").json()
    assert len(h["records"]) == 2
    active = DATA["active_calibrations"][key]["calibration_id"]
    assert h["active_calibration_id"] == active
    newest, older = h["records"]
    assert newest["calibration_id"] == active and newest["based_on_calibration_id"] == older["calibration_id"]
    assert older["confirmation_method"] == "sensor_assisted" and newest["confirmation_method"] == "manual"
    cup = client.get(f"/api/calibration-history/{cal_by('ceramic-cup')[0]['configuration_key']}").json()["records"][0]
    assert [t["event"] for t in sorted(cup["tests"].values(), key=lambda t: t["seq"])] == ["test_started", "slipped", "test_started", "damage_risk", "test_started"]
    tombstone_key = next(k for k, v in DATA['active_calibrations'].items() if v['calibration_status'] == 'invalidated')
    assert client.get(f"/api/calibrations/{tombstone_key}").status_code == 404  # an invalidated entry is never served as a calibration


def test_recent_calibrations_and_operations_endpoints_read_the_samples(env):
    client, _, _ = env
    recs = client.get("/api/calibrations?limit=50").json()["records"]
    assert len(recs) == 11 and recs == sorted(recs, key=lambda r: -r["created_at_ms"])
    ops = client.get("/api/operations?limit=50").json()["operations"]
    assert len(ops) == 10 and ops == sorted(ops, key=lambda o: -o["timestamp_ms"])
    traced = [o for o in ops if o.get("trace")]
    assert len(traced) == 1 and all(set(row) <= {"t", "f", "o", "s", "st", "d"} for row in traced[0]["trace"])
    assert {o["operation_result"] for o in ops} == {"success", "slipped"}


def test_telemetry_node_is_read_and_goes_stale(env):
    client, db, _ = env
    t = client.get("/api/telemetry/latest").json()
    assert t["available"] and not t["stale"] and t["measured_force_n"] == 9.52 and t["slip_detected"] is False and t["operation_state"] == "holding"
    client.app.state.service.store.clock = lambda: NOW + 60_000
    assert client.get("/api/telemetry/latest").json()["stale"] is True


def test_workflow_continues_on_imported_data_and_stays_exportable(env):
    client, db, llm = env
    confirm = lambda cid, f: client.post(f"/api/calibrations/{cid}/confirm", json={"outcome": "success", "final_force_n": f,
                                                                                    "user_confirmation": {"held_and_lifted": True, "no_slip": True, "no_damage": True}})
    # 1) the imported in-progress recalibration (wooden block, tested at 6.0 N) can be finished
    wood = next(r for r in cal_by("wooden-block") if r["calibration_status"] == "in_progress")
    res = confirm(wood["calibration_id"], 6.0)
    assert res.status_code == 200 and res.json()["active_updated"] is True
    assert db.get(f"active_calibrations/{wood['configuration_key']}")["version"] == 2  # transaction on imported index
    assert predict(client, wood).json()["selected_force_n"] == 6.0
    # 2) an imported calibration can be invalidated, after which the LLM is consulted again
    can = cal_by("aluminum-can", "calibrated")[0]
    assert client.post(f"/api/calibrations/{can['calibration_id']}/invalidate", json={"reason": "pads worn"}).json()["active_cleared"] is True
    assert predict(client, can).json()["source"] == "llm"
    # 3) a configuration that only had a failed session can now be calibrated from scratch
    frag = cal_by("fragile-object")[0]
    p = predict(client, frag).json()
    s = client.post("/api/calibrations", json={"object": frag["input_properties"], "initial_force_n": 3.0, "prediction_id": p["prediction"]["prediction_id"]}).json()
    client.post(f"/api/calibrations/{s['calibration_id']}/tests", json={"event": "test_started", "force_n": 3.0})
    assert confirm(s["calibration_id"], 3.0).status_code == 200
    assert predict(client, frag).json()["source"] == "calibration"
    # 4) everything the app wrote on top of the import is itself a valid, importable export
    export = from_rtdb(db._root)
    rep = validate_dataset(export)
    assert rep.errors == [], rep.errors
    assert llm.calls == 2


def test_demo_namespace_is_not_touched_by_the_live_sample(env):
    client, db, _ = env
    r = client.post("/api/predict-grip", json={"object": cal_by("plastic-bottle", "calibrated")[0]["input_properties"]}, headers={"X-GripSense-Mode": "demo"}).json()
    assert r["source"] == "llm" and r["mode"] == "demo"  # live calibrations are invisible in demo mode


# ------------------------------------------------------------ SEED_FILE (dev)
def test_seed_file_preloads_the_memory_store_in_both_namespaces(tmp_path):
    s = Settings(store_backend="memory", llm_provider="mock", seed_file=str(SAMPLE_PATH), _env_file=None)
    llm = FakeLLM()
    c = TestClient(create_app(s, llm=llm))
    bottle = cal_by("plastic-bottle", "calibrated")[0]["input_properties"]
    for mode in ("live", "demo"):
        r = c.post("/api/predict-grip", json={"object": bottle}, headers={"X-GripSense-Mode": mode}).json()
        assert r["source"] == "calibration" and r["selected_force_n"] == 9.5, mode  # timestamps rebased: not stale
    assert llm.calls == 0
    assert c.get("/api/telemetry/latest").json()["stale"] is False  # rebased to now
    assert len(c.get("/api/operations", headers={"X-GripSense-Mode": "demo"}).json()["operations"]) == 10


def test_seed_file_is_refused_on_anything_but_the_memory_store(tmp_path):
    with pytest.raises(RuntimeError, match="SEED_FILE"):
        create_app(Settings(store_backend="memory", llm_provider="mock", seed_file=str(SAMPLE_PATH), _env_file=None), db=FakeDb())


def test_seed_file_with_incompatible_data_is_rejected(tmp_path):
    bad = copy.deepcopy(DATA)
    bad["active_calibrations"][next(iter(bad["active_calibrations"]))]["calibrated_force"] = 99.0
    f = tmp_path / "bad.json"
    f.write_text(json.dumps(bad))
    with pytest.raises(ValueError, match="not compatible"):
        create_app(Settings(store_backend="memory", llm_provider="mock", seed_file=str(f), _env_file=None), llm=FakeLLM())


class FakeDb:  # any non-memory client
    def ping(self): pass


def test_generation_is_independent_of_the_environment_and_follows_the_gripper_identity(monkeypatch, tmp_path):
    monkeypatch.setenv("GRIPPER_ID", "something-else")
    monkeypatch.setenv("GRIPPER_MAX_FORCE_N", "5")
    assert generate_deterministic() == DATA  # env vars do not leak in
    mine = generate_deterministic(gripper_id="acme-gripper-7", pad_material="rubber")
    assert validate_dataset(mine).errors == []
    assert set(mine["active_calibrations"]).isdisjoint(DATA["active_calibrations"])  # different gripper => different keys
    monkeypatch.undo()  # the env patches above were only for generation
    # a backend configured for that gripper reuses them; the default backend (demo gripper) does not
    db = MemoryRtdb(); db.set("", mine)
    s = Settings(store_backend="memory", llm_provider="mock", gripper_id="acme-gripper-7", gripper_contact_pad_material="rubber", _env_file=None)
    c = TestClient(create_app(s, db=db, llm=FakeLLM()), headers={"X-GripSense-Mode": "live"})
    c.app.state.service.store.clock = lambda: NOW
    obj = next(r for r in mine["grip_calibrations"].values() if r["object_id"] == "aluminum-can")["input_properties"]
    assert c.post("/api/predict-grip", json={"object": obj}).json()["source"] == "calibration"
    default = TestClient(create_app(Settings(store_backend="memory", llm_provider="mock", _env_file=None), db=db, llm=FakeLLM()), headers={"X-GripSense-Mode": "live"})
    default.app.state.service.store.clock = lambda: NOW
    assert default.post("/api/predict-grip", json={"object": obj}).json()["calibration_lookup"]["state"] == "not_found"
