import { AlertOctagon, Ban, CheckCircle2, Lightbulb, Play, RefreshCw, TriangleAlert, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import ForceSlider from '@/components/ForceSlider'
import ForceSummary from '@/components/ForceSummary'
import ResolutionBanner from '@/components/ResolutionBanner'
import SafetyPanel from '@/components/SafetyPanel'
import SceneView from '@/components/SceneView'
import TelemetryTiles from '@/components/TelemetryTiles'
import { Banner, Button, Card, Spinner } from '@/components/ui'
import { fmtDate } from '@/lib/format'
import { summarizeAttempts, suggestNext } from '@/lib/suggest'
import AttemptsChart from '@/components/viz/AttemptsChart'
import ForceEnvelope from '@/components/viz/ForceEnvelope'
import { useApp } from '@/store/app'
import { useForces } from '@/store/derived'
import { useTelemetry } from '@/store/telemetry'

function ConfirmPanel({ onClose }: { onClose: () => void }) {
  const confirmSuccess = useApp((s) => s.confirmSuccess)
  const busy = useApp((s) => s.session?.busy)
  const allowOverride = useApp((s) => s.health?.allow_safety_override)
  const mode = useApp((s) => s.settings.mode)
  const f = useForces()
  const [held, setHeld] = useState(false), [noSlip, setNoSlip] = useState(false), [noDmg, setNoDmg] = useState(false)
  const [notes, setNotes] = useState(''), [reason, setReason] = useState('')
  const needsOverride = f.safety?.requires_override
  const ready = held && noSlip && noDmg && (!needsOverride || (allowOverride && reason.trim().length >= 5))
  return (
    <div className="space-y-3 rounded-lg border border-ok/40 bg-ok/5 p-4" data-testid="confirm-panel">
      <h3 className="text-sm font-semibold text-ok">Confirm successful grasp at {f.selected?.toFixed(2)} N</h3>
      <p className="text-xs text-slate-300">Only confirm after observing the physical gripper. Reaching the target force is <b>not</b> evidence of a good grasp.</p>
      {[[held, setHeld, 'The object was held and lifted'], [noSlip, setNoSlip, 'The object did not slip'], [noDmg, setNoDmg, 'The object was not damaged or put at risk']].map(([v, set, label]) => (
        <label key={label as string} className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-emerald-400" checked={v as boolean} onChange={(e) => (set as (b: boolean) => void)(e.target.checked)} />{label as string}</label>
      ))}
      {needsOverride && (allowOverride ? (
        <div><label className="mb-1 block text-xs text-warn" htmlFor="ov">This force is below the estimated holding requirement. Override reason (required):</label>
          <input id="ov" value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-md border border-warn/50 bg-ink-900 px-2.5 py-1.5 text-sm" /></div>
      ) : <Banner tone="bad">Below the estimated holding requirement and the override policy is disabled on the backend. This force cannot be saved as calibrated.</Banner>)}
      <textarea aria-label="Notes" placeholder="Optional notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full rounded-md border border-line bg-ink-900 px-2.5 py-1.5 text-sm" />
      <p className="text-xs text-slate-400">{mode === 'demo' ? 'Demo: this will be saved as a manually confirmed DEMO record.' : 'Saved as sensor-assisted only if fresh Firebase telemetry corroborates it; otherwise as manually confirmed.'}</p>
      <div className="flex gap-2">
        <Button variant="primary" disabled={!ready || busy} onClick={async () => { if (await confirmSuccess({ held, noSlip, noDamage: noDmg, notes, overrideReason: reason })) onClose() }}>{busy ? <Spinner /> : <CheckCircle2 className="size-4" />} Save calibrated force</Button>
        <Button variant="ghost" onClick={onClose}>Back</Button>
      </div>
    </div>
  )
}

export default function Calibration() {
  const res = useApp((s) => s.resolution)
  const session = useApp((s) => s.session)
  const starting = useApp((s) => s.starting)
  const commandNote = useApp((s) => s.commandNote)
  const startTest = useApp((s) => s.startTest)
  const mark = useApp((s) => s.mark)
  const endSession = useApp((s) => s.endSession)
  const resolve = useApp((s) => s.resolve)
  const mode = useApp((s) => s.settings.mode)
  const selected = useApp((s) => s.selectedForce)
  const simHint = useTelemetry((s) => s.simHint)
  const simRunning = useTelemetry((s) => s.simRunning)
  const f = useForces()
  const [confirming, setConfirming] = useState(false)
  const limits = useApp((s) => s.health?.limits)
  const setForce = useApp((s) => s.setForce)
  const suggestion = useMemo(() => (session && limits ? suggestNext(summarizeAttempts(session.events), limits, f.safety) : null), [session, limits, f.safety])

  const last = session?.events[session.events.length - 1]
  const tested = last?.event === 'test_started' && selected != null && Math.abs(last.force - selected) < 1e-6
  const forceChangedSinceTest = last?.event === 'test_started' && !tested
  const canTest = !!f.safety?.can_test && res.status === 'ready' && !starting && !simRunning && !res.usingCached
  const canConfirm = tested && !!f.safety && (f.safety.can_save_as_calibrated || f.safety.requires_override)
  useEffect(() => { if (!tested) setConfirming(false) }, [tested])

  if (res.status === 'idle' || res.status === 'loading' || (res.status === 'error' && !res.usingCached)) {
    return <div className="space-y-4"><h1 className="text-xl font-semibold">Force Prediction &amp; Calibration</h1><ResolutionBanner /></div>
  }
  const object = res.object!
  const pred = res.data?.prediction

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Force Prediction &amp; Calibration</h1>
          <p className="text-sm text-slate-400">{object.name} · {object.mass_g} g · {object.width_mm}×{object.height_mm}×{object.depth_mm} mm · μ≈{object.friction_coefficient} · <span className="font-mono text-xs">{res.data?.configuration_key}</span></p>
        </div>
        {!session && <Button onClick={() => resolve({ regenerate: true })} disabled={res.status !== 'ready' && !res.usingCached} title="Ask the LLM again. A saved calibration is never overwritten."><RefreshCw className="size-4" />Regenerate LLM recommendation</Button>}
      </div>

      <ResolutionBanner />
      <Card><ForceSummary /></Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Force adjustment" subtitle="Primary calibration control. Adjust, test on the gripper, repeat.">
            <ForceSlider disabled={res.status !== 'ready' && !res.usingCached} />
          </Card>

          <Card title="Force envelope" subtitle="Limits, estimated windows, the four forces and every test on one axis."><ForceEnvelope /></Card>

          <Card title="Calibration test" subtitle={session ? `Session ${session.record.calibration_id}` : 'A logged session starts when you press Start test.'}>
            <div className="space-y-4">
              {commandNote && <Banner tone="warn" icon={<TriangleAlert className="size-4" />}>{commandNote}</Banner>}
              {session?.error && <Banner tone="bad" icon={<AlertOctagon className="size-4" />}>{session.error}</Banner>}
              {forceChangedSinceTest && <Banner tone="warn">The force changed since the last test. Start a new test at {selected?.toFixed(2)} N before confirming.</Banner>}
              {f.safety && !f.safety.can_test && <Banner tone="bad" icon={<Ban className="size-4" />}>Testing is blocked: {f.safety.summary}</Banner>}
              {f.safety?.status === 'no_safe_range' && <Banner tone="bad">No safe operating range can be established; this configuration cannot be marked calibrated.</Banner>}
              {mode === 'demo' && simHint && !simRunning && (
                <Banner tone="neutral">Simulated run finished: <b>{simHint}</b>. This is a software hint only - you must still judge and confirm the result yourself.</Banner>
              )}

              {suggestion && (
                <Banner tone={suggestion.force == null ? 'warn' : 'neutral'} icon={<Lightbulb className="size-4" />}
                  action={suggestion.force != null && suggestion.force !== selected ? <Button onClick={() => setForce(suggestion.force as number)} data-testid="apply-suggestion">Set slider to {suggestion.force.toFixed(2)} N</Button> : undefined}>
                  <b>{suggestion.force == null ? 'No further force to try.' : `Suggested next test: ${suggestion.force.toFixed(2)} N.`}</b> {suggestion.reason}. <span className="text-slate-400">A suggestion only - nothing changes until you apply it and start a test.</span>
                </Banner>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" disabled={!canTest} onClick={startTest} data-testid="start-test">{starting ? <Spinner /> : <Play className="size-4" />} Start test at {selected?.toFixed(2) ?? '—'} N</Button>
                <Button variant="primary" className="!bg-ok hover:brightness-110" disabled={!canConfirm || confirming} onClick={() => setConfirming(true)} data-testid="confirm-success" title={canConfirm ? '' : 'Run a test at the selected force first'}><CheckCircle2 className="size-4" /> Confirm successful grasp</Button>
                <Button variant="warn" disabled={!tested} onClick={() => mark('slipped')}>Object slipping</Button>
                <Button variant="warn" disabled={!tested} onClick={() => mark('damage_risk')}>Damaged / at risk</Button>
                <Button variant="danger" disabled={!tested} onClick={() => mark('failed')}><XCircle className="size-4" /> Test failed</Button>
                {session && <Button variant="ghost" onClick={() => { if (window.confirm('Cancel this calibration? The saved calibration (if any) stays active.')) void endSession('cancelled') }}>Cancel calibration</Button>}
                {session && session.events.some((e) => e.event !== 'test_started') && <Button variant="ghost" onClick={() => void endSession('failed')}>End session as failed</Button>}
              </div>
              <p className="text-xs text-slate-500">Slipping → increase the force and test again. Damage/risk → decrease it. Force is never raised automatically, and values above the gripper or object limit are rejected.</p>
              {confirming && <ConfirmPanel onClose={() => setConfirming(false)} />}

              {session && session.events.length > 0 && (
                <ol className="space-y-1 border-t border-line pt-3 text-sm" aria-label="Test log">
                  {session.events.map((e, i) => (
                    <li key={i} className="flex justify-between gap-3 font-mono text-xs"><span className={e.event === 'test_started' ? 'text-accent' : 'text-warn'}>{i + 1}. {e.event.replace('_', ' ')}</span><span>{e.force.toFixed(2)} N · {new Date(e.at).toLocaleTimeString()}</span></li>
                  ))}
                </ol>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Safety &amp; feasibility"><SafetyPanel safety={f.safety} /></Card>
          <Card title="Test attempts" subtitle="Convergence of the force across tests"><AttemptsChart /></Card>
          <Card title="Live feedback"><div className="space-y-3"><SceneView height="h-52" /><TelemetryTiles /></div></Card>
        </div>
      </div>

      {pred && (
        <Card title="LLM recommendation details" subtitle="Initial estimate only - not validated or guaranteed safe.">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-slate-400">Recommended</dt><dd className="font-mono text-llm">{pred.llm_recommended_force} N · {pred.force_definition.replace(/_/g, ' ')}</dd></div>
            <div><dt className="text-xs text-slate-400">Confidence (self-reported)</dt><dd>{pred.confidence}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs text-slate-400">Rationale</dt><dd className="text-slate-200">{pred.rationale}</dd></div>
            {pred.assumptions.length > 0 && <div><dt className="text-xs text-slate-400">Assumptions</dt><dd><ul className="list-inside list-disc text-slate-300">{pred.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></dd></div>}
            {pred.llm_warnings.length > 0 && <div><dt className="text-xs text-warn">LLM warnings</dt><dd><ul className="list-inside list-disc text-warn">{pred.llm_warnings.map((a) => <li key={a}>{a}</li>)}</ul></dd></div>}
            <div className="sm:col-span-2 text-xs text-slate-500">{pred.model_identifier} · prompt {pred.prompt_version} · {fmtDate(pred.created_at)} · {pred.persisted ? `saved as ${pred.prediction_id}` : 'not saved'}</div>
          </dl>
        </Card>
      )}
    </div>
  )
}
