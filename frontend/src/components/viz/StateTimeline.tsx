import type { HistPoint } from '@/store/telemetry'
import { useThemeColors } from '@/store/theme'

const ORDER = ['idle', 'approaching', 'closing', 'holding', 'lifting', 'transporting', 'releasing', 'complete', 'slipped', 'aborted']

/** Swim-lane of operation states over the same time window as the charts. Gaps are shown as "no state". */
export default function StateTimeline({ history }: { history: HistPoint[] }) {
  const c = useThemeColors()
  if (history.length < 2) return null
  const palette = [c.axis, c.opening, c.accent, c.cal, c.llm, c.meas, c.warn, c.ok, c.bad, c.bad]
  const color = (s: string | null) => (s == null ? c.grid : palette[Math.max(0, ORDER.indexOf(s)) % palette.length] ?? c.axis)
  const t0 = history[0].t, total = Math.max(1, history[history.length - 1].t - t0)
  const segs: { state: string | null; from: number; to: number }[] = []
  history.forEach((h, i) => {
    const to = history[i + 1]?.t ?? h.t
    const last = segs[segs.length - 1]
    if (last && last.state === h.state) last.to = to
    else segs.push({ state: h.state, from: h.t, to })
  })
  return (
    <figure>
      <figcaption className="mb-1 text-xs"><b className="text-slate-100">Operation state</b> <span className="text-slate-400">(same time span as the charts)</span></figcaption>
      <div className="flex h-7 overflow-hidden rounded-md border border-line" style={{ marginLeft: 36, marginRight: 16 }} role="img" aria-label={`Operation states: ${segs.map((s) => s.state ?? 'none').join(', ')}`}>
        {segs.map((s, i) => (
          <div key={i} title={`${s.state ?? 'no state'} · ${((s.to - s.from) / 1000).toFixed(1)} s`} className="grid min-w-0 place-items-center overflow-hidden text-[10px] font-semibold" style={{ width: `${((s.to - s.from) / total) * 100}%`, background: color(s.state), color: c.on }}>
            <span className="truncate px-1 mix-blend-normal">{s.state ?? ''}</span>
          </div>
        ))}
      </div>
    </figure>
  )
}
