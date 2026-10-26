// Geometry and motion planning for the 3D work-cell view. Pure functions only (unit-tested).
//
// The arm is SCHEMATIC: no telemetry reports its pose. Its motion is derived from `operation_state`
// (and progress through that state) so the pick-and-place sequence is readable. Finger opening,
// force, slip and object detection in the view come from telemetry (or the demo simulation).

import { PHASE_DURATIONS } from './simulator'

export type Vec3 = [number, number, number]

/** Scene units: 1 unit = 100 mm. */
export const MM = 0.01

export interface CellLayout {
  base: Vec3 // arm base centre on the table
  shoulderHeight: number
  l1: number // upper arm
  l2: number // forearm
  wristToPad: number // wrist joint point -> pad centre (the gripper model is built to match)
  pick: Vec3 // pick station centre, y = table surface
  place: Vec3 // place station centre, y = table surface
  placeSurface: number // top of the tray at the place station
  liftClearance: number
  home: Vec3 // wrist point when parked
}

export const CELL: CellLayout = {
  base: [0, 0, -1.4],
  shoulderHeight: 1.7,
  l1: 2.5,
  l2: 2.3,
  wristToPad: 1.5,
  pick: [-2.2, 0, 0.5],
  place: [2.2, 0, 0.5],
  placeSurface: 0.14,
  liftClearance: 1.4,
  home: [0, 3.9, 0.3],
}

export interface ArmPose {
  yaw: number // turntable rotation about +y
  shoulder: number // pitch up from horizontal
  elbow: number // relative to the upper arm (negative = elbow up)
  wrist: number // keeps the tool pointing straight down
  roll: number // keeps the finger axis aligned with world x
  reachable: boolean
}

/** Closed-form IK: base yaw + planar 2-link (elbow-up) + wrist pitch so the gripper always points down. */
export function solveIK(target: Vec3, L: CellLayout = CELL): ArmPose {
  const dx = target[0] - L.base[0]
  const dz = target[2] - L.base[2]
  const r = Math.hypot(dx, dz)
  const h = target[1] - (L.base[1] + L.shoulderHeight)
  const yaw = r > 1e-9 ? Math.atan2(-dz, dx) : 0
  const raw = (r * r + h * h - L.l1 * L.l1 - L.l2 * L.l2) / (2 * L.l1 * L.l2)
  const c2 = Math.min(1, Math.max(-1, raw))
  const s2 = -Math.sqrt(1 - c2 * c2)
  const elbow = Math.atan2(s2, c2)
  const shoulder = Math.atan2(h, r) - Math.atan2(L.l2 * s2, L.l1 + L.l2 * c2)
  return { yaw, shoulder, elbow, wrist: -(shoulder + elbow), roll: -yaw, reachable: Math.abs(raw) <= 1 + 1e-9 && r > 1e-9 }
}

/** Forward kinematics of the wrist point (used to verify the IK). */
export function forwardWrist(p: ArmPose, L: CellLayout = CELL): Vec3 {
  const x = L.l1 * Math.cos(p.shoulder) + L.l2 * Math.cos(p.shoulder + p.elbow)
  const y = L.l1 * Math.sin(p.shoulder) + L.l2 * Math.sin(p.shoulder + p.elbow)
  return [L.base[0] + x * Math.cos(p.yaw), L.base[1] + L.shoulderHeight + y, L.base[2] - x * Math.sin(p.yaw)]
}

/** Height of the pad centre above the supporting surface while grasping an object of `heightUnits`. */
export const gripHeight = (heightUnits: number) => Math.min(1.0, Math.max(0.3, heightUnits * 0.45))

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const ease = (t: number) => t * t * (3 - 2 * t) // smoothstep

/** Point at fraction t (0..1, eased) along a polyline, by arc length. */
export function along(points: Vec3[], t: number): Vec3 {
  if (points.length === 1) return points[0]
  const u = ease(Math.min(1, Math.max(0, t)))
  const lengths = points.slice(1).map((p, i) => dist(points[i], p))
  const total = lengths.reduce((a, b) => a + b, 0)
  if (total < 1e-9) return points[points.length - 1]
  let d = u * total
  for (let i = 0; i < lengths.length; i++) {
    if (d <= lengths[i] || i === lengths.length - 1) return lerp3(points[i], points[i + 1], lengths[i] < 1e-9 ? 1 : Math.min(1, d / lengths[i]))
    d -= lengths[i]
  }
  return points[points.length - 1]
}

export interface Waypoints { home: Vec3; pickAt: Vec3; pickAbove: Vec3; placeAt: Vec3; placeAbove: Vec3; transportMid: Vec3 }

export function waypoints(objectHeightUnits: number, L: CellLayout = CELL): Waypoints {
  const pad = gripHeight(objectHeightUnits)
  const pickAt: Vec3 = [L.pick[0], L.pick[1] + pad + L.wristToPad, L.pick[2]]
  const placeAt: Vec3 = [L.place[0], L.placeSurface + pad + L.wristToPad + 0.01, L.place[2]]
  const up: Vec3 = [0, L.liftClearance, 0]
  const pickAbove = add(pickAt, up)
  const placeAbove = add(placeAt, up)
  const transportMid = add(lerp3(pickAbove, placeAbove, 0.5), [0, 0.6, 0])
  return { home: L.home, pickAt, pickAbove, placeAt, placeAbove, transportMid }
}

/** Known phases of a pick-and-place cycle (matches the simulator and the documented hardware states). */
export const KNOWN_STATES = ['idle', 'approaching', 'closing', 'holding', 'lifting', 'transporting', 'releasing', 'complete', 'slipped', 'aborted'] as const

export const phaseDuration = (state: string | null) => (state && PHASE_DURATIONS[state as keyof typeof PHASE_DURATIONS]) || 1.2

/**
 * Wrist target for a state at `progress` (0..1 through that state).
 * Returns null for 'slipped': the arm stops where the slip happened.
 */
export function wristTarget(state: string | null, progress: number, objectHeightUnits: number, L: CellLayout = CELL): Vec3 | null {
  const w = waypoints(objectHeightUnits, L)
  switch (state) {
    case 'approaching': return along([w.home, w.pickAbove, w.pickAt], progress)
    case 'closing':
    case 'holding': return w.pickAt
    case 'lifting': return along([w.pickAt, w.pickAbove], progress)
    case 'transporting': return along([w.pickAbove, w.transportMid, w.placeAbove, w.placeAt], progress)
    case 'releasing': return w.placeAt
    case 'complete': return along([w.placeAt, w.placeAbove, w.home], progress)
    case 'slipped': return null
    default: return w.home // idle, aborted, unknown or missing state
  }
}

/** Where the object should be when it is NOT held: re-staged at the pick station before a new cycle. */
export function restingStation(state: string | null): 'pick' | 'stay' {
  return state == null || state === 'idle' || state === 'approaching' || state === 'closing' ? 'pick' : 'stay'
}

/** The object follows the fingers only while detected, not slipping, and the jaws are actually closed on it. */
export function isHeld(opts: { state: string | null; objectDetected: boolean | null; slip: boolean | null; openingMm: number | null; widthMm: number }): boolean {
  const { state, objectDetected, slip, openingMm, widthMm } = opts
  if (objectDetected !== true || slip === true || openingMm == null) return false
  if (state === 'idle' || state === 'approaching' || state === 'complete' || state === 'aborted') return false
  return openingMm <= widthMm + 3
}

/** Progress through the current state of a recorded trace (for replay, where wall-clock timing is meaningless). */
export function traceProgress(states: (string | null | undefined)[], index: number): number {
  const s = states[index]
  let a = index, b = index
  while (a > 0 && states[a - 1] === s) a--
  while (b < states.length - 1 && states[b + 1] === s) b++
  return b === a ? 1 : (index - a) / (b - a)
}
