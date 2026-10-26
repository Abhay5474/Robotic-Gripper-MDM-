import { Activity, Boxes, Cpu, CornerDownLeft, FlaskConical, History, LayoutDashboard, Monitor, Moon, Radio, RefreshCw, Search, Settings, SlidersHorizontal, Sun } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { useFastNavigate } from './FastLink'
import { fuzzyFilter } from '@/lib/fuzzy'
import { objectKind, PRESETS } from '@/lib/objects'
import { useApp } from '@/store/app'
import { useTheme } from '@/store/theme'
import ObjectArt from './ObjectArt'
import { cx } from './ui'

interface Command { id: string; group: string; label: string; hint?: string; icon: ReactNode; run: () => void; disabled?: boolean }

export function useCommandPaletteHotkey(open: () => void) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); open() }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [open])
}

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Mounted only while open: every opening starts with a fresh query, and the input is focused during the commit
  // (not in a later effect/timeout), so keys typed straight after Ctrl+K cannot land anywhere else.
  return open ? <Palette onClose={onClose} /> : null
}

function Palette({ onClose }: { onClose: () => void }) {
  const nav = useFastNavigate()
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const mode = useApp((s) => s.settings.mode)
  const locked = useApp((s) => !!s.session)
  const setMode = useApp((s) => s.setMode)
  const selectPreset = useApp((s) => s.selectPreset)
  const resolve = useApp((s) => s.resolve)
  const ready = useApp((s) => s.resolution.status === 'ready')
  const setTheme = useTheme((s) => s.setPref)

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => nav(to)
    return [
      { id: 'p-overview', group: 'Go to', label: 'Overview', icon: <LayoutDashboard className="size-4" />, run: go('/') },
      { id: 'p-control', group: 'Go to', label: 'Gripper Control', hint: '3D cell, pick-and-place', icon: <Cpu className="size-4" />, run: go('/control') },
      { id: 'p-objects', group: 'Go to', label: 'Object Selection', icon: <Boxes className="size-4" />, run: go('/objects') },
      { id: 'p-cal', group: 'Go to', label: 'Force & Calibration', hint: 'slider, tests, confirm', icon: <SlidersHorizontal className="size-4" />, run: go('/calibration') },
      { id: 'p-tel', group: 'Go to', label: 'Live Telemetry', icon: <Activity className="size-4" />, run: go('/telemetry') },
      { id: 'p-hist', group: 'Go to', label: 'Calibration History', hint: 'records, replay, export', icon: <History className="size-4" />, run: go('/history') },
      { id: 'p-set', group: 'Go to', label: 'Settings', icon: <Settings className="size-4" />, run: go('/settings') },
      ...PRESETS.map((p) => ({ id: `o-${p.object_id}`, group: 'Select object', label: p.name, hint: `${p.mass_g} g · μ ${p.friction_coefficient}`, icon: <ObjectArt kind={objectKind(p)} className="size-5" />, disabled: locked, run: () => { selectPreset(p.object_id); nav('/calibration') } })),
      { id: 'a-regen', group: 'Actions', label: 'Regenerate LLM recommendation', hint: 'saved calibrations are not touched', icon: <RefreshCw className="size-4" />, disabled: !ready || locked, run: () => { void resolve({ regenerate: true }); nav('/calibration') } },
      { id: 'm-demo', group: 'Data mode', label: 'Switch to DEMO mode', hint: 'simulated telemetry', icon: <FlaskConical className="size-4" />, disabled: locked || mode === 'demo', run: () => setMode('demo') },
      { id: 'm-live', group: 'Data mode', label: 'Switch to LIVE mode', hint: 'Firebase telemetry', icon: <Radio className="size-4" />, disabled: locked || mode === 'live', run: () => setMode('live') },
      { id: 't-light', group: 'Theme', label: 'Light theme (faint red & white)', icon: <Sun className="size-4" />, run: () => setTheme('light') },
      { id: 't-dark', group: 'Theme', label: 'Dark theme', icon: <Moon className="size-4" />, run: () => setTheme('dark') },
      { id: 't-sys', group: 'Theme', label: 'Follow system theme', icon: <Monitor className="size-4" />, run: () => setTheme('system') },
    ]
  }, [nav, locked, mode, ready, selectPreset, resolve, setMode, setTheme])

  const shown = useMemo(() => fuzzyFilter(commands, q, (c) => `${c.label} ${c.group} ${c.hint ?? ''}`), [commands, q])
  useLayoutEffect(() => { input.current?.focus() }, [])
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-index="${i}"]`)?.scrollIntoView?.({ block: 'nearest' }) }, [i])

  const exec = (c: Command | undefined) => { if (!c || c.disabled) return; onClose(); c.run() }
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setI((n) => Math.min(shown.length - 1, n + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setI((n) => Math.max(0, n - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); exec(shown[i]) }
  }
  let lastGroup = ''
  return (
    <div className="fixed inset-0 z-[85] flex items-start justify-center p-4 pt-[12vh]" onKeyDown={onKey}>
      <div className="absolute inset-0 bg-ink-950/60 backdrop-blur-sm animate-[fade-in_.12s_ease-out]" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label="Command palette" data-testid="command-palette"
        className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-ink-800 shadow-2xl animate-[pop-in_.15s_ease-out]">
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search className="size-4 text-slate-400" />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setI(0) }} placeholder="Jump to a page, pick an object, switch mode or theme…"
            role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={shown[i] ? `cmd-${shown[i].id}` : undefined}
            className="h-12 w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500" />
          <kbd className="rounded border border-line px-1.5 font-mono text-[10px] text-slate-400">Esc</kbd>
        </div>
        <ul ref={list} id="palette-list" role="listbox" className="max-h-[50vh] overflow-auto p-1.5">
          {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-400">No matches</li>}
          {shown.map((c, idx) => {
            const header = !q && c.group !== lastGroup ? c.group : null
            lastGroup = c.group
            return (
              <li key={c.id} role="presentation">
                {header && <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{header}</div>}
                <div id={`cmd-${c.id}`} role="option" aria-selected={idx === i} aria-disabled={c.disabled} data-index={idx}
                  onMouseEnter={() => setI(idx)} onClick={() => exec(c)}
                  className={cx('flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm', idx === i ? 'bg-accent/15 text-slate-100' : 'text-slate-300', c.disabled && 'cursor-not-allowed opacity-40')}>
                  <span className={cx('grid size-7 place-items-center rounded-md', idx === i ? 'text-accent' : 'text-slate-400')}>{c.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{c.label}{c.hint && <span className="ml-2 text-xs text-slate-500">{c.hint}</span>}</span>
                  {q && <span className="text-[10px] uppercase tracking-wider text-slate-500">{c.group}</span>}
                  {idx === i && <CornerDownLeft className="size-3.5 text-slate-400" />}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
