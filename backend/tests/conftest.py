import json
from dataclasses import dataclass, field

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.llm import LLMError
from app.main import create_app
from app.rtdb import MemoryRtdb


@dataclass
class FakeLLM:
    """Mock LLM that records every call so tests can prove cache hits skip it."""

    force: float = 8.0
    model_identifier: str = "fake-llm-1"
    responses: list = field(default_factory=list)  # queued raw responses (str or Exception)
    calls: int = 0

    def complete(self, system: str, user: str) -> str:
        self.calls += 1
        if self.responses:
            r = self.responses.pop(0)
            if isinstance(r, Exception):
                raise r
            return r
        return self.ok(self.force)

    @staticmethod
    def ok(force, definition="normal_force_per_finger", unit="N"):
        return json.dumps({
            "recommended_force": force, "force_definition": definition, "force_unit": unit,
            "confidence": "medium", "rationale": "test", "assumptions": ["a"], "warnings": [],
        })


BOTTLE = {
    "object_id": "plastic-bottle", "name": "Plastic bottle", "mass_g": 350, "width_mm": 65, "height_mm": 210,
    "depth_mm": 65, "material": "PET plastic", "friction_coefficient": 0.4, "fragility": "moderate", "max_contact_force_n": 20,
}


@pytest.fixture
def settings():
    return Settings(store_backend="memory", llm_provider="mock", _env_file=None)


@pytest.fixture
def db():
    return MemoryRtdb()


@pytest.fixture
def llm():
    return FakeLLM()


@pytest.fixture
def app(settings, db, llm):
    return create_app(settings, db=db, llm=llm)


@pytest.fixture
def client(app):
    return TestClient(app, headers={"X-GripSense-Mode": "live"})


@pytest.fixture
def bottle():
    return dict(BOTTLE)


def predict(client, obj, **kw):
    return client.post("/api/predict-grip", json={"object": obj, **kw})


def calibrate(client, obj, pred, force, *, confirm=True, based_on=None):
    """Drive the full workflow: start -> test -> confirm. Returns (calibration_id, confirm response)."""
    body = {"object": obj, "initial_force_n": force}
    if pred is not None:
        body["prediction_id"] = pred["prediction"]["prediction_id"]
    if based_on:
        body["based_on_calibration_id"] = based_on
    r = client.post("/api/calibrations", json=body)
    assert r.status_code == 201, r.text
    cid = r.json()["calibration_id"]
    assert client.post(f"/api/calibrations/{cid}/tests", json={"event": "test_started", "force_n": force}).status_code == 200
    if not confirm:
        return cid, None
    r = client.post(f"/api/calibrations/{cid}/confirm", json={
        "outcome": "success", "final_force_n": force,
        "user_confirmation": {"held_and_lifted": True, "no_slip": True, "no_damage": True}})
    return cid, r
