import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useApp } from '@/store/app'
import { useForces } from '@/store/derived'
import { useTelemetry } from '@/store/telemetry'

const AX = { stroke: '#64748b', fontSize: 11 }

function Tip({ active, payload, unit }: { active?: boolean; payload?: readonly { value?: unknown }[]; unit: string }) {
  if (!active || !payload?.length) return null
  const p = payload[0]
  return <div className="rounded-md border border-line bg-ink-900 px-2.5 py-1.5 text-xs"><div className="font-mono">{p.value == null ? 'unavailable' : `${Number(p.value).toFixed(2)} ${unit}`}</div></div>
}

export default function TelemetryCharts() {
  const history = useTelemetry((s) => s.history)
  const source = useTelemetry((s) => s.source)
  const limits = useApp((s) => s.health?.limits)
  const f = useForces()
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
        </figcaption>
        <div className="h-60" role="img" aria-label="Measured gripping force over time against target">
          <ResponsiveContainer>
            <LineChart data={data} {...common}>
              <CartesianGrid stroke="#1e2a47" strokeDasharray="3 3" />
              <XAxis dataKey="x" {...AX} unit="s" /><YAxis {...AX} domain={[0, yMax]} width={36} />
              <Tooltip content={(p) => <Tip {...p} unit="N" />} />
              {f.selected != null && <ReferenceLine y={f.selected} stroke="#22d3ee" strokeWidth={1.5} />}
              {f.llm != null && <ReferenceLine y={f.llm} stroke="#a78bfa" strokeDasharray="5 4" />}
              {f.calibrated != null && <ReferenceLine y={f.calibrated} stroke="#34d399" strokeDasharray="5 4" />}
              <Line type="monotone" dataKey="force" stroke="#fb923c" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </figure>
      <figure>
        <figcaption className="mb-1 text-xs"><b className="text-slate-100">Finger opening (mm)</b></figcaption>
        <div className="h-40" role="img" aria-label="Finger opening over time">
          <ResponsiveContainer>
            <LineChart data={data} {...common}>
              <CartesianGrid stroke="#1e2a47" strokeDasharray="3 3" />
              <XAxis dataKey="x" {...AX} unit="s" /><YAxis {...AX} domain={[0, limits?.max_opening_mm ?? 'auto']} width={36} />
              <Tooltip content={(p) => <Tip {...p} unit="mm" />} />
              <Line type="monotone" dataKey="opening" stroke="#38bdf8" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </figure>
      <figure>
        <figcaption className="mb-1 text-xs"><b className="text-slate-100">Slip detected</b> <span className="text-slate-400">(1 = slip; gaps = unavailable)</span></figcaption>
        <div className="h-24" role="img" aria-label="Slip detection over time">
          <ResponsiveContainer>
            <LineChart data={data} {...common}>
              <CartesianGrid stroke="#1e2a47" strokeDasharray="3 3" />
              <XAxis dataKey="x" {...AX} unit="s" /><YAxis {...AX} domain={[0, 1]} ticks={[0, 1]} width={36} />
              <Line type="stepAfter" dataKey="slip" stroke="#f87171" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </figure>
    </div>
  )
}
