import type { CalibrationRecord, OperationRecord } from './types'

export interface LlmAccuracyRow { key: string; name: string; llm: number; calibrated: number; deltaPct: number }
export interface LlmAccuracy {
  rows: LlmAccuracyRow[]
  n: number
  meanAbsPctError: number | null
  meanSignedPct: number | null // > 0: the LLM under-recommended (calibrated force was higher)
  withinTenPct: number | null
}

/** Latest successful calibration per configuration, compared with the LLM's original recommendation. */
export function llmAccuracy(records: CalibrationRecord[]): LlmAccuracy {
  const latest = new Map<string, CalibrationRecord>()
  for (const r of records) {
    if (r.calibration_status !== 'calibrated' || r.calibrated_force == null || r.original_llm_force == null || r.original_llm_force <= 0) continue
    const cur = latest.get(r.configuration_key)
    if (!cur || (r.confirmed_at ?? '') > (cur.confirmed_at ?? '')) latest.set(r.configuration_key, r)
  }
  const rows = [...latest.values()].map((r) => ({
    key: r.configuration_key, name: r.input_properties.name, llm: r.original_llm_force as number, calibrated: r.calibrated_force as number,
    deltaPct: (((r.calibrated_force as number) - (r.original_llm_force as number)) / (r.original_llm_force as number)) * 100,
  }))
  const n = rows.length
  return {
    rows, n,
    meanAbsPctError: n ? rows.reduce((a, r) => a + Math.abs(r.deltaPct), 0) / n : null,
    meanSignedPct: n ? rows.reduce((a, r) => a + r.deltaPct, 0) / n : null,
    withinTenPct: n ? rows.filter((r) => Math.abs(r.deltaPct) <= 10).length / n : null,
  }
}

export interface OpStats { total: number; byResult: Record<string, number>; successRate: number | null; uncalibratedShare: number | null; avgPeakN: number | null }
export function operationStats(ops: OperationRecord[]): OpStats {
  const byResult: Record<string, number> = {}
  for (const o of ops) byResult[o.operation_result] = (byResult[o.operation_result] ?? 0) + 1
  const peaks = ops.map((o) => o.peak_measured_force_n).filter((v): v is number => v != null)
  return {
    total: ops.length, byResult,
    successRate: ops.length ? (byResult.success ?? 0) / ops.length : null,
    uncalibratedShare: ops.length ? ops.filter((o) => o.calibration_status === 'uncalibrated').length / ops.length : null,
    avgPeakN: peaks.length ? peaks.reduce((a, b) => a + b, 0) / peaks.length : null,
  }
}

const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
export function calibrationsCsv(records: CalibrationRecord[]): string {
  const head = ['calibration_id', 'configuration_key', 'object_id', 'object_name', 'mass_g', 'friction', 'status', 'mode', 'original_llm_force_n', 'calibrated_force_n', 'force_definition', 'confirmation_method', 'confirmed_at', 'prompt_version', 'model']
  const rows = records.map((r) => [r.calibration_id, r.configuration_key, r.object_id, r.input_properties.name, r.input_properties.mass_g, r.input_properties.friction_coefficient, r.calibration_status, r.mode, r.original_llm_force, r.calibrated_force, r.force_definition, r.confirmation_method, r.confirmed_at, r.prompt_version, r.model_identifier].map(esc).join(','))
  return [head.join(','), ...rows].join('\n')
}
