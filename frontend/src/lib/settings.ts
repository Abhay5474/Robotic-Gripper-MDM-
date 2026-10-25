// Browser-only preferences. No secrets are stored in localStorage; the optional API token lives in sessionStorage.
import type { Mode } from './types'
import type { ThemePref } from './theme'

const KEY = 'gripsense.settings.v1'
export interface UiSettings {
  mode: Mode
  theme: ThemePref
  staleAfterS: number | null // null = use backend default
  fineSteps: number // slider increments for +/- buttons, expressed in multiples of the gripper step
  coarseSteps: number
  telemetryPath: string
}
export const DEFAULT_SETTINGS: UiSettings = {
  mode: 'demo', theme: 'system', staleAfterS: null, fineSteps: 1, coarseSteps: 5,
  telemetryPath: import.meta.env.VITE_TELEMETRY_PATH ?? 'gripper_telemetry',
}

export function loadSettings(): UiSettings {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS
  } catch { return DEFAULT_SETTINGS }
}
export function saveSettings(s: UiSettings) { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* storage unavailable */ } }

export const getApiToken = () => { try { return sessionStorage.getItem('gripsense.token') } catch { return null } }
export const setApiToken = (t: string | null) => { try { t ? sessionStorage.setItem('gripsense.token', t) : sessionStorage.removeItem('gripsense.token') } catch { /* ignore */ } }

// ---- selected object (restored after a reload; holds no secrets)
const SEL_KEY = 'gripsense.selection.v1'
const FORM_KEYS = ['object_id', 'name', 'mass_g', 'width_mm', 'height_mm', 'depth_mm', 'material', 'friction_coefficient', 'fragility', 'max_contact_force_n']
export interface StoredSelection { presetId: string; form: Record<string, string> }

export function loadSelection(): StoredSelection | null {
  try {
    const v = JSON.parse(localStorage.getItem(SEL_KEY) ?? 'null')
    if (!v || typeof v.presetId !== 'string' || !v.form || typeof v.form !== 'object') return null
    for (const k of FORM_KEYS) if (typeof v.form[k] !== 'string') return null
    if (!['robust', 'moderate', 'fragile'].includes(v.form.fragility)) return null
    return { presetId: v.presetId, form: Object.fromEntries(FORM_KEYS.map((k) => [k, v.form[k]])) }
  } catch { return null }
}
export function saveSelection(sel: StoredSelection) { try { localStorage.setItem(SEL_KEY, JSON.stringify(sel)) } catch { /* storage unavailable */ } }
