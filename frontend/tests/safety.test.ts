import cases from '@shared/safety_cases.json'
import { describe, expect, it } from 'vitest'
import { assess } from '@/lib/safety'
import type { GripperLimits, ObjectProps } from '@/lib/types'

const limits = cases.limits as GripperLimits

describe('safety.ts mirrors backend safety.py (shared/safety_cases.json)', () => {
  it.each(cases.cases)('$name', (c) => {
    const a = assess(c.object as ObjectProps, limits, c.force_n)
    const e = c.expected as Record<string, unknown>
    for (const k of Object.keys(e)) expect((a as unknown as Record<string, unknown>)[k], k).toEqual(e[k])
  })

  it('never reports an infeasible force as savable', () => {
    const obj = { ...(cases.cases[0].object as ObjectProps), max_contact_force_n: 5 }
    for (const f of [1, 3, 5, 8, 40]) expect(assess(obj, limits, f).can_save_as_calibrated).toBe(false)
  })

  it('rejects wrong definitions / units', () => {
    const obj = cases.cases[0].object as ObjectProps
    expect(assess(obj, limits, 8, 'total_actuator_force').status).toBe('invalid')
    expect(assess(obj, limits, 8, 'normal_force_per_finger', 'lbf').status).toBe('invalid')
    expect(assess(obj, limits, Number.NaN).status).toBe('invalid')
  })
})
