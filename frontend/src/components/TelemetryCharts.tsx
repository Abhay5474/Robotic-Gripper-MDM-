import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useApp } from '@/store/app'
import { useForces } from '@/store/derived'
import { useTelemetry, type HistPoint } from '@/store/telemetry'
import { useThemeColors } from '@/store/theme'
import StateTimeline from './viz/StateTimeline'


function Tip({ active, payload, unit }: { active?: boolean; payload?: readonly { value?: unknown }[]; unit: string }) {
  if (!active || !payload?.length) return null
  const p = payload[0]
  return <div className="rounded-md border border-line bg-ink-900 px-2.5 py-1.5 text-xs"><div className="font-mono">{p.value == null ? 'unavailable' : `${Number(p.value).toFixed(2)} ${unit}`}</div></div>
}

export default function TelemetryCharts({ points }: { points?: HistPoint[] } = {}) {
  const live = useTelemetry((s) => s.history)
  const history = points ?? live
  const source = useTelemetry((s) => s.source)
  const limits = useApp((s) => s.health?.limits)
  const f = useForces()
  const c = useThemeColors()
  const AX = { stroke: c.axis, fontSize: 11 }
  if (history.length < 2) return <div className="grid h-48 place-items-center rounded-lg border border-dashed border-line text-sm text-slate-400">{source ? 'Waiting for telemetry samples…' : 'No telemetry source is active.'}</div>
  const t0 = history[0].t
  const data = history.map((h) => ({ x: Number(((h.t - t0) / 1000).toFixed(1)), force: h.force, opening: h.opening, slip: h.slip }))
  const yMax = Math.max(limits?.max_force_n ?? 10, 1)
  const common = { margin: { top: 8, right: 16, bottom: 4, left: 0 } }
  return (
    <div className="space-y-5">
      <figure>
        <figcaption className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300">
          <b className="text-slate-100">Gripping force (N)</b>
          <span><i className="mr-1 inline-block h-0.5 w-4 bg-meas align-middle" />measured</span>
          <span><i className="mr-1 inline-block h-0.5 w-4 bg-accent align-middle" />selected target</span>
          {f.llm != null && <span><i className="mr-1 inline-block h-0.5 w-4 bg-llm align-middle" />LLM</span>}
          {f.calibrated != null && <span><i className="mr-1 inline-block h-0.5 w-4 bg-cal align-middle" />calibrated</span>}
          {f.safety?.safe_range_n && <span><i className="mr-1 inline-block h-2 w-4 rounded-sm bg-ok/20 align-middle" />permitted window</span>}
        </figcaption>
        <div className="h-60" role="img" aria-label="Measured gripping force over time against target">
          <ResponsiveContainer>
            <LineChart data={data} {...common}>
              <CartesianGrid stroke={c.grid} strokeDasharray="3 3" />
              <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tickCount={7} tickFormatter={(v: number) => `${Math.round(v)}s`} {...AX} /><YAxis {...AX} domain={[0, yMax]} width={36} />
              <Tooltip content={(p) => <Tip {...p} unit="N" />} />
              {f.safety?.safe_range_n && <ReferenceArea y1={f.safety.safe_range_n[0]} y2={f.safety.safe_range_n[1]} fill={c.ok} fillOpacity={0.1} stroke="none" ifOverflow="hidden" />}
              {f.safety?.upper_limit_n != null && f.safety.upper_limit_n < yMax && <ReferenceLine y={f.safety.upper_limit_n} stroke={c.bad} strokeDasharray="6 4" label={{ value: 'limit', fill: c.bad, fontSize: 10, position: 'insideTopRight' }} />}
              {f.selected != null && <ReferenceLine y={f.selected} stroke={c.accent} strokeWidth={1.5} />}
              {f.llm != null && <ReferenceLine y={f.llm} stroke={c.llm} strokeDasharray="5 4" />}
              {f.calibrated != null && <ReferenceLine y={f.calibrated} stroke={c.cal} strokeDasharray="5 4" />}
              <Line type="monotone" dataKey="force" stroke={c.meas} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </figure>
      <StateTimeline history={history} />
      <figure>
        <figcaption className="mb-1 text-xs"><b className="text-slate-100">Finger opening (mm)</b></figcaption>
        <div className="h-40" role="img" aria-label="Finger opening over time">
          <ResponsiveContainer>
            <LineChart data={data} {...common}>
              <CartesianGrid stroke={c.grid} strokeDasharray="3 3" />
              <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tickCount={7} tickFormatter={(v: number) => `${Math.round(v)}s`} {...AX} /><YAxis {...AX} domain={[0, limits?.max_opening_mm ?? 'auto']} width={36} />
              <Tooltip content={(p) => <Tip {...p} unit="mm" />} />
              <Line type="monotone" dataKey="opening" stroke={c.opening} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </figure>
      <figure>
        <figcaption className="mb-1 text-xs"><b className="text-slate-100">Slip detected</b> <span className="text-slate-400">(1 = slip; gaps = unavailable)</span></figcaption>
        <div className="h-24" role="img" aria-label="Slip detection over time">
          <ResponsiveContainer>
            <LineChart data={data} {...common}>
              <CartesianGrid stroke={c.grid} strokeDasharray="3 3" />
              <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tickCount={7} tickFormatter={(v: number) => `${Math.round(v)}s`} {...AX} /><YAxis {...AX} domain={[0, 1]} ticks={[0, 1]} width={36} />
              <Line type="stepAfter" dataKey="slip" stroke={c.slip} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </figure>
    </div>
  )
}
