import { useState } from 'react'
import { Link } from 'react-router-dom'
import ForceSummary from '@/components/ForceSummary'
import OperationPanel from '@/components/OperationPanel'
import ResolutionBanner from '@/components/ResolutionBanner'
import SceneView from '@/components/SceneView'
import TelemetryTiles from '@/components/TelemetryTiles'
import { Card } from '@/components/ui'
import { SafetyBadge } from '@/components/SafetyPanel'
import { useApp } from '@/store/app'
import { useForces } from '@/store/derived'

export default function Control() {
  const object = useApp((s) => s.resolution.object)
  const f = useForces()
  const [saved, setSaved] = useState(0)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><h1 className="text-xl font-semibold">Gripper Control Dashboard</h1>
          <p className="text-sm text-slate-400">{object ? `${object.name} · ${object.mass_g} g · ${object.width_mm} mm wide` : 'No object resolved'}</p></div>
        <div className="flex items-center gap-3"><SafetyBadge safety={f.safety} /><Link to="/calibration" className="text-sm font-medium text-accent hover:underline">Adjust force →</Link></div>
      </div>
      <ResolutionBanner />
      <Card><ForceSummary /></Card>
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3" title="Gripper view"><SceneView height="h-80" /></Card>
        <Card className="lg:col-span-2" title="Pick-and-place" subtitle="Run, record and log an operation"><OperationPanel onSaved={() => setSaved((n) => n + 1)} />{saved > 0 && <p className="mt-2 text-xs text-ok">Saved {saved} operation(s) this session - see Calibration History.</p>}</Card>
      </div>
      <Card title="Live sensor readings"><TelemetryTiles /></Card>
    </div>
  )
}
