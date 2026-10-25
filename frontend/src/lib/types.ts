export type Mode = 'demo' | 'live'
export type Fragility = 'robust' | 'moderate' | 'fragile'

export interface ObjectProps {
  object_id: string
  name: string
  mass_g: number
  width_mm: number
  height_mm: number
  depth_mm: number
  material: string
  friction_coefficient: number
  fragility: Fragility
  max_contact_force_n: number | null
}

export interface GripperLimits {
  gripper_id: string
  finger_count: number
  contact_pad_material: string
  force_definition: 'normal_force_per_finger' | 'total_actuator_force' | 'other'
  force_unit: string
  min_force_n: number
  max_force_n: number
  force_step_n: number
  max_opening_mm: number
  lift_acceleration_m_s2: number
  holding_safety_factor: number
  limits_source: 'demo' | 'hardware_team'
}

export type SafetyStatus =
  | 'ok' | 'marginal' | 'below_required' | 'below_minimum' | 'exceeds_limit' | 'no_safe_range' | 'invalid'

export interface SafetyCheck { id: string; passed: boolean; severity: 'info' | 'warning' | 'blocking'; message: string }

export interface SafetyAssessment {
  status: SafetyStatus
  selected_force_n: number | null
  required_min_force_n: number | null
  recommended_min_force_n: number | null
  upper_limit_n: number | null
  upper_limit_source: 'gripper_max' | 'object_max_contact' | null
  safe_range_n: [number, number] | null
  checks: SafetyCheck[]
  can_test: boolean
  can_save_as_calibrated: boolean
  requires_override: boolean
  summary: string
  disclaimer: string
}

export interface PredictionRecord {
  prediction_id: string
  configuration_key: string
  llm_recommended_force: number
  force_definition: string
  force_unit: string
  confidence: string
  rationale: string
  assumptions: string[]
  llm_warnings: string[]
  model_identifier: string
  prompt_version: string
  created_at: string
  persisted: boolean
}

export interface TestEventRecord { event: string; force_n: number; at: string; seq?: number; note?: string; safety_status?: string }

export interface CalibrationRecord {
  calibration_id: string
  configuration_key: string
  object_id: string
  input_properties: ObjectProps
  prediction_id?: string | null
  based_on_calibration_id?: string | null
  original_llm_force?: number | null
  model_identifier?: string | null
  prompt_version?: string | null
  initial_force: number
  calibrated_force?: number | null
  force_definition: string
  force_unit: string
  calibration_status: 'in_progress' | 'calibrated' | 'failed' | 'cancelled' | 'invalidated'
  confirmation_method?: 'manual' | 'sensor_assisted' | null
  created_at: string
  confirmed_at?: string | null
  last_verified_at?: string | null
  warnings: string[]
  sensor_summary?: Record<string, unknown> | null
  override?: { used: boolean; reason: string } | null
  invalidation_reason?: string | null
  notes?: string | null
  mode: Mode
  tests?: Record<string, TestEventRecord>
}

export type LookupState =
  | 'found_valid' | 'not_found' | 'stale' | 'invalidated' | 'safety_failed' | 'inconsistent' | 'skipped' | 'unavailable'

export interface PredictGripResponse {
  configuration_key: string
  source: 'calibration' | 'llm'
  calibration_status: 'calibrated' | 'uncalibrated'
  calibration_lookup: { state: LookupState; reason?: string | null; record?: CalibrationRecord | null }
  llm_called: boolean
  prediction: PredictionRecord | null
  selected_force_n: number
  selected_force_note?: string | null
  safety: SafetyAssessment
  limits: GripperLimits
  messages: string[]
  mode: Mode
}

export interface Health {
  status: 'ok' | 'degraded'
  version: string
  store: { backend: string; reachable: boolean; error: string | null; dev_only: boolean }
  llm: { provider: string; model: string; configured: boolean; prompt_version: string; is_mock: boolean }
  limits: GripperLimits
  telemetry: { path: string; stale_after_s: number }
  command_channel: 'none' | 'rtdb'
  auth_mode: 'none' | 'bearer' | 'firebase'
  allow_safety_override: boolean
  calibration_max_age_days: number
}

export interface OperationRecord {
  operation_id: string
  object_id: string
  configuration_key: string
  selected_force_n: number
  calibration_id?: string
  calibration_status: 'calibrated' | 'uncalibrated'
  operation_result: 'success' | 'failed' | 'aborted' | 'slipped' | 'damaged'
  duration_s?: number
  peak_measured_force_n?: number
  data_source: 'simulated' | 'firebase_live' | 'manual'
  notes?: string
  trace?: TraceRow[]
  timestamp: string
  timestamp_ms: number
  mode: Mode
}

/** Compact recorded sample: t seconds, f measured force N, o opening mm, s slip(0/1), st state */
export interface TraceRow { t: number; f?: number | null; o?: number | null; s?: number | null; st?: string | null; d?: number | null }

export interface Telemetry {
  measured_force_n: number | null
  finger_opening_mm: number | null
  object_detected: boolean | null
  slip_detected: boolean | null
  operation_state: string | null
  timestamp_ms: number | null
  received_ms: number
}

export interface ApiErrorBody { code: string; message: string; retryable?: boolean; fallback_available?: boolean; safety?: SafetyAssessment }
