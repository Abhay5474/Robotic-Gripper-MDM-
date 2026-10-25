import { Minus, Plus } from 'lucide-react'
import { useApp } from '@/store/app'
import { useForces } from '@/store/derived'
import { SafetyBadge } from './SafetyPanel'
import { Button, cx } from './ui'

const pct = (v: number, lo: number, hi: number) => `${Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100))}%`

/** The primary calibration control. Every marker is a different quantity; nothing here talks to hardware. */
export default function ForceSlider({ disabled }: { disabled?: boolean }) {
  const limits = useApp((s) => s.health?.limits)
  const mode = useApp((s) => s.settings.mode)
  const channel = useApp((s) => s.health?.command_channel)
  const setForce = useApp((s) => s.setForce)
  const nudge = useApp((s) => s.nudge)
  const settings = useApp((s) => s.settings)
  const f = useForces()
  if (!limits) return null
  const { min_force_n: lo, max_force_n: hi, force_step_n: step } = limits
  const off = disabled || f.selected == null
  const sa = f.safety
  const safe = sa?.safe_range_n
  const upper = sa?.upper_limit_n
  return (
    <div className="space-y-4" data-testid="force-slider">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400">Selected gripping force</div>
          <div className="font-mono text-5xl font-bold tabular-nums text-accent" data-testid="selected-force">
            {f.selected == null ? '—' : f.selected.toFixed(2)}<span className="ml-1.5 text-xl font-medium text-slate-400">N</span>
          </div>
          <div className="text-xs text-slate-400">{limits.force_definition.replace(/_/g, ' ')} · unit {limits.force_unit}</div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <SafetyBadge safety={sa} />
          <label className="flex items-center gap-2 text-xs text-slate-400">Exact value
            <input aria-label="Exact force value in newtons" type="number" inputMode="decimal" min={lo} max={hi} step={step} disabled={off} value={f.selected ?? ''}
              onChange={(e) => e.target.value !== '' && setForce(Number(e.target.value))}
              className="w-24 rounded-md border border-line bg-ink-900 px-2 py-1 font-mono text-sm text-slate-100 disabled:opacity-50" /> N
          </label>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button aria-label={`Decrease force by ${settings.coarseSteps * step} N`} disabled={off} onClick={() => nudge(-1, 'coarse')}>−{(settings.coarseSteps * step).toFixed(1)}</Button>
        <Button aria-label={`Decrease force by ${settings.fineSteps * step} N`} disabled={off} onClick={() => nudge(-1, 'fine')}><Minus className="size-4" /></Button>
        <div className="relative min-w-0 flex-1 pb-9 pt-2">
          <div className="pointer-events-none absolute inset-x-0 top-[22px] h-2.5 overflow-hidden rounded-full bg-ink-600" aria-hidden>
            {safe && <div className="absolute inset-y-0 bg-ok/50" style={{ left: pct(safe[0], lo, hi), width: `calc(${pct(safe[1], lo, hi)} - ${pct(safe[0], lo, hi)})` }} />}
            {upper != null && upper < hi && <div className="absolute inset-y-0 right-0 bg-bad/50" style={{ left: pct(upper, lo, hi) }} />}
          </div>
          <input aria-label="Gripping force (N)" className="force-range relative" type="range" min={lo} max={hi} step={step} disabled={off}
            value={f.selected ?? lo} onChange={(e) => setForce(Number(e.target.value))}
            aria-valuetext={f.selected == null ? 'no value' : `${f.selected} newtons`} />
          {[{ v: f.llm, c: 'bg-llm', l: 'LLM', up: false }, { v: f.calibrated, c: 'bg-cal', l: f.calibratedApplicable ? 'Calibrated' : 'Saved (not applied)', up: true }].map((m) =>
            m.v != null && (
              <div key={m.l} className="pointer-events-none absolute top-[14px] -translate-x-1/2" style={{ left: `calc(${pct(m.v, lo, hi)} * 1)` }}>
                <div className={cx('mx-auto h-[26px] w-0.5', m.c)} />
                <div className={cx('mt-1.5 -translate-y-0 whitespace-nowrap text-[11px] font-medium', m.up ? 'text-cal' : 'text-llm')}>{m.l} {m.v.toFixed(1)}</div>
              </div>
            ))}
        </div>
        <Button aria-label={`Increase force by ${settings.fineSteps * step} N`} disabled={off} onClick={() => nudge(1, 'fine')}><Plus className="size-4" /></Button>
        <Button aria-label={`Increase force by ${settings.coarseSteps * step} N`} disabled={off} onClick={() => nudge(1, 'coarse')}>+{(settings.coarseSteps * step).toFixed(1)}</Button>
      </div>

      <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 font-mono text-xs text-slate-400">
        <span>min {lo} N</span>
        <span>step {step} N</span>
        <span>max {hi} N {limits.limits_source === 'demo' && <b className="font-sans text-warn">(demo limits, not validated)</b>}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span><i className="mr-1 inline-block h-2 w-3 rounded-sm bg-ok/60" />estimated permitted range</span>
        <span><i className="mr-1 inline-block h-2 w-3 rounded-sm bg-bad/60" />above object/gripper limit</span>
      </div>
      <p className="rounded-md border border-line bg-ink-900/60 px-3 py-2 text-xs text-slate-300" data-testid="command-status">
        {mode === 'demo'
          ? 'Demo: the slider drives the software simulation only. No hardware exists in this mode.'
          : channel === 'rtdb'
            ? 'Live: the target is sent to Firebase only when you press Start test; the hardware must acknowledge it separately (acknowledgement is not assumed).'
            : 'Software target only - the physical gripper has NOT received this value (no hardware command channel is configured).'}
      </p>
    </div>
  )
}
