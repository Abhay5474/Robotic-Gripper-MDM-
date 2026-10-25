"""LLM provider clients. Only the backend ever holds the API key."""
from __future__ import annotations

import json
import re
from typing import Protocol

import httpx

from .config import Settings
from .prompts import SYSTEM_PROMPT


class LLMError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = True):
        super().__init__(message)
        self.code, self.message, self.retryable = code, message, retryable


class LLMClient(Protocol):
    model_identifier: str

    def complete(self, system: str, user: str) -> str: ...


def extract_json_object(text: str) -> dict:
    """Parse a JSON object from model text, tolerating code fences / surrounding prose."""
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t, flags=re.IGNORECASE)
    try:
        val = json.loads(t)
    except json.JSONDecodeError:
        start, end = t.find("{"), t.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("no JSON object found in LLM response")
        val = json.loads(t[start : end + 1])
    if not isinstance(val, dict):
        raise ValueError("LLM response is not a JSON object")
    return val


class _HttpClient:
    def __init__(self, settings: Settings):
        self.s = settings
        if settings.llm_api_key is None:
            raise LLMError("llm_not_configured", "LLM_API_KEY is not set on the backend.", retryable=False)
        self.key = settings.llm_api_key.get_secret_value()
        self.model_identifier = settings.llm_model

    def _post(self, url: str, headers: dict, body: dict) -> dict:
        try:
            r = httpx.post(url, headers=headers, json=body, timeout=self.s.llm_timeout_s)
        except httpx.HTTPError as e:
            raise LLMError("llm_unavailable", f"LLM request failed: {type(e).__name__}") from e
        if r.status_code in (401, 403):
            raise LLMError("llm_auth_failed", "LLM provider rejected the credentials.", retryable=False)
        if r.status_code >= 400:
            raise LLMError("llm_unavailable", f"LLM provider returned HTTP {r.status_code}.")
        try:
            return r.json()
        except ValueError as e:
            raise LLMError("llm_invalid_response", "LLM provider returned non-JSON.") from e


class AnthropicClient(_HttpClient):
    def complete(self, system: str, user: str) -> str:
        base = (self.s.llm_base_url or "https://api.anthropic.com").rstrip("/")
        data = self._post(
            f"{base}/v1/messages",
            {"x-api-key": self.key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            {"model": self.model_identifier, "max_tokens": 800, "system": system,
             "messages": [{"role": "user", "content": user}]},
        )
        try:
            return "".join(b.get("text", "") for b in data["content"] if b.get("type") == "text")
        except (KeyError, TypeError) as e:
            raise LLMError("llm_invalid_response", "Unexpected Anthropic response shape.") from e


class OpenAICompatibleClient(_HttpClient):
    def complete(self, system: str, user: str) -> str:
        base = (self.s.llm_base_url or "https://api.openai.com/v1").rstrip("/")
        data = self._post(
            f"{base}/chat/completions",
            {"Authorization": f"Bearer {self.key}", "content-type": "application/json"},
            {"model": self.model_identifier, "max_tokens": 800, "response_format": {"type": "json_object"},
             "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]},
        )
        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as e:
            raise LLMError("llm_invalid_response", "Unexpected chat-completions response shape.") from e


class MockHeuristicClient:
    """Offline stand-in that applies the friction model. It is NOT an LLM and is labelled as such."""

    model_identifier = "mock-heuristic-v1 (not an LLM)"

    def complete(self, system: str, user: str) -> str:
        spec = json.loads(user[user.index("{"):])
        o, g, lift = spec["object"], spec["gripper"], spec["lifting"]
        n = g["finger_count"]
        force = lift["design_vertical_load_n"] / (n * o["estimated_friction_coefficient"]) * 1.5
        lo, hi = g["force_range_n_per_finger"]["min"], g["force_range_n_per_finger"]["max"]
        cap = o["max_allowable_contact_force_n_per_finger"]
        warnings = []
        if cap is not None and force > cap:
            warnings.append("Margin-adjusted estimate exceeds the stated contact-force limit; capped.")
            force = cap
        force = round(min(max(force, lo), hi), 2)
        return json.dumps({
            "recommended_force": force, "force_definition": "normal_force_per_finger",
            "force_definition_note": "Normal force applied by each finger pad.", "force_unit": "N",
            "confidence": "low", "rationale": "Coulomb friction model with 1.5x margin (offline heuristic, not an LLM).",
            "assumptions": ["Vertical lift", "Two symmetric friction contacts"], "warnings": warnings,
        })


def build_llm_client(settings: Settings) -> LLMClient:
    if settings.llm_provider == "mock":
        return MockHeuristicClient()
    if settings.llm_provider == "openai_compatible":
        return OpenAICompatibleClient(settings)
    return AnthropicClient(settings)


class UnconfiguredLLM:
    """Placeholder that reports a configuration error on use instead of failing at startup."""

    model_identifier = "unconfigured"

    def __init__(self, error: LLMError):
        self.error = error

    def complete(self, system: str, user: str) -> str:
        raise self.error


__all__ = ["LLMClient", "LLMError", "build_llm_client", "extract_json_object", "UnconfiguredLLM", "SYSTEM_PROMPT"]
