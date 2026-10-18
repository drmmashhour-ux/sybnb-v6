import type { CSSProperties } from 'react'

/**
 * Original, generic side-view illustrations (drawn for this app) -- one simple silhouette per ride
 * class. Deliberately plain shapes; not derived from any brand's artwork.
 */
export type VehicleKind = 'bike' | 'economy' | 'comfort' | 'suv' | 'van' | 'vip'

const INK = '#111'
const GLASS = '#d9e2ea'
const HUB = '#9a9a9a'

function Wheel({ cx, cy = 36, r = 7 }: { cx: number; cy?: number; r?: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={INK} />
      <circle cx={cx} cy={cy} r={r * 0.45} fill={HUB} />
    </g>
  )
}

export function VehicleArt({ kind, style }: { kind: VehicleKind; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 96 48" width="72" height="36" role="img" aria-hidden="true" focusable="false" style={style}>
      {kind === 'bike' && (
        <g>
          <circle cx="22" cy="34" r="9" fill="none" stroke={INK} strokeWidth="4" />
          <circle cx="74" cy="34" r="9" fill="none" stroke={INK} strokeWidth="4" />
          <path d="M22 34 L36 20 L56 20 L66 14 L72 14" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M36 20 L50 34 L74 34 L62 20" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="38" y="14" width="18" height="6" rx="3" fill={INK} />
          <path d="M66 14 L70 8 L78 8" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
        </g>
      )}
      {kind === 'economy' && (
        <g>
          <path d="M6 34 L8 26 Q10 22 18 21 L30 12 Q33 10 38 10 L58 10 Q63 10 66 13 L74 21 Q86 22 89 28 L90 34 Z" fill={INK} />
          <path d="M33 21 L40 13 L48 13 L48 21 Z" fill={GLASS} />
          <path d="M52 21 L52 13 L60 13 L67 21 Z" fill={GLASS} />
          <Wheel cx={24} />
          <Wheel cx={72} />
        </g>
      )}
      {kind === 'comfort' && (
        <g>
          <path d="M4 34 L6 27 Q8 23 17 22 L30 12 Q33 10 39 10 L60 10 Q65 10 68 13 L76 22 Q88 23 91 28 L92 34 Z" fill={INK} />
          <path d="M33 22 L40 13 L48 13 L48 22 Z" fill={GLASS} />
          <path d="M52 22 L52 13 L61 13 L69 22 Z" fill={GLASS} />
          <path d="M10 28 L88 28" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.5" />
          <Wheel cx={24} />
          <Wheel cx={73} />
        </g>
      )}
      {kind === 'suv' && (
        <g>
          <path d="M5 35 L6 25 Q7 21 14 20 L24 10 Q26 8 30 8 L68 8 Q72 8 74 11 L80 20 Q88 21 90 26 L91 35 Z" fill={INK} />
          <path d="M27 20 L32 11 L46 11 L46 20 Z" fill={GLASS} />
          <path d="M50 20 L50 11 L67 11 L72 20 Z" fill={GLASS} />
          <Wheel cx={23} cy={36} r={8} />
          <Wheel cx={72} cy={36} r={8} />
        </g>
      )}
      {kind === 'van' && (
        <g>
          <path d="M4 35 L4 14 Q4 8 10 8 L68 8 Q72 8 75 12 L84 22 Q91 24 92 30 L92 35 Z" fill={INK} />
          <rect x="9" y="12" width="14" height="10" rx="2" fill={GLASS} />
          <rect x="27" y="12" width="14" height="10" rx="2" fill={GLASS} />
          <rect x="45" y="12" width="14" height="10" rx="2" fill={GLASS} />
          <path d="M63 12 L69 12 L76 22 L63 22 Z" fill={GLASS} />
          <path d="M44 24 L44 34" stroke="#fff" strokeOpacity="0.4" strokeWidth="1.5" />
          <Wheel cx={22} cy={36} r={8} />
          <Wheel cx={72} cy={36} r={8} />
        </g>
      )}
      {kind === 'vip' && (
        <g>
          {/* Long, low luxury sedan with a gold beltline accent. */}
          <path d="M3 34 L5 27 Q7 23 18 22 L32 13 Q35 11 42 11 L62 11 Q68 11 71 14 L78 22 Q89 23 92 28 L93 34 Z" fill={INK} />
          <path d="M35 22 L42 14 L50 14 L50 22 Z" fill={GLASS} />
          <path d="M54 22 L54 14 L63 14 L70 22 Z" fill={GLASS} />
          <path d="M8 27 L90 27" stroke="#d4af37" strokeWidth="2" />
          <path d="M14 24 L20 24" stroke="#d4af37" strokeWidth="1.5" strokeLinecap="round" />
          <Wheel cx={25} />
          <Wheel cx={74} />
        </g>
      )}
    </svg>
  )
}

export function SeatIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="7" r="4" />
      <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8z" />
    </svg>
  )
}
