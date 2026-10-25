// Mirror of backend/app/safety.py. Both are verified against shared/safety_cases.json.
import type { GripperLimits, ObjectProps, SafetyAssessment, SafetyCheck } from './types'

export const G = 9.80665
const EPS = 1e-9
export const DISCLAIMER =
  'Estimate based on a simplified friction model and unvalidated inputs. Not a guarantee of safety; the hardware team must validate force ranges on the real gripper.'

const r3 = (x: number) => Math.round(x * 1000) / 1000

export function requiredMinForce(o: ObjectProps, l: GripperLimits): number {
  return ((o.mass_g / 1000) * (G + l.lift_acceleration_m_s2)) / (l.finger_count * o.friction_coefficient)
}

export function assess(
  o: ObjectProps,
  l: GripperLimits,
  force: number | null,
  def: string = l.force_definition,
  unit: string = l.force_unit,
): SafetyAssessment {
  const checks: SafetyCheck[] = []
  const add = (id: string, passed: boolean, severity: SafetyCheck['severity'], message: string) =>
    checks.push({ id, passed, severity, message })
  const base = {
    selected_force_n: force != null && Number.isFinite(force) ? r3(force) : null,
    required_min_force_n: null as number | null,
    recommended_min_force_n: null as number | null,
    upper_limit_n: null as number | null,
    upper_limit_source: null as SafetyAssessment['upper_limit_source'],
    safe_range_n: null as [number, number] | null,
    can_test: false,
    can_save_as_calibrated: false,
    requires_override: false,
  }
  const done = (status: SafetyAssessment['status'], summary: string, extra: Partial<SafetyAssessment> = {}): SafetyAssessment => ({
    ...base, ...extra, status, checks, summary, disclaimer: DISCLAIMER,
  })

  const defOk = def === l.force_definition
  const unitOk = unit === l.force_unit && unit === 'N'
  add('force_definition', defOk, 'blocking', defOk ? `Force definition: ${def}.` : `Force is '${def}'; gripper expects '${l.force_definition}'.`)
  add('force_unit', unitOk, 'blocking', unitOk ? `Force unit: ${unit}.` : `Force unit '${unit}' is not supported (expected N).`)
  const valid = force != null && Number.isFinite(force) && force > 0
  add('force_numeric', valid, 'blocking', valid ? 'Force is a valid number.' : 'Force must be a finite positive number.')
  if (!(defOk && unitOk && valid)) return done('invalid', 'Force value, unit or definition is invalid.')
  const f = force as number

  const fits = o.width_mm <= l.max_opening_mm + EPS
  add('object_fits', fits, 'blocking', fits ? `Object width ${o.width_mm} mm fits the ${l.max_opening_mm} mm opening.` : `Object width ${o.width_mm} mm exceeds the gripper opening ${l.max_opening_mm} mm.`)

  const req = requiredMinForce(o, l)
  const rec = req * l.holding_safety_factor
  let upper = l.max_force_n
  let src: 'gripper_max' | 'object_max_contact' = 'gripper_max'
  if (o.max_contact_force_n != null && o.max_contact_force_n < upper) { upper = o.max_contact_force_n; src = 'object_max_contact' }
  const lowerHard = Math.max(l.min_force_n, req)
  const lowerMargin = Math.max(l.min_force_n, rec)
  const ctx: Partial<SafetyAssessment> = {
    required_min_force_n: r3(req), recommended_min_force_n: r3(rec), upper_limit_n: r3(upper), upper_limit_source: src,
  }
  const srcText = src.replace('_', ' ')

  if (o.max_contact_force_n == null) add('contact_limit_known', false, o.fragility !== 'robust' ? 'warning' : 'info', 'No maximum allowable contact force was provided; only the gripper maximum is enforced.')
  else add('contact_limit_known', true, 'info', `Object contact-force limit: ${o.max_contact_force_n} N.`)

  const rangeExists = fits && lowerHard <= upper + EPS
  add('safe_range_exists', rangeExists, 'blocking',
    fits && !rangeExists ? `Estimated minimum ${r3(lowerHard)} N exceeds the permitted maximum ${r3(upper)} N (${srcText}); no safe range can be established.`
      : !fits ? 'Cannot assess range: object does not fit the gripper.' : `Estimated permitted range ${r3(lowerHard)}-${r3(upper)} N.`)
  if (!rangeExists) return done('no_safe_range', 'No safe operating range can be established for this object and gripper.', ctx)

  const marginOk = lowerMargin <= upper + EPS
  ctx.safe_range_n = [r3(marginOk ? lowerMargin : lowerHard), r3(upper)]
  add('safety_margin_available', marginOk, 'warning', marginOk ? `Safety factor ${l.holding_safety_factor} is achievable.` : `Safety factor ${l.holding_safety_factor} cannot be met within the permitted maximum; margin is reduced.`)

  const belowMin = f < l.min_force_n - EPS
  const above = f > upper + EPS
  add('above_gripper_minimum', !belowMin, 'blocking', `Force ${r3(f)} N vs gripper minimum ${l.min_force_n} N.`)
  add('below_upper_limit', !above, 'blocking', above ? `Force ${r3(f)} N exceeds the ${srcText} limit of ${r3(upper)} N.` : `Force is within the ${srcText} limit of ${r3(upper)} N.`)
  const holds = f >= req - EPS
  add('meets_holding_requirement', holds, 'warning', holds ? `Force meets the estimated holding requirement ${r3(req)} N.` : `Force ${r3(f)} N is below the estimated holding requirement ${r3(req)} N (the object is likely to slip).`)
  const margin = f >= lowerMargin - EPS
  add('meets_safety_margin', margin, 'warning', margin ? 'Force includes the configured safety margin.' : `Force ${r3(f)} N is below the recommended ${r3(lowerMargin)} N (holding requirement x ${l.holding_safety_factor}).`)

  if (belowMin) return done('below_minimum', `Below the gripper minimum of ${l.min_force_n} N.`, ctx)
  if (above) return done('exceeds_limit', `Exceeds the permitted maximum of ${r3(upper)} N (${srcText}).`, ctx)
  if (!holds) return done('below_required', 'Below the estimated holding requirement; likely to slip.', { ...ctx, can_test: true, requires_override: true })
  if (!margin) return done('marginal', 'Meets the holding estimate but not the full safety margin.', { ...ctx, can_test: true, can_save_as_calibrated: true })
  return done('ok', 'Within the estimated permitted range (unvalidated).', { ...ctx, can_test: true, can_save_as_calibrated: true })
}

export const STATUS_LABEL: Record<SafetyAssessment['status'], string> = {
  ok: 'Within estimated range',
  marginal: 'Marginal',
  below_required: 'Likely to slip',
  below_minimum: 'Below gripper minimum',
  exceeds_limit: 'Exceeds limit',
  no_safe_range: 'No safe range',
  invalid: 'Invalid',
}

export type Tone = 'ok' | 'warn' | 'bad' | 'neutral'
export const STATUS_TONE: Record<SafetyAssessment['status'], Tone> = {
  ok: 'ok', marginal: 'warn', below_required: 'warn', below_minimum: 'bad', exceeds_limit: 'bad', no_safe_range: 'bad', invalid: 'bad',
}
