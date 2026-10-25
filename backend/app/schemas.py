"""Pydantic schemas shared by the API, the services and the RTDB records."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

FORCE_UNIT = "N"
CANONICAL_FORCE_DEFINITION = "normal_force_per_finger"

ForceDefinition = Literal["normal_force_per_finger", "total_actuator_force", "other"]
Fragility = Literal["robust", "moderate", "fragile"]
Mode = Literal["demo", "live"]

ID_PATTERN = r"^[a-z0-9][a-z0-9_-]{0,63}$"
KEY_PATTERN = r"^cfg_[0-9a-f]{32}$"
RECORD_ID_PATTERN = r"^(cal|pred|op)_[0-9]{10,}_[0-9a-f]{6}$"


class ObjectProperties(BaseModel):
    """User-editable object description. All values are estimates unless measured."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    object_id: str = Field(pattern=ID_PATTERN)
    name: str = Field(min_length=1, max_length=80)
    mass_g: float = Field(gt=0, le=50_000)
    width_mm: float = Field(gt=0, le=1000, description="Dimension between the finger pads")
    height_mm: float = Field(gt=0, le=1000)
    depth_mm: float = Field(gt=0, le=1000)
    material: str = Field(min_length=1, max_length=40)
    friction_coefficient: float = Field(gt=0, le=2.0)
    fragility: Fragility
    max_contact_force_n: Optional[float] = Field(default=None, gt=0, le=1000)


class GripperLimits(BaseModel):
    """Gripper constraints used for feasibility checks. Authoritative on the server."""

    gripper_id: str
    finger_count: int = Field(ge=1, le=8)
    contact_pad_material: str
    force_definition: ForceDefinition = CANONICAL_FORCE_DEFINITION
    force_unit: str = FORCE_UNIT
    min_force_n: float = Field(ge=0)
    max_force_n: float = Field(gt=0)
    force_step_n: float = Field(gt=0)
    max_opening_mm: float = Field(gt=0)
    lift_acceleration_m_s2: float = Field(ge=0)
    holding_safety_factor: float = Field(ge=1)
    limits_source: Literal["demo", "hardware_team"] = "demo"

    @model_validator(mode="after")
    def _range(self) -> "GripperLimits":
        if self.min_force_n >= self.max_force_n:
            raise ValueError("min_force_n must be below max_force_n")
        return self

    def configuration(self) -> dict[str, Any]:
        """The subset of the gripper description that identifies a calibration."""
        return {
            "gripper_id": self.gripper_id,
            "finger_count": self.finger_count,
            "contact_pad_material": self.contact_pad_material.strip().lower(),
            "force_definition": self.force_definition,
            "force_unit": self.force_unit,
        }


# ---------------------------------------------------------------- safety ---
SafetyStatus = Literal[
    "ok", "marginal", "below_required", "below_minimum", "exceeds_limit", "no_safe_range", "invalid"
]


class SafetyCheck(BaseModel):
    id: str
    passed: bool
    severity: Literal["info", "warning", "blocking"]
    message: str


class SafetyAssessment(BaseModel):
    status: SafetyStatus
    selected_force_n: Optional[float]
    required_min_force_n: Optional[float]
    recommended_min_force_n: Optional[float]
    upper_limit_n: Optional[float]
    upper_limit_source: Optional[Literal["gripper_max", "object_max_contact"]]
    safe_range_n: Optional[tuple[float, float]]
    checks: list[SafetyCheck]
    can_test: bool
    can_save_as_calibrated: bool
    requires_override: bool
    summary: str
    disclaimer: str


# ------------------------------------------------------------ predictions --
class LLMForceResponse(BaseModel):
    """Structured output demanded from the LLM."""

    model_config = ConfigDict(extra="ignore")

    recommended_force: float
    force_definition: ForceDefinition
    force_definition_note: Optional[str] = None
    force_unit: str
    confidence: Literal["low", "medium", "high"]
    rationale: str = Field(min_length=1, max_length=2000)
    assumptions: list[str] = Field(default_factory=list, max_length=20)
    warnings: list[str] = Field(default_factory=list, max_length=20)


class PredictionRecord(BaseModel):
    prediction_id: str
    configuration_key: str
    object_id: str
    input_properties: dict[str, Any]
    gripper_configuration: dict[str, Any]
    llm_recommended_force: float
    force_definition: ForceDefinition
    force_unit: str
    confidence: str
    rationale: str
    # RTDB does not store empty arrays, so these legitimately come back absent
    assumptions: list[str] = Field(default_factory=list)
    llm_warnings: list[str] = Field(default_factory=list)
    model_identifier: str
    prompt_version: str
    created_at: str
    created_at_ms: int
    mode: Mode
    persisted: bool = True


class PredictGripRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    object: ObjectProperties
    regenerate: bool = Field(
        default=False,
        description="Skip the calibration cache and ask the LLM again. Never touches saved calibrations.",
    )
    allow_without_calibration_check: bool = Field(
        default=False,
        description="Explicit authorisation to query the LLM when Firebase is unavailable.",
    )


LookupState = Literal[
    "found_valid", "not_found", "stale", "invalidated", "safety_failed", "inconsistent", "skipped", "unavailable"
]


class CalibrationRecord(BaseModel):
    """Full calibration document stored under grip_calibrations/{id}."""

    model_config = ConfigDict(extra="allow")

    calibration_id: str
    configuration_key: str
    object_id: str
    input_properties: dict[str, Any]
    gripper_configuration: dict[str, Any]
    prediction_id: Optional[str] = None
    based_on_calibration_id: Optional[str] = None
    original_llm_force: Optional[float] = None
    model_identifier: Optional[str] = None
    prompt_version: Optional[str] = None
    initial_force: float
    calibrated_force: Optional[float] = None
    force_definition: ForceDefinition
    force_unit: str
    calibration_status: Literal["in_progress", "calibrated", "failed", "cancelled", "invalidated"]
    calibration_outcome: Optional[str] = None
    confirmation_method: Optional[Literal["manual", "sensor_assisted"]] = None
    created_at: str
    created_at_ms: int
    confirmed_at: Optional[str] = None
    confirmed_at_ms: Optional[int] = None
    last_verified_at: Optional[str] = None
    sensor_summary: Optional[dict[str, Any]] = None
    safety_assessment: Optional[dict[str, Any]] = None
    warnings: list[str] = Field(default_factory=list)
    override: Optional[dict[str, Any]] = None
    notes: Optional[str] = None
    invalidated_at: Optional[str] = None
    invalidation_reason: Optional[str] = None
    mode: Mode
    tests: dict[str, Any] = Field(default_factory=dict)


class CalibrationLookup(BaseModel):
    state: LookupState
    reason: Optional[str] = None
    record: Optional[CalibrationRecord] = None


class PredictGripResponse(BaseModel):
    configuration_key: str
    normalized_configuration: dict[str, Any]
    source: Literal["calibration", "llm"]
    calibration_status: Literal["calibrated", "uncalibrated"]
    calibration_lookup: CalibrationLookup
    llm_called: bool
    prediction: Optional[PredictionRecord]
    selected_force_n: float
    selected_force_note: Optional[str] = None
    safety: SafetyAssessment
    limits: GripperLimits
    messages: list[str]
    mode: Mode


# ----------------------------------------------------------- calibrations --
class StartCalibrationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    object: ObjectProperties
    initial_force_n: float = Field(gt=0)
    prediction_id: Optional[str] = Field(default=None, pattern=RECORD_ID_PATTERN)
    based_on_calibration_id: Optional[str] = Field(default=None, pattern=RECORD_ID_PATTERN)


TestEvent = Literal["test_started", "slipped", "damage_risk", "failed"]


class TestEventRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event: TestEvent
    force_n: float = Field(gt=0)
    note: Optional[str] = Field(default=None, max_length=300)


class UserConfirmation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    held_and_lifted: bool
    no_slip: bool
    no_damage: bool


class ConfirmRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    outcome: Literal["success", "failed", "cancelled"]
    final_force_n: Optional[float] = Field(default=None, gt=0)
    user_confirmation: Optional[UserConfirmation] = None
    override_reason: Optional[str] = Field(default=None, min_length=5, max_length=300)
    notes: Optional[str] = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _success_needs_details(self) -> "ConfirmRequest":
        if self.outcome == "success" and (self.final_force_n is None or self.user_confirmation is None):
            raise ValueError("a successful outcome requires final_force_n and user_confirmation")
        return self


class InvalidateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=3, max_length=300)


# -------------------------------------------------------------- telemetry --
class TelemetrySample(BaseModel):
    """Normalised telemetry. Missing hardware fields stay None (shown as unavailable)."""

    measured_force_n: Optional[float] = None
    finger_opening_mm: Optional[float] = None
    object_detected: Optional[bool] = None
    slip_detected: Optional[bool] = None
    operation_state: Optional[str] = None
    timestamp_ms: Optional[int] = None
    age_s: Optional[float] = None
    stale: bool = True
    available: bool = False
    reason: Optional[str] = None


# ------------------------------------------------------------- operations --
class OperationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    object_id: str = Field(pattern=ID_PATTERN)
    configuration_key: str = Field(pattern=KEY_PATTERN)
    selected_force_n: float = Field(gt=0)
    calibration_id: Optional[str] = Field(default=None, pattern=RECORD_ID_PATTERN)
    calibration_status: Literal["calibrated", "uncalibrated"]
    operation_result: Literal["success", "failed", "aborted", "slipped", "damaged"]
    duration_s: Optional[float] = Field(default=None, ge=0, le=3600)
    peak_measured_force_n: Optional[float] = Field(default=None, ge=0)
    data_source: Literal["simulated", "firebase_live", "manual"]
    notes: Optional[str] = Field(default=None, max_length=300)
    trace: Optional[list[dict[str, Any]]] = Field(default=None, max_length=400)

    @field_validator("trace")
    @classmethod
    def _trace_ok(cls, v: Optional[list[dict[str, Any]]]) -> Optional[list[dict[str, Any]]]:
        if v is None:
            return v
        for row in v:
            if len(row) > 8:
                raise ValueError("trace rows may hold at most 8 fields")
        return v


class ForceCommandRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    configuration_key: str = Field(pattern=KEY_PATTERN)
    object: ObjectProperties
    target_force_n: float = Field(gt=0)
