// Calibration assistant: proposes the next force to TRY. It never applies or tests anything by itself,
// never leaves the safe window, and refuses to suggest when the evidence says no window exists.
import { clamp, roundToStep } from './format'
import type { GripperLimits, SafetyAssessment } from './types'

export type AttemptOutcome = 'pending' | 'held_unconfirmed' | 'slipped' | 'risk' | 'failed'
export interface Attempt { n: number; force: number; outcome: AttemptOutcome }
export interface EventLike { event: 'test_started' | 'slipped' | 'damage_risk' | 'failed'; force: number }

/** Folds the ordered session log into one attempt per test_started, labelled by the event that followed it. */
export function summarizeAttempts(events: EventLike[]): Attempt[] {
  const out: Attempt[] = []
  for (const e of events) {
    if (e.event === 'test_started') out.push({ n: out.length + 1, force: e.force, outcome: 'pending' })
    else if (out.length) out[out.length - 1].outcome = e.event === 'slipped' ? 'slipped' : e.event === 'damage_risk' ? 'risk' : 'failed'
  }
  return out
}

export interface Bracket { slippedAtOrBelow: number | null; riskAtOrAbove: number | null }
export function bracketOf(attempts: Attempt[]): Bracket {
  const s = attempts.filter((a) => a.outcome === 'slipped').map((a) => a.force)
  const r = attempts.filter((a) => a.outcome === 'risk').map((a) => a.force)
  return { slippedAtOrBelow: s.length ? Math.max(...s) : null, riskAtOrAbove: r.length ? Math.min(...r) : null }
}

export interface Suggestion { force: number | null; reason: string; windowClosed?: boolean }

export function suggestNext(attempts: Attempt[], limits: GripperLimits, safety: SafetyAssessment | null): Suggestion | null {
  const last = attempts.at(-1)
  if (!last || last.outcome === 'pending' || last.outcome === 'failed' || last.outcome === 'held_unconfirmed') return null
  const step = limits.force_step_n
  const { slippedAtOrBelow: lo, riskAtOrAbove: hi } = bracketOf(attempts)
  const upper = Math.min(limits.max_force_n, safety?.upper_limit_n ?? limits.max_force_n)
  const lower = Math.max(limits.min_force_n, safety?.required_min_force_n ?? limits.min_force_n)
  // Snap to the slider grid, but never across a bound: round up to stay >= lower, round down to stay <= upper.
  const snap = (v: number) => {
    let r = clamp(roundToStep(v, step), limits.min_force_n, limits.max_force_n)
    if (r < lower - 1e-9) r = Math.ceil(lower / step - 1e-9) * step
    if (r > upper + 1e-9) r = Math.floor(upper / step + 1e-9) * step
    return Number(r.toFixed(4))
  }
  const tried = new Set(attempts.map((a) => a.force))
  const result = (f: number, reason: string): Suggestion => (tried.has(f) ? { force: null, reason: `${reason} (already tried ${f} N)` } : { force: f, reason })

  if (lo != null && hi != null) {
    if (hi - lo <= step + 1e-9) return { force: null, windowClosed: true, reason: `Slipped at ${lo} N and at risk at ${hi} N: no testable force lies between them at a ${step} N step. Re-check the friction estimate, mass and contact limit, or use a different grasp.` }
    return result(snap((lo + hi) / 2), `Midpoint between the highest slipping force (${lo} N) and the lowest risky force (${hi} N)`)
  }
  if (last.outcome === 'slipped') {
    if (last.force >= upper - 1e-9) return { force: null, windowClosed: true, reason: `Slipped at ${last.force} N, which is already the permitted maximum (${upper} N). More force is not allowed; this object may not be graspable with these limits.` }
    const target = Math.min(upper, last.force + Math.max(5 * step, 0.15 * last.force))
    return result(snap(target), `Slipped at ${last.force} N: raise by about 15% (at least ${5 * step} N), capped at the ${upper} N limit`)
  }
  // risk
  const target = Math.max(lower, last.force * 0.85)
  if (snap(target) >= last.force - 1e-9) return { force: null, windowClosed: true, reason: `At risk at ${last.force} N and the estimated holding minimum is ${lower.toFixed(2)} N: there is no lower force to try.` }
  return result(snap(target), `Risk at ${last.force} N: lower by about 15%, not below the estimated holding minimum (${lower.toFixed(2)} N)`)
}
