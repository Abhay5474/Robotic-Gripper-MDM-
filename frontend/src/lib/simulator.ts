// DEMO MODE ONLY. A deterministic software simulation of a pick-and-place cycle.
// It exists so the UI can be exercised without hardware; every reading it produces is labelled SIMULATED.
import { requiredMinForce } from './safety'
import type { GripperLimits, ObjectProps } from './types'

export type SimState = 'idle' | 'approaching' | 'closing' | 'holding' | 'lifting' | 'transporting' | 'releasing' | 'slipped' | 'complete' | 'aborted'
export type SimOutcomeHint = 'success' | 'slipped' | 'overforce' | 'aborted'

export interface SimRaw {
  measured_force_n: number
  finger_opening_mm: number
  object_detected: boolean
  slip_detected: boolean
  operation_state: SimState
  timestamp: number
}

const DURATIONS: Partial<Record<SimState, number>> = { approaching: 1.2, closing: 1.2, holding: 0.8, lifting: 1.6, transporting: 1.6, releasing: 1.0 }
const ORDER: SimState[] = ['approaching', 'closing', 'holding', 'lifting', 'transporting', 'releasing', 'complete']

export class GripperSimulator {
  state: SimState = 'idle'
  hint: SimOutcomeHint | null = null
  private phaseT = 0
  private runT = 0
  private obj: ObjectProps | null = null
  private target = 0
  private slipAt = Infinity
  private overforce = false

  constructor(private limits: GripperLimits) {}

  get running() { return !['idle', 'complete', 'slipped', 'aborted'].includes(this.state) }
  get runTime() { return this.runT }

  start(object: ObjectProps, targetForce: number) {
    this.obj = object
    this.target = targetForce
    // Physics-based: the sim slips when the target is clearly below the friction requirement.
    this.slipAt = targetForce < requiredMinForce(object, this.limits) * 0.95 ? 0.35 : Infinity
    this.overforce = object.max_contact_force_n != null && targetForce > object.max_contact_force_n
    this.state = 'approaching'
    this.phaseT = 0
    this.runT = 0
    this.hint = null
  }

  abort() { if (this.running) { this.state = 'aborted'; this.hint = 'aborted' } }
  reset() { this.state = 'idle'; this.hint = null }

  step(dt: number, nowMs: number): SimRaw {
    if (this.running) {
      this.phaseT += dt
      this.runT += dt
      const dur = DURATIONS[this.state] ?? 1
      if (this.state === 'lifting' && this.phaseT / dur >= this.slipAt) {
        this.state = 'slipped'; this.hint = 'slipped'; this.phaseT = 0
      } else if (this.phaseT >= dur) {
        this.state = ORDER[ORDER.indexOf(this.state) + 1]
        this.phaseT = 0
        if (this.state === 'complete') this.hint = this.overforce ? 'overforce' : 'success'
      }
    }
    return this.sample(nowMs)
  }

  private sample(nowMs: number): SimRaw {
    const open = this.limits.max_opening_mm
    const w = this.obj?.width_mm ?? open
    const dur = DURATIONS[this.state] ?? 1
    const p = Math.min(1, this.phaseT / dur)
    const noise = Math.sin(this.runT * 23) * 0.015 * this.target
    let opening = open, force = 0, detected = false, slip = false
    switch (this.state) {
      case 'approaching': opening = open - (open - (w + 10)) * p; break
      case 'closing': opening = w + 10 - 10 * p; force = this.target * p; detected = p > 0.9; break
      case 'holding': case 'lifting': case 'transporting': opening = w; force = this.target + noise; detected = true; break
      case 'releasing': opening = w + (open - w) * p; force = this.target * (1 - p); detected = p < 0.5; break
      case 'slipped': opening = w; force = this.target * 0.55; detected = true; slip = true; break
      case 'complete': case 'idle': case 'aborted': break
    }
    return {
      measured_force_n: Math.max(0, Number(force.toFixed(3))), finger_opening_mm: Number(opening.toFixed(2)),
      object_detected: detected, slip_detected: slip, operation_state: this.state, timestamp: nowMs,
    }
  }
}
