// Grasp mechanics used by the free-body diagram and the grip-margin readouts.
// Same simplified Coulomb model as safety.ts: vertical lift, `finger_count` friction contacts.
import { G, requiredMinForce } from './safety'
import type { GripperLimits, ObjectProps } from './types'

export interface GraspBalance {
  normalPerFinger: number // N, the force being evaluated (normal force per finger)
  frictionPerFinger: number // μ·N
  frictionCapacity: number // finger_count · μ · N
  load: number // m · (g + a)
  weight: number // m · g
  margin: number | null // capacity / load  (= N / N_required); null when not computable
  tone: 'bad' | 'warn' | 'ok'
}

/** Grip margin: 1.0 = exactly at the estimated slip threshold; the configured safety factor is the target. */
export function graspBalance(o: ObjectProps, l: GripperLimits, normalPerFinger: number): GraspBalance {
  const m = o.mass_g / 1000
  const load = m * (G + l.lift_acceleration_m_s2)
  const frictionPerFinger = o.friction_coefficient * normalPerFinger
  const frictionCapacity = l.finger_count * frictionPerFinger
  const req = requiredMinForce(o, l)
  const margin = Number.isFinite(normalPerFinger) && normalPerFinger > 0 && req > 0 ? normalPerFinger / req : null
  const tone = margin == null || margin < 1 ? 'bad' : margin < l.holding_safety_factor ? 'warn' : 'ok'
  return { normalPerFinger, frictionPerFinger, frictionCapacity, load, weight: m * G, margin, tone }
}

export const fmtMargin = (m: number | null) => (m == null ? '—' : `×${m.toFixed(2)}`)
