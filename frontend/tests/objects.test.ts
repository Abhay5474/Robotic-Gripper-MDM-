import { describe, expect, it } from 'vitest'
import { fingerprint, PRESETS, toForm, validateForm } from '@/lib/objects'

describe('object form validation', () => {
  it('offers the eight required presets', () => {
    expect(PRESETS.map((p) => p.name)).toEqual(['Plastic bottle', 'Aluminum can', 'Wooden block', 'Cardboard box', 'Rubber ball', 'Ceramic cup', 'Fragile object', 'Custom object'])
  })
  it('accepts every preset', () => PRESETS.forEach((p) => expect(validateForm(toForm(p)).value).toEqual(p)))
  it.each([
    ['mass_g', '0'], ['mass_g', '-3'], ['mass_g', 'abc'], ['mass_g', ''], ['friction_coefficient', '2.5'], ['width_mm', '0'],
    ['max_contact_force_n', '-1'], ['name', ' '], ['material', ''],
  ])('rejects %s=%j', (field, value) => {
    const r = validateForm({ ...toForm(PRESETS[0]), [field]: value })
    expect(r.value).toBeNull()
    expect(r.errors[field as keyof typeof r.errors]).toBeTruthy()
  })
  it('treats an empty contact limit as unknown (null)', () => {
    expect(validateForm({ ...toForm(PRESETS[0]), max_contact_force_n: '' }).value?.max_contact_force_n).toBeNull()
  })
  it('fingerprint changes with mass and friction but not with the label', () => {
    const p = PRESETS[0]
    expect(fingerprint({ ...p, name: 'x' })).toBe(fingerprint(p))
    expect(fingerprint({ ...p, mass_g: p.mass_g + 1 })).not.toBe(fingerprint(p))
    expect(fingerprint({ ...p, friction_coefficient: 0.5 })).not.toBe(fingerprint(p))
  })
})
