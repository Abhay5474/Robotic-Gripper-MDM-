import type { ObjectKind } from '@/lib/objects'

/** Small isometric-style illustrations for the object gallery (pure SVG, theme-aware outlines). */
export default function ObjectArt({ kind, className }: { kind: ObjectKind; className?: string }) {
  const line = 'stroke-slate-500'
  return (
    <svg viewBox="0 0 64 64" className={className || 'size-14'} aria-hidden>
      <ellipse cx="32" cy="58" rx="18" ry="3" className="fill-slate-500/20" />
      {kind === 'bottle' && (<g strokeWidth="1.4" className={line}>
        <path d="M24 26c0-4 3-6 5-8v-6h6v6c2 2 5 4 5 8v28a3 3 0 0 1-3 3H27a3 3 0 0 1-3-3Z" fill="#bfe3f5" fillOpacity=".85" />
        <rect x="24" y="32" width="16" height="10" fill="#1d4ed8" stroke="none" />
        <rect x="28" y="7" width="8" height="5" rx="1.2" fill="#1d4ed8" />
        <path d="M28 30v20" stroke="#fff" strokeOpacity=".7" strokeLinecap="round" />
      </g>)}
      {kind === 'can' && (<g strokeWidth="1.4" className={line}>
        <path d="M19 14v38c0 2.2 5.8 4 13 4s13-1.8 13-4V14" fill="#dfe3e8" />
        <path d="M19 22h26v24H19z" fill="#b91c1c" stroke="none" />
        <path d="M19 38c6-4 12 4 26-2" stroke="#fff" strokeWidth="2.2" fill="none" />
        <ellipse cx="32" cy="14" rx="13" ry="4" fill="#eef1f4" />
        <path d="M30 13h5" strokeLinecap="round" />
      </g>)}
      {kind === 'block' && (<g strokeWidth="1.2" className={line}>
        <path d="M32 10 52 20 32 30 12 20Z" fill="#dcae74" />
        <path d="M12 20 32 30v24L12 44Z" fill="#bf8a50" />
        <path d="M32 30 52 20v24L32 54Z" fill="#a1703e" />
        <path d="M17 26c5 2 8 5 10 10M37 35c4-3 9-5 11-9M22 17c4-2 10-1 14 2" stroke="#7a4f27" strokeOpacity=".5" fill="none" />
      </g>)}
      {kind === 'box' && (<g strokeWidth="1.2" className={line}>
        <path d="M32 8 54 19 32 30 10 19Z" fill="#dcb98a" />
        <path d="M10 19 32 30v26L10 45Z" fill="#c49a66" />
        <path d="M32 30 54 19v26L32 56Z" fill="#a97f4d" />
        <path d="M21 13.5 43 24.5l-3 1.5L18 15Z" fill="#efe3c6" stroke="none" />
        <path d="M18 34v-7l-2 2m2-2 2 2" stroke="#6b4a24" strokeOpacity=".7" fill="none" strokeLinecap="round" />
      </g>)}
      {kind === 'ball' && (<g strokeWidth="1.4" className={line}>
        <circle cx="32" cy="33" r="20" fill="#e4572e" />
        <path d="M14 27c10 6 26 6 36 0M18 46c8-10 20-14 30-12" stroke="#7c2410" fill="none" />
        <ellipse cx="25" cy="24" rx="5" ry="3" fill="#fff" fillOpacity=".35" stroke="none" />
      </g>)}
      {kind === 'cup' && (<g strokeWidth="1.4" className={line}>
        <path d="M44 28c7 0 7 12 0 12" fill="none" strokeWidth="3.2" />
        <path d="M18 20h28l-3 32a3 3 0 0 1-3 3H24a3 3 0 0 1-3-3Z" fill="#faf7f2" />
        <ellipse cx="32" cy="20" rx="14" ry="3.2" fill="#4a2c1a" />
        <path d="M27 14c-2-3 2-4 0-7M34 14c-2-3 2-4 0-7" className="stroke-accent" fill="none" strokeLinecap="round" />
      </g>)}
      {kind === 'glass' && (<g strokeWidth="1.4" className={line}>
        <path d="M26 8h12c0 6-1 8 4 16 5 9 4 22-2 28a4 4 0 0 1-3 1H27a4 4 0 0 1-3-1c-6-6-7-19-2-28 5-8 4-10 4-16Z" fill="#d6f1ff" fillOpacity=".7" />
        <path d="M27 28c-2 5-2 12 0 17" stroke="#fff" strokeOpacity=".8" fill="none" strokeLinecap="round" />
        <path d="M38 30l-3 4 3 2-3 5" className="stroke-bad" fill="none" strokeLinejoin="round" />
      </g>)}
      {kind === 'generic' && (<g strokeWidth="1.4" className={line} fill="none" strokeDasharray="3 2.5">
        <path d="M32 10 52 20 32 30 12 20Z" /><path d="M12 20 32 30v24L12 44Z" /><path d="M32 30 52 20v24L32 54Z" />
        <path d="M30 37c0-3 5-3 5 0 0 2-3 2-3 5" strokeDasharray="none" className="stroke-accent" strokeLinecap="round" /><circle cx="32" cy="46" r=".8" className="fill-accent" stroke="none" />
      </g>)}
    </svg>
  )
}
