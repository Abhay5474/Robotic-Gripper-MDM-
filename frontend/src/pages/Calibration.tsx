import { AlertOctagon, Ban, CheckCircle2, Keyboard, Lightbulb, Play, RefreshCw, TriangleAlert, XCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import ForceSlider from '@/components/ForceSlider'
import ForceSummary from '@/components/ForceSummary'
import ResolutionBanner from '@/components/ResolutionBanner'
import SafetyPanel from '@/components/SafetyPanel'
import SceneView from '@/components/SceneView'
import TelemetryTiles from '@/components/TelemetryTiles'
import WorkflowStepper from '@/components/WorkflowStepper'
import { Banner, Button, Card, Kbd, Modal, Spinner, cx } from '@/components/ui'
import AttemptsChart from '@/components/viz/AttemptsChart'
import ForceEnvelope from '@/components/viz/ForceEnvelope'
import GripDiagram from '@/components/viz/GripDiagram'
import { fmtDate } from '@/lib/format'
import { summarizeAttempts, suggestNext } from '@/lib/suggest'
import { useHotkeys } from '@/lib/useHotkeys'
import { currentStep } from '@/lib/workflow'
import { useApp } from '@/store/app'
import { useForces } from '@/store/derived'
import { useTelemetry } from '@/store/telemetry'
import { toast } from '@/store/toast'

function ConfirmDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const confirmSuccess = useApp((s) => s.confirmSuccess)
  const busy = useApp((s) => s.session?.busy)
  const error = useApp((s) => s.session?.error)
  const allowOverride = useApp((s) => s.health?.allow_safety_override)
  const mode = useApp((s) => s.settings.mode)
  const name = useApp((s) => s.resolution.object?.name)
  const f = useForces()
  const [held, setHeld] = useState(false), [noSlip, setNoSlip] = useState(false), [noDmg, setNoDmg] = useState(false)
  const [notes, setNotes] = useState(''), [reason, setReason] = useState('')
  useEffect(() => { if (open) { setHeld(false); setNoSlip(false); setNoDmg(false); setNotes(''); setReason('') } }, [open])
  const needsOverride = f.safety?.requires_override
  const ready = held && noSlip && noDmg && (!needsOverride || (allowOverride && reason.trim().length >= 5))
  const save = async () => {
    const force = f.selected
    if (await confirmSuccess({ held, noSlip, noDamage: noDmg, notes, overrideReason: reason })) {
      onClose()
      toast({ tone: 'ok', title: 'Calibration saved', body: `${force?.toFixed(2)} N is now the active calibration for ${name}. It will be reused automatically.` })
    }
  }
  const checks: [boolean, (b: boolean) => void, string][] = [
    [held, setHeld, 'The object was held and lifted'], [noSlip, setNoSlip, 'The object did not slip'], [noDmg, setNoDmg, 'The object was not damaged or put at risk'],
  ]
  return (
    <Modal open={open} onClose={onClose} title={<>Confirm a successful grasp at <span className="font-mono text-ok">{f.selected?.toFixed(2)} N</span></>} testId="confirm-panel">
      <div className="space-y-3">
        <p className="text-sm text-slate-300">Only confirm what you observed on the gripper. Reaching the target force is <b>not</b> evidence of a good grasp.</p>
        <div className="space-y-2 rounded-lg border border-line bg-ink-900/60 p-3">
          {checks.map(([v, set, label]) => (
            <label key={label} className="flex cursor-pointer items-center gap-2.5 text-sm"><input type="checkbox" className="size-4 accent-emerald-500" checked={v} onChange={(e) => set(e.target.checked)} />{label}</label>
          ))}
        </div>
        {needsOverride && (allowOverride ? (
          <div><label className="mb-1 block text-xs text-warn" htmlFor="ov">This force is below the estimated holding requirement. Override reason (required):</label>
            <input id="ov" value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-md border border-warn/50 bg-ink-900 px-2.5 py-1.5 text-sm" /></div>
        ) : <Banner tone="bad">Below the estimated holding requirement and the override policy is disabled on the backend. This force cannot be saved as calibrated.</Banner>)}
        <textarea aria-label="Notes" placeholder="Optional notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full rounded-md border border-line bg-ink-900 px-2.5 py-1.5 text-sm" />
        <p className="text-xs text-slate-400">{mode === 'demo' ? 'Demo: saved as a manually confirmed DEMO record.' : 'Saved as sensor-assisted only if fresh Firebase telemetry corroborates it; otherwise as manually confirmed.'}</p>
        {error && <Banner tone="bad">{error}</Banner>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Back</Button>
          <Button variant="primary" className="!bg-ok" disabled={!ready || busy} onClick={save}>{busy ? <Spinner /> : <CheckCircle2 className="size-4" />} Save calibrated force</Button>
        </div>
      </div>
    </Modal>
  )
}

function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rows: [string, string][] = [['T', 'Start test at the selected force'], ['C', 'Confirm a successful grasp'], ['S', 'Mark: object slipping'], ['D', 'Mark: damaged / at risk'], ['F', 'Mark: test failed'], ['← →', 'Adjust force by one step'], ['Shift + ← →', 'Adjust force by the coarse step'], ['?', 'Show this help']]
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" labelledBy="kbd-title">
      <dl className="space-y-1.5 text-sm">{rows.map(([k, v]) => <div key={k} className="flex justify-between gap-6"><dt className="text-slate-300">{v}</dt><dd><kbd className="rounded border border-line bg-ink-900 px-1.5 py-0.5 font-mono text-xs">{k}</kbd></dd></div>)}</dl>
      <p className="mt-3 text-xs text-slate-500">Shortcuts are ignored while typing in a field. Nothing is ever tested automatically.</p>
    </Modal>
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
  const nudge = useApp((s) => s.nudge)
  const mode = useApp((s) => s.settings.mode)
  const selected = useApp((s) => s.selectedForce)
  const limits = useApp((s) => s.health?.limits)
  const setForce = useApp((s) => s.setForce)
  const simHint = useTelemetry((s) => s.simHint)
  const simRunning = useTelemetry((s) => s.simRunning)
  const latest = useTelemetry((s) => s.latest)
  const f = useForces()
  const [confirming, setConfirming] = useState(false)
  const [help, setHelp] = useState(false)
  const suggestion = useMemo(() => (session && limits ? suggestNext(summarizeAttempts(session.events), limits, f.safety) : null), [session, limits, f.safety])

  const last = session?.events[session.events.length - 1]
  const tested = last?.event === 'test_started' && selected != null && Math.abs(last.force - selected) < 1e-6
  const forceChangedSinceTest = last?.event === 'test_started' && !tested
  const canTest = !!f.safety?.can_test && res.status === 'ready' && !starting && !simRunning && !res.usingCached
  const canConfirm = tested && !!f.safety && (f.safety.can_save_as_calibrated || f.safety.requires_override)
  useEffect(() => { if (!tested) setConfirming(false) }, [tested])
  const step = currentStep({ resolution: res.status, usingCached: res.usingCached, hasSession: !!session, testedAtSelected: !!tested, calibratedApplied: f.state === 'calibrated' })

  const markAndNotify = useCallback(async (ev: 'slipped' | 'damage_risk' | 'failed') => {
    await mark(ev)
    const msg = { slipped: 'Slip recorded - raise the force and test again.', damage_risk: 'Damage risk recorded - lower the force and test again.', failed: 'Test marked as failed.' }[ev]
    toast({ tone: ev === 'failed' ? 'bad' : 'warn', title: msg })
  }, [mark])

  useHotkeys({
    t: () => canTest && void startTest(),
    c: () => canConfirm && setConfirming(true),
    s: () => tested && void markAndNotify('slipped'),
    d: () => tested && void markAndNotify('damage_risk'),
    f: () => tested && void markAndNotify('failed'),
    ArrowRight: () => nudge(1, 'fine'), ArrowLeft: () => nudge(-1, 'fine'),
    'shift+ArrowRight': () => nudge(1, 'coarse'), 'shift+ArrowLeft': () => nudge(-1, 'coarse'),
    '?': () => setHelp(true),
  }, res.status === 'ready' || res.usingCached)

  if (res.status === 'idle' || res.status === 'loading' || (res.status === 'error' && !res.usingCached)) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Force Prediction &amp; Calibration</h1>
        <WorkflowStepper step={step} detail={{ 2: res.status === 'loading' ? 'looking up…' : undefined }} />
        <ResolutionBanner />
      </div>
    )
  }
  const object = res.object!
  const pred = res.data?.prediction
  const statusLine = !session
    ? (f.state === 'calibrated' ? `Saved calibration ${selected?.toFixed(2)} N loaded. Test it again to recalibrate, or run operations.` : `Ready to test ${selected?.toFixed(2) ?? '—'} N on the gripper.`)
    : tested ? `Tested ${selected?.toFixed(2)} N - record what you observed.` : forceChangedSinceTest ? `Force changed to ${selected?.toFixed(2)} N - start a new test before confirming.` : 'Adjust the force and start the next test.'

  return (
    <div className="space-y-4 pb-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">Force Prediction &amp; Calibration</h1>
          <p className="truncate text-sm text-slate-400">{object.name} · {object.mass_g} g · {object.width_mm}×{object.height_mm}×{object.depth_mm} mm · μ≈{object.friction_coefficient} · <span className="font-mono text-xs">{res.data?.configuration_key}</span></p>
        </div>
        <div className="flex gap-2">
          <span className="hidden sm:contents"><Button variant="ghost" onClick={() => setHelp(true)} title="Keyboard shortcuts (?)"><Keyboard className="size-4" />Shortcuts</Button></span>
          {!session && <Button onClick={() => resolve({ regenerate: true })} disabled={res.status !== 'ready' && !res.usingCached} aria-label="Regenerate LLM recommendation" title="Ask the LLM again. A saved calibration is never overwritten."><RefreshCw className="size-4" /><span className="sm:hidden">Regenerate</span><span className="hidden sm:inline">Regenerate LLM recommendation</span></Button>}
        </div>
      </div>

      <WorkflowStepper step={step} detail={{
        1: object.name, 2: res.data?.source === 'calibration' ? 'saved calibration' : res.usingCached ? 'cached locally' : 'LLM estimate',
        3: session ? `${summarizeAttempts(session.events).length} test(s)` : undefined, 5: f.state === 'calibrated' ? `${f.calibrated?.toFixed(2)} N active` : undefined,
      }} />
      <ResolutionBanner />
      <Card><ForceSummary /></Card>

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-7">
          <Card title="Force adjustment" subtitle="Primary calibration control. Adjust, test on the gripper, repeat.">
            <ForceSlider disabled={res.status !== 'ready' && !res.usingCached} />
          </Card>
          <Card title="Force envelope" subtitle="Limits, estimated windows, the four forces and every test on one axis."><ForceEnvelope /></Card>
          <Card title="Test session" subtitle={session ? `Session ${session.record.calibration_id}` : 'A logged session starts when you press Start test.'}>
            <div className="space-y-3">
              {commandNote && <Banner tone="warn" icon={<TriangleAlert className="size-4" />}>{commandNote}</Banner>}
              {session?.error && !confirming && <Banner tone="bad" icon={<AlertOctagon className="size-4" />}>{session.error}</Banner>}
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
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-medium text-slate-400">Test log</div>
                  {session && session.events.length > 0 ? (
                    <ol className="max-h-48 space-y-1 overflow-auto pr-1 text-sm" aria-label="Test log">
                      {session.events.map((e, i) => (
                        <li key={i} className="flex items-center justify-between gap-3 rounded-md bg-ink-900/50 px-2 py-1 font-mono text-xs">
                          <span className={cx('flex items-center gap-1.5', e.event === 'test_started' ? 'text-accent' : e.event === 'slipped' ? 'text-warn' : 'text-bad')}>
                            <span className="text-slate-500">{i + 1}.</span>{e.event.replace('_', ' ')}
                          </span>
                          <span className="text-slate-300">{e.force.toFixed(2)} N · {new Date(e.at).toLocaleTimeString()}</span>
                        </li>
                      ))}
                    </ol>
                  ) : <p className="text-sm text-slate-500">No tests yet.</p>}
                </div>
                <div><div className="mb-1 text-xs font-medium text-slate-400">Convergence</div><AttemptsChart /></div>
              </div>
              <p className="text-xs text-slate-500">Slipping → increase the force and test again. Damage/risk → decrease it. Force is never raised automatically, and values above the gripper or object limit are rejected.</p>
            </div>
          </Card>
        </div>

        <div className="space-y-4 xl:col-span-5">
          <div className="xl:sticky xl:top-20 space-y-4">
            <Card title="Live feedback" subtitle="Follows the gripper; switch to Cell to see the whole pick-and-place">
              <div className="space-y-3"><SceneView height="h-72" defaultView="gripper" compact /><TelemetryTiles /></div>
            </Card>
            {limits && <Card title="Free-body diagram" subtitle="Normal force, friction at the pads and the design load"><GripDiagram object={object} limits={limits} force={selected} measured={latest?.measured_force_n ?? null} openingMm={latest?.finger_opening_mm ?? null} compact /></Card>}
            <Card title="Safety &amp; feasibility"><SafetyPanel safety={f.safety} showMargin={false} /></Card>
          </div>
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
            <div className="text-xs text-slate-500 sm:col-span-2">{pred.model_identifier} · prompt {pred.prompt_version} · {fmtDate(pred.created_at)} · {pred.persisted ? `saved as ${pred.prediction_id}` : 'not saved'}</div>
          </dl>
        </Card>
      )}

      {/* sticky action bar: the controls are always one click away */}
      <div className="sticky bottom-3 z-30" data-testid="action-bar">
        {/* message on its own row (never squeezed), buttons on one row; single row only on very wide screens */}
        <div className="flex flex-col gap-2 rounded-2xl border border-line bg-ink-800/90 p-2.5 shadow-2xl backdrop-blur-md 2xl:flex-row 2xl:items-center">
          <p className="min-w-0 px-1 text-xs text-slate-300 sm:text-sm 2xl:flex-1" aria-live="polite">{statusLine}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={!canTest} onClick={startTest} data-testid="start-test" aria-label={`Start test at ${selected?.toFixed(2) ?? '—'} N`}>{starting ? <Spinner /> : <Play className="size-4" />}<span className="hidden sm:inline">Start test ·</span><span className="sm:hidden">Test</span> {selected?.toFixed(2) ?? '—'} N<Kbd>T</Kbd></Button>
            <Button variant="primary" className="!bg-ok hover:brightness-110" disabled={!canConfirm || confirming} onClick={() => setConfirming(true)} data-testid="confirm-success" aria-label="Confirm successful grasp" title={canConfirm ? '' : 'Run a test at the selected force first'}><CheckCircle2 className="size-4" /> Confirm<span className="hidden sm:inline"> grasp</span><Kbd>C</Kbd></Button>
            {/* outcome buttons: always visible (disabled) on larger screens; on phones only once there is a test to judge */}
            <span className={tested ? 'contents' : 'hidden sm:contents'}>
              <span className="hidden h-6 w-px bg-line sm:block" aria-hidden />
              <Button variant="warn" disabled={!tested} onClick={() => void markAndNotify('slipped')} aria-label="Object slipping">Slipping<Kbd>S</Kbd></Button>
              <Button variant="warn" disabled={!tested} onClick={() => void markAndNotify('damage_risk')} aria-label="Damaged / at risk">Damage risk<Kbd>D</Kbd></Button>
              <Button variant="danger" disabled={!tested} onClick={() => void markAndNotify('failed')} aria-label="Test failed"><XCircle className="size-4" /> Failed<Kbd>F</Kbd></Button>
            </span>
            {session && <Button variant="ghost" aria-label="Cancel calibration" onClick={() => { if (window.confirm('Cancel this calibration? The saved calibration (if any) stays active.')) { void endSession('cancelled'); toast({ tone: 'neutral', title: 'Calibration cancelled' }) } }}>Cancel</Button>}
            {session && session.events.some((e) => e.event !== 'test_started') && <Button variant="ghost" aria-label="End session as failed" onClick={() => void endSession('failed')}>End as failed</Button>}
          </div>
        </div>
      </div>

      <ConfirmDialog open={confirming} onClose={() => setConfirming(false)} />
      <ShortcutHelp open={help} onClose={() => setHelp(false)} />
    </div>
  )
}
