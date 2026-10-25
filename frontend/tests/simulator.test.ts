import { describe, expect, it } from 'vitest'
import cases from '@shared/safety_cases.json'
import { GripperSimulator } from '@/lib/simulator'
import type { GripperLimits, ObjectProps } from '@/lib/types'

const limits = cases.limits as GripperLimits
const bottle = cases.cases[0].object as ObjectProps

function run(force: number, obj = bottle) {
  const sim = new GripperSimulator(limits)
  sim.start(obj, force)
  const states = new Set<string>()
  for (let i = 0; i < 400 && sim.running; i++) states.add(sim.step(0.05, 1000 + i).operation_state)
  return { sim, states }
}

describe('demo simulator', () => {
  it('completes when force is adequate', () => {
    const { sim, states } = run(9)
    expect(sim.hint).toBe('success')
    expect(states.has('slipped')).toBe(false)
  })
  it('slips when force is well below the friction requirement', () => {
    const { sim, states } = run(2)
    expect(sim.hint).toBe('slipped')
    expect(states.has('slipped')).toBe(true)
  })
  it('flags over-force against the object contact limit', () => expect(run(25).sim.hint).toBe('overforce'))
  it('reports idle samples with zero force and a fully open gripper', () => {
    const s = new GripperSimulator(limits).step(0.1, 5)
    expect(s.operation_state).toBe('idle')
    expect(s.measured_force_n).toBe(0)
    expect(s.finger_opening_mm).toBe(limits.max_opening_mm)
  })
})
