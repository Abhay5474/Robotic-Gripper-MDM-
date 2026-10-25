import { ArrowRight, Boxes, SlidersHorizontal, Activity } from 'lucide-react'
import { Link } from 'react-router-dom'
import ForceSummary from '@/components/ForceSummary'
import ResolutionBanner from '@/components/ResolutionBanner'
import SafetyPanel from '@/components/SafetyPanel'
import TelemetryTiles from '@/components/TelemetryTiles'
import InsightsPanel from '@/components/InsightsPanel'
import { Banner, Card, KV } from '@/components/ui'
import { useApp } from '@/store/app'
import { useForces } from '@/store/derived'

const STEPS = [
  { n: 1, t: 'Select object', d: 'Choose a preset or edit its properties.', to: '/objects', icon: Boxes },
  { n: 2, t: 'Resolve force', d: 'Saved calibration from Firebase, else an LLM estimate.', to: '/calibration', icon: SlidersHorizontal },
  { n: 3, t: 'Test & adjust', d: 'Use the slider on the real gripper until the grasp holds.', to: '/calibration', icon: SlidersHorizontal },
  { n: 4, t: 'Confirm & save', d: 'Explicit confirmation saves it for automatic reuse.', to: '/history', icon: Activity },
]

export default function Overview() {
  const health = useApp((s) => s.health)
  const healthError = useApp((s) => s.healthError)
  const object = useApp((s) => s.resolution.object)
  const f = useForces()
  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-semibold">Overview</h1><p className="text-sm text-slate-400">LLM initial recommendation → physical test → slider calibration → save → automatic reuse.</p></div>
      {healthError && <Banner tone="bad">Backend unreachable: {healthError} Start it with <code className="font-mono">uvicorn app.main:app_factory --factory</code>.</Banner>}
      <ResolutionBanner />
      <Card title={object ? `Current object: ${object.name}` : 'Current object'} action={<Link to="/objects" className="text-xs font-medium text-accent hover:underline">Change</Link>}><ForceSummary /></Card>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {STEPS.map((s) => (
          <Link key={s.n} to={s.to} className="group rounded-xl border border-line bg-ink-800/80 p-4 transition-colors hover:border-accent/60">
            <div className="flex items-center justify-between"><span className="grid size-7 place-items-center rounded-full bg-accent/15 text-sm font-bold text-accent">{s.n}</span><ArrowRight className="size-4 text-slate-500 group-hover:text-accent" /></div>
            <div className="mt-3 text-sm font-semibold">{s.t}</div><p className="mt-1 text-xs text-slate-400">{s.d}</p>
          </Link>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Safety assessment (current force)"><SafetyPanel safety={f.safety} /></Card>
        <Card title="Live status"><TelemetryTiles /></Card>
      </div>
      <InsightsPanel />
      {health && (
        <Card title="System configuration">
          <dl className="grid gap-x-8 sm:grid-cols-2">
            <div>
              <KV k="Gripper" v={health.limits.gripper_id} />
              <KV k="Force definition" v={health.limits.force_definition.replace(/_/g, ' ')} />
              <KV k="Force range" v={`${health.limits.min_force_n}–${health.limits.max_force_n} N (step ${health.limits.force_step_n})`} />
              <KV k="Limits source" v={health.limits.limits_source === 'demo' ? 'DEMO (unvalidated)' : 'hardware team'} />
            </div>
            <div>
              <KV k="LLM" v={health.llm.is_mock ? 'mock heuristic (not an LLM)' : `${health.llm.provider} · ${health.llm.model}`} />
              <KV k="Prompt version" v={health.llm.prompt_version} />
              <KV k="Store" v={`${health.store.backend}${health.store.dev_only ? ' (dev only)' : ''}`} />
              <KV k="Hardware command channel" v={health.command_channel === 'none' ? 'not configured' : health.command_channel} />
            </div>
          </dl>
        </Card>
      )}
    </div>
  )
}
