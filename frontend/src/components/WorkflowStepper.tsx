import { Check } from 'lucide-react'
import { STEPS, type Step } from '@/lib/workflow'
import { cx } from './ui'

export default function WorkflowStepper({ step, detail }: { step: Step; detail?: Partial<Record<Step, string>> }) {
  return (
    <ol className="flex w-full items-center gap-1 overflow-x-auto rounded-xl border border-line bg-ink-800/70 p-2 shadow-[var(--shadow-card)]" aria-label="Calibration workflow" data-testid="workflow-stepper">
      {STEPS.map((s, i) => {
        const done = s.n < step || (s.n === 5 && step === 5)
        const current = s.n === step
        return (
          <li key={s.n} className={cx('flex min-w-0 items-center gap-1', current ? 'flex-[2_1_0%] md:flex-1' : 'flex-none md:flex-1')} aria-current={current ? 'step' : undefined} aria-label={`Step ${s.n}: ${s.title}${done ? ' (done)' : current ? ' (current)' : ''}`}>
            <div className={cx('flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 transition-colors', current && 'bg-accent/12 ring-1 ring-accent/40')}>
              <span className={cx('grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold',
                done ? 'bg-ok text-ink-950' : current ? 'bg-accent text-ink-950' : 'border border-line text-slate-500')}>
                {done ? <Check className="size-3.5" /> : s.n}
              </span>
              <span className={cx('min-w-0', !current && 'hidden md:block')}>
                <span className={cx('block truncate text-xs font-semibold', current ? 'text-slate-100' : done ? 'text-slate-300' : 'text-slate-500')}>{s.title}</span>
                {detail?.[s.n] && <span className="block truncate text-[11px] text-slate-400">{detail[s.n]}</span>}
              </span>
            </div>
            {i < STEPS.length - 1 && <span aria-hidden className={cx('hidden h-px w-4 shrink-0 sm:block', s.n < step ? 'bg-ok/60' : 'bg-line')} />}
          </li>
        )
      })}
    </ol>
  )
}
