import presetsJson from '@shared/object_presets.json'
import type { Fragility, ObjectProps } from './types'

export interface Preset extends ObjectProps { }
export const PRESETS: Preset[] = presetsJson.presets as Preset[]
export const CUSTOM_ID = 'custom-object'

/** Form values are strings so partially typed input is representable. */
export interface ObjectForm {
  object_id: string
  name: string
  mass_g: string
  width_mm: string
  height_mm: string
  depth_mm: string
  material: string
  friction_coefficient: string
  fragility: Fragility
  max_contact_force_n: string
}

export const toForm = (o: ObjectProps): ObjectForm => ({
  object_id: o.object_id, name: o.name, mass_g: String(o.mass_g), width_mm: String(o.width_mm), height_mm: String(o.height_mm),
  depth_mm: String(o.depth_mm), material: o.material, friction_coefficient: String(o.friction_coefficient), fragility: o.fragility,
  max_contact_force_n: o.max_contact_force_n == null ? '' : String(o.max_contact_force_n),
})

export const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

export type FormErrors = Partial<Record<keyof ObjectForm, string>>

const RANGES: Record<string, [number, number, string]> = {
  mass_g: [0, 50000, 'g'], width_mm: [0, 1000, 'mm'], height_mm: [0, 1000, 'mm'], depth_mm: [0, 1000, 'mm'],
  friction_coefficient: [0, 2, ''], max_contact_force_n: [0, 1000, 'N'],
}

export function validateForm(f: ObjectForm): { value: ObjectProps | null; errors: FormErrors } {
  const errors: FormErrors = {}
  const nums: Record<string, number> = {}
  for (const k of ['mass_g', 'width_mm', 'height_mm', 'depth_mm', 'friction_coefficient'] as const) {
    const raw = f[k].trim()
    const v = Number(raw)
    const [lo, hi, u] = RANGES[k]
    if (raw === '' || !Number.isFinite(v)) errors[k] = 'Enter a number'
    else if (v <= lo) errors[k] = 'Must be greater than 0'
    else if (v > hi) errors[k] = `Must be at most ${hi}${u ? ' ' + u : ''}`
    else nums[k] = v
  }
  let maxContact: number | null = null
  if (f.max_contact_force_n.trim() !== '') {
    const v = Number(f.max_contact_force_n)
    if (!Number.isFinite(v) || v <= 0) errors.max_contact_force_n = 'Must be greater than 0, or leave empty if unknown'
    else if (v > 1000) errors.max_contact_force_n = 'Must be at most 1000 N'
    else maxContact = v
  }
  if (!f.name.trim()) errors.name = 'Required'
  else if (f.name.trim().length > 80) errors.name = 'At most 80 characters'
  if (!f.material.trim()) errors.material = 'Required'
  else if (f.material.trim().length > 40) errors.material = 'At most 40 characters'
  const id = f.object_id || slugify(f.name)
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) errors.name = errors.name ?? 'Name must contain letters or digits'
  if (Object.keys(errors).length) return { value: null, errors }
  return {
    errors,
    value: {
      object_id: id, name: f.name.trim(), mass_g: nums.mass_g, width_mm: nums.width_mm, height_mm: nums.height_mm,
      depth_mm: nums.depth_mm, material: f.material.trim(), friction_coefficient: nums.friction_coefficient,
      fragility: f.fragility, max_contact_force_n: maxContact,
    },
  }
}

/** Stable fingerprint of what the backend keys a calibration on (used for the local cache only). */
export function fingerprint(o: ObjectProps): string {
  const r = (x: number, d: number) => x.toFixed(d)
  return [o.object_id, r(o.mass_g, 1), r(o.width_mm, 1), r(o.height_mm, 1), r(o.depth_mm, 1), o.material.toLowerCase().replace(/\s+/g, ' ').trim(),
    r(o.friction_coefficient, 2), o.fragility, o.max_contact_force_n ?? 'none'].join('|')
}

/** Visual family of an object, used for its 3D shape and gallery illustration. Physics never depends on it. */
export type ObjectKind = 'bottle' | 'can' | 'block' | 'box' | 'ball' | 'cup' | 'glass' | 'generic'
const KIND_BY_ID: Record<string, ObjectKind> = {
  'plastic-bottle': 'bottle', 'aluminum-can': 'can', 'wooden-block': 'block', 'cardboard-box': 'box',
  'rubber-ball': 'ball', 'ceramic-cup': 'cup', 'fragile-object': 'glass',
}
export function objectKind(o: Pick<ObjectProps, 'object_id' | 'name' | 'material'> | null | undefined): ObjectKind {
  if (!o) return 'generic'
  if (KIND_BY_ID[o.object_id]) return KIND_BY_ID[o.object_id]
  const t = `${o.name} ${o.material}`.toLowerCase()
  if (/bottle/.test(t)) return 'bottle'
  if (/\bcan\b|\btin\b/.test(t)) return 'can'
  if (/\bball\b|sphere/.test(t)) return 'ball'
  if (/\bcup\b|\bmug\b/.test(t)) return 'cup'
  if (/glass|vase/.test(t)) return 'glass'
  if (/cardboard|carton/.test(t)) return 'box'
  if (/wood/.test(t)) return 'block'
  return 'generic'
}
