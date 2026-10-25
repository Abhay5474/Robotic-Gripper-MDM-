// The browser code must cope with records exactly as RTDB returns them (nulls and empty arrays are absent).
import sample from '../../samples/firebase_sample_data.json'
import cases from '@shared/safety_cases.json'
import { describe, expect, it } from 'vitest'
import { calibrationsCsv, llmAccuracy, operationStats } from '@/lib/analytics'
import { toForm, validateForm, fingerprint } from '@/lib/objects'
import { assess } from '@/lib/safety'
import { freshness, normalizeTelemetry } from '@/lib/telemetry'
import type { CalibrationRecord, GripperLimits, OperationRecord } from '@/lib/types'

const limits = cases.limits as GripperLimits
const cals = Object.values(sample.grip_calibrations) as unknown as CalibrationRecord[]
const ops = Object.values(sample.operations) as unknown as OperationRecord[]
const T0 = sample.gripper_telemetry.timestamp

describe('sample RTDB data', () => {
  it('telemetry node is normalised and judged fresh, then stale', () => {
    const t = normalizeTelemetry(sample.gripper_telemetry, T0 + 1000)!
    expect(t).toMatchObject({ measured_force_n: 9.52, finger_opening_mm: 65.1, object_detected: true, slip_detected: false, operation_state: 'holding', timestamp_ms: T0 })
    expect(freshness(t, T0 + 1000, 5).state).toBe('fresh')
    expect(freshness(t, T0 + 60_000, 5).state).toBe('stale')
  })

  it('every active calibration passes the safety check that gates reuse', () => {
    type Active = { calibration_id: string; calibration_status: string; calibrated_force?: number }
    const active = (Object.values(sample.active_calibrations) as Active[]).filter((a) => a.calibration_status === 'calibrated')
    expect(active).toHaveLength(6)
    for (const a of active) {
      const rec = sample.grip_calibrations[a.calibration_id as keyof typeof sample.grip_calibrations] as unknown as CalibrationRecord
      const sa = assess(rec.input_properties, limits, a.calibrated_force as number)
      expect(['ok', 'marginal'], `${rec.input_properties.name} ${a.calibrated_force} N`).toContain(sa.status)
    }
  })

  it('records with an unknown contact limit (field absent) work in forms, keys and safety checks', () => {
    const wood = cals.find((r) => r.object_id === 'wooden-block' && r.calibration_status === 'calibrated')!
    expect('max_contact_force_n' in wood.input_properties).toBe(false)
    expect(toForm(wood.input_properties).max_contact_force_n).toBe('')
    expect(validateForm(toForm(wood.input_properties)).value?.max_contact_force_n).toBeNull()
    expect(fingerprint(wood.input_properties)).not.toContain('undefined')
    expect(assess(wood.input_properties, limits, 5.5).upper_limit_n).toBe(limits.max_force_n)
  })

  it('every stored object round-trips through the object form (Recalibrate from History)', () => {
    for (const r of cals) {
      const v = validateForm(toForm(r.input_properties))
      expect(v.errors, r.calibration_id).toEqual({})
      expect(v.value?.mass_g).toBe(r.input_properties.mass_g)
    }
  })

  it('analytics read the samples: LLM accuracy, operation stats and CSV export', () => {
    const acc = llmAccuracy(cals)
    expect(acc.n).toBe(6) // bottle, can, wood, cup, steel bracket, stale box. Not: invalidated ball, failed fragile
    expect(acc.rows.find((r) => r.name === 'Plastic bottle')).toMatchObject({ llm: 7.75, calibrated: 9.5 })
    const st = operationStats(ops)
    expect(st.total).toBe(10)
    expect(st.byResult).toEqual({ success: 8, slipped: 2 })
    expect(st.uncalibratedShare).toBeCloseTo(0.1)
    const csv = calibrationsCsv(cals).split('\n')
    expect(csv).toHaveLength(1 + cals.length)
    expect(csv.join('\n')).not.toMatch(/undefined|null/)
  })

  it('operation traces have only the fields the replay view reads', () => {
    const traced = ops.filter((o) => o.trace?.length)
    expect(traced).toHaveLength(1)
    for (const row of traced[0].trace!) {
      expect(Object.keys(row).every((k) => ['t', 'f', 'o', 's', 'st', 'd'].includes(k))).toBe(true)
      expect(typeof row.t).toBe('number')
    }
  })

  it('test logs are objects keyed t_0001… with a numeric seq (History sorts on it)', () => {
    const cup = cals.find((r) => r.object_id === 'ceramic-cup')!
    const tests = Object.entries(cup.tests!)
    expect(tests.map(([k]) => k)).toEqual(['t_0001', 't_0002', 't_0003', 't_0004', 't_0005'])
    expect(tests.every(([, t]) => typeof t.seq === 'number')).toBe(true)
  })
})
