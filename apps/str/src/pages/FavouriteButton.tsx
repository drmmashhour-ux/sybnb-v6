import type { CSSProperties } from 'react'
import { pick, type Lang } from '@platform/engines/language/languageEngine'

type Props = {
  active: boolean
  busy?: boolean
  onToggle: () => void
  lang: Lang
  size?: number
  variant?: 'overlay' | 'inline'
}

// Heart toggle for saving a listing. Presentational: the parent owns active/busy state and the
// handler (same contract as the platform button). Stops propagation so it never opens the card.
export function FavouriteButton({ active, busy, onToggle, lang, size = 20, variant = 'overlay' }: Props) {
  const label = active
    ? pick(lang, 'إزالة من المفضلة', 'Remove from favourites', 'Retirer des favoris')
    : pick(lang, 'حفظ في المفضلة', 'Save to favourites', 'Sauvegarder')
  const base: CSSProperties = {
    border: 'none',
    borderRadius: 999,
    width: size + 16,
    height: size + 16,
    minHeight: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: busy ? 'default' : 'pointer',
    opacity: busy ? 0.6 : 1,
    padding: 0,
    background: variant === 'overlay' ? 'transparent' : '#f2f2f2',
  }
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); if (!busy) onToggle() }}
      style={base}
    >
      <svg viewBox="0 0 32 32" width={size + 4} height={size + 4} aria-hidden="true" style={{ overflow: 'visible' }}>
        <path
          d="M16 28C7 22 2 17 2 11.5A7.5 7.5 0 0 1 9.5 4C12.4 4 14.8 5.6 16 7.8 17.2 5.6 19.6 4 22.5 4A7.5 7.5 0 0 1 30 11.5C30 17 25 22 16 28z"
          fill={active ? '#2457f5' : 'rgba(0,0,0,.5)'}
          stroke="#fff"
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}
