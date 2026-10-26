import { CheckCircle2, CircleAlert, Info, TriangleAlert, X } from 'lucide-react'
import { useToasts, type ToastTone } from '@/store/toast'
import { cx } from './ui'

const ICON: Record<ToastTone, typeof Info> = { ok: CheckCircle2, warn: TriangleAlert, bad: CircleAlert, neutral: Info }
const TONE: Record<ToastTone, string> = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', neutral: 'text-accent' }

export default function Toaster() {
  const { toasts, dismiss } = useToasts()
  return (
    <div aria-live="polite" aria-relevant="additions" className="pointer-events-none fixed bottom-4 right-4 z-[90] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((t) => {
        const Icon = ICON[t.tone]
        return (
          <div key={t.id} role="status" className="pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-ink-800/95 p-3 shadow-xl backdrop-blur animate-[slide-up_.2s_ease-out]">
            <Icon className={cx('mt-0.5 size-4 shrink-0', TONE[t.tone])} />
            <div className="min-w-0 flex-1 text-sm"><div className="font-semibold text-slate-100">{t.title}</div>{t.body && <div className="mt-0.5 text-slate-400">{t.body}</div>}</div>
            <button type="button" aria-label="Dismiss notification" onClick={() => dismiss(t.id)} className="rounded p-0.5 text-slate-400 hover:text-slate-100"><X className="size-4" /></button>
          </div>
        )
      })}
    </div>
  )
}
