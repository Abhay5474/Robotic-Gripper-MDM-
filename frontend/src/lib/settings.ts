// Browser-only preferences. No secrets are stored in localStorage; the optional API token lives in sessionStorage.
import type { Mode } from './types'

const KEY = 'gripsense.settings.v1'
export interface UiSettings {
  mode: Mode
  staleAfterS: number | null // null = use backend default
  fineSteps: number // slider increments for +/- buttons, expressed in multiples of the gripper step
  coarseSteps: number
  telemetryPath: string
}
export const DEFAULT_SETTINGS: UiSettings = {
  mode: 'demo', staleAfterS: null, fineSteps: 1, coarseSteps: 5,
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
