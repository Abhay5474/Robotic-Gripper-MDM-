import { ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { FastLink as Link } from '@/components/FastLink'
import ForceSummary from '@/components/ForceSummary'
import OperationPanel from '@/components/OperationPanel'
import ResolutionBanner from '@/components/ResolutionBanner'
import { SafetyBadge } from '@/components/SafetyPanel'
import SceneView from '@/components/SceneView'
import TelemetryTiles from '@/components/TelemetryTiles'
import { Card } from '@/components/ui'
import ForceGauge from '@/components/viz/ForceGauge'
import GripDiagram from '@/components/viz/GripDiagram'
import { toast } from '@/store/toast'
import { useApp } from '@/store/app'
import { useForces } from '@/store/derived'
import { useTelemetry } from '@/store/telemetry'

export default function Control() {
  const object = useApp((s) => s.resolution.object)
  const limits = useApp((s) => s.health?.limits)
  const selected = useApp((s) => s.selectedForce)
  const latest = useTelemetry((s) => s.latest)
  const f = useForces()
  const [saved, setSaved] = useState(0)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><h1 className="text-xl font-semibold">Gripper Control Dashboard</h1>
          <p className="text-sm text-slate-400">{object ? `${object.name} · ${object.mass_g} g · ${object.width_mm} mm wide` : 'No object resolved'}</p></div>
        <div className="flex items-center gap-3"><SafetyBadge safety={f.safety} /><Link to="/calibration" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">Adjust force <ArrowRight className="size-4" /></Link></div>
      </div>
      <ResolutionBanner />
      <div className="grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-8"><SceneView height="h-[26rem] lg:h-[32rem]" defaultView="cell" /></div>
        <div className="space-y-4 xl:col-span-4">
          <Card title="Pick-and-place" subtitle="Run, record and log an operation">
            <OperationPanel onSaved={() => { setSaved((n) => n + 1); toast({ tone: 'ok', title: 'Operation logged', body: 'See Calibration History → Operations to replay it.' }) }} />
            {saved > 0 && <p className="mt-2 text-xs text-ok">Saved {saved} operation(s) this session.</p>}
          </Card>
          <Card title="Grip force gauge" subtitle="Measured vs target and permitted window"><ForceGauge /></Card>
        </div>
      </div>
      <Card title="Forces"><ForceSummary /></Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Live sensor readings"><TelemetryTiles /></Card>
        {object && limits && <Card title="Free-body diagram" subtitle="At the selected target force"><GripDiagram object={object} limits={limits} force={selected} measured={latest?.object_detected === false ? null : latest?.measured_force_n ?? null} openingMm={latest?.finger_opening_mm ?? null} /></Card>}
      </div>
    </div>
  )
}
