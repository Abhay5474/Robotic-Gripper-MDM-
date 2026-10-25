import { useMemo } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis, type DotItemDotProps } from 'recharts'
import { summarizeAttempts, type Attempt } from '@/lib/suggest'
import { useApp } from '@/store/app'
import { useForces } from '@/store/derived'
import { useThemeColors } from '@/store/theme'

/** How the force was tuned test by test: the convergence path from the LLM value to the final one. */
export default function AttemptsChart() {
  const events = useApp((s) => s.session?.events)
  const limits = useApp((s) => s.health?.limits)
  const f = useForces()
  const c = useThemeColors()
  const attempts: Attempt[] = useMemo(() => summarizeAttempts(events ?? []), [events])
  if (!limits || attempts.length === 0) return <p className="text-sm text-slate-400">No tests yet. Each test you run appears here, so you can see how the force converges.</p>
  const col = (o: Attempt['outcome']) => (o === 'slipped' ? c.warn : o === 'risk' || o === 'failed' ? c.bad : c.accent)
  const Dot = (p: DotItemDotProps) => {
    const a = p.payload as Attempt
    return <circle key={a.n} cx={p.cx} cy={p.cy} r={6} fill={a.outcome === 'pending' ? 'transparent' : col(a.outcome)} stroke={col(a.outcome)} strokeWidth={2.5} />
  }
  return (
    <div>
      <div className="h-44" role="img" aria-label={`Force by test attempt: ${attempts.map((a) => `${a.n}: ${a.force} N ${a.outcome}`).join('; ')}`}>
        <ResponsiveContainer>
          <LineChart data={attempts} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke={c.grid} strokeDasharray="3 3" />
            <XAxis dataKey="n" stroke={c.axis} fontSize={11} allowDecimals={false} label={{ value: 'test #', position: 'insideBottomRight', offset: -2, fill: c.axis, fontSize: 10 }} />
            <YAxis stroke={c.axis} fontSize={11} width={36} domain={[limits.min_force_n, (max: number) => Math.min(limits.max_force_n, Math.ceil(max + 2))]} />
            {f.llm != null && <ReferenceLine y={f.llm} stroke={c.llm} strokeDasharray="5 4" label={{ value: 'LLM', fill: c.llm, fontSize: 10, position: 'insideTopLeft' }} />}
            {f.calibrated != null && <ReferenceLine y={f.calibrated} stroke={c.cal} strokeDasharray="5 4" label={{ value: 'saved', fill: c.cal, fontSize: 10, position: 'insideBottomLeft' }} />}
            <Line dataKey="force" stroke={c.accent} strokeWidth={2} dot={Dot} activeDot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[11px] text-slate-400">
        <span style={{ color: c.accent }}>●</span> logged without a negative result · <span style={{ color: c.warn }}>●</span> slipped · <span style={{ color: c.bad }}>●</span> damage risk / failed · hollow = awaiting your verdict
      </p>
    </div>
  )
}
