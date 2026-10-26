import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { Tone } from '@/lib/safety'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(t) }, [intervalMs])
  return now
}

export function Card({ title, subtitle, action, children, className }: { title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-xl border border-line bg-ink-800/80 p-4 shadow-[var(--shadow-card)] sm:p-5', className)}>
      {(title || action) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-sm font-semibold tracking-wide text-slate-100">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

const TONES: Record<Tone, string> = {
  ok: 'border-ok/40 bg-ok/10 text-ok',
  warn: 'border-warn/40 bg-warn/10 text-warn',
  bad: 'border-bad/40 bg-bad/10 text-bad',
  neutral: 'border-line bg-ink-700/60 text-slate-300',
}
export function Pill({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span title={title} className={cx('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', TONES[tone])}>{children}</span>
}

export function Banner({ tone = 'neutral', icon, children, action }: { tone?: Tone; icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={cx('flex items-start gap-3 rounded-lg border px-3.5 py-2.5 text-sm', TONES[tone])}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1 text-slate-100/90">{children}</div>
      {action}
    </div>
  )
}

type Variant = 'primary' | 'secondary' | 'danger' | 'warn' | 'ghost'
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-ink-950 hover:brightness-110 font-semibold',
  secondary: 'border border-line bg-ink-700 text-slate-100 hover:bg-ink-600',
  danger: 'border border-bad/50 bg-bad/10 text-bad hover:bg-bad/20',
  warn: 'border border-warn/50 bg-warn/10 text-warn hover:bg-warn/20',
  ghost: 'text-slate-300 hover:bg-ink-700',
}
export function Button({ variant = 'secondary', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" {...p} className={cx('inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40', VARIANTS[variant], className)} />
}

export function Stat({ label, value, sub, tone, badge }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string; badge?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-ink-900/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</div>
        {badge}
      </div>
      <div className={cx('mt-1 font-mono text-2xl font-semibold tabular-nums', tone)}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span role="status" aria-label={label} className="inline-block size-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
}

export function KV({ k, v }: { k: string; v: ReactNode }) {
  return <div className="flex justify-between gap-4 border-b border-line/60 py-1.5 text-sm last:border-0"><dt className="text-slate-400">{k}</dt><dd className="text-right font-mono text-slate-100">{v}</dd></div>
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="ml-1 hidden rounded border border-current/30 px-1 font-mono text-[10px] leading-4 opacity-70 sm:inline-block">{children}</kbd>
}

/** Accessible modal: Esc closes, focus moves in on open and returns on close, Tab stays inside. */
export function Modal({ open, onClose, title, children, labelledBy = 'modal-title', testId }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; labelledBy?: string; testId?: string }) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const focusables = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])') ?? []).filter((el) => !el.hasAttribute('disabled'))
    focusables()[0]?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
      if (e.key === 'Tab') {
        const f = focusables(); if (!f.length) return
        const first = f[0], last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    window.addEventListener('keydown', key, true)
    return () => { window.removeEventListener('keydown', key, true); prev?.focus?.() }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center p-4">
      <div className="absolute inset-0 bg-ink-950/70 backdrop-blur-sm animate-[fade-in_.15s_ease-out]" onClick={onClose} aria-hidden />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={labelledBy} data-testid={testId}
        className="relative w-full max-w-lg rounded-2xl border border-line bg-ink-800 p-5 shadow-2xl animate-[pop-in_.18s_ease-out]">
        <h2 id={labelledBy} className="mb-3 text-base font-semibold text-slate-100">{title}</h2>
        {children}
      </div>
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-ink-700/70', className)} aria-hidden />
}
