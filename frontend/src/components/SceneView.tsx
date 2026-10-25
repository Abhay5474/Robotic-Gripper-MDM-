import { lazy, Suspense } from 'react'
import { useApp } from '@/store/app'
import { useTelemetry } from '@/store/telemetry'
import { SimTag } from './ModeBadge'
import { Spinner } from './ui'
import type { Telemetry } from '@/lib/types'

const GripperScene = lazy(() => import('./GripperScene'))

export default function SceneView({ override, height = 'h-72' }: { override?: Partial<Telemetry> | null; height?: string }) {
  const live = useTelemetry((s) => s.latest)
  const source = useTelemetry((s) => s.source)
  const object = useApp((s) => s.resolution.object)
  const limits = useApp((s) => s.health?.limits)
  const force = useApp((s) => s.selectedForce)
  const t = { ...live, ...override } as Partial<Telemetry>
  const ratio = limits && t.measured_force_n != null ? Math.min(1, t.measured_force_n / limits.max_force_n) : 0
  void force
  return (
    <div className={`relative overflow-hidden rounded-lg border border-line ${height}`}>
      <Suspense fallback={<div className="grid h-full place-items-center"><Spinner label="Loading 3D view" /></div>}>
        <GripperScene object={object} openingMm={t.finger_opening_mm ?? null} maxOpeningMm={limits?.max_opening_mm ?? 120} state={t.operation_state ?? null}
          slip={t.slip_detected ?? null} objectDetected={t.object_detected ?? null} forceRatio={ratio} />
      </Suspense>
      <div className="pointer-events-none absolute left-2 top-2 flex gap-2 text-[11px]">
        {source === 'simulated' && <SimTag />}
        <span className="rounded bg-ink-950/70 px-1.5 py-0.5 text-slate-300">{t.operation_state ?? 'no state'}</span>
      </div>
      {t.finger_opening_mm == null && <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-ink-950/80 px-2 py-1 text-[11px] text-slate-400">Finger opening unavailable - fingers shown fully open</div>}
    </div>
  )
}
