import { useMemo } from 'react'
import { assess } from '@/lib/safety'
import type { CalibrationRecord, SafetyAssessment } from '@/lib/types'
import { useApp } from './app'

export type CalState = 'in_progress' | 'calibrated' | 'cached' | 'uncalibrated' | 'not_applied' | 'unresolved' | 'error'

export interface Forces {
  llm: number | null
  selected: number | null
  calibrated: number | null
  calibratedRecord: CalibrationRecord | null
  calibratedApplicable: boolean // false when stale/invalid/safety_failed: shown, never applied silently
  state: CalState
  stateLabel: string
  safety: SafetyAssessment | null
}

/** Single source of truth for the four force quantities and the calibration status shown in the UI. */
export function useForces(): Forces {
  const res = useApp((s) => s.resolution)
  const selected = useApp((s) => s.selectedForce)
  const health = useApp((s) => s.health)
  const session = useApp((s) => s.session)
  return useMemo(() => {
    const data = res.data
    const rec = data?.calibration_lookup.record ?? (res.usingCached ? res.cached?.record ?? null : null)
    const applicable = data ? data.calibration_lookup.state === 'found_valid' : res.usingCached
    const safety = res.object && health && selected != null ? assess(res.object, health.limits, selected) : null
    let state: CalState = 'unresolved'
    let label = 'Not resolved'
    if (session?.record) { state = 'in_progress'; label = 'Calibration in progress' }
    else if (res.status === 'error') { state = res.usingCached ? 'cached' : 'error'; label = res.usingCached ? 'Cached local data (not verified with Firebase)' : 'Lookup failed' }
    else if (data) {
      if (data.calibration_lookup.state === 'found_valid' && data.source === 'calibration') { state = 'calibrated'; label = 'Calibrated - loaded from Firebase' }
      else if (data.calibration_lookup.state === 'found_valid') { state = 'calibrated'; label = 'Calibrated value exists - viewing a new LLM recommendation' }
      else if (data.calibration_lookup.state === 'unavailable') { state = 'uncalibrated'; label = 'Calibration status unknown (check skipped)' }
      else if (rec) { state = 'not_applied'; label = `Saved calibration NOT applied (${data.calibration_lookup.state.replace('_', ' ')})` }
      else { state = 'uncalibrated'; label = 'Not yet calibrated' }
    }
    return {
      llm: data?.prediction?.llm_recommended_force ?? null,
      selected, calibrated: rec?.calibrated_force ?? null, calibratedRecord: rec, calibratedApplicable: applicable, state, stateLabel: label, safety,
    }
  }, [res, selected, health, session])
}
