import { useApp } from '@/store/app'
import { useForces } from '@/store/derived'
import { useTelemetry } from '@/store/telemetry'
import { useThemeColors } from '@/store/theme'
import { SimTag } from '../ModeBadge'

const CX = 120, CY = 112, R = 88
const polar = (deg: number, r = R) => [CX + r * Math.cos((Math.PI * (180 - deg)) / 180), CY - r * Math.sin((Math.PI * (180 - deg)) / 180)]
const arc = (a0: number, a1: number, r = R) => { const [x0, y0] = polar(a0, r), [x1, y1] = polar(a1, r); return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}` }

/** Semicircular gauge: measured force (needle) vs selected target (tick), permitted window and limits. */
export default function ForceGauge() {
  const limits = useApp((s) => s.health?.limits)
  const measured = useTelemetry((s) => s.latest?.measured_force_n ?? null)
  const source = useTelemetry((s) => s.source)
  const f = useForces()
  const c = useThemeColors()
  if (!limits) return null
  const lo = 0, hi = limits.max_force_n
  const ang = (v: number) => 180 * (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)
  const sa = f.safety
  const safe = sa?.safe_range_n
  const upper = sa?.upper_limit_n ?? hi
  const deviation = measured != null && f.selected != null ? measured - f.selected : null
  return (
    <figure className="mx-auto max-w-xs" data-testid="force-gauge">
      <svg viewBox="0 0 240 150" role="img" aria-label={`Grip force gauge. Measured ${measured == null ? 'unavailable' : measured.toFixed(2) + ' newtons'}; target ${f.selected?.toFixed(2) ?? 'none'} newtons.`}>
        <path d={arc(0, 180)} stroke={c.grid} strokeWidth="16" fill="none" strokeLinecap="round" />
        {safe && <path d={arc(ang(safe[0]), ang(safe[1]))} stroke={c.ok} strokeWidth="16" fill="none" opacity=".55" />}
        {upper < hi && <path d={arc(ang(upper), 180)} stroke={c.bad} strokeWidth="16" fill="none" opacity=".55" />}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => { const [x, y] = polar(180 * t, R + 16); return <text key={t} x={x} y={y + 3} fontSize="9" textAnchor="middle" fill={c.axis}>{(hi * t).toFixed(hi * t % 1 ? 1 : 0)}</text> })}
        {f.selected != null && (() => { const [x0, y0] = polar(ang(f.selected), R - 14), [x1, y1] = polar(ang(f.selected), R + 9); return <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={c.accent} strokeWidth="4" strokeLinecap="round"><title>{`Target ${f.selected.toFixed(2)} N`}</title></line> })()}
        {measured != null && (() => { const [x, y] = polar(ang(measured), R - 22); return (<g><line x1={CX} y1={CY} x2={x} y2={y} stroke={c.meas} strokeWidth="3.5" strokeLinecap="round" /><circle cx={CX} cy={CY} r="6" fill={c.meas} /></g>) })()}
        {measured == null && <circle cx={CX} cy={CY} r="6" fill={c.axis} />}
        <text x={CX} y={CY + 26} textAnchor="middle" fontSize="19" fontWeight="700" fill={measured == null ? c.axis : c.meas} fontFamily="ui-monospace, monospace">{measured == null ? 'unavailable' : `${measured.toFixed(2)} N`}</text>
      </svg>
      <figcaption className="-mt-1 flex items-center justify-center gap-3 text-xs text-slate-400">
        <span>measured <span style={{ color: c.meas }}>▬</span></span><span>target <span style={{ color: c.accent }}>▮</span></span>
        {deviation != null && <span className="font-mono">Δ {deviation >= 0 ? '+' : ''}{deviation.toFixed(2)} N</span>}
        {source === 'simulated' && <SimTag />}
      </figcaption>
    </figure>
  )
}
