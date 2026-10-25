import { Info, Lock } from 'lucide-react'
import { Link } from 'react-router-dom'
import ResolutionBanner from '@/components/ResolutionBanner'
import { Button, Card, KV, Pill, cx } from '@/components/ui'
import { CUSTOM_ID, PRESETS, validateForm, type ObjectForm } from '@/lib/objects'
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
          className={cx('w-full rounded-md border bg-ink-900 px-2.5 py-2 font-mono text-sm disabled:opacity-60', err ? 'border-bad' : 'border-line')} />
        {unit && <span className="w-8 text-xs text-slate-400">{unit}</span>}
      </div>
      {err ? <p id={`${id}-err`} className="mt-1 text-xs text-bad">{err}</p> : hint && <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
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
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Object Selection</h1>
      {locked && <div className="flex items-center gap-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn"><Lock className="size-4" /> A calibration is in progress. Finish or cancel it on the Force &amp; Calibration page before changing the object.</div>}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3" title="Object properties" subtitle="Preset values are illustrative ESTIMATES, not measurements. Replace them with measured values.">
          <div className="mb-4">
            <label htmlFor="preset" className="mb-1 block text-xs font-medium text-slate-300">Object</label>
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
            {res.data && <div className="mt-3"><Link to="/calibration" className="text-sm font-medium text-accent hover:underline">Continue to force &amp; calibration →</Link></div>}
          </Card>
          <Card title="What is in the key?">
            <p className="text-xs leading-relaxed text-slate-400">The configuration key hashes object id, mass, width/height/depth, material, friction estimate, fragility and the gripper identity/force definition. Changing any of them selects a different calibration. Contact-force limits are re-checked on every load instead. <Pill>{res.data?.configuration_key.slice(0, 12) ?? 'cfg_…'}…</Pill></p>
          </Card>
        </div>
      </div>
    </div>
  )
}
