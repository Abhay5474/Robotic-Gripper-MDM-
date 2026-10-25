import { beforeEach, describe, expect, it, vi } from 'vitest'
import cases from '@shared/safety_cases.json'
import { ApiError } from '@/lib/api'
import { assess } from '@/lib/safety'
import type { CalibrationRecord, GripperLimits, Health, ObjectProps, PredictGripResponse } from '@/lib/types'

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof import('@/lib/api')>()
  return { ...real, api: { health: vi.fn(), predict: vi.fn(), startCalibration: vi.fn(), logTest: vi.fn(), confirm: vi.fn(), invalidate: vi.fn(), sendForceTarget: vi.fn() } }
})
vi.mock('@/lib/firebase', () => ({ subscribeTelemetry: () => () => {}, firebaseConfigured: false }))

import { api } from '@/lib/api'
import { toForm } from '@/lib/objects'
import { useApp } from '@/store/app'
import { useTelemetry } from '@/store/telemetry'

const limits = cases.limits as GripperLimits
const bottle = cases.cases[0].object as ObjectProps
const health = { status: 'ok', limits, telemetry: { path: 'gripper_telemetry', stale_after_s: 5 }, command_channel: 'none', allow_safety_override: false } as unknown as Health

const rec = (force: number): CalibrationRecord => ({
  calibration_id: 'cal_0000000000001_abcdef', configuration_key: 'cfg_' + 'a'.repeat(32), object_id: bottle.object_id, input_properties: bottle,
  initial_force: 8, calibrated_force: force, force_definition: 'normal_force_per_finger', force_unit: 'N', calibration_status: 'calibrated',
  created_at: '2026-01-01T00:00:00Z', confirmed_at: '2026-01-01T00:00:00Z', warnings: [], mode: 'demo',
})
const llmResp = (force: number): PredictGripResponse => ({
  configuration_key: 'cfg_' + 'a'.repeat(32), source: 'llm', calibration_status: 'uncalibrated', calibration_lookup: { state: 'not_found' }, llm_called: true,
  prediction: { prediction_id: 'pred_0000000000001_abcdef', configuration_key: 'cfg_' + 'a'.repeat(32), llm_recommended_force: force, force_definition: 'normal_force_per_finger', force_unit: 'N', confidence: 'medium', rationale: 'r', assumptions: [], llm_warnings: [], model_identifier: 'm', prompt_version: 'v1', created_at: '2026-01-01', persisted: true },
  selected_force_n: force, safety: assess(bottle, limits, force), limits, messages: [], mode: 'demo',
})
const cacheResp = (force: number): PredictGripResponse => ({ ...llmResp(force), source: 'calibration', calibration_status: 'calibrated', calibration_lookup: { state: 'found_valid', record: rec(force) }, llm_called: false, prediction: null })

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  useTelemetry.getState().stop()
  useApp.setState({ health, form: toForm(bottle), session: null, selectedForce: null, resolution: { status: 'idle', data: null, error: null, object: null, cached: null, usingCached: false } })
})

describe('resolution flow', () => {
  it('Case B: no calibration -> slider takes the LLM recommendation, marked uncalibrated', async () => {
    vi.mocked(api.predict).mockResolvedValue(llmResp(8))
    await useApp.getState().resolve()
    const s = useApp.getState()
    expect(s.selectedForce).toBe(8)
    expect(s.resolution.data?.calibration_status).toBe('uncalibrated')
  })

  it('Case A: saved calibration populates the slider and no LLM recommendation is present', async () => {
    vi.mocked(api.predict).mockResolvedValue(cacheResp(9.5))
    await useApp.getState().resolve()
    const s = useApp.getState()
    expect(s.selectedForce).toBe(9.5)
    expect(s.resolution.data?.llm_called).toBe(false)
    expect(s.resolution.data?.prediction).toBeNull()
  })

  it('Case C: Firebase down -> error, no force invented, nothing selected', async () => {
    vi.mocked(api.predict).mockRejectedValue(new ApiError(503, { code: 'store_unavailable', message: 'down', retryable: true, fallback_available: true }))
    await useApp.getState().resolve()
    const s = useApp.getState()
    expect(s.resolution.status).toBe('error')
    expect(s.selectedForce).toBeNull()
    expect(s.resolution.data).toBeNull()
  })

  it('Case C with a previously cached calibration: offered as cached, applied only after safety re-check', async () => {
    vi.mocked(api.predict).mockResolvedValueOnce(cacheResp(9.5))
    await useApp.getState().resolve()
    vi.mocked(api.predict).mockRejectedValue(new ApiError(503, { code: 'store_unavailable', message: 'down', retryable: true }))
    await useApp.getState().resolve()
    let s = useApp.getState()
    expect(s.selectedForce).toBeNull() // not applied automatically
    expect(s.resolution.cached?.record.calibrated_force).toBe(9.5)
    useApp.getState().useCachedLocal()
    s = useApp.getState()
    expect(s.selectedForce).toBe(9.5)
    expect(s.resolution.usingCached).toBe(true)
  })

  it('refuses a cached value that fails the current safety checks', () => {
    const tighter = { ...bottle, max_contact_force_n: 10 } // cached 19 N is now above the object limit
    useApp.setState({ resolution: { status: 'error', data: null, error: { code: 'store_unavailable', message: 'down' }, object: tighter,
      cached: { fingerprint: 'x', mode: 'demo', configuration_key: 'cfg_' + 'a'.repeat(32), record: rec(19), limits, cached_at: '2026-01-01' }, usingCached: false } })
    useApp.getState().useCachedLocal()
    const s = useApp.getState()
    expect(s.selectedForce).toBeNull()
    expect(s.resolution.usingCached).toBe(false)
    expect(s.resolution.error?.code).toBe('cached_unsafe')
  })

  it('editing any property discards the resolution so a force is never carried to another configuration', async () => {
    vi.mocked(api.predict).mockResolvedValue(cacheResp(9.5))
    await useApp.getState().resolve()
    useApp.getState().editForm('mass_g', '500')
    const s = useApp.getState()
    expect(s.selectedForce).toBeNull()
    expect(s.resolution.status).toBe('idle')
  })

  it('invalid form never calls the backend', async () => {
    useApp.setState({ form: { ...useApp.getState().form, mass_g: '-1' } })
    await useApp.getState().resolve()
    expect(api.predict).not.toHaveBeenCalled()
    expect(useApp.getState().resolution.status).toBe('error')
  })
})

describe('slider', () => {
  it('clamps to the gripper range and snaps to the step', () => {
    useApp.setState({ selectedForce: 8 })
    useApp.getState().setForce(999)
    expect(useApp.getState().selectedForce).toBe(limits.max_force_n)
    useApp.getState().setForce(-5)
    expect(useApp.getState().selectedForce).toBe(limits.min_force_n)
    useApp.getState().setForce(7.26)
    expect(useApp.getState().selectedForce).toBe(7.5)
  })
  it('nudges by configured increments', () => {
    useApp.setState({ selectedForce: 8 })
    useApp.getState().nudge(1, 'coarse')
    expect(useApp.getState().selectedForce).toBe(8 + 5 * limits.force_step_n)
    useApp.getState().nudge(-1, 'fine')
    expect(useApp.getState().selectedForce).toBe(8 + 4 * limits.force_step_n)
  })
})

describe('calibration session', () => {
  it('does not start a test for an infeasible force', async () => {
    vi.mocked(api.predict).mockResolvedValue(llmResp(8))
    await useApp.getState().resolve()
    useApp.setState({ selectedForce: 25 }) // above the bottle's 20 N contact limit
    await useApp.getState().startTest()
    expect(api.startCalibration).not.toHaveBeenCalled()
  })

  it('start test creates a session at the selected force and logs it', async () => {
    vi.mocked(api.predict).mockResolvedValue(llmResp(8))
    vi.mocked(api.startCalibration).mockResolvedValue({ ...rec(0), calibration_status: 'in_progress', calibrated_force: null })
    vi.mocked(api.logTest).mockResolvedValue({} as never)
    await useApp.getState().resolve()
    useApp.getState().setForce(9)
    await useApp.getState().startTest()
    expect(api.startCalibration).toHaveBeenCalledWith('demo', expect.objectContaining({ initial_force_n: 9, prediction_id: 'pred_0000000000001_abcdef' }))
    expect(api.logTest).toHaveBeenCalledWith('demo', 'cal_0000000000001_abcdef', 'test_started', 9)
    expect(useApp.getState().session?.events.at(-1)?.force).toBe(9)
  })

  it('confirm re-reads from the backend after saving', async () => {
    vi.mocked(api.predict).mockResolvedValueOnce(llmResp(8)).mockResolvedValue(cacheResp(9))
    vi.mocked(api.startCalibration).mockResolvedValue({ ...rec(0), calibration_status: 'in_progress' })
    vi.mocked(api.logTest).mockResolvedValue({} as never)
    vi.mocked(api.confirm).mockResolvedValue({ record: rec(9), active_updated: true })
    await useApp.getState().resolve()
    useApp.getState().setForce(9)
    await useApp.getState().startTest()
    const ok = await useApp.getState().confirmSuccess({ held: true, noSlip: true, noDamage: true })
    expect(ok).toBe(true)
    expect(api.confirm).toHaveBeenCalledWith('demo', 'cal_0000000000001_abcdef', expect.objectContaining({ outcome: 'success', final_force_n: 9 }))
    expect(useApp.getState().resolution.data?.source).toBe('calibration')
    expect(useApp.getState().session).toBeNull()
  })

  it('backend rejection keeps the session open and shows the reason', async () => {
    vi.mocked(api.predict).mockResolvedValue(llmResp(8))
    vi.mocked(api.startCalibration).mockResolvedValue({ ...rec(0), calibration_status: 'in_progress' })
    vi.mocked(api.logTest).mockResolvedValue({} as never)
    vi.mocked(api.confirm).mockRejectedValue(new ApiError(409, { code: 'untested_force', message: 'test it first' }))
    await useApp.getState().resolve()
    await useApp.getState().startTest()
    expect(await useApp.getState().confirmSuccess({ held: true, noSlip: true, noDamage: true })).toBe(false)
    expect(useApp.getState().session?.error).toBe('test it first')
  })
})

describe('selection persistence', () => {
  it('stores the chosen object and restores it after a reload', async () => {
    const { loadSelection } = await import('@/lib/settings')
    useApp.getState().selectPreset('ceramic-cup')
    expect(loadSelection()?.presetId).toBe('ceramic-cup')
    useApp.getState().editForm('mass_g', '320')
    expect(loadSelection()?.form.mass_g).toBe('320')
    vi.resetModules()
    vi.doMock('@/lib/firebase', () => ({ subscribeTelemetry: () => () => {}, firebaseConfigured: false }))
    const fresh = await import('@/store/app')
    expect(fresh.useApp.getState().presetId).toBe('ceramic-cup')
    expect(fresh.useApp.getState().form.mass_g).toBe('320')
  })
  it('ignores malformed or unknown stored selections', async () => {
    const { loadSelection } = await import('@/lib/settings')
    localStorage.setItem('gripsense.selection.v1', '{"presetId":"x","form":{"mass_g":5}}')
    expect(loadSelection()).toBeNull()
    localStorage.setItem('gripsense.selection.v1', 'not json')
    expect(loadSelection()).toBeNull()
  })
})
