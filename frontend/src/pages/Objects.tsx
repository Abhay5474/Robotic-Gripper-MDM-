import { ArrowRight, Info, Lock, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { FastLink as Link } from '@/components/FastLink'
import ObjectArt from '@/components/ObjectArt'
import ResolutionBanner from '@/components/ResolutionBanner'
import { Button, Card, KV, Pill, Skeleton, cx } from '@/components/ui'
import { api } from '@/lib/api'
import { CUSTOM_ID, objectKind, PRESETS, toForm, validateForm, type ObjectForm } from '@/lib/objects'
import type { Tone } from '@/lib/safety'
import type { LookupItem, LookupState } from '@/lib/types'
import { useApp } from '@/store/app'

function Field({ label, field, unit, hint, type = 'number', step }: { label: string; field: keyof ObjectForm; unit?: string; hint?: string; type?: string; step?: string }) {
  const form = useApp((s) => s.form)
  const edit = useApp((s) => s.editForm)
  const locked = useApp((s) => !!s.session)
  const err = validateForm(form).errors[field]
  const id = `f-${field}`
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-300">{label}</label>
      <div className="flex items-center gap-2">
        <input id={id} type={type} step={step} inputMode={type === 'number' ? 'decimal' : undefined} value={form[field]} disabled={locked}
          aria-invalid={!!err} aria-describedby={err ? `${id}-err` : hint ? `${id}-hint` : undefined}
          onChange={(e) => edit(field, e.target.value)}
          className={cx('w-full rounded-md border bg-ink-900 px-2.5 py-2 font-mono text-sm transition-colors focus:border-accent disabled:opacity-60', err ? 'border-bad' : 'border-line')} />
        {unit && <span className="w-8 text-xs text-slate-400">{unit}</span>}
      </div>
      {err ? <p id={`${id}-err`} className="mt-1 text-xs text-bad">{err}</p> : hint && <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

const STATUS: Record<LookupState, { tone: Tone; label: (i: LookupItem) => string }> = {
  found_valid: { tone: 'ok', label: (i) => `Calibrated · ${i.calibrated_force?.toFixed(2)} N` },
  not_found: { tone: 'neutral', label: () => 'Not calibrated' },
  stale: { tone: 'warn', label: () => 'Calibration stale' },
  invalidated: { tone: 'bad', label: () => 'Invalidated' },
  safety_failed: { tone: 'bad', label: () => 'Fails safety re-check' },
  inconsistent: { tone: 'warn', label: () => 'Index inconsistent' },
  skipped: { tone: 'neutral', label: () => 'Not checked' },
  unavailable: { tone: 'neutral', label: () => 'Status unavailable' },
}

/** Calibration status of every preset (one backend call, never the LLM). */
function usePresetStatus(trigger: string) {
  const mode = useApp((s) => s.settings.mode)
  const online = useApp((s) => !!s.health)
  const [items, setItems] = useState<Record<string, LookupItem> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    if (!online) return
    setError(null)
    api.lookup(mode, PRESETS).then((r) => setItems(Object.fromEntries(r.items.map((i) => [i.object_id, i])))).catch((e) => { setItems(null); setError(e.message) })
  }, [mode, online])
  useEffect(() => { load() }, [load, trigger])
  return { items, error, reload: load }
}

export default function Objects() {
  const presetId = useApp((s) => s.presetId)
  const select = useApp((s) => s.selectPreset)
  const form = useApp((s) => s.form)
  const edit = useApp((s) => s.editForm)
  const resolve = useApp((s) => s.resolve)
  const res = useApp((s) => s.resolution)
  const locked = useApp((s) => !!s.session)
  const valid = validateForm(form).value != null
  const isPreset = presetId !== CUSTOM_ID
  const preset = PRESETS.find((p) => p.object_id === presetId)
  const edited = !!preset && JSON.stringify(toForm(preset)) !== JSON.stringify(form)
  const status = usePresetStatus(`${res.data?.configuration_key}:${res.data?.calibration_lookup.state}:${res.data?.selected_force_n}`)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Object Selection</h1>
          <p className="text-sm text-slate-400">Pick what the gripper will handle. Badges show whether a reusable calibration exists, without asking the LLM.</p>
        </div>
        <Button variant="ghost" onClick={status.reload} title="Refresh calibration status"><RefreshCw className="size-4" />Refresh status</Button>
      </div>
      {locked && <div className="flex items-center gap-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn"><Lock className="size-4" /> A calibration is in progress. Finish or cancel it on the Force &amp; Calibration page before changing the object.</div>}

      <div role="radiogroup" aria-label="Object presets" className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="object-gallery">
        {PRESETS.map((p) => {
          const active = p.object_id === presetId
          const item = status.items?.[p.object_id]
          const st = item ? STATUS[item.state] : null
          return (
            <button key={p.object_id} type="button" role="radio" aria-checked={active} disabled={locked} onClick={() => select(p.object_id)} data-testid={`preset-${p.object_id}`}
              className={cx('group relative flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60',
                active ? 'border-accent bg-accent/8 shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-accent)_22%,transparent)]' : 'border-line bg-ink-800/80 hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-[var(--shadow-card)]')}>
              <div className="flex w-full items-start justify-between gap-2">
                <ObjectArt kind={objectKind(p)} className="size-14 transition-transform group-hover:scale-105" />
                {active && edited && <Pill tone="warn">edited</Pill>}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-100">{p.name}</div>
                <div className="truncate text-[11px] text-slate-400">{p.mass_g} g · μ {p.friction_coefficient.toFixed(2)} · {p.fragility}</div>
              </div>
              {status.error ? <Pill>status unavailable</Pill> : st && item ? <Pill tone={st.tone} title={item.reason ?? undefined}>{st.label(item)}</Pill> : <Skeleton className="h-5 w-24 rounded-full" />}
            </button>
          )
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3" title="Object properties" subtitle="Preset values are illustrative ESTIMATES, not measurements. Replace them with measured values.">
          <div className="mb-4">
            <label htmlFor="preset" className="mb-1 block text-xs font-medium text-slate-300">Preset</label>
            <select id="preset" value={presetId} disabled={locked} onChange={(e) => select(e.target.value)} className="w-full rounded-md border border-line bg-ink-900 px-2.5 py-2 text-sm disabled:opacity-60">
              {PRESETS.map((p) => <option key={p.object_id} value={p.object_id}>{p.name}</option>)}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Object name" field="name" type="text" hint={isPreset ? 'Display label only - calibrations are keyed on properties, not the name.' : 'The name also forms the object identifier.'} />
            <Field label="Material" field="material" type="text" />
            <Field label="Mass" field="mass_g" unit="g" step="1" />
            <Field label="Estimated friction coefficient" field="friction_coefficient" hint="Pad-to-object Coulomb μ, 0–2. Estimate." step="0.01" />
            <Field label="Width (between finger pads)" field="width_mm" unit="mm" step="0.5" />
            <Field label="Height" field="height_mm" unit="mm" step="0.5" />
            <Field label="Depth" field="depth_mm" unit="mm" step="0.5" />
            <Field label="Max allowable contact force (optional)" field="max_contact_force_n" unit="N" hint="Per finger, if known. Leave empty if unknown." step="0.5" />
            <div>
              <label htmlFor="fragility" className="mb-1 block text-xs font-medium text-slate-300">Fragility classification</label>
              <select id="fragility" value={form.fragility} disabled={locked} onChange={(e) => edit('fragility', e.target.value)} className="w-full rounded-md border border-line bg-ink-900 px-2.5 py-2 text-sm disabled:opacity-60">
                <option value="robust">Robust</option><option value="moderate">Moderate</option><option value="fragile">Fragile</option>
              </select>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="primary" disabled={!valid || locked || res.status === 'loading'} onClick={() => resolve()}>Apply &amp; look up force</Button>
            <span className="flex items-center gap-1.5 text-xs text-slate-400"><Info className="size-3.5" />Any change to a property looks up a different calibration. Values reset the slider until looked up.</span>
          </div>
        </Card>
        <div className="space-y-4 lg:col-span-2">
          <Card title="Resolution" subtitle="Firebase is checked first; the LLM is queried only when no valid calibration exists.">
            <ResolutionBanner />
            {res.data && (
              <dl className="mt-3">
                <KV k="Configuration key" v={<span className="break-all text-xs">{res.data.configuration_key}</span>} />
                <KV k="Source" v={res.data.source === 'calibration' ? 'Saved calibration' : 'LLM recommendation'} />
                <KV k="LLM called" v={res.data.llm_called ? 'yes' : 'no'} />
                <KV k="Selected force" v={`${res.data.selected_force_n} N`} />
              </dl>
            )}
            {res.data && <div className="mt-3"><Link to="/calibration" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">Continue to force &amp; calibration <ArrowRight className="size-4" /></Link></div>}
          </Card>
          <Card title="What is in the key?">
            <p className="text-xs leading-relaxed text-slate-400">The configuration key hashes object id, mass, width/height/depth, material, friction estimate, fragility and the gripper identity/force definition. Changing any of them selects a different calibration. Contact-force limits are re-checked on every load instead. <Pill>{res.data?.configuration_key.slice(0, 12) ?? 'cfg_…'}…</Pill></p>
          </Card>
        </div>
      </div>
    </div>
  )
}
