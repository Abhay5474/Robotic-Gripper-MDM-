import { gripHeight, MM } from '@/lib/kinematics'
import { fmtMargin, graspBalance } from '@/lib/mechanics'
import { objectKind } from '@/lib/objects'
import type { GripperLimits, ObjectProps } from '@/lib/types'
import { cx } from '../ui'

const W = 380, H = 280, FLOOR = 252, CX = 190
const TONE_TEXT = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' } as const
const TONE_FILL = { ok: 'fill-ok', warn: 'fill-warn', bad: 'fill-bad' } as const

function Arrow({ x1, y1, x2, y2, className }: { x1: number; y1: number; x2: number; y2: number; className: string }) {
  const a = Math.atan2(y2 - y1, x2 - x1), hl = 8
  const p = (da: number) => `${x2 - hl * Math.cos(a + da)},${y2 - hl * Math.sin(a + da)}`
  return (
    <g className={className}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={2.5} className="stroke-current" />
      <polygon points={`${x2},${y2} ${p(0.45)} ${p(-0.45)}`} className="fill-current" />
    </g>
  )
}

/**
 * Engineering front view of the grasp with a free-body diagram.
 * Normal force N per finger, friction μN at each pad, and the vertical design load m(g+a).
 * Grip margin = (finger_count · μ · N) / (m(g+a)) = N / N_required.
 */
export default function GripDiagram({ object, limits, force, measured, openingMm, compact = false }: {
  object: ObjectProps; limits: GripperLimits; force: number | null; measured?: number | null; openingMm?: number | null; compact?: boolean
}) {
  const kind = objectKind(object)
  const N = force ?? 0
  const b = graspBalance(object, limits, N)
  const bm = measured != null && measured > 0 ? graspBalance(object, limits, measured) : null // 0 N = nothing gripped
  // scale so the widest of (object, jaw stroke) and the object height fit the drawing
  const sc = Math.min(170 / Math.max(limits.max_opening_mm, object.width_mm), 150 / object.height_mm)
  const ow = object.width_mm * sc, oh = object.height_mm * sc
  const open = (openingMm != null && Number.isFinite(openingMm) ? openingMm : object.width_mm) * sc
  const padC = FLOOR - (gripHeight(object.height_mm * MM) / MM) * sc
  const padH = Math.max(18, 45 * sc), padW = 6, fingerW = 13
  const housingY = 18, housingH = 26
  const fingerTop = housingY + housingH
  const fingerBottom = padC + padH / 2 + 8
  const lx = CX - open / 2, rx = CX + open / 2
  const housingW = limits.max_opening_mm * sc + 2 * (padW + fingerW) + 34
  const arrowLen = 18 + 44 * Math.min(1, N / limits.max_force_n)
  const fricLen = 10 + 38 * Math.min(1, b.frictionPerFinger / Math.max(b.load, 1e-6))
  const loadLen = 14 + 50 * Math.min(1.5, b.load / Math.max(b.frictionCapacity, 1e-6)) / 1.5
  const top = FLOOR - oh
  const summary = `Free-body diagram. Normal force ${N.toFixed(2)} N per finger, friction capacity ${b.frictionCapacity.toFixed(2)} N against a load of ${b.load.toFixed(2)} N: grip margin ${fmtMargin(b.margin)}.`

  return (
    <figure className={cx('grid gap-3', !compact && 'sm:grid-cols-[minmax(0,1fr)_minmax(0,13rem)]')} data-testid="grip-diagram">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} className="w-full text-slate-400">
        <defs>
          <pattern id="fbd-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="7" className="stroke-slate-500" strokeWidth="1.2" />
          </pattern>
        </defs>
        {/* ground */}
        <rect x={20} y={FLOOR} width={W - 40} height={10} fill="url(#fbd-hatch)" opacity={0.6} />
        <line x1={20} y1={FLOOR} x2={W - 20} y2={FLOOR} className="stroke-slate-400" strokeWidth={1.5} />
        {/* gripper body */}
        <rect x={CX - housingW / 2} y={housingY} width={housingW} height={housingH} rx={6} className="fill-ink-700 stroke-line" strokeWidth={1.5} />
        <rect x={CX - housingW / 2} y={housingY + housingH / 2 - 3} width={housingW} height={6} className="fill-accent" opacity={0.85} />
        {[-1, 1].map((s) => {
          const inner = s < 0 ? lx : rx
          const fx = inner + s * (padW + fingerW / 2)
          return (
            <g key={s}>
              <rect x={fx - fingerW / 2} y={fingerTop} width={fingerW} height={Math.max(10, fingerBottom - fingerTop)} rx={3} className="fill-ink-600 stroke-slate-500" strokeWidth={1} />
              <rect x={s < 0 ? inner - padW : inner} y={padC - padH / 2} width={padW} height={padH} rx={2} className="fill-slate-300" />
            </g>
          )
        })}
        {/* object */}
        {kind === 'ball'
          ? <ellipse cx={CX} cy={FLOOR - oh / 2} rx={ow / 2} ry={oh / 2} className="fill-accent/15 stroke-accent" strokeWidth={1.8} />
          : kind === 'bottle' || kind === 'glass'
            ? <path d={`M${CX - ow / 2},${FLOOR} V${FLOOR - oh * 0.68} Q${CX - ow / 2},${FLOOR - oh * 0.8} ${CX - ow * 0.18},${FLOOR - oh * 0.86} V${top} H${CX + ow * 0.18} V${FLOOR - oh * 0.86} Q${CX + ow / 2},${FLOOR - oh * 0.8} ${CX + ow / 2},${FLOOR - oh * 0.68} V${FLOOR} Z`} className="fill-accent/15 stroke-accent" strokeWidth={1.8} />
            : <rect x={CX - ow / 2} y={top} width={ow} height={oh} rx={kind === 'cup' ? 4 : 2} className="fill-accent/15 stroke-accent" strokeWidth={1.8} />}
        <circle cx={CX} cy={FLOOR - oh / 2} r={3} className="fill-slate-300" />
        {/* normal forces (squeeze) */}
        <Arrow x1={lx - padW - fingerW - 4 - arrowLen} y1={padC} x2={lx - padW - fingerW - 4} y2={padC} className="text-meas" />
        <Arrow x1={rx + padW + fingerW + 4 + arrowLen} y1={padC} x2={rx + padW + fingerW + 4} y2={padC} className="text-meas" />
        <text x={lx - padW - fingerW - 8 - arrowLen / 2} y={padC - 9} textAnchor="middle" fontSize={13} fontWeight={700} className="fill-meas">N {N.toFixed(2)}</text>
        <text x={rx + padW + fingerW + 8 + arrowLen / 2} y={padC - 9} textAnchor="middle" fontSize={13} fontWeight={700} className="fill-meas">N {N.toFixed(2)}</text>
        {/* friction at the contacts (upward) */}
        <Arrow x1={lx + 5} y1={padC + padH / 2} x2={lx + 5} y2={padC + padH / 2 - fricLen} className="text-ok" />
        <Arrow x1={rx - 5} y1={padC + padH / 2} x2={rx - 5} y2={padC + padH / 2 - fricLen} className="text-ok" />
        <text x={CX} y={Math.max(fingerTop + 26, padC - padH / 2 - fricLen - 4)} textAnchor="middle" fontSize={12.5} fontWeight={600} className="fill-ok">μN {b.frictionPerFinger.toFixed(2)} each</text>
        {/* design load */}
        <Arrow x1={CX} y1={FLOOR - oh / 2} x2={CX} y2={FLOOR - oh / 2 + loadLen} className="text-bad" />
        <text x={CX + 8} y={Math.min(FLOOR - 4, FLOOR - oh / 2 + loadLen - 2)} fontSize={12.5} fontWeight={600} className="fill-bad">m(g+a) {b.load.toFixed(2)}</text>
        {/* opening dimension */}
        <line x1={lx} y1={fingerTop + 12} x2={rx} y2={fingerTop + 12} className="stroke-slate-400" strokeWidth={1} />
        <line x1={lx} y1={fingerTop + 6} x2={lx} y2={fingerTop + 18} className="stroke-slate-400" strokeWidth={1} />
        <line x1={rx} y1={fingerTop + 6} x2={rx} y2={fingerTop + 18} className="stroke-slate-400" strokeWidth={1} />
        <text x={CX} y={fingerTop + 9} textAnchor="middle" fontSize={12} className="fill-slate-400">
          {openingMm != null ? `opening ${openingMm.toFixed(1)} mm` : `width ${object.width_mm} mm`}
        </text>
      </svg>
      <dl className={cx('self-center text-sm', compact ? 'grid grid-cols-1 gap-1.5 sm:grid-cols-2 sm:gap-x-6' : 'space-y-1.5')}>
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Normal / finger</dt><dd className="font-mono text-meas">{N.toFixed(2)} N</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Friction capacity</dt><dd className="font-mono text-ok">{b.frictionCapacity.toFixed(2)} N</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-400">Design load m(g+a)</dt><dd className="font-mono text-bad">{b.load.toFixed(2)} N</dd></div>
        <div className={cx('mt-2 rounded-lg border border-line bg-ink-900/60 p-2.5', compact && 'sm:col-span-2')} data-testid="grip-margin">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs uppercase tracking-wider text-slate-400">Grip margin</span>
            <span className={cx('font-mono text-xl font-bold', TONE_TEXT[b.tone])}>{fmtMargin(b.margin)}</span>
          </div>
          <MarginBar margin={b.margin} target={limits.holding_safety_factor} tone={b.tone} />
          <p className="mt-1 text-[11px] text-slate-500">1.0 = estimated slip threshold · target ×{limits.holding_safety_factor}{bm && <> · measured <span className={cx('font-mono', TONE_TEXT[bm.tone])}>{fmtMargin(bm.margin)}</span></>}</p>
        </div>
      </dl>
    </figure>
  )
}

export function MarginBar({ margin, target, tone }: { margin: number | null; target: number; tone: 'ok' | 'warn' | 'bad' }) {
  const max = Math.max(3, target * 1.6)
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`
  return (
    <svg viewBox="0 0 200 14" className="mt-1.5 w-full" aria-hidden>
      <rect x={0} y={4} width={200} height={6} rx={3} className="fill-ink-600" />
      {margin != null && <rect x={0} y={4} width={(Math.min(max, margin) / max) * 200} height={6} rx={3} className={TONE_FILL[tone]} />}
      <line x1={pct(1)} x2={pct(1)} y1={0} y2={14} className="stroke-bad" strokeWidth={1.5} />
      <line x1={pct(target)} x2={pct(target)} y1={0} y2={14} className="stroke-ok" strokeWidth={1.5} strokeDasharray="2 2" />
    </svg>
  )
}
