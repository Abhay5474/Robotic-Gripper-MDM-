import { getApiToken } from './settings'
import type { ApiErrorBody, CalibrationRecord, Health, LookupItem, Mode, ObjectProps, OperationRecord, PredictGripResponse, SafetyAssessment, TestEventRecord } from './types'

const BASE = import.meta.env.VITE_API_BASE ?? '/api'

export class ApiError extends Error {
  constructor(public status: number, public body: ApiErrorBody) { super(body.message) }
}

let tokenProvider: (() => Promise<string | null>) | null = null
export const setTokenProvider = (p: (() => Promise<string | null>) | null) => { tokenProvider = p }

async function request<T>(mode: Mode, method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { 'X-GripSense-Mode': mode }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = (tokenProvider && (await tokenProvider().catch(() => null))) || getApiToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let res: Response
  try {
    res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError(0, { code: 'backend_unreachable', message: 'Cannot reach the GripSense backend. Is it running?', retryable: true })
  }
  const text = await res.text()
  let data: unknown = null
  try { data = text ? JSON.parse(text) : null } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const d = (data as { detail?: unknown } | null)?.detail
    if (d && typeof d === 'object' && !Array.isArray(d) && 'code' in d) throw new ApiError(res.status, d as ApiErrorBody)
    if (Array.isArray(d)) throw new ApiError(res.status, { code: 'validation_error', message: d.map((x: { loc?: string[]; msg?: string }) => `${(x.loc ?? []).slice(1).join('.')}: ${x.msg}`).join('; ') })
    throw new ApiError(res.status, { code: 'http_error', message: `Backend returned HTTP ${res.status}.`, retryable: res.status >= 500 })
  }
  return data as T
}

export const api = {
  health: () => request<Health>('live', 'GET', '/health'),
  predict: (mode: Mode, object: ObjectProps, opts: { regenerate?: boolean; allow_without_calibration_check?: boolean } = {}, signal?: AbortSignal) =>
    request<PredictGripResponse>(mode, 'POST', '/predict-grip', { object, ...opts }, signal),
  startCalibration: (mode: Mode, body: { object: ObjectProps; initial_force_n: number; prediction_id?: string | null; based_on_calibration_id?: string | null }) =>
    request<CalibrationRecord>(mode, 'POST', '/calibrations', { ...body, prediction_id: body.prediction_id ?? undefined, based_on_calibration_id: body.based_on_calibration_id ?? undefined }),
  logTest: (mode: Mode, id: string, event: 'test_started' | 'slipped' | 'damage_risk' | 'failed', force_n: number, note?: string) =>
    request<{ test_id: string; event: TestEventRecord; safety: SafetyAssessment }>(mode, 'POST', `/calibrations/${id}/tests`, { event, force_n, note }),
  confirm: (mode: Mode, id: string, body: Record<string, unknown>) =>
    request<{ record: CalibrationRecord; active_updated: boolean; note?: string | null }>(mode, 'POST', `/calibrations/${id}/confirm`, body),
  invalidate: (mode: Mode, id: string, reason: string) =>
    request<{ record: CalibrationRecord; active_cleared: boolean }>(mode, 'POST', `/calibrations/${id}/invalidate`, { reason }),
  /** Calibration status of many configurations at once. Never calls the LLM. */
  lookup: (mode: Mode, objects: ObjectProps[]) => request<{ items: LookupItem[]; llm_called: false }>(mode, 'POST', '/calibrations/lookup', { objects }),
  history: (mode: Mode, key: string) =>
    request<{ configuration_key: string; active_calibration_id: string | null; records: CalibrationRecord[] }>(mode, 'GET', `/calibration-history/${key}`),
  recentCalibrations: (mode: Mode, limit = 100) => request<{ records: CalibrationRecord[] }>(mode, 'GET', `/calibrations?limit=${limit}`),
  operations: (mode: Mode, limit = 100) => request<{ operations: OperationRecord[] }>(mode, 'GET', `/operations?limit=${limit}`),
  recordOperation: (mode: Mode, body: Omit<OperationRecord, 'operation_id' | 'timestamp' | 'timestamp_ms' | 'mode'>) =>
    request<OperationRecord>(mode, 'POST', '/operations', body),
  sendForceTarget: (mode: Mode, key: string, object: ObjectProps, target_force_n: number) =>
    request<{ command: { command_id: string; status: string }; acknowledged_by_hardware: boolean }>(mode, 'POST', '/commands/force-target', { configuration_key: key, object, target_force_n }),
}
