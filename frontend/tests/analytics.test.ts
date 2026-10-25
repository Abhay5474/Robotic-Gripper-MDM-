import { describe, expect, it } from 'vitest'
import { calibrationsCsv, llmAccuracy, operationStats } from '@/lib/analytics'
import type { CalibrationRecord, ObjectProps, OperationRecord } from '@/lib/types'

const obj = { object_id: 'b', name: 'Bottle, "big"', mass_g: 300, width_mm: 60, height_mm: 1, depth_mm: 1, material: 'pet', friction_coefficient: 0.4, fragility: 'moderate', max_contact_force_n: null } as ObjectProps
const rec = (key: string, llm: number | null, cal: number | null, at: string, status: CalibrationRecord['calibration_status'] = 'calibrated'): CalibrationRecord => ({
  calibration_id: 'cal_' + key + at, configuration_key: key, object_id: 'b', input_properties: obj, original_llm_force: llm, initial_force: 1, calibrated_force: cal,
  force_definition: 'normal_force_per_finger', force_unit: 'N', calibration_status: status, created_at: at, confirmed_at: at, warnings: [], mode: 'demo',
})

describe('LLM accuracy', () => {
  it('uses the latest calibrated record per configuration and ignores failed / LLM-less ones', () => {
    const a = llmAccuracy([rec('k1', 10, 12, '2026-01-01'), rec('k1', 10, 11, '2026-02-01'), rec('k2', 8, 6, '2026-01-01'), rec('k3', 5, 9, '2026-01-01', 'failed'), rec('k4', null, 5, '2026-01-01')])
    expect(a.n).toBe(2)
    expect(a.rows.find((r) => r.key === 'k1')?.calibrated).toBe(11)
    expect(a.meanAbsPctError).toBeCloseTo((10 + 25) / 2)
    expect(a.meanSignedPct).toBeCloseTo((10 - 25) / 2)
    expect(a.withinTenPct).toBeCloseTo(0.5)
  })
  it('is empty-safe', () => expect(llmAccuracy([]).meanAbsPctError).toBeNull())
})

describe('operation stats', () => {
  const op = (result: OperationRecord['operation_result'], cal: OperationRecord['calibration_status'], peak?: number) => ({ operation_result: result, calibration_status: cal, peak_measured_force_n: peak }) as OperationRecord
  it('computes rates', () => {
    const s = operationStats([op('success', 'calibrated', 8), op('slipped', 'uncalibrated', 4), op('success', 'calibrated')])
    expect(s.total).toBe(3)
    expect(s.successRate).toBeCloseTo(2 / 3)
    expect(s.uncalibratedShare).toBeCloseTo(1 / 3)
    expect(s.avgPeakN).toBe(6)
  })
  it('returns nulls with no data', () => expect(operationStats([]).successRate).toBeNull())
})

describe('CSV export', () => {
  it('escapes commas and quotes and keeps empty cells empty', () => {
    const csv = calibrationsCsv([rec('k1', 10, null, '2026-01-01', 'failed')])
    const [head, row] = csv.split('\n')
    expect(head.split(',')[0]).toBe('calibration_id')
    expect(row).toContain('"Bottle, ""big"""')
    expect(row).not.toContain('null')
  })
})
