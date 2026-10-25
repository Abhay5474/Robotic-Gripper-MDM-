import { create } from 'zustand'
import { api, ApiError } from '@/lib/api'
import { cacheDrop, cacheGet, cachePut, type CachedCalibration } from '@/lib/localCache'
import { CUSTOM_ID, fingerprint, PRESETS, slugify, toForm, validateForm, type ObjectForm } from '@/lib/objects'
import { assess } from '@/lib/safety'
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type UiSettings } from '@/lib/settings'
import type { ApiErrorBody, CalibrationRecord, GripperLimits, Health, Mode, ObjectProps, PredictGripResponse } from '@/lib/types'
import { clamp, roundToStep } from '@/lib/format'
import { useTelemetry } from './telemetry'

export interface SessionEvent { event: 'test_started' | 'slipped' | 'damage_risk' | 'failed'; force: number; at: number }
export interface Session {
  record: CalibrationRecord
  events: SessionEvent[]
  busy: boolean
  error: string | null
}
export interface Resolution {
  status: 'idle' | 'loading' | 'ready' | 'error'
  data: PredictGripResponse | null
  error: ApiErrorBody | null
  object: ObjectProps | null // the exact configuration that `data` belongs to
  cached: CachedCalibration | null
  usingCached: boolean
}
const EMPTY_RES: Resolution = { status: 'idle', data: null, error: null, object: null, cached: null, usingCached: false }

interface AppState {
  settings: UiSettings
  health: Health | null
  healthError: string | null
  presetId: string
  form: ObjectForm
  resolution: Resolution
  selectedForce: number | null
  session: Session | null
  commandNote: string | null
  starting: boolean
  init: () => Promise<void>
  updateSettings: (p: Partial<UiSettings>) => void
  setMode: (m: Mode) => void
  selectPreset: (id: string) => void
  editForm: (field: keyof ObjectForm, value: string) => void
  loadObject: (o: ObjectProps) => void
  resolve: (opts?: { regenerate?: boolean; allowWithoutCheck?: boolean }) => Promise<void>
  useCachedLocal: () => void
  setForce: (v: number) => void
  nudge: (dir: 1 | -1, size: 'fine' | 'coarse') => void
  startTest: () => Promise<void>
  mark: (event: 'slipped' | 'damage_risk' | 'failed') => Promise<void>
  confirmSuccess: (p: { held: boolean; noSlip: boolean; noDamage: boolean; notes?: string; overrideReason?: string }) => Promise<boolean>
  endSession: (outcome: 'cancelled' | 'failed') => Promise<void>
  invalidate: (id: string, reason: string) => Promise<void>
}

let seq = 0
const initialPreset = PRESETS[0]

export const limitsOf = (s: AppState): GripperLimits | null => s.health?.limits ?? null
export const staleAfter = (s: AppState) => s.settings.staleAfterS ?? s.health?.telemetry.stale_after_s ?? 5

const errBody = (e: unknown): ApiErrorBody =>
  e instanceof ApiError ? e.body : { code: 'unexpected', message: e instanceof Error ? e.message : String(e) }

export const useApp = create<AppState>((set, get) => ({
  settings: loadSettings(),
  health: null,
  healthError: null,
  presetId: initialPreset.object_id,
  form: toForm(initialPreset),
  resolution: EMPTY_RES,
  selectedForce: null,
  session: null,
  commandNote: null,
  starting: false,

  async init() {
    try {
      const health = await api.health()
      set({ health, healthError: null })
    } catch (e) {
      set({ healthError: errBody(e).message })
    }
    const s = get()
    useTelemetry.getState().start(s.settings.mode, s.settings.telemetryPath, limitsOf(s))
    if (s.health) await get().resolve()
  },

  updateSettings(p) {
    const settings = { ...get().settings, ...p, theme: loadSettings().theme }
    saveSettings(settings)
    set({ settings })
    if (p.telemetryPath !== undefined) useTelemetry.getState().start(settings.mode, settings.telemetryPath, limitsOf(get()))
  },

  setMode(mode) {
    if (get().session?.record.calibration_status === 'in_progress') return
    get().updateSettings({ mode })
    set({ resolution: EMPTY_RES, selectedForce: null, session: null, commandNote: null })
    const s = get()
    useTelemetry.getState().start(mode, s.settings.telemetryPath, limitsOf(s))
    void get().resolve()
  },

  selectPreset(id) {
    if (get().session) return
    const p = PRESETS.find((x) => x.object_id === id)
    if (!p) return
    set({ presetId: id, form: toForm(p), resolution: EMPTY_RES, selectedForce: null })
    void get().resolve()
  },

  editForm(field, value) {
    if (get().session) return
    const form = { ...get().form, [field]: value } as ObjectForm
    if (get().presetId === CUSTOM_ID && field === 'name') form.object_id = slugify(value) || 'custom-object'
    // Any edit invalidates the previous resolution: a force must never be carried over to a changed configuration.
    set({ form, resolution: EMPTY_RES, selectedForce: null })
  },

  loadObject(o) {
    const known = PRESETS.some((p) => p.object_id === o.object_id)
    set({ presetId: known ? o.object_id : CUSTOM_ID, form: toForm(o), resolution: EMPTY_RES, selectedForce: null, session: null })
    void get().resolve()
  },

  async resolve(opts = {}) {
    const s = get()
    const { value, errors } = validateForm(s.form)
    if (!value || !s.health) {
      set({ resolution: { ...EMPTY_RES, status: 'error', error: { code: s.health ? 'invalid_form' : 'backend_unreachable', message: s.health ? `Fix the highlighted fields: ${Object.values(errors).join(', ')}` : 'Backend unavailable.' } } })
      return
    }
    const my = ++seq
    const mode = s.settings.mode
    const fp = fingerprint(value)
    set({ resolution: { ...EMPTY_RES, status: 'loading', object: value } })
    try {
      const data = await api.predict(mode, value, { regenerate: opts.regenerate, allow_without_calibration_check: opts.allowWithoutCheck })
      if (my !== seq) return
      if (data.calibration_lookup.state === 'found_valid' && data.calibration_lookup.record) {
        cachePut({ fingerprint: fp, mode, configuration_key: data.configuration_key, record: data.calibration_lookup.record, limits: data.limits, cached_at: new Date().toISOString() })
      } else if (data.calibration_lookup.state !== 'unavailable') {
        cacheDrop(mode, fp)
      }
      set({ resolution: { status: 'ready', data, error: null, object: value, cached: null, usingCached: false }, selectedForce: data.selected_force_n })
    } catch (e) {
      if (my !== seq) return
      const body = errBody(e)
      const cached = body.code === 'store_unavailable' || body.code === 'backend_unreachable' ? cacheGet(mode, fp) : null
      set({ resolution: { status: 'error', data: null, error: body, object: value, cached, usingCached: false }, selectedForce: null })
    }
  },

  useCachedLocal() {
    const { resolution, health } = get()
    const c = resolution.cached
    if (!c || !resolution.object || !health || c.record.calibrated_force == null) return
    const sa = assess(resolution.object, health.limits, c.record.calibrated_force)
    if (sa.status !== 'ok' && sa.status !== 'marginal') {
      set({ resolution: { ...resolution, error: { code: 'cached_unsafe', message: `Cached value fails current safety checks: ${sa.summary}` } } })
      return
    }
    set({ resolution: { ...resolution, usingCached: true }, selectedForce: c.record.calibrated_force })
  },

  setForce(v) {
    const l = limitsOf(get())
    if (!l || !Number.isFinite(v)) return
    set({ selectedForce: Number(clamp(roundToStep(v, l.force_step_n), l.min_force_n, l.max_force_n).toFixed(4)) })
  },

  nudge(dir, size) {
    const { selectedForce, settings } = get()
    const l = limitsOf(get())
    if (selectedForce == null || !l) return
    const mult = size === 'fine' ? settings.fineSteps : settings.coarseSteps
    get().setForce(selectedForce + dir * mult * l.force_step_n)
  },

  async startTest() {
    const s = get()
    const { resolution, selectedForce, health } = s
    if (!resolution.data || !resolution.object || selectedForce == null || !health) return
    if (resolution.usingCached) { set({ commandNote: 'Cached data cannot start a logged calibration test: Firebase is unreachable.' }); return }
    const mode = s.settings.mode
    const local = assess(resolution.object, health.limits, selectedForce)
    if (!local.can_test) return
    set({ starting: true, commandNote: null })
    try {
      let session = s.session
      if (!session) {
        const base = resolution.data.calibration_lookup.record?.calibration_id ?? null
        const record = await api.startCalibration(mode, {
          object: resolution.object, initial_force_n: selectedForce,
          prediction_id: resolution.data.prediction?.prediction_id ?? null, based_on_calibration_id: base,
        })
        session = { record, events: [], busy: false, error: null }
        set({ session })
      } else set({ session: { ...session, error: null } })
      await api.logTest(mode, session.record.calibration_id, 'test_started', selectedForce)
      set((st) => ({ session: st.session && { ...st.session, events: [...st.session.events, { event: 'test_started', force: selectedForce, at: Date.now() }] } }))
      if (mode === 'demo') useTelemetry.getState().runSim(resolution.object, selectedForce)
      if (mode === 'live') {
        if (health.command_channel === 'rtdb') {
          try {
            const r = await api.sendForceTarget(mode, resolution.data.configuration_key, resolution.object, selectedForce)
            set({ commandNote: `Target ${selectedForce} N queued in Firebase (${r.command.command_id}). Hardware acknowledgement is NOT confirmed - watch the telemetry.` })
          } catch (e) { set({ commandNote: `Command not sent: ${errBody(e).message}` }) }
        } else {
          set({ commandNote: 'No hardware command channel is configured: the selected force is a software target and the physical gripper has NOT received it. Set it on the gripper, then run the test.' })
        }
      }
    } catch (e) {
      const msg = errBody(e).message
      set((st) => ({ session: st.session ? { ...st.session, error: msg } : null, commandNote: st.session ? st.commandNote : msg }))
    } finally {
      set({ starting: false })
    }
  },

  async mark(event) {
    const s = get()
    const sess = s.session
    if (!sess?.record) return
    const lastTest = [...sess.events].reverse().find((e) => e.event === 'test_started')
    const force = lastTest?.force ?? s.selectedForce
    if (force == null) return
    try {
      await api.logTest(s.settings.mode, sess.record.calibration_id, event, force)
      set((st) => ({ session: st.session && { ...st.session, error: null, events: [...st.session.events, { event, force, at: Date.now() }] } }))
      useTelemetry.getState().abortSim()
    } catch (e) {
      set((st) => ({ session: st.session && { ...st.session, error: errBody(e).message } }))
    }
  },

  async confirmSuccess(p) {
    const s = get()
    const sess = s.session
    if (!sess?.record || s.selectedForce == null) return false
    set({ session: { ...sess, busy: true, error: null } })
    try {
      await api.confirm(s.settings.mode, sess.record.calibration_id, {
        outcome: 'success', final_force_n: s.selectedForce,
        user_confirmation: { held_and_lifted: p.held, no_slip: p.noSlip, no_damage: p.noDamage },
        notes: p.notes || undefined, override_reason: p.overrideReason || undefined,
      })
      set({ session: null, commandNote: null })
      await get().resolve() // re-read from Firebase: proves the saved value is what will be reused
      return true
    } catch (e) {
      set((st) => ({ session: st.session && { ...st.session, busy: false, error: errBody(e).message } }))
      return false
    }
  },

  async endSession(outcome) {
    const s = get()
    const sess = s.session
    if (!sess) return
    useTelemetry.getState().abortSim()
    if (sess.record) {
      try { await api.confirm(s.settings.mode, sess.record.calibration_id, { outcome }) } catch (e) {
        set({ session: { ...sess, error: errBody(e).message } }); return
      }
    }
    set({ session: null, commandNote: null })
    await get().resolve()
  },

  async invalidate(id, reason) {
    const mode = get().settings.mode
    await api.invalidate(mode, id, reason)
    const o = get().resolution.object
    if (o) cacheDrop(mode, fingerprint(o))
    await get().resolve()
  },
}))

export { DEFAULT_SETTINGS }
