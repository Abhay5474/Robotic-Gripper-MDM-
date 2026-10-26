import { ChevronDown, ChevronRight, Layers, Pause, Play, RotateCcw, Search, ShieldOff } from 'lucide-react'
import { Fragment, startTransition, useCallback, useEffect, useMemo, useState } from 'react'
import { useFastNavigate } from '@/components/FastLink'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import SceneView from '@/components/SceneView'
import { Banner, Button, Card, KV, Pill, Spinner, cx } from '@/components/ui'
import { api, ApiError } from '@/lib/api'
import { calibrationsCsv } from '@/lib/analytics'
import { fmtDate, fmtN, shortId } from '@/lib/format'
import { traceProgress } from '@/lib/kinematics'
import { PRESETS } from '@/lib/objects'
import type { CalibrationRecord, OperationRecord, TraceRow } from '@/lib/types'
import { useApp } from '@/store/app'
import { useThemeColors } from '@/store/theme'

function download(name: string, text: string, type: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

const STATUS_TONE = { calibrated: 'ok', in_progress: 'warn', failed: 'bad', cancelled: 'neutral', invalidated: 'bad' } as const

function CalibrationRow({ rec, onChanged }: { rec: CalibrationRecord; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null | undefined>(undefined)
  const [err, setErr] = useState<string | null>(null)
  const mode = useApp((s) => s.settings.mode)
  const invalidate = useApp((s) => s.invalidate)
  const loadObject = useApp((s) => s.loadObject)
  const nav = useFastNavigate()
  useEffect(() => {
    if (open && activeId === undefined) api.history(mode, rec.configuration_key).then((h) => setActiveId(h.active_calibration_id)).catch(() => setActiveId(null))
  }, [open, activeId, mode, rec.configuration_key])
  const isActive = activeId === rec.calibration_id
  const tests = Object.values(rec.tests ?? {})
  return (
    <>
      <tr className="border-t border-line/70 hover:bg-ink-700/40">
        <td className="py-2 pl-2"><button aria-label={open ? 'Collapse' : 'Expand'} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</button></td>
        <td className="py-2 text-xs">{fmtDate(rec.confirmed_at ?? rec.created_at)}</td>
        <td className="py-2 text-sm">{rec.input_properties.name}<div className="font-mono text-[10px] text-slate-500">{rec.configuration_key.slice(0, 14)}…</div></td>
        <td className="py-2 font-mono text-sm text-llm">{fmtN(rec.original_llm_force)}</td>
        <td className="py-2 font-mono text-sm text-cal">{fmtN(rec.calibrated_force)}</td>
        <td className="py-2"><Pill tone={STATUS_TONE[rec.calibration_status]}>{rec.calibration_status.replace('_', ' ')}</Pill>{rec.mode === 'demo' && <span className="ml-1 text-[10px] font-bold text-warn">DEMO</span>}</td>
        <td className="py-2 text-xs text-slate-400">{rec.confirmation_method?.replace('_', '-') ?? '—'}</td>
      </tr>
      {open && (
        <tr className="bg-ink-900/50"><td colSpan={7} className="px-4 py-3">
          <div className="grid gap-4 md:grid-cols-2">
            <dl>
              <KV k="Record" v={<span className="text-xs">{rec.calibration_id}</span>} />
              <KV k="Prediction" v={<span className="text-xs">{shortId(rec.prediction_id)}</span>} />
              <KV k="Model / prompt" v={<span className="text-xs">{rec.model_identifier ?? '—'} · {rec.prompt_version ?? '—'}</span>} />
              <KV k="Created" v={fmtDate(rec.created_at)} /><KV k="Last verified" v={fmtDate(rec.last_verified_at)} />
              <KV k="Active for this configuration" v={activeId === undefined ? <Spinner /> : isActive ? <Pill tone="ok">active</Pill> : 'no'} />
              {rec.invalidation_reason && <KV k="Invalidated because" v={rec.invalidation_reason} />}
              {rec.override?.used && <KV k="Safety override" v={rec.override.reason} />}
            </dl>
            <div className="space-y-2 text-xs">
              {rec.warnings?.length > 0 && <ul className="list-inside list-disc text-warn">{rec.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
              <div className="text-slate-400">Test log ({tests.length}):</div>
              <ol className="font-mono text-slate-300">{tests.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)).map((t) => <li key={t.seq}>{t.seq}. {t.event} @ {t.force_n} N</li>)}</ol>
            </div>
          </div>
          {err && <div className="mt-2"><Banner tone="bad">{err}</Banner></div>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => { loadObject(rec.input_properties); nav('/calibration') }}><RotateCcw className="size-4" />Recalibrate</Button>
            {rec.calibration_status === 'calibrated' && (
              <Button variant="danger" onClick={async () => {
                const reason = window.prompt('Why is this calibration being invalidated? (e.g. pads replaced)')
                if (!reason || reason.trim().length < 3) return
                try { await invalidate(rec.calibration_id, reason.trim()); onChanged() } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)) }
              }}><ShieldOff className="size-4" />Invalidate</Button>
            )}
          </div>
        </td></tr>
      )}
    </>
  )
}

function TraceChart({ rows, cursor }: { rows: TraceRow[]; cursor: number }) {
  const c = useThemeColors()
  return (
    <div className="h-36" role="img" aria-label="Recorded force trace">
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={c.grid} strokeDasharray="3 3" />
          <XAxis dataKey="t" stroke={c.axis} fontSize={11} unit="s" /><YAxis stroke={c.axis} fontSize={11} width={34} />
          <Line dataKey="f" stroke={c.meas} dot={false} strokeWidth={2} isAnimationActive={false} />
          <ReferenceLine x={rows[cursor]?.t} stroke={c.accent} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function OperationsTab() {
  const mode = useApp((s) => s.settings.mode)
  const [ops, setOps] = useState<OperationRecord[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [sel, setSel] = useState<OperationRecord | null>(null)
  const [cursor, setCursor] = useState(0)
  const [playing, setPlaying] = useState(false)
  const trace = sel?.trace
  useEffect(() => {
    if (!playing || !trace?.length) return
    const t0 = performance.now() - (trace[cursor]?.t ?? 0) * 1000
    const id = setInterval(() => {
      const el = (performance.now() - t0) / 1000
      let i = cursor
      while (i < trace.length - 1 && trace[i + 1].t <= el) i++
      // low priority: a playing replay must never hold up route changes or input (React Router navigates in a transition)
      startTransition(() => {
        setCursor(i)
        if (i >= trace.length - 1) setPlaying(false)
      })
    }, 80)
    return () => clearInterval(id)
    // restart only when play state or the selected trace changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, trace])
  const progress = useMemo(() => (trace?.length ? traceProgress(trace.map((r) => r.st ?? null), cursor) : null), [trace, cursor])
  const replayObject = useMemo(() => PRESETS.find((p) => p.object_id === sel?.object_id) ?? null, [sel])
  const load = useCallback(() => { setErr(null); api.operations(mode).then((r) => setOps(r.operations)).catch((e) => setErr(e.message)) }, [mode])
  useEffect(load, [load])
  const row = sel?.trace?.[cursor]
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-3" title="Operations" action={<Button variant="ghost" onClick={load}>Refresh</Button>}>
        {err && <Banner tone="bad">{err}</Banner>}
        {!ops && !err && <Spinner />}
        {ops && ops.length === 0 && <p className="text-sm text-slate-400">No operations recorded in {mode} mode yet. Run one from the Gripper Control page.</p>}
        {ops && ops.length > 0 && (
          <table className="w-full text-left text-sm"><thead className="text-xs text-slate-400"><tr><th className="py-1">When</th><th>Object</th><th>Force</th><th>Result</th><th>Source</th></tr></thead>
            <tbody>{ops.map((o) => (
              <tr key={o.operation_id} onClick={() => { setSel(o); setCursor(0); setPlaying(false) }} className={cx('cursor-pointer border-t border-line/70 hover:bg-ink-700/40', sel?.operation_id === o.operation_id && 'bg-ink-700/60')}>
                <td className="py-2 text-xs">{fmtDate(o.timestamp)}</td><td>{o.object_id}</td><td className="font-mono">{fmtN(o.selected_force_n)}</td>
                <td><Pill tone={o.operation_result === 'success' ? 'ok' : 'bad'}>{o.operation_result}</Pill></td><td className="text-xs text-slate-400">{o.data_source}{o.calibration_status === 'uncalibrated' && ' · uncal.'}</td>
              </tr>))}</tbody></table>
        )}
      </Card>
      <Card className="lg:col-span-2" title="Replay" subtitle={sel ? `${sel.operation_id}` : 'Select an operation with a recorded trace'}>
        {sel?.trace?.length ? (
          <div className="space-y-3">
            <SceneView height="h-64" compact progress={progress} object={replayObject} targetForce={sel.selected_force_n}
              override={{ finger_opening_mm: row?.o ?? null, measured_force_n: row?.f ?? null, slip_detected: row?.s == null ? null : !!row.s, operation_state: row?.st ?? null, object_detected: ['closing', 'holding', 'lifting', 'transporting', 'releasing', 'slipped'].includes(row?.st ?? '') }} />
            <div className="flex items-center gap-2">
              <Button aria-label={playing ? 'Pause replay' : 'Play replay'} onClick={() => { if (!playing && cursor >= (sel.trace?.length ?? 1) - 1) setCursor(0); setPlaying((p) => !p) }}>{playing ? <Pause className="size-4" /> : <Play className="size-4" />}</Button>
              <input type="range" aria-label="Replay position" className="w-full accent-[var(--color-accent)]" min={0} max={sel.trace.length - 1} value={cursor} onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)) }} />
            </div>
            <div className="font-mono text-xs text-slate-300">t={row?.t}s · {fmtN(row?.f)} · {row?.st ?? 'state n/a'}</div>
            <TraceChart rows={sel.trace} cursor={cursor} />
            <Button variant="ghost" onClick={() => { const b = new Blob([JSON.stringify(sel, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${sel.operation_id}.json`; a.click(); URL.revokeObjectURL(a.href) }}>Download JSON</Button>
          </div>
        ) : <p className="text-sm text-slate-400">{sel ? 'This operation has no recorded trace.' : 'Nothing selected.'}</p>}
      </Card>
    </div>
  )
}

export default function HistoryPage() {
  const mode = useApp((s) => s.settings.mode)
  const [tab, setTab] = useState<'cal' | 'ops'>('cal')
  const [recs, setRecs] = useState<CalibrationRecord[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [grouped, setGrouped] = useState(true)
  const load = useCallback(() => { setErr(null); setRecs(null); api.recentCalibrations(mode).then((r) => setRecs(r.records)).catch((e) => setErr(e.message)) }, [mode])
  useEffect(load, [load])
  const needle = q.trim().toLowerCase()
  const shown = recs?.filter((r) => (filter === 'all' || r.calibration_status === filter)
    && (!needle || `${r.input_properties.name} ${r.object_id} ${r.configuration_key} ${r.calibration_id}`.toLowerCase().includes(needle)))
  const groups = useMemo(() => {
    const m = new Map<string, CalibrationRecord[]>()
    for (const r of shown ?? []) m.set(r.configuration_key, [...(m.get(r.configuration_key) ?? []), r])
    return [...m.entries()]
  }, [shown])
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Calibration History</h1>
      <div role="tablist" className="inline-flex rounded-lg border border-line bg-ink-900 p-0.5 text-sm">
        {([['cal', 'Calibrations'], ['ops', 'Operations']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('rounded-md px-4 py-1.5', tab === k ? 'bg-accent/20 text-accent' : 'text-slate-300')}>{l}</button>
        ))}
      </div>
      {tab === 'ops' ? <OperationsTab /> : (
        <Card title={`Calibrations (${mode} data)`} subtitle="Every record is kept for audit. Only the one marked active is reused automatically."
          action={<div className="flex flex-wrap items-center justify-end gap-2">
            <label className="relative"><Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-500" /><input aria-label="Search calibrations" placeholder="Search object, key, id" value={q} onChange={(e) => setQ(e.target.value)} className="w-44 rounded-md border border-line bg-ink-900 py-1 pl-7 pr-2 text-xs" /></label>
            <Button variant="ghost" aria-pressed={grouped} onClick={() => setGrouped((g) => !g)} className={grouped ? 'text-accent' : ''}><Layers className="size-4" />Group</Button>
            <select aria-label="Filter by status" value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-md border border-line bg-ink-900 px-2 py-1 text-xs"><option value="all">All</option>{Object.keys(STATUS_TONE).map((s) => <option key={s} value={s}>{s}</option>)}</select><Button variant="ghost" disabled={!shown?.length} onClick={() => download(`gripsense-calibrations-${mode}.csv`, calibrationsCsv(shown ?? []), 'text/csv')}>Export CSV</Button><Button variant="ghost" onClick={load}>Refresh</Button></div>}>
          {err && <Banner tone="bad">{err}</Banner>}
          {!recs && !err && <Spinner />}
          {shown && shown.length === 0 && <p className="text-sm text-slate-400">No calibration records yet.</p>}
          {shown && shown.length > 0 && (
            <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left"><thead className="text-xs text-slate-400"><tr><th className="w-8" /><th className="py-1">When</th><th>Object</th><th>LLM original</th><th>Calibrated</th><th>Status</th><th>Method</th></tr></thead>
              <tbody>{grouped
                ? groups.map(([key, rs]) => {
                    const cal = rs.filter((r) => r.calibration_status === 'calibrated')
                    return (
                      <Fragment key={key}>
                        <tr className="border-t-2 border-line bg-ink-900/60">
                          <td colSpan={7} className="px-2 py-2">
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                              <span className="font-semibold text-slate-100">{rs[0].input_properties.name}</span>
                              <span className="font-mono text-[11px] text-slate-500">{key}</span>
                              <span className="text-xs text-slate-400">{rs.length} record{rs.length > 1 ? 's' : ''}</span>
                              {cal[0] ? <Pill tone="ok">latest calibrated {fmtN(cal[0].calibrated_force)}</Pill> : <Pill>no successful calibration</Pill>}
                            </div>
                          </td>
                        </tr>
                        {rs.map((r) => <CalibrationRow key={r.calibration_id} rec={r} onChanged={load} />)}
                      </Fragment>
                    )
                  })
                : shown.map((r) => <CalibrationRow key={r.calibration_id} rec={r} onChanged={load} />)}</tbody></table></div>
          )}
        </Card>
      )}
    </div>
  )
}
