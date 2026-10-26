import { Pause, Play, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import ForceSummary from '@/components/ForceSummary'
import { StateStepper } from '@/components/OperationPanel'
import SceneView from '@/components/SceneView'
import TelemetryCharts from '@/components/TelemetryCharts'
import TelemetryTiles from '@/components/TelemetryTiles'
import { Button, Card, Pill, cx } from '@/components/ui'
import { telemetryStats, windowed } from '@/lib/telemetry'
import { useApp } from '@/store/app'
import { useTelemetry, type HistPoint } from '@/store/telemetry'

const WINDOWS: { s: number | null; label: string }[] = [{ s: 15, label: '15 s' }, { s: 30, label: '30 s' }, { s: 60, label: '60 s' }, { s: null, label: 'All' }]

export default function Telemetry() {
  const clear = useTelemetry((s) => s.clearHistory)
  const { conn, source, history } = useTelemetry()
  const path = useApp((s) => s.settings.telemetryPath)
  const mode = useApp((s) => s.settings.mode)
  const [frozen, setFrozen] = useState<HistPoint[] | null>(null)
  const [win, setWin] = useState<number | null>(30)
  const points = useMemo(() => windowed(frozen ?? history, win), [frozen, history, win])
  const st = telemetryStats(points)
  const n = (v: number | null, d = 2, u = '') => (v == null ? '—' : `${v.toFixed(d)}${u}`)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><h1 className="text-xl font-semibold">Live Telemetry</h1>
          <p className="text-sm text-slate-400">{mode === 'live' ? <>Listening to Firebase node <code className="font-mono">{path}</code></> : 'Simulated readings (demo mode)'}</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={conn === 'connected' ? 'ok' : 'bad'}>{source ?? 'no source'} · {conn}</Pill>
          <div role="group" aria-label="Time window" className="inline-flex rounded-lg border border-line bg-ink-900 p-0.5 text-xs">
            {WINDOWS.map((w) => <button key={w.label} type="button" aria-pressed={win === w.s} onClick={() => setWin(w.s)} className={cx('rounded-md px-2.5 py-1', win === w.s ? 'bg-accent text-ink-950' : 'text-slate-300 hover:text-slate-100')}>{w.label}</button>)}
          </div>
          <Button onClick={() => setFrozen((f) => (f ? null : [...history]))} aria-pressed={!!frozen}>{frozen ? <><Play className="size-4" />Resume</> : <><Pause className="size-4" />Pause</>}</Button>
          <Button variant="ghost" onClick={() => { clear(); setFrozen(null) }}><Trash2 className="size-4" />Clear ({history.length})</Button>
        </div>
      </div>
      <Card><ForceSummary compact /></Card>
      <Card title="Current readings"><div className="space-y-3"><TelemetryTiles /><StateStepper /></div></Card>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6" data-testid="telemetry-stats">
        {[['Samples', String(st.samples)], ['Rate', n(st.rateHz, 1, ' Hz')], ['Force min', n(st.fMin, 2, ' N')], ['Force mean', n(st.fMean, 2, ' N')], ['Force max', n(st.fMax, 2, ' N')], ['Time slipping', st.slipShare == null ? '—' : `${(st.slipShare * 100).toFixed(0)} %`]].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-line bg-ink-800/80 px-3 py-2"><div className="text-[11px] uppercase tracking-wider text-slate-400">{k}</div><div className="font-mono text-lg tabular-nums text-slate-100">{v}</div></div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3" title={frozen ? 'History (paused)' : 'History'} subtitle="Only real samples received since this page session started; nothing is interpolated or backfilled."><TelemetryCharts points={points} /></Card>
        {/* sticky so the cell stays in view while scrolling through the charts */}
        <Card className="self-start lg:sticky lg:top-24 lg:col-span-2" title="Work-cell view" subtitle="Same samples as the charts"><SceneView height="h-[26rem] lg:h-[32rem]" /></Card>
      </div>
    </div>
  )
}
