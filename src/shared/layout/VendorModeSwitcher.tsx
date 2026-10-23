import { useEffect } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { text } from '../../engines/language/languageEngine'
import { VENDOR_MODE_HOME, VENDOR_MODE_KEY, vendorModeFromPath, type VendorMode } from '../lib/vendor-mode'
import { STAYS_ONLY } from '../brand/brandName'

const LABELS: Record<VendorMode, { ar: string; en: string; fr: string; icon: string }> = {
  property: { icon: '🏠', ar: 'العقارات والإقامات', en: 'Property Portfolio', fr: 'Immobilier' },
  fleet: { icon: '🚗', ar: 'الأسطول والمزادات', en: 'Fleet & Auctions', fr: 'Flotte et enchères' },
  ondemand: { icon: '🍔', ar: 'المطعم / السائق', en: 'Restaurant & Driver', fr: 'Restaurant et chauffeur' },
}

// Persistent business-mode switcher shown on every supplier dashboard so each business line
// (property / fleet & auctions / restaurant & driver) is its own workspace.
export function VendorModeSwitcher({ lang, path }: { lang: Lang; path: string }) {
  const active = vendorModeFromPath(path)
  useEffect(() => {
    if (!active) return
    try { localStorage.setItem(VENDOR_MODE_KEY, active) } catch { /* ignore */ }
  }, [active])
  if (!active || STAYS_ONLY) return null
  return (
    <nav aria-label={text({ ar: 'وضع العمل', en: 'Business mode', fr: "Mode d'activité" }, lang)}
      style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '10px 16px', borderBottom: '1px solid rgba(128,128,128,.25)' }}>
      {(Object.keys(LABELS) as VendorMode[]).map((m) => (
        <a key={m} href={VENDOR_MODE_HOME[m]} aria-current={m === active ? 'page' : undefined}
          style={{ padding: '6px 14px', borderRadius: 999, textDecoration: 'none', fontWeight: m === active ? 700 : 500,
            border: '1px solid currentColor', opacity: m === active ? 1 : 0.6 }}>
          {LABELS[m].icon} {text(LABELS[m], lang)}
        </a>
      ))}
      {active === 'ondemand' && (
        <span style={{ marginInlineStart: 'auto', display: 'flex', gap: 8 }}>
          <a href="/merchant">{text({ ar: 'المطعم', en: 'Restaurant', fr: 'Restaurant' }, lang)}</a>
          <a href="/driver">{text({ ar: 'السائق', en: 'Driver', fr: 'Chauffeur' }, lang)}</a>
        </span>
      )}
    </nav>
  )
}
