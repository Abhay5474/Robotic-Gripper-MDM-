import type { Telemetry } from './types'

export function parseTimestampMs(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v < 1e11 ? Math.round(v * 1000) : Math.round(v)
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? null : t }
  return null
}
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const flag = (v: unknown) => (typeof v === 'boolean' ? v : v === 0 || v === 1 ? v === 1 : null)

/** Normalises the hardware node. Missing / malformed fields become null ("unavailable"), never a default. */
export function normalizeTelemetry(raw: unknown, receivedMs: number): Telemetry | null {
  if (raw == null || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  return {
    measured_force_n: num(r.measured_force_n),
    finger_opening_mm: num(r.finger_opening_mm),
    object_detected: flag(r.object_detected),
    slip_detected: flag(r.slip_detected),
    operation_state: typeof r.operation_state === 'string' && r.operation_state ? r.operation_state : null,
    timestamp_ms: parseTimestampMs(r.timestamp),
    received_ms: receivedMs,
  }
}

export type FreshnessState = 'fresh' | 'stale' | 'unknown' | 'none'
export interface Freshness { state: FreshnessState; ageS: number | null; reason: string }

/**
 * Freshness comes from the hardware timestamp when present. Without a timestamp we can only say
 * when WE last received a change, so the state is 'unknown' (shown as a warning), or 'stale' once
 * nothing has arrived for longer than the threshold.
 */
export function freshness(t: Telemetry | null, nowMs: number, staleAfterS: number): Freshness {
  if (!t) return { state: 'none', ageS: null, reason: 'No telemetry received.' }
  if (t.timestamp_ms != null) {
    const age = Math.max(0, (nowMs - t.timestamp_ms) / 1000)
    return age > staleAfterS
      ? { state: 'stale', ageS: age, reason: `Last reading is ${age.toFixed(1)} s old (limit ${staleAfterS} s).` }
      : { state: 'fresh', ageS: age, reason: 'Telemetry is current.' }
  }
  const sinceRx = (nowMs - t.received_ms) / 1000
  return sinceRx > staleAfterS
    ? { state: 'stale', ageS: sinceRx, reason: `No update for ${sinceRx.toFixed(1)} s and the hardware sends no timestamp.` }
    : { state: 'unknown', ageS: sinceRx, reason: 'Hardware timestamp missing; freshness cannot be verified.' }
}

export interface TelemetryStats { samples: number; spanS: number; rateHz: number | null; fMin: number | null; fMax: number | null; fMean: number | null; slipShare: number | null }

/** Summary over received samples only. Missing values are skipped, never treated as zero. */
export function telemetryStats(points: { t: number; force: number | null; slip: number | null }[]): TelemetryStats {
  const n = points.length
  const span = n > 1 ? (points[n - 1].t - points[0].t) / 1000 : 0
  const forces = points.map((p) => p.force).filter((v): v is number => v != null && Number.isFinite(v))
  const slips = points.map((p) => p.slip).filter((v): v is number => v != null)
  return {
    samples: n,
    spanS: span,
    rateHz: span > 0 ? (n - 1) / span : null,
    fMin: forces.length ? Math.min(...forces) : null,
    fMax: forces.length ? Math.max(...forces) : null,
    fMean: forces.length ? forces.reduce((a, b) => a + b, 0) / forces.length : null,
    slipShare: slips.length ? slips.filter((s) => s > 0).length / slips.length : null,
  }
}

/** Keep only the last `windowS` seconds of samples (null = everything). */
export function windowed<T extends { t: number }>(points: T[], windowS: number | null): T[] {
  if (windowS == null || points.length === 0) return points
  const end = points[points.length - 1].t
  return points.filter((p) => end - p.t <= windowS * 1000)
}
