import json

import httpx
import pytest

from app.config import Settings
from app.llm import AnthropicClient, LLMError, MockHeuristicClient, OpenAICompatibleClient, build_llm_client
from app.prompts import PROMPT_VERSION, SYSTEM_PROMPT, build_user_prompt
from app.schemas import ObjectProperties
from app.service import limits_from_settings
from conftest import BOTTLE

S = Settings(_env_file=None, llm_api_key="sk-test-123", store_backend="memory")


def test_prompt_is_versioned_and_carries_every_required_input():
    limits = limits_from_settings(S)
    user = build_user_prompt(ObjectProperties(**BOTTLE), limits)
    assert PROMPT_VERSION == "force-estimate-v1"
    payload = json.loads(user[user.index("{"):])
    o, g, lift = payload["object"], payload["gripper"], payload["lifting"]
    assert o["name"] == "Plastic bottle" and o["mass_g"] == 350 and o["material"] == "PET plastic"
    assert o["dimensions_mm"] == {"width_between_finger_pads": 65, "height": 210, "depth": 65}
    assert o["estimated_friction_coefficient"] == 0.4 and o["fragility"] == "moderate"
    assert o["max_allowable_contact_force_n_per_finger"] == 20
    assert g["force_range_n_per_finger"] == {"min": 1.0, "max": 40.0} and g["finger_count"] == 2
    assert lift["weight_n"] == pytest.approx(3.432, abs=1e-3) and lift["lift_acceleration_m_s2"] == 2.0
    assert "normal_force_per_finger" in SYSTEM_PROMPT and "not validated" in SYSTEM_PROMPT and "JSON" in SYSTEM_PROMPT


def test_unknown_contact_limit_is_sent_as_null_not_invented():
    user = build_user_prompt(ObjectProperties(**{**BOTTLE, "max_contact_force_n": None}), limits_from_settings(S))
    assert json.loads(user[user.index("{"):])["object"]["max_allowable_contact_force_n_per_finger"] is None


class _Resp:
    def __init__(self, status, body): self.status_code, self._b = status, body
    def json(self): return self._b


def test_anthropic_request_shape_and_key_only_in_header(monkeypatch):
    seen = {}
    def fake_post(url, headers, json, timeout):
        seen.update(url=url, headers=headers, body=json)
        return _Resp(200, {"content": [{"type": "text", "text": '{"ok": 1}'}]})
    monkeypatch.setattr(httpx, "post", fake_post)
    out = AnthropicClient(S).complete("sys", "usr")
    assert out == '{"ok": 1}' and seen["url"].endswith("/v1/messages")
    assert seen["headers"]["x-api-key"] == "sk-test-123" and "sk-test-123" not in repr(seen["body"])
    assert seen["body"]["system"] == "sys" and seen["body"]["messages"][0]["content"] == "usr"


def test_openai_compatible_request_shape(monkeypatch):
    seen = {}
    def fake_post(url, headers, json, timeout):
        seen.update(url=url, body=json)
        return _Resp(200, {"choices": [{"message": {"content": "{}"}}]})
    monkeypatch.setattr(httpx, "post", fake_post)
    s = Settings(_env_file=None, llm_provider="openai_compatible", llm_api_key="k", llm_base_url="http://gw.local/v1/", store_backend="memory")
    assert OpenAICompatibleClient(s).complete("a", "b") == "{}"
    assert seen["url"] == "http://gw.local/v1/chat/completions" and seen["body"]["response_format"] == {"type": "json_object"}


@pytest.mark.parametrize("status,code", [(401, "llm_auth_failed"), (500, "llm_unavailable"), (429, "llm_unavailable")])
def test_provider_errors_map_to_codes(monkeypatch, status, code):
    monkeypatch.setattr(httpx, "post", lambda *a, **k: _Resp(status, {}))
    with pytest.raises(LLMError) as e:
        AnthropicClient(S).complete("a", "b")
    assert e.value.code == code


def test_network_failure_maps_to_unavailable(monkeypatch):
    def boom(*a, **k): raise httpx.ConnectError("nope")
    monkeypatch.setattr(httpx, "post", boom)
    with pytest.raises(LLMError) as e:
        AnthropicClient(S).complete("a", "b")
    assert e.value.code == "llm_unavailable"


def test_missing_key_is_a_config_error_and_mock_is_labelled():
    with pytest.raises(LLMError) as e:
        build_llm_client(Settings(_env_file=None, store_backend="memory", llm_api_key=None))
    assert e.value.code == "llm_not_configured"
    assert "not an LLM" in MockHeuristicClient.model_identifier


def test_mock_heuristic_output_passes_the_same_validation(client, app):
    app.state.service.llm = MockHeuristicClient()
    r = client.post("/api/predict-grip", json={"object": BOTTLE}).json()
    assert r["prediction"]["model_identifier"].startswith("mock-heuristic") and r["safety"]["status"] in ("ok", "marginal")


def test_frontend_dist_is_served_with_spa_fallback_and_does_not_shadow_api(tmp_path, db, llm):
    from fastapi.testclient import TestClient
    from app.main import create_app
    (tmp_path / "index.html").write_text("<html>app</html>")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "a.js").write_text("console.log(1)")
    (tmp_path.parent / "secret.txt").write_text("nope")
    c = TestClient(create_app(Settings(_env_file=None, store_backend="memory", llm_provider="mock", frontend_dist=str(tmp_path)), db=db, llm=llm))
    assert c.get("/calibration").text == "<html>app</html>"          # client-side route
    assert c.get("/assets/a.js").text == "console.log(1)"
    assert c.get("/api/health").json()["status"] in ("ok", "degraded")  # API still wins
    assert c.get("/api/nope").status_code == 404
    assert "nope" not in c.get("/../secret.txt").text and "nope" not in c.get("/%2e%2e/secret.txt").text  # no path traversal
    with pytest.raises(RuntimeError):
        create_app(Settings(_env_file=None, store_backend="memory", llm_provider="mock", frontend_dist=str(tmp_path / "missing")), db=db, llm=llm)
