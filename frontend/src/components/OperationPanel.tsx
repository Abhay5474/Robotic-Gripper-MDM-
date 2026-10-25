import { CircleStop, Circle, Play, Save } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { OperationRecord, TraceRow } from '@/lib/types'
import { useApp } from '@/store/app'
import { useForces } from '@/store/derived'
import { useTelemetry } from '@/store/telemetry'
import { Banner, Button, Spinner, cx } from './ui'

const STEPS = ['approaching', 'closing', 'holding', 'lifting', 'transporting', 'releasing', 'complete']
type Result = OperationRecord['operation_result']
interface Pending { trace: TraceRow[]; duration: number; peak: number | null; hint: string | null }

export function StateStepper() {
  const state = useTelemetry((s) => s.latest?.operation_state)
  const idx = state ? STEPS.indexOf(state) : -1
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label="Operation state">
      {STEPS.map((s, i) => (
        <li key={s} className={cx('rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize', i === idx ? 'border-accent bg-accent/20 text-accent' : i < idx ? 'border-ok/40 text-ok/80' : 'border-line text-slate-500')}>{s}</li>
      ))}
      {state && idx < 0 && <li className="rounded-full border border-warn/50 px-2.5 py-1 text-[11px] font-medium text-warn">{state}</li>}
    </ol>
  )
}

export default function OperationPanel({ onSaved }: { onSaved?: () => void }) {
  const mode = useApp((s) => s.settings.mode)
  const res = useApp((s) => s.resolution)
  const selected = useApp((s) => s.selectedForce)
  const session = useApp((s) => s.session)
  const f = useForces()
  const { simRunning, simHint, recording, runSim, abortSim, startRecording, stopRecording, source, latest } = useTelemetry()
  const [pending, setPending] = useState<Pending | null>(null)
  const [result, setResult] = useState<Result>('success')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const wasRunning = useRef(false)

  // demo: when the simulated run ends, collect its trace for logging
  useEffect(() => {
    if (mode === 'demo' && wasRunning.current && !simRunning) {
      const trace = stopRecording()
      const peak = trace.reduce<number | null>((m, r) => (r.f != null && (m == null || r.f > m) ? r.f : m), null)
      setPending({ trace, duration: trace.at(-1)?.t ?? 0, peak, hint: simHint })
      setResult(simHint === 'success' ? 'success' : simHint === 'slipped' ? 'slipped' : simHint === 'overforce' ? 'damaged' : 'aborted')
    }
    wasRunning.current = simRunning
  }, [simRunning, simHint, mode, stopRecording])

  const ready = res.status === 'ready' && selected != null && !!res.object && !!f.safety?.can_test && !session
  const stopLive = () => {
    const trace = stopRecording()
    const peak = trace.reduce<number | null>((m, r) => (r.f != null && (m == null || r.f > m) ? r.f : m), null)
    setPending({ trace, duration: trace.at(-1)?.t ?? 0, peak, hint: null }); setResult('success')
  }
  const save = async () => {
    if (!res.data || !res.object || selected == null || !pending) return
    setSaving(true); setErr(null)
    try {
      await api.recordOperation(mode, {
        object_id: res.object.object_id, configuration_key: res.data.configuration_key, selected_force_n: selected,
        calibration_id: f.calibratedApplicable ? f.calibratedRecord?.calibration_id : undefined,
        calibration_status: f.state === 'calibrated' || f.state === 'cached' ? 'calibrated' : 'uncalibrated',
        operation_result: result, duration_s: Number(pending.duration.toFixed(2)), peak_measured_force_n: pending.peak ?? undefined,
        data_source: mode === 'demo' ? 'simulated' : pending.trace.length ? 'firebase_live' : 'manual', notes: notes || undefined,
        trace: pending.trace.length ? pending.trace : undefined,
      })
      setPending(null); setNotes(''); onSaved?.()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setSaving(false) }
  }

  return (
    <div className="space-y-3">
      <StateStepper />
      {f.state !== 'calibrated' && f.state !== 'cached' && <Banner tone="warn">Running with an <b>uncalibrated</b> force ({f.stateLabel}). Calibrate on the Force &amp; Calibration page for a verified value.</Banner>}
      {!pending && (
        <div className="flex flex-wrap items-center gap-2">
          {mode === 'demo' ? (
            simRunning
              ? <Button variant="danger" onClick={abortSim}><CircleStop className="size-4" />Abort simulation</Button>
              : <Button variant="primary" disabled={!ready || source !== 'simulated'} onClick={() => res.object && selected != null && runSim(res.object, selected)} data-testid="run-sim"><Play className="size-4" />Run simulated pick-and-place at {selected?.toFixed(2) ?? '—'} N</Button>
          ) : recording.active
            ? <Button variant="danger" onClick={stopLive}><CircleStop className="size-4" />Stop recording &amp; log</Button>
            : <Button variant="primary" disabled={!ready || !latest} onClick={startRecording}><Circle className="size-4" />Start recording telemetry</Button>}
          <span className="text-xs text-slate-400">{mode === 'demo' ? 'Software simulation only.' : 'The app cannot move the gripper: run the operation on the hardware while recording.'}</span>
        </div>
      )}
      {pending && (
        <div className="space-y-3 rounded-lg border border-line bg-ink-900/60 p-3" data-testid="log-operation">
          <h3 className="text-sm font-semibold">Log operation result</h3>
          <p className="text-xs text-slate-400">{pending.trace.length} samples · {pending.duration.toFixed(1)} s · peak {pending.peak?.toFixed(2) ?? 'unavailable'} N{pending.hint && ` · simulation suggests “${pending.hint}” (you decide)`}</p>
          <div className="flex flex-wrap gap-3 text-sm">
            {(['success', 'slipped', 'damaged', 'failed', 'aborted'] as Result[]).map((r) => (
              <label key={r} className="flex items-center gap-1.5 capitalize"><input type="radio" name="op-result" checked={result === r} onChange={() => setResult(r)} />{r}</label>
            ))}
          </div>
          <input aria-label="Operation notes" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-md border border-line bg-ink-900 px-2.5 py-1.5 text-sm" />
          {err && <Banner tone="bad">{err}</Banner>}
          <div className="flex gap-2"><Button variant="primary" disabled={saving} onClick={save}>{saving ? <Spinner /> : <Save className="size-4" />}Save operation</Button><Button variant="ghost" onClick={() => setPending(null)}>Discard</Button></div>
        </div>
      )}
    </div>
  )
}
