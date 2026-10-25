"""Environment-driven configuration. Secrets only ever come from the environment."""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"
    # Optional: serve the built frontend (frontend/dist) from this process for single-process deployments.
    frontend_dist: str | None = None
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # --- access control for the backend API -------------------------------
    # none: no auth (local development only).
    # bearer: a shared token supplied by the operator (Authorization: Bearer ...).
    # firebase: a Firebase Auth ID token, verified with the Admin SDK.
    auth_mode: Literal["none", "bearer", "firebase"] = "none"
    api_bearer_token: SecretStr | None = None

    # --- LLM ---------------------------------------------------------------
    # "mock" is a labelled physics heuristic for offline demos. It is not an LLM.
    llm_provider: Literal["anthropic", "openai_compatible", "mock"] = "anthropic"
    llm_api_key: SecretStr | None = None
    llm_model: str = "claude-sonnet-5-5"
    llm_base_url: str | None = None
    llm_timeout_s: float = 30.0
    llm_max_attempts: int = 2  # attempts when the response is malformed / invalid

    # --- Firebase RTDB -----------------------------------------------------
    # "memory" keeps everything in process memory (dev/tests only, lost on restart).
    store_backend: Literal["firebase", "memory"] = "firebase"
    firebase_database_url: str | None = None
    firebase_credentials_path: str | None = None
    firebase_credentials_json: SecretStr | None = None
    telemetry_path: str = "gripper_telemetry"
    telemetry_stale_after_s: float = 5.0

    # --- gripper (DEMO values until the hardware team supplies real ones) ---
    gripper_id: str = "demo-parallel-gripper"
    gripper_finger_count: int = 2
    gripper_contact_pad_material: str = "silicone"
    gripper_min_force_n: float = 1.0
    gripper_max_force_n: float = 40.0
    gripper_force_step_n: float = 0.5
    gripper_max_opening_mm: float = 120.0
    gripper_limits_source: Literal["demo", "hardware_team"] = "demo"
    lift_acceleration_m_s2: float = 2.0
    holding_safety_factor: float = 1.5

    # --- calibration policy ------------------------------------------------
    calibration_max_age_days: int = 365  # 0 disables age-based staleness
    allow_safety_override: bool = False  # lets a user save a below-estimate force with a reason

    # --- hardware command channel -----------------------------------------
    # Must be agreed with the hardware team. "none" = the slider is a software target only.
    command_channel: Literal["none", "rtdb"] = "none"
    command_path: str = "gripper_commands"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
