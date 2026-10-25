import { useMemo } from 'react'
import { bracketOf, summarizeAttempts, type Attempt } from '@/lib/suggest'
import { useApp } from '@/store/app'
import { useForces } from '@/store/derived'
import { useTelemetry } from '@/store/telemetry'
import { useThemeColors } from '@/store/theme'

const W = 720, H = 168, PAD = 28

/** One axis, every force quantity: limits, estimated windows, the four forces, and what was actually tried. */
export default function ForceEnvelope() {
  const limits = useApp((s) => s.health?.limits)
  const events = useApp((s) => s.session?.events)
  const measured = useTelemetry((s) => s.latest?.measured_force_n ?? null)
  const f = useForces()
  const c = useThemeColors()
  const attempts: Attempt[] = useMemo(() => summarizeAttempts(events ?? []), [events])
  if (!limits) return null
  const lo = limits.min_force_n, hi = limits.max_force_n
  const x = (v: number) => PAD + ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (W - 2 * PAD)
  const sa = f.safety
  const { slippedAtOrBelow, riskAtOrAbove } = bracketOf(attempts)
  const upper = sa?.upper_limit_n ?? hi
  const req = sa?.required_min_force_n
  const safe = sa?.safe_range_n
  const stepT = [1, 2, 5, 10, 20, 25, 50].find((s) => (hi - lo) / s <= 8) ?? 100
  const ticks = [lo, ...Array.from({ length: Math.floor(hi / stepT) + 1 }, (_, i) => i * stepT).filter((t) => t > lo + stepT * 0.4 && t <= hi)]
  const summary = `Force envelope from ${lo} to ${hi} newtons. ${safe ? `Estimated permitted range ${safe[0]} to ${safe[1]} N. ` : 'No permitted range established. '}${f.selected != null ? `Selected ${f.selected} N.` : ''}`
  const trackY = 62, trackH = 26
  const outcomeColor = (o: Attempt['outcome']) => (o === 'slipped' ? c.warn : o === 'risk' || o === 'failed' ? c.bad : c.accent)

  return (
    <figure data-testid="force-envelope">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} className="w-full">
        <defs>
          <pattern id="hatch-w" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke={c.warn} strokeWidth="2" opacity=".55" /></pattern>
          <pattern id="hatch-b" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke={c.bad} strokeWidth="2" opacity=".55" /></pattern>
        </defs>
        {/* gripper range */}
        <rect x={PAD} y={trackY} width={W - 2 * PAD} height={trackH} rx={6} fill={c.grid} />
        {/* estimated below-holding zone */}
        {req != null && req > lo && <rect x={PAD} y={trackY} width={x(req) - PAD} height={trackH} rx={6} fill="url(#hatch-w)"><title>Below the estimated holding requirement: likely to slip</title></rect>}
        {/* between the holding minimum and the recommended margin */}
        {req != null && safe && safe[0] > req && <rect x={x(req)} y={trackY} width={Math.max(0, x(safe[0]) - x(req))} height={trackH} fill={c.warn} opacity=".22"><title>Marginal: holds in theory but without the full safety margin</title></rect>}
        {/* permitted window */}
        {safe && <rect x={x(safe[0])} y={trackY} width={Math.max(2, x(safe[1]) - x(safe[0]))} height={trackH} fill={c.ok} opacity=".45"><title>{`Estimated permitted range ${safe[0]}-${safe[1]} N`}</title></rect>}
        {/* above limit */}
        {upper < hi && <rect x={x(upper)} y={trackY} width={W - PAD - x(upper)} height={trackH} rx={6} fill="url(#hatch-b)"><title>{`Above the ${sa?.upper_limit_source?.replace('_', ' ')} limit (${upper} N)`}</title></rect>}
        {/* evidence from this session */}
        {slippedAtOrBelow != null && <rect x={PAD} y={trackY + trackH + 4} width={x(slippedAtOrBelow) - PAD} height={5} fill={c.warn} rx={2.5}><title>{`Slipped at ${slippedAtOrBelow} N: lower forces are ruled out`}</title></rect>}
        {riskAtOrAbove != null && <rect x={x(riskAtOrAbove)} y={trackY + trackH + 4} width={W - PAD - x(riskAtOrAbove)} height={5} fill={c.bad} rx={2.5}><title>{`Risk at ${riskAtOrAbove} N: higher forces are ruled out`}</title></rect>}
        {/* axis */}
        {ticks.map((t) => (<g key={t}><line x1={x(t)} x2={x(t)} y1={trackY + trackH + 12} y2={trackY + trackH + 17} stroke={c.axis} /><text x={x(t)} y={trackY + trackH + 30} textAnchor="middle" fontSize="11" fill={c.axis}>{t.toFixed(t % 1 ? 1 : 0)}</text></g>))}
        <text x={W - PAD} y={H - 4} textAnchor="end" fontSize="10" fill={c.axis}>N per finger</text>
        {/* tried forces */}
        {attempts.map((a) => (
          <g key={a.n} transform={`translate(${x(a.force)},${trackY + trackH / 2})`}>
            <circle r={7} fill={a.outcome === 'pending' ? 'none' : outcomeColor(a.outcome)} stroke={outcomeColor(a.outcome)} strokeWidth="2.5"><title>{`Test ${a.n}: ${a.force} N - ${a.outcome}`}</title></circle>
            <text y={3.5} textAnchor="middle" fontSize="9" fontWeight="700" fill={a.outcome === 'pending' ? c.axis : c.on}>{a.n}</text>
          </g>
        ))}
        {/* named markers (stacked so labels never collide) */}
        {[
          { v: f.llm, label: 'LLM', color: c.llm, row: 0 },
          { v: f.calibrated, label: f.calibratedApplicable ? 'Calibrated' : 'Saved (not applied)', color: c.cal, row: 1 },
          { v: measured, label: 'Measured', color: c.meas, row: 2 },
          { v: f.selected, label: 'Selected', color: c.accent, row: 3 },
        ].map((m) => m.v != null && (
          <g key={m.label}>
            <line x1={x(m.v)} x2={x(m.v)} y1={14 + m.row * 11} y2={trackY - 2} stroke={m.color} strokeWidth={m.label === 'Selected' ? 2.5 : 1.5} strokeDasharray={m.label === 'Selected' ? undefined : '3 3'} />
            <circle cx={x(m.v)} cy={14 + m.row * 11} r="3.5" fill={m.color} />
            <text x={x(m.v) + (x(m.v) > W - 150 ? -8 : 8)} y={17 + m.row * 11} textAnchor={x(m.v) > W - 150 ? 'end' : 'start'} fontSize="11" fontWeight="600" fill={m.color}>{m.label} {m.v.toFixed(2)}</text>
          </g>
        ))}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
        <span><i className="mr-1 inline-block h-2 w-3 rounded-sm bg-ok/60" />permitted window</span>
        <span><i className="mr-1 inline-block h-2 w-3 rounded-sm bg-warn/60" />likely slip zone</span>
        <span><i className="mr-1 inline-block h-2 w-3 rounded-sm bg-warn/25" />marginal (no full margin)</span>
        <span><i className="mr-1 inline-block h-2 w-3 rounded-sm bg-bad/60" />above limit</span>
        <span>numbered dots = tests this session (filled = result logged)</span>
      </figcaption>
    </figure>
  )
}
