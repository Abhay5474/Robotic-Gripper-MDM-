"""GripSense shows the ML Lab's force for the current object; it is display only."""
import httpx
from fastapi.testclient import TestClient

from app.config import Settings
from app.llm import MockHeuristicClient
from app.main import create_app
from app.rtdb import MemoryRtdb

BOTTLE = {"object_id": "plastic-bottle", "name": "Plastic bottle", "mass_g": 350, "width_mm": 65, "height_mm": 210, "depth_mm": 65,
          "material": "PET plastic", "friction_coefficient": 0.4, "fragility": "moderate", "max_contact_force_n": 20}


def client(fetch):
    s = Settings(_env_file=None, store_backend="memory", llm_provider="mock")
    return TestClient(create_app(s, MemoryRtdb(), MockHeuristicClient(), ml_fetch=fetch))


def test_returns_the_ml_lab_prediction_for_the_object():
    seen = []

    def fetch(payload):
        seen.append(payload)
        return {"model_min": 5.98, "model_recommended": 8.97, "epoch": 150, "epochs": 150, "status": "done",
                "metrics": {"mae": 0.47}, "trained_on": "synthetic"}

    r = client(fetch).post("/api/ml-prediction", json=BOTTLE, headers={"X-GripSense-Mode": "demo"})
    assert r.status_code == 200
    assert r.json() == {"available": True, "model_min": 5.98, "model_recommended": 8.97, "epoch": 150, "epochs": 150,
                        "status": "done", "mae_n": 0.47, "trained_on": "synthetic"}
    assert seen[0]["material"] == "PET plastic" and seen[0]["mass_g"] == 350


def test_reports_unavailable_when_the_ml_lab_is_not_running():
    def fetch(payload):
        raise httpx.ConnectError("refused")

    r = client(fetch).post("/api/ml-prediction", json=BOTTLE)
    assert r.status_code == 200 and r.json()["available"] is False
    assert "run-mlsim" in r.json()["reason"]


def test_rejects_invalid_objects():
    assert client(lambda p: {}).post("/api/ml-prediction", json={**BOTTLE, "mass_g": -1}).status_code == 422
