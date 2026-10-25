import { Trash2 } from 'lucide-react'
import ForceSummary from '@/components/ForceSummary'
import SceneView from '@/components/SceneView'
import TelemetryCharts from '@/components/TelemetryCharts'
import TelemetryTiles from '@/components/TelemetryTiles'
import { StateStepper } from '@/components/OperationPanel'
import { Button, Card, Pill } from '@/components/ui'
import { useApp } from '@/store/app'
import { useTelemetry } from '@/store/telemetry'

export default function Telemetry() {
  const clear = useTelemetry((s) => s.clearHistory)
  const { conn, source, history } = useTelemetry()
  const path = useApp((s) => s.settings.telemetryPath)
  const mode = useApp((s) => s.settings.mode)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><h1 className="text-xl font-semibold">Live Telemetry</h1>
          <p className="text-sm text-slate-400">{mode === 'live' ? <>Listening to Firebase node <code className="font-mono">{path}</code></> : 'Simulated readings (demo mode)'}</p></div>
        <div className="flex items-center gap-2"><Pill tone={conn === 'connected' ? 'ok' : 'bad'}>{source ?? 'no source'} · {conn}</Pill><Button variant="ghost" onClick={clear}><Trash2 className="size-4" />Clear chart ({history.length})</Button></div>
      </div>
      <Card><ForceSummary compact /></Card>
      <Card title="Current readings"><div className="space-y-3"><TelemetryTiles /><StateStepper /></div></Card>
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3" title="History" subtitle="Only real samples received since this page session started; nothing is interpolated or backfilled."><TelemetryCharts /></Card>
        <Card className="lg:col-span-2" title="Gripper view"><SceneView height="h-72" /></Card>
      </div>
    </div>
  )
}
