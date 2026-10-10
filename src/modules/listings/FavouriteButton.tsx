import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'

type Props = {
  active: boolean
  busy?: boolean
  onToggle: () => void
  lang: Lang
  size?: number
  variant?: 'overlay' | 'inline'
}

// A heart toggle for saving a listing to favourites. Presentational: parent owns active/busy state
// and the toggle handler. Stops propagation so it never triggers the card/listing click underneath.
export function FavouriteButton({ active, busy, onToggle, lang, size = 20, variant = 'overlay' }: Props) {
  const label = active
    ? pick(lang, 'إزالة من المفضلة', 'Remove from favourites', 'Retirer des favoris')
    : pick(lang, 'حفظ في المفضلة', 'Save to favourites', 'Sauvegarder')
  const base: CSSProperties = {
    border: 'none',
    borderRadius: 999,
    width: size + 16,
    height: size + 16,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: busy ? 'default' : 'pointer',
    opacity: busy ? 0.6 : 1,
    padding: 0,
  }
  const style: CSSProperties = variant === 'overlay'
    ? { ...base, background: 'rgba(255,255,255,0.92)', boxShadow: '0 1px 5px rgba(0,0,0,0.18)' }
    : { ...base, background: '#f1f5f9' }
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); if (!busy) onToggle() }}
      style={style}
    >
      <span style={{ color: active ? '#e0245e' : '#64748b', fontSize: size, lineHeight: 1 }}>{active ? '♥' : '♡'}</span>
    </button>
  )
}
