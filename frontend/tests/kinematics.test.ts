import cases from '@shared/safety_cases.json'
import { describe, expect, it } from 'vitest'
import { along, CELL, forwardWrist, gripHeight, isHeld, restingStation, solveIK, traceProgress, waypoints, wristTarget, type Vec3 } from '@/lib/kinematics'
import { graspBalance } from '@/lib/mechanics'
import { requiredMinForce } from '@/lib/safety'
import type { GripperLimits, ObjectProps } from '@/lib/types'

const close = (a: Vec3, b: Vec3, eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps)

describe('inverse kinematics', () => {
  const w = waypoints(2.1) // tallest preset (bottle, 210 mm)
  const targets: Vec3[] = [...Object.values(waypoints(0.5)), ...Object.values(w)]

  it.each(targets.map((t) => [t]))('reaches %j exactly', (t) => {
    const pose = solveIK(t)
    expect(pose.reachable).toBe(true)
    expect(close(forwardWrist(pose), t)).toBe(true)
  })

  it('keeps the tool vertical and the finger axis aligned with world x', () => {
    for (const t of targets) {
      const p = solveIK(t)
      expect(p.shoulder + p.elbow + p.wrist).toBeCloseTo(0, 9) // tool pitch cancels the arm pitch
      expect(p.roll).toBeCloseTo(-p.yaw, 9)
    }
  })

  it('uses the elbow-up solution (elbow above the shoulder-wrist line)', () => {
    const p = solveIK(waypoints(0.5).pickAt)
    expect(p.elbow).toBeLessThan(0)
    const elbowY = CELL.shoulderHeight + CELL.l1 * Math.sin(p.shoulder)
    expect(elbowY).toBeGreaterThan(waypoints(0.5).pickAt[1])
  })

  it('reports unreachable targets instead of producing NaN', () => {
    const p = solveIK([50, 0, 50])
    expect(p.reachable).toBe(false)
    expect(Object.values(p).every((v) => typeof v === 'boolean' || Number.isFinite(v))).toBe(true)
  })
})

describe('motion planner', () => {
  const h = 0.95 // ceramic cup
  const w = waypoints(h)

  it('fingertips stay above the table and the pad stays on the object', () => {
    for (const height of [0.3, 0.5, 0.95, 2.1]) {
      const pad = gripHeight(height)
      expect(pad - 0.25).toBeGreaterThan(0) // fingertip clearance (pad half-height ≈ 0.225 + tip)
      expect(pad).toBeLessThanOrEqual(Math.max(height, 0.3))
    }
  })

  it('follows the cycle: home -> pick -> lift -> place -> home', () => {
    expect(wristTarget('idle', 0, h)).toEqual(w.home)
    expect(close(wristTarget('approaching', 0, h)!, w.home)).toBe(true)
    expect(close(wristTarget('approaching', 1, h)!, w.pickAt)).toBe(true)
    expect(wristTarget('closing', 0.5, h)).toEqual(w.pickAt)
    expect(close(wristTarget('lifting', 1, h)!, w.pickAbove)).toBe(true)
    expect(close(wristTarget('transporting', 1, h)!, w.placeAt)).toBe(true)
    expect(wristTarget('releasing', 0.3, h)).toEqual(w.placeAt)
    expect(close(wristTarget('complete', 1, h)!, w.home)).toBe(true)
  })

  it('stops the arm on a slip and parks it for unknown hardware states', () => {
    expect(wristTarget('slipped', 0.5, h)).toBeNull()
    expect(wristTarget('calibrating_encoder', 0.5, h)).toEqual(w.home)
    expect(wristTarget(null, 0, h)).toEqual(w.home)
  })

  it('transport lifts over the midpoint and clears the tray', () => {
    const mid = wristTarget('transporting', 0.5, h)!
    expect(mid[1]).toBeGreaterThan(w.pickAbove[1])
    const objectBaseAtPlaceAbove = w.placeAbove[1] - CELL.wristToPad - gripHeight(h)
    expect(objectBaseAtPlaceAbove).toBeGreaterThan(CELL.placeSurface)
  })

  it('interpolates along a polyline by arc length, clamped', () => {
    const pts: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0]]
    expect(along(pts, 0)).toEqual([0, 0, 0])
    expect(along(pts, 1)).toEqual([1, 1, 0])
    expect(along(pts, 0.5)).toEqual([1, 0, 0]) // half of total length (eased 0.5 stays 0.5)
    expect(along(pts, 2)).toEqual([1, 1, 0])
  })
})

describe('object attachment', () => {
  const base = { state: 'lifting', objectDetected: true, slip: false, openingMm: 65, widthMm: 65 }
  it('is held only when detected, not slipping and the jaws are closed on it', () => {
    expect(isHeld(base)).toBe(true)
    expect(isHeld({ ...base, slip: true })).toBe(false)
    expect(isHeld({ ...base, objectDetected: false })).toBe(false)
    expect(isHeld({ ...base, objectDetected: null })).toBe(false) // unknown is not "held"
    expect(isHeld({ ...base, openingMm: 90 })).toBe(false)
    expect(isHeld({ ...base, openingMm: null })).toBe(false) // no opening reading: never pretend contact
    expect(isHeld({ ...base, state: 'approaching' })).toBe(false)
  })
  it('re-stages the object at the pick station only before a cycle', () => {
    expect(restingStation('idle')).toBe('pick')
    expect(restingStation('approaching')).toBe('pick')
    expect(restingStation('releasing')).toBe('stay')
    expect(restingStation('slipped')).toBe('stay')
  })
  it('derives replay progress from the run of identical states', () => {
    const s = ['closing', 'closing', 'holding', 'holding', 'holding', 'lifting']
    expect(traceProgress(s, 2)).toBe(0)
    expect(traceProgress(s, 3)).toBe(0.5)
    expect(traceProgress(s, 4)).toBe(1)
    expect(traceProgress(s, 5)).toBe(1)
  })
})

describe('grip margin', () => {
  const limits = cases.limits as GripperLimits
  const bottle = cases.cases[0].object as ObjectProps
  it('equals N / N_required and maps to the safety tones', () => {
    const req = requiredMinForce(bottle, limits)
    expect(graspBalance(bottle, limits, req).margin).toBeCloseTo(1, 9)
    expect(graspBalance(bottle, limits, req * 0.9).tone).toBe('bad')
    expect(graspBalance(bottle, limits, req * 1.2).tone).toBe('warn')
    expect(graspBalance(bottle, limits, req * 1.6).tone).toBe('ok')
  })
  it('friction capacity equals the load exactly at the threshold', () => {
    const b = graspBalance(bottle, limits, requiredMinForce(bottle, limits))
    expect(b.frictionCapacity).toBeCloseTo(b.load, 9)
    expect(b.frictionPerFinger * limits.finger_count).toBeCloseTo(b.frictionCapacity, 9)
  })
  it('is null for a non-positive force', () => expect(graspBalance(bottle, limits, 0).margin).toBeNull())
})
