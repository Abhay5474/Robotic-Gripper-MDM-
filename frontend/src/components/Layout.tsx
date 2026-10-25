import { Activity, AlertTriangle, Boxes, Cpu, Gauge, History, LayoutDashboard, Settings as Cog, SlidersHorizontal, WifiOff } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { freshness } from '@/lib/telemetry'
import { staleAfter, useApp } from '@/store/app'
import { useTelemetry } from '@/store/telemetry'
import { ModeBadge } from './ModeBadge'
import ThemeToggle from './ThemeToggle'
import { Banner, Pill, cx, useNow } from './ui'

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/control', label: 'Gripper Control', icon: Cpu },
  { to: '/objects', label: 'Object Selection', icon: Boxes },
  { to: '/calibration', label: 'Force & Calibration', icon: SlidersHorizontal },
  { to: '/telemetry', label: 'Live Telemetry', icon: Activity },
  { to: '/history', label: 'Calibration History', icon: History },
  { to: '/settings', label: 'Settings', icon: Cog },
]

function ModeSwitch() {
  const mode = useApp((s) => s.settings.mode)
  const setMode = useApp((s) => s.setMode)
  const locked = useApp((s) => !!s.session)
  return (
    <div role="group" aria-label="Data mode" className={cx('inline-flex rounded-lg border border-line bg-ink-900 p-0.5 text-xs font-semibold', locked && 'opacity-50')} title={locked ? 'Finish or cancel the calibration before switching mode' : 'Switch data mode'}>
      {(['demo', 'live'] as const).map((m) => (
        <button key={m} disabled={locked} aria-pressed={mode === m} onClick={() => mode !== m && setMode(m)}
          className={cx('rounded-md px-3 py-1.5 uppercase tracking-wider transition-colors', mode === m ? (m === 'demo' ? 'bg-warn text-ink-950' : 'bg-ok text-ink-950') : 'text-slate-400 hover:text-slate-100')}>
          {m}
        </button>
      ))}
    </div>
  )
}

function StatusChips() {
  const health = useApp((s) => s.health)
  const healthError = useApp((s) => s.healthError)
  const mode = useApp((s) => s.settings.mode)
  const stale = useApp(staleAfter)
  const { latest, conn, source } = useTelemetry()
  const now = useNow()
  const fr = freshness(latest, now, stale)
  return (
    <div className="flex flex-wrap items-center gap-2">
      {healthError ? <Pill tone="bad"><WifiOff className="size-3" /> Backend offline</Pill> : health && (
        <>
          <Pill tone={health.store.reachable ? 'ok' : 'bad'} title={health.store.error ?? undefined}>RTDB {health.store.reachable ? 'reachable' : 'unreachable'}{health.store.dev_only && ' (memory, dev)'}</Pill>
          <Pill tone={health.llm.configured ? (health.llm.is_mock ? 'warn' : 'ok') : 'bad'}>LLM {health.llm.configured ? (health.llm.is_mock ? 'MOCK heuristic' : health.llm.model) : 'not configured'}</Pill>
          {health.limits.limits_source === 'demo' && <Pill tone="warn" title="Force limits are placeholders until the hardware team supplies validated values">Demo gripper limits</Pill>}
        </>
      )}
      {mode === 'live' ? (
        <Pill tone={conn !== 'connected' ? 'bad' : fr.state === 'fresh' ? 'ok' : 'warn'} title={fr.reason}>
          Telemetry: {conn !== 'connected' ? conn : fr.state}
        </Pill>
      ) : source === 'simulated' && <Pill tone="warn">Telemetry: simulated</Pill>}
    </div>
  )
}

export default function Layout() {
  const mode = useApp((s) => s.settings.mode)
  const { conn, connDetail } = useTelemetry()
  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <aside className="border-line bg-ink-900 lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:shrink-0 lg:border-r">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <div className="grid size-9 place-items-center rounded-lg bg-accent/15 text-accent"><Gauge className="size-5" /></div>
          <div><div className="text-sm font-bold tracking-wide">GripSense AI</div><div className="text-[11px] text-slate-400">Force calibration console</div></div>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-2 pb-2 lg:block lg:space-y-1 lg:overflow-visible lg:pb-0">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => cx('flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors', isActive ? 'bg-accent/15 text-accent' : 'text-slate-300 hover:bg-ink-700')}>
              <Icon className="size-4" /> {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-line bg-ink-950/90 px-4 py-3 backdrop-blur sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3"><ModeBadge mode={mode} /><StatusChips /></div>
            <div className="flex items-center gap-2"><ThemeToggle /><ModeSwitch /></div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6">
          {mode === 'demo' ? (
            <Banner tone="warn" icon={<AlertTriangle className="size-4" />}>
              <b>DEMO MODE.</b> Sensor readings come from a software simulation, not from the gripper. Calibrations and operations are stored under the separate <code className="font-mono">demo/</code> namespace and are <b>not</b> hardware calibrations.
            </Banner>
          ) : conn !== 'connected' && (
            <Banner tone="bad" icon={<WifiOff className="size-4" />}>
              <b>LIVE MODE - no telemetry connection ({conn}).</b> {connDetail} No simulated values are being substituted; readings show as unavailable.
            </Banner>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  )
}
