import { Activity, ArrowRight, Boxes, Cpu, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { FastLink as Link } from '@/components/FastLink'
import { CAL_TONE } from '@/components/ForceSummary'
import ForceSummary from '@/components/ForceSummary'
import InsightsPanel from '@/components/InsightsPanel'
import ObjectArt from '@/components/ObjectArt'
import ResolutionBanner from '@/components/ResolutionBanner'
import SafetyPanel, { marginOf } from '@/components/SafetyPanel'
import SceneView from '@/components/SceneView'
import TelemetryTiles from '@/components/TelemetryTiles'
import { Banner, Card, KV, Pill } from '@/components/ui'
import { fmtMargin } from '@/lib/mechanics'
import { objectKind } from '@/lib/objects'
import { useApp } from '@/store/app'
import { useForces } from '@/store/derived'

const STEPS = [
  { n: 1, t: 'Select object', d: 'Pick a preset or edit its measured properties.', to: '/objects', icon: Boxes },
  { n: 2, t: 'Resolve force', d: 'A saved calibration from Firebase, otherwise one LLM estimate.', to: '/calibration', icon: SlidersHorizontal },
  { n: 3, t: 'Test & adjust', d: 'Run it on the gripper; adjust the slider until the grasp holds.', to: '/calibration', icon: Cpu },
  { n: 4, t: 'Confirm & reuse', d: 'Explicit confirmation saves it; the next selection reuses it.', to: '/history', icon: ShieldCheck },
]

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export default function Overview() {
  const health = useApp((s) => s.health)
  const healthError = useApp((s) => s.healthError)
  const object = useApp((s) => s.resolution.object)
  const f = useForces()
  const m = f.safety ? marginOf(f.safety) : null
  return (
    <div className="space-y-4">
      {healthError && <Banner tone="bad">Backend unreachable: {healthError} Start it with <code className="font-mono">uvicorn app.main:app_factory --factory</code>.</Banner>}

      <section className="relative overflow-hidden rounded-2xl border border-line bg-ink-800/80 shadow-[var(--shadow-card)]" data-testid="overview-hero">
        <div className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full bg-accent/10 blur-3xl" aria-hidden />
        <div className="grid gap-0 lg:grid-cols-5">
          <div className="relative flex flex-col justify-between gap-5 p-5 sm:p-6 lg:col-span-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Pick-and-place cell</div>
              <h1 className="mt-2 text-2xl font-bold leading-tight text-slate-100 sm:text-3xl">Grip forces that are tested, saved and reused.</h1>
              <p className="mt-2 text-sm text-slate-400">LLM initial recommendation → physical test → slider calibration → saved to Firebase → reused automatically, with no further LLM call.</p>
            </div>
            {object ? (
              <div className="rounded-xl border border-line bg-ink-900/60 p-4">
                <div className="flex items-center gap-3">
                  <ObjectArt kind={objectKind(object)} className="size-14 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-slate-100">{object.name}</div>
                    <div className="text-xs text-slate-400">{object.mass_g} g · {object.width_mm}×{object.height_mm}×{object.depth_mm} mm · μ≈{object.friction_coefficient}</div>
                  </div>
                  <Link to="/objects" className="inline-flex shrink-0 items-center gap-1 self-start rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-accent/10"><Boxes className="size-3.5" />Change</Link>
                </div>
                <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-slate-400">Selected force</div>
                    <div className="font-mono text-3xl font-bold tabular-nums text-accent">{f.selected == null ? '—' : f.selected.toFixed(2)}<span className="ml-1 text-base text-slate-400">N</span></div>
                  </div>
                  <div className="flex flex-col items-start gap-1.5 sm:items-end">
                    <Pill tone={CAL_TONE[f.state]}>{f.stateLabel}</Pill>
                    {m?.margin != null && <Pill tone={m.tone}>grip margin {fmtMargin(m.margin)}</Pill>}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-line p-4 text-sm text-slate-400">
                No object resolved yet.
                <Link to="/objects" className="inline-flex items-center gap-1 font-medium text-accent hover:underline"><Boxes className="size-4" />Choose object</Link>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Link to="/calibration" className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-ink-950 hover:brightness-110">Calibrate force <ArrowRight className="size-4" /></Link>
              <Link to="/control" className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-ink-700 px-3.5 py-2 text-sm text-slate-100 hover:bg-ink-600"><Cpu className="size-4" />Run pick-and-place</Link>
            </div>
          </div>
          <div className="p-2 lg:col-span-3 lg:pl-0">
            <SceneView height="h-[20rem] sm:h-[24rem] lg:h-full lg:min-h-[24rem]" defaultView="cell" autoRotate={!reducedMotion()} autoRotateFor={20} />
          </div>
        </div>
      </section>

      <ResolutionBanner />
      <Card title="Forces"><ForceSummary /></Card>

      <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="How it works">
        {STEPS.map((s) => (
          <li key={s.n}>
            <Link to={s.to} className="group flex h-full flex-col rounded-xl border border-line bg-ink-800/80 p-4 transition-all hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-[var(--shadow-card)]">
              <div className="flex items-center justify-between">
                <span className="grid size-8 place-items-center rounded-lg bg-accent/15 text-accent"><s.icon className="size-4" /></span>
                <span className="text-xs font-semibold text-slate-500">Step {s.n}</span>
              </div>
              <div className="mt-3 text-sm font-semibold text-slate-100">{s.t}</div>
              <p className="mt-1 flex-1 text-xs text-slate-400">{s.d}</p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent opacity-70 transition-opacity group-hover:opacity-100">Open <ArrowRight className="size-3.5" /></span>
            </Link>
          </li>
        ))}
      </ol>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Safety assessment (current force)"><SafetyPanel safety={f.safety} /></Card>
        <Card title="Live status" action={<Link to="/telemetry" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"><Activity className="size-3.5" />Telemetry</Link>}><TelemetryTiles /></Card>
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
