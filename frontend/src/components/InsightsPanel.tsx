import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '@/lib/api'
import { llmAccuracy, operationStats } from '@/lib/analytics'
import type { CalibrationRecord, OperationRecord } from '@/lib/types'
import { useApp } from '@/store/app'
import { useThemeColors } from '@/store/theme'
import { Banner, Card, Spinner, Stat } from './ui'

const pct = (v: number | null, d = 0) => (v == null ? '—' : `${v.toFixed(d)}%`)

/** What the saved data says about the LLM and about how operations went. Read-only analytics. */
export default function InsightsPanel() {
  const mode = useApp((s) => s.settings.mode)
  const c = useThemeColors()
  const [cals, setCals] = useState<CalibrationRecord[] | null>(null)
  const [ops, setOps] = useState<OperationRecord[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setCals(null); setOps(null); setErr(null)
    Promise.all([api.recentCalibrations(mode, 200), api.operations(mode, 200)])
      .then(([a, b]) => { if (live) { setCals(a.records); setOps(b.operations) } })
      .catch((e) => live && setErr(e.message))
    return () => { live = false }
  }, [mode])

  if (err) return <Card title="Insights"><Banner tone="warn">Insights unavailable: {err}</Banner></Card>
  if (!cals || !ops) return <Card title="Insights"><Spinner /></Card>
  const acc = llmAccuracy(cals)
  const st = operationStats(ops)
  const calibrated = new Set(cals.filter((r) => r.calibration_status === 'calibrated').map((r) => r.configuration_key)).size
  const bias = acc.meanSignedPct
  const results: [string, string][] = [['success', c.ok], ['slipped', c.warn], ['damaged', c.bad], ['failed', c.bad], ['aborted', c.axis]]
  return (
    <Card title="Insights" subtitle={`From saved ${mode} data. Descriptive only: nothing here changes prompts, limits or calibrations.`}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Calibrated configurations" value={calibrated} sub={`${cals.length} calibration records`} />
        <Stat label="LLM error vs calibrated" value={pct(acc.meanAbsPctError)} sub={acc.n ? `mean absolute, ${acc.n} configuration${acc.n > 1 ? 's' : ''}` : 'no data yet'} />
        <Stat label="LLM tendency" value={<span className="text-xl">{bias == null ? '—' : Math.abs(bias) < 3 ? 'balanced' : bias > 0 ? 'under-estimates' : 'over-estimates'}</span>} sub={bias == null ? 'no data yet' : `${bias > 0 ? '+' : ''}${bias.toFixed(0)}% calibrated vs LLM`} />
        <Stat label="Operation success" value={pct(st.successRate == null ? null : st.successRate * 100)} sub={st.total ? `${st.total} run${st.total > 1 ? 's' : ''} · ${pct((st.uncalibratedShare ?? 0) * 100)} uncalibrated` : 'no operations yet'} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <div className="mb-1 text-xs font-medium text-slate-300">LLM recommendation vs calibrated force (N)</div>
          {acc.rows.length === 0 ? <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-slate-400">Confirm a calibration that started from an LLM recommendation to compare them here.</p> : (
            <div className="h-56" role="img" aria-label={`Bar chart comparing LLM and calibrated forces: ${acc.rows.map((r) => `${r.name} ${r.llm} versus ${r.calibrated} N`).join('; ')}`}>
              <ResponsiveContainer>
                <BarChart data={acc.rows} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                  <CartesianGrid stroke={c.grid} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" stroke={c.axis} fontSize={11} interval={0} tickFormatter={(v: string) => (v.length > 12 ? v.slice(0, 11) + '…' : v)} />
                  <YAxis stroke={c.axis} fontSize={11} width={34} />
                  <Tooltip cursor={{ fill: c.grid, opacity: 0.4 }} contentStyle={{ background: 'var(--color-ink-900)', border: '1px solid var(--color-line)', borderRadius: 8, fontSize: 12 }} formatter={(v: unknown) => `${Number(v).toFixed(2)} N`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="llm" name="LLM recommended" fill={c.llm} radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false} />
                  <Bar dataKey="calibrated" name="Calibrated" fill={c.cal} radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <div className="lg:col-span-2">
          <div className="mb-1 text-xs font-medium text-slate-300">Operation outcomes</div>
          {st.total === 0 ? <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-slate-400">No operations recorded yet.</p> : (
            <div className="space-y-3">
              <div className="flex h-6 overflow-hidden rounded-md border border-line" role="img" aria-label={results.map(([k]) => `${k} ${st.byResult[k] ?? 0}`).join(', ')}>
                {results.map(([k, col]) => (st.byResult[k] ? <div key={k} title={`${k}: ${st.byResult[k]}`} style={{ width: `${(st.byResult[k] / st.total) * 100}%`, background: col }} /> : null))}
              </div>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300">
                {results.map(([k, col]) => <li key={k} className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm" style={{ background: col }} />{k} <b className="font-mono">{st.byResult[k] ?? 0}</b></li>)}
              </ul>
              {st.avgPeakN != null && <p className="text-xs text-slate-400">Average peak measured force: <span className="font-mono text-slate-200">{st.avgPeakN.toFixed(2)} N</span></p>}
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
