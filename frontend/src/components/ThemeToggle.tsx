import { Monitor, Moon, Sun } from 'lucide-react'
import type { ThemePref } from '@/lib/theme'
import { useTheme } from '@/store/theme'
import { cx } from './ui'

const OPTS: { v: ThemePref; label: string; icon: typeof Sun }[] = [
  { v: 'light', label: 'Light', icon: Sun }, { v: 'dark', label: 'Dark', icon: Moon }, { v: 'system', label: 'System', icon: Monitor },
]

export default function ThemeToggle({ labels = false }: { labels?: boolean }) {
  const pref = useTheme((s) => s.pref)
  const setPref = useTheme((s) => s.setPref)
  return (
    <div role="group" aria-label="Colour theme" className="inline-flex rounded-lg border border-line bg-ink-900 p-0.5">
      {OPTS.map(({ v, label, icon: Icon }) => (
        <button key={v} aria-pressed={pref === v} aria-label={`${label} theme`} title={`${label} theme`} onClick={() => setPref(v)}
          className={cx('inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors', pref === v ? 'bg-accent text-ink-950' : 'text-slate-400 hover:text-slate-100')}>
          <Icon className="size-3.5" />{labels && label}
        </button>
      ))}
    </div>
  )
}
