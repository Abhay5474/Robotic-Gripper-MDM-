import { Activity, AlertTriangle, Boxes, ChevronDown, ChevronRight, Cpu, Gauge, History, LayoutDashboard, Menu, PanelLeftClose, PanelLeftOpen, Search, Settings as Cog, SlidersHorizontal, WifiOff, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { FastNavLink as NavLink } from './FastLink'
import { fmtN } from '@/lib/format'
import { objectKind } from '@/lib/objects'
import { freshness } from '@/lib/telemetry'
import { staleAfter, useApp } from '@/store/app'
import { useForces } from '@/store/derived'
import { useTelemetry } from '@/store/telemetry'
import CommandPalette, { useCommandPaletteHotkey } from './CommandPalette'
import { CAL_TONE } from './ForceSummary'
import { ModeBadge } from './ModeBadge'
import ObjectArt from './ObjectArt'
import ThemeToggle from './ThemeToggle'
import Toaster from './Toaster'
import { Banner, Pill, cx, useNow } from './ui'

const NAV = [
  { group: 'Operate', items: [
    { to: '/', label: 'Overview', icon: LayoutDashboard },
    { to: '/control', label: 'Gripper Control', icon: Cpu },
    { to: '/objects', label: 'Object Selection', icon: Boxes },
    { to: '/calibration', label: 'Force & Calibration', icon: SlidersHorizontal },
  ] },
  { group: 'Monitor', items: [
    { to: '/telemetry', label: 'Live Telemetry', icon: Activity },
    { to: '/history', label: 'Calibration History', icon: History },
  ] },
  { group: 'System', items: [{ to: '/settings', label: 'Settings', icon: Cog }] },
]
const CRUMBS: Record<string, { group: string; label: string }> = Object.fromEntries(NAV.flatMap((g) => g.items.map((i) => [i.to, { group: g.group, label: i.label }])))

const readCollapsed = () => { try { return localStorage.getItem('gripsense.sidebar.collapsed') === '1' } catch { return false } }

function ModeSwitch() {
  const mode = useApp((s) => s.settings.mode)
  const setMode = useApp((s) => s.setMode)
  const locked = useApp((s) => !!s.session)
  return (
    <div role="group" aria-label="Data mode" className={cx('inline-flex rounded-lg border border-line bg-ink-900 p-0.5 text-xs font-semibold', locked && 'opacity-50')} title={locked ? 'Finish or cancel the calibration before switching mode' : 'Switch data mode'}>
      {(['demo', 'live'] as const).map((m) => (
        <button key={m} disabled={locked} aria-pressed={mode === m} onClick={() => mode !== m && setMode(m)}
          className={cx('rounded-md px-2 py-1.5 uppercase tracking-wider transition-colors sm:px-3', mode === m ? (m === 'demo' ? 'bg-warn text-ink-950' : 'bg-ok text-ink-950') : 'text-slate-400 hover:text-slate-100')}>
          {m}
        </button>
      ))}
    </div>
  )
}

function StatusChips({ vertical = false }: { vertical?: boolean }) {
  const health = useApp((s) => s.health)
  const healthError = useApp((s) => s.healthError)
  const mode = useApp((s) => s.settings.mode)
  const stale = useApp(staleAfter)
  const { latest, conn, source } = useTelemetry()
  const now = useNow()
  const fr = freshness(latest, now, stale)
  return (
    <div className={cx('flex gap-2', vertical ? 'flex-col items-start' : 'flex-wrap items-center')}>
      {healthError ? <Pill tone="bad"><WifiOff className="size-3" /> Backend offline</Pill> : health && (
        <>
          <Pill tone={health.store.reachable ? 'ok' : 'bad'} title={health.store.error ?? undefined}>RTDB {health.store.reachable ? 'reachable' : 'unreachable'}{health.store.dev_only && ' (memory, dev)'}</Pill>
          <Pill tone={health.llm.configured ? (health.llm.is_mock ? 'warn' : 'ok') : 'bad'}>LLM {health.llm.configured ? (health.llm.is_mock ? 'MOCK heuristic' : health.llm.model) : 'not configured'}</Pill>
          {health.limits.limits_source === 'demo' && <Pill tone="warn" title="Force limits are placeholders until the hardware team supplies validated values">Demo gripper limits</Pill>}
        </>
      )}
      {mode === 'live' ? (
        <Pill tone={conn !== 'connected' ? 'bad' : fr.state === 'fresh' ? 'ok' : 'warn'} title={fr.reason}>Telemetry: {conn !== 'connected' ? conn : fr.state}</Pill>
      ) : source === 'simulated' && <Pill tone="warn">Telemetry: simulated</Pill>}
    </div>
  )
}

/** On narrow screens the status chips fold into one button. */
function StatusPopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const health = useApp((s) => s.health)
  const healthError = useApp((s) => s.healthError)
  useEffect(() => {
    if (!open) return
    const out = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', out); window.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', out); window.removeEventListener('keydown', esc) }
  }, [open])
  const ok = !healthError && health?.store.reachable && health.llm.configured
  return (
    <div ref={ref} className="relative shrink-0 xl:hidden">
      <button type="button" aria-expanded={open} aria-label="System status" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-ink-900 px-2 py-1.5 text-xs text-slate-300 hover:text-slate-100 sm:px-2.5">
        <span className={cx('size-2 rounded-full', ok ? 'bg-ok' : 'bg-bad')} /><span className="hidden sm:inline">System</span><ChevronDown className="size-3" />
      </button>
      {open && <div className="absolute left-0 top-full z-40 mt-2 rounded-xl border border-line bg-ink-800 p-3 shadow-xl"><StatusChips vertical /></div>}
    </div>
  )
}

function CurrentObjectCard({ collapsed }: { collapsed: boolean }) {
  const object = useApp((s) => s.resolution.object)
  const f = useForces()
  if (!object) return null
  if (collapsed) return <NavLink to="/calibration" title={`${object.name} · ${f.stateLabel}`} className="mx-auto grid size-10 place-items-center rounded-lg border border-line bg-ink-800"><ObjectArt kind={objectKind(object)} className="size-8" /></NavLink>
  return (
    <NavLink to="/calibration" className="block rounded-xl border border-line bg-ink-800/80 p-3 transition-colors hover:border-accent/50" data-testid="sidebar-object">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Current object</div>
      <div className="mt-1.5 flex items-center gap-2.5">
        <ObjectArt kind={objectKind(object)} className="size-10 shrink-0" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-100">{object.name}</div>
          <div className="font-mono text-xs text-accent">{fmtN(f.selected)}</div>
        </div>
      </div>
      <div className="mt-2"><Pill tone={CAL_TONE[f.state]}>{f.stateLabel}</Pill></div>
    </NavLink>
  )
}

function SidebarContent({ collapsed, onNavigate, onToggle, drawer = false }: { collapsed: boolean; onNavigate?: () => void; onToggle?: () => void; drawer?: boolean }) {
  return (
    <div className="flex h-full flex-col">
      <div className={cx('flex items-center gap-2.5 py-4', collapsed ? 'justify-center px-2' : 'px-4')}>
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-linear-to-br from-accent to-accent-dim text-ink-950 shadow-[var(--shadow-card)]"><Gauge className="size-5" /></div>
        {!collapsed && <div className="min-w-0"><div className="text-sm font-bold tracking-wide">GripSense AI</div><div className="text-[11px] text-slate-400">Force calibration console</div></div>}
      </div>
      <nav aria-label="Main" className="flex-1 space-y-4 overflow-y-auto px-2">
        {NAV.map((g) => (
          <div key={g.group}>
            {!collapsed && <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{g.group}</div>}
            <div className="space-y-0.5">
              {g.items.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} end={to === '/'} onClick={onNavigate} title={collapsed ? label : undefined}
                  className={({ isActive }) => cx('relative flex items-center gap-2.5 rounded-lg py-2 text-sm transition-colors', collapsed ? 'justify-center px-2' : 'px-3',
                    isActive ? 'bg-accent/15 font-medium text-accent before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-accent' : 'text-slate-300 hover:bg-ink-700')}>
                  <Icon className="size-4 shrink-0" />{!collapsed && label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className={cx('space-y-3 border-t border-line py-3', collapsed ? 'px-2' : 'px-3')}>
        {drawer && <div className="flex items-center justify-between gap-2 px-1 md:hidden"><span className="text-xs text-slate-400">Theme</span><ThemeToggle /></div>}
        <CurrentObjectCard collapsed={collapsed} />
        {onToggle && (
          <button type="button" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cx('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-slate-400 hover:bg-ink-700 hover:text-slate-100', collapsed && 'justify-center')}>
            {collapsed ? <PanelLeftOpen className="size-4" /> : <><PanelLeftClose className="size-4" />Collapse</>}
          </button>
        )}
      </div>
    </div>
  )
}

export default function Layout() {
  const mode = useApp((s) => s.settings.mode)
  const { conn, connDetail } = useTelemetry()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [drawer, setDrawer] = useState(false)
  const [palette, setPalette] = useState(false)
  const openPalette = useCallback(() => setPalette(true), [])
  useCommandPaletteHotkey(openPalette)
  useEffect(() => { setDrawer(false) }, [location.pathname])
  useEffect(() => { try { localStorage.setItem('gripsense.sidebar.collapsed', collapsed ? '1' : '0') } catch { /* ignore */ } }, [collapsed])
  useEffect(() => {
    if (!drawer) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false)
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [drawer])
  const crumb = CRUMBS[location.pathname]
  useEffect(() => { document.title = crumb ? `${crumb.label} · GripSense AI` : 'GripSense AI' }, [crumb])

  return (
    <div className="flex min-h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-ink-950">Skip to content</a>
      <aside className={cx('sticky top-0 hidden h-screen shrink-0 border-r border-line bg-ink-900/95 transition-[width] duration-200 lg:block', collapsed ? 'w-[4.5rem]' : 'w-64')}>
        <SidebarContent collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      </aside>
      {drawer && (
        <div className="fixed inset-0 z-[75] lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-ink-950/60 backdrop-blur-sm animate-[fade-in_.15s_ease-out]" onClick={() => setDrawer(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 w-72 border-r border-line bg-ink-900 shadow-2xl animate-[slide-up_.2s_ease-out]">
            <button type="button" onClick={() => setDrawer(false)} aria-label="Close navigation" className="absolute right-3 top-4 rounded-md p-1 text-slate-400 hover:text-slate-100"><X className="size-5" /></button>
            <SidebarContent collapsed={false} onNavigate={() => setDrawer(false)} drawer />
          </div>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-line bg-ink-950/85 px-4 py-2.5 backdrop-blur sm:px-6">
          <div className="flex items-center gap-2 sm:gap-3">
            <button type="button" onClick={() => setDrawer(true)} aria-label="Open navigation" className="rounded-md p-1.5 text-slate-300 hover:bg-ink-700 lg:hidden"><Menu className="size-5" /></button>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2 xl:flex-wrap">
                {/* breadcrumb, not a second page title: every page renders its own <h1> */}
                <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
                  {crumb ? <>
                    <span className="hidden text-slate-500 sm:inline">{crumb.group}</span>
                    <ChevronRight className="hidden size-3.5 shrink-0 text-slate-500 sm:block" aria-hidden />
                    <span aria-current="page" className="truncate font-medium text-slate-200">{crumb.label}</span>
                  </> : <span className="truncate font-medium text-slate-200">GripSense AI</span>}
                </nav>
                <span className="hidden shrink-0 sm:inline-flex"><ModeBadge mode={mode} /></span>
                <div className="hidden xl:block"><StatusChips /></div>
                <StatusPopover />
              </div>
            </div>
            <button type="button" onClick={openPalette} className="hidden items-center gap-2 rounded-lg border border-line bg-ink-900 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-100 md:inline-flex" aria-label="Open command palette">
              <Search className="size-3.5" />Search…<kbd className="rounded border border-line px-1 font-mono text-[10px]">Ctrl K</kbd>
            </button>
            <button type="button" onClick={openPalette} className="rounded-md p-1.5 text-slate-300 hover:bg-ink-700 md:hidden" aria-label="Open command palette"><Search className="size-4" /></button>
            <div className="hidden md:block"><ThemeToggle /></div>
            <ModeSwitch />
          </div>
        </header>
        <main id="main" className="mx-auto max-w-[96rem] space-y-4 px-4 py-5 sm:px-6">
          {mode === 'demo' ? (
            <Banner tone="warn" icon={<AlertTriangle className="size-4" />}>
              <b>DEMO MODE.</b> Sensor readings come from a software simulation, not from the gripper. Calibrations and operations are stored under the separate <code className="font-mono">demo/</code> namespace and are <b>not</b> hardware calibrations.
            </Banner>
          ) : conn !== 'connected' && (
            <Banner tone="bad" icon={<WifiOff className="size-4" />}>
              <b>LIVE MODE - no telemetry connection ({conn}).</b> {connDetail} No simulated values are being substituted; readings show as unavailable.
            </Banner>
          )}
          <div key={location.pathname} className="page-enter space-y-4"><Outlet /></div>
        </main>
      </div>
      <Toaster />
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  )
}
