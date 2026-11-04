"""GripSense ML Lab: trains a grip-force model live on a synthetic dataset and serves a dashboard.

Separate from GripSense (its own port, its own process); GripSense does not use this model.
Pure Python standard library: python mlsim/server.py [--port 8100]
"""
from __future__ import annotations

import argparse
import json
import math
import random
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from dataset import FRAGILITY, MATERIALS, generate, material_of, physics_required, read_csv, true_min_force, write_csv
from model import MATS, MLP, features

HERE = Path(__file__).parent
ROOT = HERE.parent
DATA = HERE / "data" / "grasp_trials.csv"
SAFETY_FACTOR = 1.5  # GripSense's holding safety factor (demo value)


def load_presets() -> list[dict]:
    """The GripSense object presets, plus the force each was calibrated to in the sample database (if any)."""
    try:
        presets = json.loads((ROOT / "shared" / "object_presets.json").read_text())["presets"]
    except OSError:
        return []
    calibrated: dict[str, float] = {}
    try:
        db = json.loads((ROOT / "samples" / "firebase_sample_data.json").read_text())
        active = {a["calibration_id"] for a in db.get("active_calibrations", {}).values()}
        for rec in db.get("grip_calibrations", {}).values():
            if rec.get("calibration_id") in active and rec.get("calibrated_force") is not None:
                calibrated[rec["input_properties"]["object_id"]] = rec["calibrated_force"]
    except (OSError, KeyError, ValueError):
        pass
    out = []
    for p in presets:
        if p["object_id"] == "custom-object":
            continue
        out.append({"id": p["object_id"], "name": p["name"], "material": material_of(p["material"]), "mass_g": p["mass_g"],
                    "width_mm": p["width_mm"], "height_mm": p["height_mm"], "friction_coefficient": p["friction_coefficient"],
                    "fragility": p["fragility"], "calibrated": calibrated.get(p["object_id"])})
    return out


class Lab:
    def __init__(self):
        if not DATA.exists():
            write_csv(generate(), DATA)
        self.rows = read_csv(DATA)
        self.presets = load_presets()
        self.lock = threading.Lock()
        self.thread: threading.Thread | None = None
        self.stop_flag = threading.Event()
        self.cfg = {"epochs": 150, "lr": 0.01, "hidden": 16, "delay_ms": 120}
        self.lr_halflife = 40  # epochs: the learning rate halves every 40 epochs (steadier convergence)
        self.reset()

    # ------------------------------------------------------------------ training
    def reset(self, **cfg):
        self.stop()
        self.cfg.update({k: v for k, v in cfg.items() if k in self.cfg})
        rng = random.Random(1)
        rows = self.rows[:]
        rng.shuffle(rows)
        cut = int(len(rows) * 0.8)
        self.train_rows, self.val_rows = rows[:cut], rows[cut:]
        self.X = [features(r) for r in self.train_rows]
        self.y = [math.log(r["min_holding_force_n"]) for r in self.train_rows]
        self.Xv = [features(r) for r in self.val_rows]
        self.yv = [math.log(r["min_holding_force_n"]) for r in self.val_rows]
        self.model = MLP(len(self.X[0]), int(self.cfg["hidden"]))
        self.model.fit_scaler(self.X, self.y)
        self.rng = random.Random(3)
        with self.lock:
            self.epoch, self.status, self.history, self.preset_history = 0, "ready", [], []
            self.snapshot = self._snapshot()

    def start(self):
        if self.thread and self.thread.is_alive():
            return
        if self.epoch >= self.cfg["epochs"]:
            self.reset()
        self.stop_flag.clear()
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_flag.set()
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=5)
        with self.lock:
            if getattr(self, "status", None) == "training":
                self.status = "paused"

    def _run(self):
        with self.lock:
            self.status = "training"
        while self.epoch < self.cfg["epochs"] and not self.stop_flag.is_set():
            t0 = time.time()
            lr = self.cfg["lr"] * 0.5 ** (self.epoch / self.lr_halflife)
            train = self.model.train_epoch(self.X, self.y, lr=lr, rng=self.rng)
            val = self.model.mse(self.Xv, self.yv)
            snap = None
            self.epoch += 1
            if self.epoch <= 10 or self.epoch % 2 == 0 or self.epoch == self.cfg["epochs"]:
                snap = self._snapshot()
            with self.lock:
                self.history.append({"epoch": self.epoch, "train": round(train, 5), "val": round(val, 5)})
                if snap:
                    self.snapshot = snap
                    self.preset_history.append({"epoch": self.epoch, "pred": [p["model_min"] for p in snap["presets"]]})
            left = self.cfg["delay_ms"] / 1000 - (time.time() - t0)
            if left > 0:
                time.sleep(left)
        with self.lock:
            self.status = "done" if self.epoch >= self.cfg["epochs"] else "paused"
            self.snapshot = self._snapshot()

    # ------------------------------------------------------------------ views
    def predict(self, r: dict) -> float:
        return self.model.predict(r)

    def _snapshot(self) -> dict:
        val = self.val_rows
        preds = [self.predict(r) for r in val]
        errs = [abs(p - r["min_holding_force_n"]) for p, r in zip(preds, val)]
        phys = [abs(physics_required(r["mass_g"], r["friction_coefficient"]) - r["min_holding_force_n"]) for r in val]
        within = sum(abs(p / r["min_holding_force_n"] - 1) <= 0.10 for p, r in zip(preds, val)) / len(val)
        presets = []
        for p in self.presets:
            m = self.predict(p)
            presets.append({**p, "model_min": round(m, 2), "model_recommended": round(m * SAFETY_FACTOR, 2),
                            "physics_min": round(physics_required(p["mass_g"], p["friction_coefficient"]), 2),
                            "simulator_truth": round(true_min_force(p["mass_g"], p["width_mm"], p["friction_coefficient"], p["material"]), 2)})
        ref = {"mass_g": 300, "width_mm": 60, "height_mm": 100, "friction_coefficient": 0.5, "fragility": "moderate"}
        base_true = physics_required(300, 0.5)
        materials = []
        for mat in MATS:
            learned = self.predict({**ref, "material": mat}) / (base_true)
            truth = true_min_force(300, 60, 0.5, mat) / base_true
            materials.append({"material": mat, "learned": round(learned, 3), "truth": round(truth, 3)})
        curves = {
            "mass": [{"x": g, "model": round(self.predict({**ref, "mass_g": g, "material": "plastic"}), 3),
                      "physics": round(physics_required(g, 0.5), 3)} for g in range(50, 2001, 50)],
            "width": [{"x": w, "model": round(self.predict({**ref, "width_mm": w, "material": "plastic"}), 3),
                       "truth": round(true_min_force(300, w, 0.5, "plastic"), 3)} for w in range(20, 111, 5)],
        }
        return {
            "metrics": {"mae": round(sum(errs) / len(errs), 3), "physics_mae": round(sum(phys) / len(phys), 3),
                        "within10": round(within, 3)},
            "scatter": [[r["min_holding_force_n"], round(p, 3), r["material"]] for r, p in list(zip(val, preds))[:180]],
            "presets": presets, "materials": materials, "curves": curves,
        }

    def state(self) -> dict:
        with self.lock:
            return {"status": self.status, "epoch": self.epoch, "config": self.cfg, "history": self.history,
                    "preset_history": self.preset_history, "dataset": {"rows": len(self.rows), "train": len(self.train_rows),
                    "val": len(self.val_rows), "materials": MATS, "fragility": list(FRAGILITY)}, **self.snapshot}


LAB: Lab


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj).encode(), "application/json")

    def _body(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return {}

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/", "/index.html"):
            self._send(200, (HERE / "static" / "index.html").read_bytes(), "text/html; charset=utf-8")
        elif path == "/api/state":
            self._json(LAB.state())
        elif path == "/api/dataset":
            self._json({"columns": list(LAB.rows[0].keys()), "rows": LAB.rows[:40], "total": len(LAB.rows)})
        elif path == "/dataset.csv":
            self._send(200, DATA.read_bytes(), "text/csv; charset=utf-8", {"Content-Disposition": 'attachment; filename="grasp_trials.csv"'})
        else:
            self._json({"error": "not found"}, 404)

    def do_POST(self):
        path, body = self.path.split("?")[0], self._body()
        if path == "/api/train":
            LAB.start()
        elif path == "/api/pause":
            LAB.stop()
        elif path == "/api/reset":
            cfg = {}
            for k, lo, hi in (("epochs", 10, 1000), ("lr", 1e-4, 0.1), ("hidden", 2, 64), ("delay_ms", 0, 2000)):
                if k in body:
                    try:
                        cfg[k] = min(hi, max(lo, float(body[k])))
                    except (TypeError, ValueError):
                        pass
            if "epochs" in cfg:
                cfg["epochs"] = int(cfg["epochs"])
            LAB.reset(**cfg)
        elif path == "/api/predict":
            try:
                r = {"material": body.get("material", "plastic"), "mass_g": float(body["mass_g"]),
                     "width_mm": float(body.get("width_mm", 60)), "height_mm": float(body.get("height_mm", 100)),
                     "friction_coefficient": float(body["friction_coefficient"]), "fragility": body.get("fragility", "moderate")}
                if r["material"] not in MATERIALS or r["fragility"] not in FRAGILITY or r["mass_g"] <= 0 or r["friction_coefficient"] <= 0:
                    raise ValueError
            except (KeyError, TypeError, ValueError):
                return self._json({"error": "mass_g > 0, friction_coefficient > 0, and a known material / fragility are required"}, 400)
            m = LAB.predict(r)
            return self._json({"model_min": round(m, 2), "model_recommended": round(m * SAFETY_FACTOR, 2),
                               "physics_min": round(physics_required(r["mass_g"], r["friction_coefficient"]), 2),
                               "epoch": LAB.epoch})
        else:
            return self._json({"error": "not found"}, 404)
        self._json({"ok": True, "status": LAB.status})


def main():
    global LAB
    ap = argparse.ArgumentParser(description="GripSense ML Lab (synthetic data)")
    ap.add_argument("--port", type=int, default=8100)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()
    LAB = Lab()
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"GripSense ML Lab on http://localhost:{args.port}  (synthetic dataset: {len(LAB.rows)} trials) - Ctrl+C to stop")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
