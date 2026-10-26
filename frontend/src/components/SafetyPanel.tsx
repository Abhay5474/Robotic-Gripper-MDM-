import { CheckCircle2, Info, ShieldAlert, XCircle } from 'lucide-react'
import { STATUS_LABEL, STATUS_TONE } from '@/lib/safety'
import type { SafetyAssessment } from '@/lib/types'
import { Pill, cx } from './ui'
import { MarginBar } from './viz/GripDiagram'
import { fmtMargin } from '@/lib/mechanics'

export function SafetyBadge({ safety }: { safety: SafetyAssessment | null }) {
  if (!safety) return <Pill>Safety: n/a</Pill>
  return <Pill tone={STATUS_TONE[safety.status]}>{safety.status === 'ok' ? <CheckCircle2 className="size-3" /> : <ShieldAlert className="size-3" />} {STATUS_LABEL[safety.status]}</Pill>
}

export default function SafetyPanel({ safety, showMargin = true }: { safety: SafetyAssessment | null; showMargin?: boolean }) {
  if (!safety) return <p className="text-sm text-slate-400">Safety checks appear once a configuration is resolved.</p>
  return (
    <div className="space-y-3" data-testid="safety-panel">
      <div className="flex flex-wrap items-center gap-2"><SafetyBadge safety={safety} /><span className="text-sm text-slate-300">{safety.summary}</span></div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-xs text-slate-300">
        <div><dt className="text-slate-500">Est. holding min</dt><dd>{safety.required_min_force_n ?? '—'} N</dd></div>
        <div><dt className="text-slate-500">Recommended min</dt><dd>{safety.recommended_min_force_n ?? '—'} N</dd></div>
        <div><dt className="text-slate-500">Upper limit</dt><dd>{safety.upper_limit_n ?? '—'} N <span className="text-slate-500">({safety.upper_limit_source?.replace('_', ' ') ?? '—'})</span></dd></div>
        <div><dt className="text-slate-500">Permitted range</dt><dd>{safety.safe_range_n ? `${safety.safe_range_n[0]}–${safety.safe_range_n[1]} N` : 'none'}</dd></div>
      </dl>
      {showMargin && <MarginRow safety={safety} />}
      <ul className="space-y-1">
        {safety.checks.filter((c) => c.severity !== 'info' || !c.passed || c.id === 'contact_limit_known').map((c) => (
          <li key={c.id} className={cx('flex items-start gap-2 text-xs', c.passed ? 'text-slate-400' : c.severity === 'blocking' ? 'text-bad' : 'text-warn')}>
            {c.passed ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-ok" /> : c.severity === 'blocking' ? <XCircle className="mt-0.5 size-3.5 shrink-0" /> : <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />}
            {c.message}
          </li>
        ))}
      </ul>
      <p className="flex items-start gap-2 text-[11px] text-slate-500"><Info className="mt-0.5 size-3 shrink-0" />{safety.disclaimer}</p>
    </div>
  )
}

/** Grip margin = selected force / estimated holding force (1.0 = slip threshold). */
export function marginOf(safety: SafetyAssessment): { margin: number | null; factor: number | null; tone: 'ok' | 'warn' | 'bad' } {
  const req = safety.required_min_force_n, sel = safety.selected_force_n, rec = safety.recommended_min_force_n
  const margin = req && sel != null && req > 0 ? sel / req : null
  const factor = req && rec ? rec / req : null
  return { margin, factor, tone: margin == null || margin < 1 ? 'bad' : factor != null && margin < factor - 1e-9 ? 'warn' : 'ok' }
}

function MarginRow({ safety }: { safety: SafetyAssessment }) {
  const { margin, factor, tone } = marginOf(safety)
  if (margin == null) return null
  return (
    <div className="rounded-lg border border-line bg-ink-900/60 px-3 py-2" data-testid="safety-margin">
      <div className="flex items-baseline justify-between text-xs">
        <span className="uppercase tracking-wider text-slate-400">Grip margin</span>
        <span className={cx('font-mono text-base font-bold', tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-bad')}>{fmtMargin(margin)}</span>
      </div>
      <MarginBar margin={margin} target={factor ?? 1.5} tone={tone} />
      <p className="mt-0.5 text-[11px] text-slate-500">friction capacity ÷ design load · 1.0 = slip threshold · target ×{factor?.toFixed(2) ?? '—'}</p>
    </div>
  )
}
