import { Bot, Gauge, ShieldCheck, Target } from 'lucide-react'
import { fmtDate, fmtN } from '@/lib/format'
import { freshness } from '@/lib/telemetry'
import { staleAfter, useApp } from '@/store/app'
import { useForces, type CalState } from '@/store/derived'
import { useTelemetry } from '@/store/telemetry'
import { SimTag } from './ModeBadge'
import { Pill, Stat, useNow } from './ui'
import { marginOf } from './SafetyPanel'
import { fmtMargin } from '@/lib/mechanics'
import type { Tone } from '@/lib/safety'

export const CAL_TONE: Record<CalState, Tone> = { calibrated: 'ok', cached: 'warn', in_progress: 'warn', uncalibrated: 'neutral', not_applied: 'warn', unresolved: 'neutral', error: 'bad' }

/** The four force quantities, always shown separately and with distinct colours. */
export default function ForceSummary({ compact = false }: { compact?: boolean }) {
  const f = useForces()
  const latest = useTelemetry((s) => s.latest)
  const source = useTelemetry((s) => s.source)
  const stale = useApp(staleAfter)
  const now = useNow()
  const fr = freshness(latest, now, stale)
  const measured = latest?.measured_force_n ?? null
  const unit = 'per finger'
  return (
    <div className="space-y-3">
      <div className={compact ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-2 gap-3 xl:grid-cols-4'}>
        <Stat label="LLM recommended" tone="text-llm" value={fmtN(f.llm)} sub={f.llm == null ? 'No LLM call for this configuration' : `Initial estimate, ${unit}`} badge={<Bot className="size-4 text-llm" />} />
        <Stat label="Selected target" tone="text-accent" value={fmtN(f.selected)} sub="Slider value (software target)" badge={<Target className="size-4 text-accent" />} />
        <Stat label="Measured (actual)" tone="text-meas" value={measured == null ? 'unavailable' : fmtN(measured)}
          sub={fr.state === 'fresh' || fr.state === 'unknown' ? (fr.state === 'unknown' ? fr.reason : 'Sensor reading') : fr.reason}
          badge={source === 'simulated' ? <SimTag /> : <Gauge className="size-4 text-meas" />} />
        <Stat label="Last calibrated" tone="text-cal" value={fmtN(f.calibrated)}
          sub={f.calibratedRecord ? `${fmtDate(f.calibratedRecord.confirmed_at)}${f.calibratedApplicable ? '' : ' (not applied)'}` : 'None saved'} badge={<ShieldCheck className="size-4 text-cal" />} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-400">Calibration status:</span>
        <Pill tone={CAL_TONE[f.state]}>{f.stateLabel}</Pill>
        {f.safety && marginOf(f.safety).margin != null && (() => {
          const m = marginOf(f.safety)
          const gripping = measured != null && measured > 0 && latest?.object_detected !== false
          const measuredMargin = gripping && f.safety.required_min_force_n ? measured / f.safety.required_min_force_n : null
          return (
            <Pill tone={m.tone} title="Friction capacity divided by the design load (1.0 = estimated slip threshold)">
              grip margin {fmtMargin(m.margin)}{measuredMargin != null && <span className="opacity-80"> · measured {fmtMargin(measuredMargin)}</span>}
            </Pill>
          )
        })()}
      </div>
    </div>
  )
}
