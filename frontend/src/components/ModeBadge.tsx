import { FlaskConical, Radio } from 'lucide-react'
import type { Mode } from '@/lib/types'
import { cx } from './ui'

export function ModeBadge({ mode, className }: { mode: Mode; className?: string }) {
  return mode === 'demo' ? (
    <span data-testid="mode-badge" className={cx('inline-flex items-center gap-1.5 rounded-md border border-warn/60 bg-warn/15 px-2 py-1 text-xs font-bold tracking-wider text-warn', className)}>
      <FlaskConical className="size-3.5" /> DEMO MODE · SIMULATED
    </span>
  ) : (
    <span data-testid="mode-badge" className={cx('inline-flex items-center gap-1.5 rounded-md border border-ok/60 bg-ok/15 px-2 py-1 text-xs font-bold tracking-wider text-ok', className)}>
      <Radio className="size-3.5" /> LIVE MODE · FIREBASE
    </span>
  )
}

export function SimTag() {
  return <span className="rounded border border-warn/50 bg-warn/10 px-1 text-[10px] font-bold tracking-wider text-warn">SIMULATED</span>
}
