import { freshness } from '@/lib/telemetry'
import { fmtMm, fmtN } from '@/lib/format'
import { staleAfter, useApp } from '@/store/app'
import { useTelemetry } from '@/store/telemetry'
import { SimTag } from './ModeBadge'
import { Pill, Stat, useNow } from './ui'

const yn = (v: boolean | null | undefined, yes = 'Yes', no = 'No') => (v == null ? 'unavailable' : v ? yes : no)

export default function TelemetryTiles() {
  const t = useTelemetry((s) => s.latest)
  const source = useTelemetry((s) => s.source)
  const stale = useApp(staleAfter)
  const now = useNow(500)
  const fr = freshness(t, now, stale)
  const tag = source === 'simulated' ? <SimTag /> : undefined
  return (
    <div className="space-y-3" data-testid="telemetry-tiles">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={fr.state === 'fresh' ? 'ok' : fr.state === 'none' ? 'bad' : 'warn'}>{fr.state === 'fresh' ? 'Fresh' : fr.state === 'stale' ? 'STALE' : fr.state === 'unknown' ? 'Freshness unknown' : 'No data'}</Pill>
        <span className="text-xs text-slate-400" data-testid="freshness-reason">{fr.reason}</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-3">
        <Stat label="Measured force" value={t?.measured_force_n == null ? <span className="text-base text-slate-500">unavailable</span> : fmtN(t.measured_force_n)} tone="text-meas" badge={tag} />
        <Stat label="Finger opening" value={t?.finger_opening_mm == null ? <span className="text-base text-slate-500">unavailable</span> : fmtMm(t.finger_opening_mm)} badge={tag} />
        <Stat label="Object detected" value={<span className="text-xl">{yn(t?.object_detected)}</span>} badge={tag} />
        <Stat label="Slip detected" value={<span className={t?.slip_detected ? 'text-xl text-bad' : 'text-xl'}>{yn(t?.slip_detected)}</span>} badge={tag} />
        <Stat label="Operation state" value={<span className="text-xl">{t?.operation_state ?? 'unavailable'}</span>} badge={tag} />
      </div>
    </div>
  )
}
