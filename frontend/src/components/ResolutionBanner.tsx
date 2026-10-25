import { AlertTriangle, CheckCircle2, CloudOff, Database, Sparkles } from 'lucide-react'
import { fmtDate, shortId } from '@/lib/format'
import { useApp } from '@/store/app'
import { Banner, Button, Spinner } from './ui'

/** Explains exactly how the current force was obtained (Case A / B / C of the decision flow). */
export default function ResolutionBanner() {
  const res = useApp((s) => s.resolution)
  const resolve = useApp((s) => s.resolve)
  const useCached = useApp((s) => s.useCachedLocal)
  const session = useApp((s) => !!s.session)

  if (res.status === 'idle') return <Banner tone="neutral" icon={<Database className="size-4" />} action={<Button variant="primary" onClick={() => resolve()}>Look up force</Button>}>Configuration not resolved yet. Look it up to check Firebase for a saved calibration (and query the LLM only if none exists).</Banner>
  if (res.status === 'loading') return <Banner icon={<Spinner />}>Checking Firebase for a saved calibration…</Banner>

  if (res.status === 'error' && res.error) {
    const e = res.error
    return (
      <div className="space-y-2">
        <Banner tone="bad" icon={<CloudOff className="size-4" />}
          action={e.retryable ? <Button onClick={() => resolve()}>Retry</Button> : undefined}>
          <b>{e.code === 'store_unavailable' ? 'Firebase unavailable - saved calibrations cannot be checked.' : e.code === 'llm_unavailable' || e.code === 'llm_invalid_response' || e.code === 'llm_not_configured' ? 'LLM recommendation unavailable.' : 'Could not resolve the configuration.'}</b>{' '}
          {e.message} <span className="text-slate-400">No force has been fabricated.</span>
        </Banner>
        {e.fallback_available && (
          <Banner tone="warn" icon={<AlertTriangle className="size-4" />}
            action={<Button variant="warn" onClick={() => { if (window.confirm('Query the LLM WITHOUT checking for a saved calibration? A calibration for this configuration may exist in Firebase.')) void resolve({ allowWithoutCheck: true }) }}>Proceed with LLM only</Button>}>
            Explicit fallback: ask the LLM for a recommendation without the calibration check. The result will be labelled “check skipped”.
          </Banner>
        )}
        {res.cached && !res.usingCached && (
          <Banner tone="warn" icon={<Database className="size-4" />} action={<Button variant="warn" onClick={useCached}>Use cached value</Button>}>
            <b>Cached local data available</b>: {res.cached.record.calibrated_force} N saved {fmtDate(res.cached.record.confirmed_at)} (record {shortId(res.cached.record.calibration_id)}). It was <u>not</u> verified with Firebase just now; current safety checks are applied before use.
          </Banner>
        )}
      </div>
    )
  }

  const d = res.data
  if (!d) return null
  const lk = d.calibration_lookup
  return (
    <div className="space-y-2" data-testid="resolution-banner">
      {d.source === 'calibration' && lk.record && (
        <Banner tone="ok" icon={<CheckCircle2 className="size-4" />}>
          <b>Calibrated force loaded from Firebase.</b> Previously calibrated force loaded - the LLM was not queried.
          <div className="mt-0.5 text-xs text-slate-300">Calibrated {fmtDate(lk.record.confirmed_at)} · record <code className="font-mono">{lk.record.calibration_id}</code> · {lk.record.confirmation_method === 'sensor_assisted' ? 'sensor-assisted confirmation' : 'manually confirmed'}{lk.record.mode === 'demo' && ' · DEMO record'}</div>
        </Banner>
      )}
      {d.source === 'llm' && (
        <Banner tone="neutral" icon={<Sparkles className="size-4" />}>
          <b>{lk.state === 'unavailable' ? 'LLM recommendation (calibration check skipped).' : 'Not yet calibrated - LLM initial recommendation.'}</b> This is an unvalidated starting point, not a safe force. {d.prediction && <span className="text-xs text-slate-400">Model {d.prediction.model_identifier} · prompt {d.prediction.prompt_version}{!d.prediction.persisted && ' · NOT saved to Firebase'}</span>}
        </Banner>
      )}
      {d.messages.filter((m) => /NOT reused|SKIPPED|clamped|unchanged/.test(m)).map((m) => <Banner key={m} tone="warn" icon={<AlertTriangle className="size-4" />}>{m}</Banner>)}
      {res.usingCached && <Banner tone="warn" icon={<Database className="size-4" />}>Using <b>cached local data</b> - not verified with Firebase.</Banner>}
      {!session && d.source === 'llm' && lk.state === 'found_valid' && (
        <Banner tone="neutral" action={<Button onClick={() => resolve()}>Back to saved value</Button>}>A saved calibration exists. The slider now shows a fresh LLM suggestion; the saved calibration is untouched.</Banner>
      )}
    </div>
  )
}
