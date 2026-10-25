import cases from '@shared/safety_cases.json'
import { describe, expect, it } from 'vitest'
import { assess } from '@/lib/safety'
import { bracketOf, suggestNext, summarizeAttempts, type EventLike } from '@/lib/suggest'
import type { GripperLimits, ObjectProps } from '@/lib/types'

const limits = cases.limits as GripperLimits
const bottle = cases.cases[0].object as ObjectProps // required ≈5.17 N, upper 20 N
const safety = (f: number) => assess(bottle, limits, f)
const ev = (...x: [EventLike['event'], number][]): EventLike[] => x.map(([event, force]) => ({ event, force }))

describe('attempt summary', () => {
  it('labels each test by the event that followed it', () => {
    const a = summarizeAttempts(ev(['test_started', 8], ['slipped', 8], ['test_started', 10], ['damage_risk', 10], ['test_started', 9]))
    expect(a.map((x) => [x.force, x.outcome])).toEqual([[8, 'slipped'], [10, 'risk'], [9, 'pending']])
    expect(bracketOf(a)).toEqual({ slippedAtOrBelow: 8, riskAtOrAbove: 10 })
  })
})

describe('suggestions', () => {
  it('never suggests while a test is awaiting a verdict', () => {
    expect(suggestNext(summarizeAttempts(ev(['test_started', 8])), limits, safety(8))).toBeNull()
  })
  it('after a slip raises by ~15% (min 5 steps) and stays on the step grid', () => {
    const s = suggestNext(summarizeAttempts(ev(['test_started', 8], ['slipped', 8])), limits, safety(8))!
    expect(s.force).toBe(10.5) // 8 + max(2.5, 1.2) = 10.5
    expect((s.force! / limits.force_step_n) % 1).toBe(0)
  })
  it('never suggests beyond the object contact limit', () => {
    const s = suggestNext(summarizeAttempts(ev(['test_started', 18], ['slipped', 18])), limits, safety(18))!
    expect(s.force).toBe(20) // capped at the 20 N limit
    const closed = suggestNext(summarizeAttempts(ev(['test_started', 20], ['slipped', 20])), limits, safety(20))!
    expect(closed.force).toBeNull()
    expect(closed.windowClosed).toBe(true)
  })
  it('after damage risk lowers by ~15% but not below the estimated holding minimum', () => {
    const s = suggestNext(summarizeAttempts(ev(['test_started', 12], ['damage_risk', 12])), limits, safety(12))!
    expect(s.force).toBe(10) // 12 * 0.85 = 10.2, snapped to the 0.5 N grid
  })
  it('never goes below the holding minimum when lowering', () => {
    const s = suggestNext(summarizeAttempts(ev(['test_started', 6], ['damage_risk', 6])), limits, safety(6))!
    expect(s.force).toBeGreaterThanOrEqual(5.165) // 6*0.85 = 5.1 is clamped up to the estimated minimum
  })
  it('bisects once both a slip and a risk are known', () => {
    const s = suggestNext(summarizeAttempts(ev(['test_started', 8], ['slipped', 8], ['test_started', 14], ['damage_risk', 14])), limits, safety(14))!
    expect(s.force).toBe(11)
  })
  it('declares the window closed when slip and risk are adjacent', () => {
    const s = suggestNext(summarizeAttempts(ev(['test_started', 10], ['slipped', 10], ['test_started', 10.5], ['damage_risk', 10.5])), limits, safety(10.5))!
    expect(s.windowClosed).toBe(true)
    expect(s.force).toBeNull()
  })
  it('does not repeat a force that was already tried', () => {
    const s = suggestNext(summarizeAttempts(ev(['test_started', 10.5], ['slipped', 10.5], ['test_started', 8], ['damage_risk', 8])), limits, safety(8))!
    expect(s.force === null || s.force !== 8).toBe(true)
  })
  it('gives no suggestion after a generic failed test', () => {
    expect(suggestNext(summarizeAttempts(ev(['test_started', 8], ['failed', 8])), limits, safety(8))).toBeNull()
  })
})
