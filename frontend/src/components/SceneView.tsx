import { Camera, Maximize2, Minimize2, Orbit } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fmtMargin, graspBalance } from '@/lib/mechanics'
import type { ObjectProps, Telemetry } from '@/lib/types'
import { useApp } from '@/store/app'
import { useTelemetry } from '@/store/telemetry'
import ErrorBoundary from './ErrorBoundary'
import type { SceneApi, ViewName } from './GripperScene'
import { Spinner, cx } from './ui'
import GripDiagram from './viz/GripDiagram'

const GripperScene = lazy(() => import('./GripperScene'))

const VIEWS: { id: ViewName; label: string; short: string }[] = [
  { id: 'cell', label: 'Whole cell', short: 'Cell' },
  { id: 'gripper', label: 'Follow the gripper', short: 'Grip' },
  { id: 'front', label: 'Front', short: 'Front' },
  { id: 'side', label: 'Side', short: 'Side' },
  { id: 'top', label: 'Top', short: 'Top' },
]

const hasWebGL = () => {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')) } catch { return false }
}

export interface SceneViewProps {
  /** Replay a recorded sample instead of live/simulated telemetry. */
  override?: Partial<Telemetry> | null
  progress?: number | null
  object?: ObjectProps | null
  targetForce?: number | null
  height?: string
  defaultView?: ViewName
  autoRotate?: boolean
  /** Stop auto-rotation after this many seconds (an intro spin rather than a perpetual render loop). */
  autoRotateFor?: number
  compact?: boolean
}

export default function SceneView({ override, progress, object: objectProp, targetForce, height = 'h-80', defaultView = 'cell', autoRotate: rotate0 = false, autoRotateFor, compact = false }: SceneViewProps) {
  const live = useTelemetry((s) => s.latest)
  const source = useTelemetry((s) => s.source)
  const selected = useApp((s) => s.resolution.object)
  const limits = useApp((s) => s.health?.limits)
  const selForce = useApp((s) => s.selectedForce)
  const replay = override !== undefined
  const t: Partial<Telemetry> = (replay ? override : live) ?? {}
  const object = objectProp !== undefined ? objectProp : selected
  const target = targetForce !== undefined ? targetForce : selForce

  const [view, setView] = useState<ViewName>(defaultView)
  const [nonce, setNonce] = useState(0)
  const [rotate, setRotate] = useState(rotate0)
  useEffect(() => {
    if (!rotate0 || !autoRotateFor) return
    const id = setTimeout(() => setRotate(false), autoRotateFor * 1000)
    return () => clearTimeout(id)
  }, [rotate0, autoRotateFor])
  const [fs, setFs] = useState(false)
  const [fsFallback, setFsFallback] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const api = useRef<SceneApi | null>(null)
  const forceL = useRef<HTMLDivElement>(null), pickL = useRef<HTMLDivElement>(null), placeL = useRef<HTMLDivElement>(null), alertL = useRef<HTMLDivElement>(null)
  const labels = useMemo(() => ({ force: forceL, pick: pickL, place: placeL, alert: alertL }), [])
  const webgl = useMemo(hasWebGL, [])
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const el = box.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '120px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  const onApi = useCallback((a: SceneApi | null) => { api.current = a }, [])

  useEffect(() => {
    const on = () => setFs(document.fullscreenElement === box.current)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  useEffect(() => {
    if (!fsFallback) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setFsFallback(false)
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [fsFallback])
  const toggleFs = async () => {
    if (document.fullscreenElement) { await document.exitFullscreen().catch(() => {}); return }
    if (fsFallback) { setFsFallback(false); return }
    if (box.current?.requestFullscreen) await box.current.requestFullscreen().catch(() => setFsFallback(true))
    else setFsFallback(true)
  }
  const snapshot = () => {
    const url = api.current?.snapshot()
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = `gripsense-cell-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
    a.click()
  }

  const measured = t.measured_force_n ?? null
  const slip = t.slip_detected ?? null
  const over = object?.max_contact_force_n != null && measured != null && measured > object.max_contact_force_n
  // While nothing is being squeezed (0 N, or the sensor reports no object) the measured margin is meaningless,
  // so show the margin the target force would give, labelled as such.
  const inContact = measured != null && measured > 0 && t.object_detected !== false
  const marginForce = inContact ? measured : target
  const balance = object && limits && marginForce != null ? graspBalance(object, limits, marginForce) : null
  const tag = replay ? { text: 'REPLAY', cls: 'border-llm/50 bg-llm/15 text-llm' } : source === 'simulated' ? { text: 'SIMULATED', cls: 'border-warn/60 bg-warn/15 text-warn' } : { text: 'LIVE', cls: 'border-ok/60 bg-ok/15 text-ok' }
  const note = replay ? ['Replay of a recorded trace · arm pose is schematic', 'Replay · schematic arm']
    : source === 'simulated' ? ['Simulated cell · drag to orbit, scroll to zoom', 'Drag to orbit']
    : ['Arm pose is schematic (follows operation_state) · fingers & force from telemetry', 'Arm pose is schematic']
  const big = fs || fsFallback
  const chip = 'rounded-md border border-line/70 bg-ink-950/75 px-2 py-1 backdrop-blur-sm'

  const fallback = object && limits
    ? <div className="h-full overflow-auto p-3"><p className="mb-2 text-xs text-slate-400">3D view unavailable (WebGL could not start). Showing the 2D free-body diagram instead.</p><GripDiagram object={object} limits={limits} force={target} measured={inContact ? measured : null} openingMm={t.finger_opening_mm ?? null} compact /></div>
    : <div className="grid h-full place-items-center p-4 text-center text-sm text-slate-400">3D view unavailable (WebGL could not start).</div>

  return (
    <div ref={box} data-testid="scene-view"
      className={cx('group @container relative isolate overflow-hidden rounded-xl border border-line bg-ink-900', big ? (fsFallback ? 'fixed inset-0 z-[70] h-screen rounded-none' : 'h-screen rounded-none') : height)}>
      {!webgl ? fallback : (
        <ErrorBoundary fallback={fallback}>
          <Suspense fallback={<div className="grid h-full place-items-center"><Spinner label="Loading 3D view" /></div>}>
            <GripperScene object={object} openingMm={t.finger_opening_mm ?? null} maxOpeningMm={limits?.max_opening_mm ?? 120} state={t.operation_state ?? null}
              slip={slip} objectDetected={t.object_detected ?? null} measuredForce={measured} maxForce={limits?.max_force_n ?? 40}
              contactLimit={object?.max_contact_force_n ?? null} progress={progress} view={view} viewNonce={nonce} autoRotate={rotate}
              labels={labels} onApi={onApi} paused={!visible && !big} />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* projected labels (positioned every frame by the scene) */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden text-[11px] font-semibold">
        <div ref={labels.pick} className="absolute left-0 top-0 rounded bg-accent px-1.5 py-0.5 tracking-wider text-ink-950 opacity-0 shadow">PICK</div>
        <div ref={labels.place} className="absolute left-0 top-0 rounded bg-accent px-1.5 py-0.5 tracking-wider text-ink-950 opacity-0 shadow">PLACE</div>
        <div ref={labels.force} className={cx('absolute left-0 top-0 whitespace-nowrap opacity-0', chip)} data-testid="scene-force-label">
          <div className={cx('font-mono text-sm', over ? 'text-bad' : 'text-meas')}>{measured == null ? 'force n/a' : `${measured.toFixed(2)} N`}</div>
          <div className="font-normal text-slate-400">target {target != null ? `${target.toFixed(2)} N` : '—'}</div>
        </div>
        <div ref={labels.alert} className="absolute left-0 top-0 rounded-md bg-bad px-2 py-1 tracking-wider text-white opacity-0 shadow-lg">{slip ? 'SLIP DETECTED' : 'OVER CONTACT LIMIT'}</div>
      </div>

      {/* HUD */}
      <div className="pointer-events-none absolute left-2 top-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className={cx('rounded border px-1.5 py-0.5 font-bold tracking-wider', tag.cls)}>{tag.text}</span>
        <span className={cx(chip, 'font-mono text-slate-200')}>{t.operation_state ?? 'no state'}</span>
      </div>
      <div className="absolute right-2 top-2 flex items-center gap-1">
        {/* a dropdown in compact or narrow views (container query), view buttons when there is room */}
        <select aria-label="Camera view" value={view} onChange={(e) => { setView(e.target.value as ViewName); setNonce((n) => n + 1) }}
          className={cx(chip, 'cursor-pointer py-1 text-[11px] font-medium text-slate-200', !compact && '@md:hidden')}>
          {VIEWS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
        {!compact && (
          <div role="group" aria-label="Camera view buttons" className={cx(chip, 'hidden gap-0.5 p-0.5 @md:flex')}>
            {VIEWS.map((v) => (
              <button key={v.id} type="button" title={v.label} aria-pressed={view === v.id} onClick={() => { setView(v.id); setNonce((n) => n + 1) }}
                className={cx('rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors', view === v.id ? 'bg-accent text-ink-950' : 'text-slate-300 hover:text-slate-100')}>{v.short}</button>
            ))}
          </div>
        )}
        <button type="button" title={rotate ? 'Stop auto-rotate' : 'Auto-rotate'} aria-pressed={rotate} onClick={() => setRotate((r) => !r)} className={cx(chip, 'p-1.5', rotate ? 'text-accent' : 'text-slate-300 hover:text-slate-100')}><Orbit className="size-3.5" /></button>
        {webgl && <button type="button" title="Save a PNG snapshot" onClick={snapshot} className={cx(chip, 'p-1.5 text-slate-300 hover:text-slate-100')}><Camera className="size-3.5" /></button>}
        <button type="button" title={big ? 'Exit full screen (Esc)' : 'Full screen'} onClick={toggleFs} className={cx(chip, 'p-1.5 text-slate-300 hover:text-slate-100')}>{big ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}</button>
      </div>
      <div className="pointer-events-none absolute inset-x-2 bottom-2 flex items-end justify-between gap-2 text-[11px]">
        <div className="flex min-w-0 flex-wrap gap-1.5" data-testid="scene-readouts">
          <span className={chip}><span className="text-slate-400">opening </span><span className="font-mono text-slate-100">{t.finger_opening_mm == null ? 'unavailable' : `${t.finger_opening_mm.toFixed(1)} mm`}</span></span>
          <span className={chip}><span className="text-slate-400">force </span><span className={cx('font-mono', over ? 'text-bad' : 'text-meas')}>{measured == null ? 'unavailable' : `${measured.toFixed(2)} N`}</span></span>
          {balance && <span className={chip}><span className="text-slate-400">grip margin{inContact ? '' : ' (target)'} </span><span className={cx('font-mono', balance.tone === 'ok' ? 'text-ok' : balance.tone === 'warn' ? 'text-warn' : 'text-bad')}>{fmtMargin(balance.margin)}</span></span>}
        </div>
        {webgl && (
          <div className={cx(chip, 'min-w-0 max-w-[45%] text-right text-[10.5px] leading-snug text-slate-400')}>
            <span className={cx('whitespace-nowrap', !compact && '@lg:hidden')}>{note[1]}</span>
            {!compact && <span className="hidden @lg:inline">{note[0]}</span>}
          </div>
        )}
      </div>
    </div>
  )
}
