import { useEffect, useState } from 'react'
import { Banner, Button, Card, KV, Pill } from '@/components/ui'
import ThemeToggle from '@/components/ThemeToggle'
import { firebaseConfigured, getAuthSafe, onUser, signIn, signOutUser } from '@/lib/firebase'
import { getApiToken, setApiToken } from '@/lib/settings'
import { useApp } from '@/store/app'
import { useTelemetry } from '@/store/telemetry'

export default function SettingsPage() {
  const { settings, health, updateSettings, init } = useApp()
  const conn = useTelemetry((s) => s.conn)
  const [token, setToken] = useState(getApiToken() ?? '')
  const [email, setEmail] = useState(''), [pw, setPw] = useState('')
  const [user, setUser] = useState<string | null>(null)
  const [authErr, setAuthErr] = useState<string | null>(null)
  useEffect(() => onUser((u) => setUser(u?.email ?? null)), [])
  const l = health?.limits
  const num = (v: string, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d)
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Gripper configuration (from backend)" subtitle="Authoritative values are set in backend/.env so the safety checks cannot be altered from the browser.">
          {l ? (
            <dl>
              <KV k="Gripper id" v={l.gripper_id} /><KV k="Fingers" v={l.finger_count} /><KV k="Pad material" v={l.contact_pad_material} />
              <KV k="Force definition" v={l.force_definition.replace(/_/g, ' ')} /><KV k="Force unit" v={l.force_unit} />
              <KV k="Force range" v={`${l.min_force_n} – ${l.max_force_n} N`} /><KV k="Slider step" v={`${l.force_step_n} N`} />
              <KV k="Max opening" v={`${l.max_opening_mm} mm`} /><KV k="Lift acceleration" v={`${l.lift_acceleration_m_s2} m/s²`} /><KV k="Holding safety factor" v={l.holding_safety_factor} />
              <KV k="Limits source" v={<Pill tone={l.limits_source === 'demo' ? 'warn' : 'ok'}>{l.limits_source === 'demo' ? 'DEMO - not validated' : 'hardware team'}</Pill>} />
              <KV k="Calibration max age" v={health.calibration_max_age_days ? `${health.calibration_max_age_days} days` : 'never expires'} />
              <KV k="Safety override" v={health.allow_safety_override ? 'enabled' : 'disabled'} />
              <KV k="Command channel" v={health.command_channel === 'none' ? 'not configured (software target only)' : health.command_channel} />
            </dl>
          ) : <Banner tone="bad">Backend not reachable. <Button variant="ghost" onClick={() => void init()}>Retry</Button></Banner>}
          {l?.limits_source === 'demo' && <div className="mt-3"><Banner tone="warn">These limits are placeholders. The hardware team must supply and validate the real range before use with a physical gripper.</Banner></div>}
        </Card>
        <div className="space-y-4">
          <Card title="Interface preferences">
            <div className="space-y-3 text-sm">
              <div><span className="mb-1 block text-xs text-slate-400">Colour theme (light = faint red &amp; white)</span><ThemeToggle labels /></div>
              <label className="block"><span className="mb-1 block text-xs text-slate-400">Telemetry stale after (s) - blank uses the backend default ({health?.telemetry.stale_after_s ?? '—'})</span>
                <input type="number" min="0.5" step="0.5" value={settings.staleAfterS ?? ''} onChange={(e) => updateSettings({ staleAfterS: e.target.value === '' ? null : num(e.target.value, 5) })} className="w-32 rounded-md border border-line bg-ink-900 px-2 py-1.5 font-mono" /></label>
              <label className="block"><span className="mb-1 block text-xs text-slate-400">Fine adjustment (× slider step)</span>
                <input type="number" min="1" step="1" value={settings.fineSteps} onChange={(e) => updateSettings({ fineSteps: Math.round(num(e.target.value, 1)) })} className="w-32 rounded-md border border-line bg-ink-900 px-2 py-1.5 font-mono" /></label>
              <label className="block"><span className="mb-1 block text-xs text-slate-400">Coarse adjustment (× slider step)</span>
                <input type="number" min="1" step="1" value={settings.coarseSteps} onChange={(e) => updateSettings({ coarseSteps: Math.round(num(e.target.value, 5)) })} className="w-32 rounded-md border border-line bg-ink-900 px-2 py-1.5 font-mono" /></label>
              <label className="block"><span className="mb-1 block text-xs text-slate-400">Firebase telemetry path</span>
                <input value={settings.telemetryPath} onChange={(e) => updateSettings({ telemetryPath: e.target.value.trim() || 'gripper_telemetry' })} className="w-full rounded-md border border-line bg-ink-900 px-2 py-1.5 font-mono" /></label>
            </div>
          </Card>
          <Card title="Live data connection">
            <dl><KV k="Firebase web config" v={firebaseConfigured ? 'present' : 'missing (VITE_FIREBASE_*)'} /><KV k="Telemetry connection" v={conn} /><KV k="Backend auth mode" v={health?.auth_mode ?? '—'} /></dl>
            {firebaseConfigured && getAuthSafe() && (
              <div className="mt-3 space-y-2 border-t border-line pt-3">
                {user ? <div className="flex items-center justify-between text-sm"><span>Signed in as {user}</span><Button onClick={() => void signOutUser()}>Sign out</Button></div> : (
                  <form className="flex flex-wrap gap-2" onSubmit={async (e) => { e.preventDefault(); setAuthErr(null); try { await signIn(email, pw); setPw('') } catch (x) { setAuthErr((x as Error).message) } }}>
                    <input aria-label="Email" type="email" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} className="min-w-0 flex-1 rounded-md border border-line bg-ink-900 px-2 py-1.5 text-sm" />
                    <input aria-label="Password" type="password" placeholder="password" value={pw} onChange={(e) => setPw(e.target.value)} className="min-w-0 flex-1 rounded-md border border-line bg-ink-900 px-2 py-1.5 text-sm" />
                    <Button type="submit">Sign in</Button>
                  </form>
                )}
                {authErr && <Banner tone="bad">{authErr}</Banner>}
              </div>
            )}
            {health && health.auth_mode === 'bearer' && (
              <label className="mt-3 block text-sm"><span className="mb-1 block text-xs text-slate-400">Backend access token (kept in this tab only, never in the bundle)</span>
                <input type="password" value={token} onChange={(e) => { setToken(e.target.value); setApiToken(e.target.value || null) }} className="w-full rounded-md border border-line bg-ink-900 px-2 py-1.5 font-mono text-sm" /></label>
            )}
          </Card>
          <Card title="Local cache">
            <p className="mb-2 text-xs text-slate-400">Calibrations loaded earlier are cached in this browser and used only when Firebase is unreachable (always labelled as cached).</p>
            <Button variant="danger" onClick={() => { try { localStorage.removeItem('gripsense.calibrationCache.v1') } catch { /* ignore */ } }}>Clear cached calibrations</Button>
          </Card>
        </div>
      </div>
    </div>
  )
}
