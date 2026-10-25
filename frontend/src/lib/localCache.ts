// Local copy of previously loaded calibrations, used ONLY when Firebase cannot be reached.
// It is never treated as authoritative and is always labelled "cached local data" in the UI.
import type { CalibrationRecord, GripperLimits, Mode } from './types'

const KEY = 'gripsense.calibrationCache.v1'
export interface CachedCalibration { fingerprint: string; mode: Mode; configuration_key: string; record: CalibrationRecord; limits: GripperLimits; cached_at: string }

function readAll(): Record<string, CachedCalibration> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { return {} }
}
const k = (mode: Mode, fp: string) => `${mode}::${fp}`

export function cachePut(c: CachedCalibration) {
  try { const all = readAll(); all[k(c.mode, c.fingerprint)] = c; localStorage.setItem(KEY, JSON.stringify(all)) } catch { /* ignore */ }
}
export function cacheGet(mode: Mode, fp: string): CachedCalibration | null { return readAll()[k(mode, fp)] ?? null }
export function cacheDrop(mode: Mode, fp: string) {
  try { const all = readAll(); delete all[k(mode, fp)]; localStorage.setItem(KEY, JSON.stringify(all)) } catch { /* ignore */ }
}
