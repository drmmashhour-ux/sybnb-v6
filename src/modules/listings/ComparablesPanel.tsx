import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { fetchComparables, type PlatformListing } from '../../shared/api/platformApi'
import { moneyText } from '../../shared/i18n/display'
import { listingDisplayTitle } from '../../shared/listing/displayTitle'

// Comparable listings (Centris-depth, 2026-10-11). "Similar properties nearby": same division, same
// city when known, asking price within +/-35%. Server-ranked by price proximity.
function firstPhoto(l: PlatformListing): string | null {
  const m = (l.media || [])[0] as { url?: string; src?: string; assetUrl?: string } | undefined
  return m?.url || m?.src || m?.assetUrl || null
}

function divisionEmoji(division: string | undefined): string {
  switch (division) {
    case 'CARS': return '🚗'
    case 'MARKETPLACE': return '🛍️'
    case 'NEW_CONSTRUCTION': return '🏗️'
    default: return '🏠'
  }
}

function comparablesTitle(division: string | undefined, lang: Lang): string {
  switch (division) {
    case 'CARS': return pick(lang, 'مركبات مشابهة', 'Similar vehicles', 'Véhicules similaires')
    case 'MARKETPLACE': return pick(lang, 'عروض مشابهة', 'Similar items', 'Articles similaires')
    case 'NEW_CONSTRUCTION': return pick(lang, 'مشاريع مشابهة', 'Similar projects', 'Projets similaires')
    default: return pick(lang, 'عقارات مشابهة', 'Similar properties', 'Propriétés similaires')
  }
}

export function ComparablesPanel({ listingId, lang, division }: { listingId: string; lang: Lang; division?: string }) {
  const isAr = lang === 'ar'
  const [items, setItems] = useState<PlatformListing[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let on = true
    fetchComparables(listingId).then((rows) => { if (on) { setItems(rows); setLoaded(true) } }).catch(() => { if (on) setLoaded(true) })
    return () => { on = false }
  }, [listingId])

  if (loaded && items.length === 0) return null

  return (
    <section style={styles.wrap} dir={isAr ? 'rtl' : 'ltr'}>
      <strong style={styles.title}>🔁 {comparablesTitle(division || items[0]?.division, lang)}</strong>
      <div style={styles.row}>
        {items.map((l) => {
          const photo = firstPhoto(l)
          const title = listingDisplayTitle(l, lang) || l.id.slice(0, 8).toUpperCase()
          const city = (l.location as { city?: string } | null)?.city || ''
          return (
            <a key={l.id} href={`#/listing/${l.id}`} style={styles.card}>
              <div style={{ ...styles.thumb, backgroundImage: photo ? `url(${photo})` : undefined }} aria-hidden>
                {!photo && <span style={styles.thumbFallback}>{divisionEmoji(l.division)}</span>}
              </div>
              <div style={styles.cardBody}>
                <strong style={styles.price} dir={isAr ? 'rtl' : 'ltr'}>{moneyText(l.priceMinor, l.currency, lang)}</strong>
                <span style={styles.cardTitle}>{title}</span>
                {city && <small style={styles.city}>⌖ {city}</small>}
              </div>
            </a>
          )
        })}
      </div>
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { display: 'grid', gap: 10, marginTop: 16 },
  title: { fontSize: 15 },
  row: { display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 6, scrollSnapType: 'x proximity' },
  card: { flex: '0 0 190px', width: 190, borderRadius: 14, border: '1px solid #e6e9ee', background: '#fff', textDecoration: 'none', color: 'inherit', overflow: 'hidden', scrollSnapAlign: 'start' },
  thumb: { width: '100%', height: 110, backgroundSize: 'cover', backgroundPosition: 'center', background: '#eef1f4', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  thumbFallback: { fontSize: 32 },
  cardBody: { display: 'grid', gap: 2, padding: 10 },
  price: { fontSize: 15 },
  cardTitle: { fontSize: 13, color: '#15181d', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  city: { color: '#5c6673' },
}
