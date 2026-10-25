export const fmtN = (v: number | null | undefined, digits = 2) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)} N`)
export const fmtMm = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)} mm`)
export function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
export const shortId = (id?: string | null) => (id ? id.replace(/^(cal|pred|op)_0*/, '$1_').slice(0, 20) : '—')
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
export const roundToStep = (v: number, step: number) => Math.round(v / step) * step
