"""python -m pytest mlsim  (pure standard library + pytest)."""
import json
import math
import random
import sys
import threading
import time
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import dataset  # noqa: E402
import server  # noqa: E402
from model import MLP, features  # noqa: E402


def test_dataset_is_deterministic_and_matches_the_committed_csv():
    rows = dataset.generate()
    assert rows == dataset.generate()
    saved = dataset.read_csv(Path(__file__).parent / "data" / "grasp_trials.csv")
    assert len(saved) == len(rows) == 900
    assert [r["min_holding_force_n"] for r in saved] == [r["min_holding_force_n"] for r in rows]
    assert all(r["min_holding_force_n"] >= dataset.MIN_FORCE for r in rows)


def test_trained_model_beats_the_plain_formula_on_unseen_trials():
    rows = dataset.generate()
    random.Random(1).shuffle(rows)
    tr, va = rows[:720], rows[720:]
    X, y = [features(r) for r in tr], [math.log(r["min_holding_force_n"]) for r in tr]
    m = MLP(len(X[0]), 16)
    m.fit_scaler(X, y)
    untrained = sum(abs(m.predict(r) - r["min_holding_force_n"]) for r in va) / len(va)
    rng = random.Random(3)
    for e in range(60):
        m.train_epoch(X, y, lr=0.01 * 0.5 ** (e / 40), rng=rng)
    mae = sum(abs(m.predict(r) - r["min_holding_force_n"]) for r in va) / len(va)
    formula = sum(abs(dataset.physics_required(r["mass_g"], r["friction_coefficient"]) - r["min_holding_force_n"]) for r in va) / len(va)
    assert mae < 0.7 * formula < untrained


def test_server_trains_and_predicts():
    server.LAB = server.Lab()
    server.LAB.reset(epochs=12, delay_ms=0)
    srv = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"

    def call(path, body=None):
        req = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(), headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())

    try:
        assert call("/api/state")["status"] == "ready"
        call("/api/train", {})
        for _ in range(200):
            s = call("/api/state")
            if s["status"] == "done":
                break
            time.sleep(0.05)
        assert s["epoch"] == 12 and len(s["history"]) == 12
        assert {p["id"] for p in s["presets"]} >= {"plastic-bottle", "fragile-object"}
        p = call("/api/predict", {"material": "glass", "mass_g": 80, "friction_coefficient": 0.3, "width_mm": 60, "fragility": "fragile"})
        assert p["model_min"] > 0 and abs(p["model_recommended"] - 1.5 * p["model_min"]) < 0.02
        assert call("/api/state")["gripsense"] is None  # the page's own form is not GripSense
        g = call("/api/predict", {"object_id": "wooden-block", "name": "Wooden block", "material": "wood", "mass_g": 200,
                                  "friction_coefficient": 0.45, "width_mm": 50, "height_mm": 50, "fragility": "robust"})
        link = call("/api/state")["gripsense"]
        assert link["name"] == "Wooden block" and link["model_recommended"] == g["model_recommended"] and link["age_s"] < 5
        with urllib.request.urlopen(base + "/dataset.csv") as r:
            assert r.read().startswith(b"trial_id,material")
    finally:
        srv.shutdown()
