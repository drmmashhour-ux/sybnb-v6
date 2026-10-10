import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { moneyText } from '../../shared/i18n/display'
import {
  deleteSavedSearch,
  fetchFavourites,
  fetchSavedSearches,
  getStoredGuestSession,
  removeFavourite,
  updateSavedSearch,
  type PlatformFavourite,
  type PlatformSavedSearch,
} from '../../shared/api/platformApi'

type Props = { lang: Lang }

const DIVISION_ROUTE: Record<string, string> = {
  STAYS: '/stays', RENTALS: '/rentals', BUY: '/buy', CARS: '/cars',
  MARKETPLACE: '/marketplace', NEW_CONSTRUCTION: '/new-construction',
}

function divisionLabel(division: string, lang: Lang): string {
  switch (String(division || '').toUpperCase()) {
    case 'STAYS': return pick(lang, 'إيجار يومي', 'Daily stays', 'Séjours')
    case 'RENTALS': return pick(lang, 'إيجار شهري', 'Monthly rentals', 'Locations')
    case 'BUY': return pick(lang, 'شراء عقار', 'Buy property', 'Acheter')
    case 'CARS': return pick(lang, 'سيارات', 'Cars', 'Voitures')
    case 'MARKETPLACE': return pick(lang, 'السوق', 'Marketplace', 'Marché')
    case 'NEW_CONSTRUCTION': return pick(lang, 'مشاريع جديدة', 'New construction', 'Construction')
    default: return division
  }
}

function filterSummary(filters: Record<string, unknown>, lang: Lang): string {
  const parts: string[] = []
  if (filters.city) parts.push(String(filters.city))
  if (filters.priceMin || filters.priceMax) {
    parts.push(`${filters.priceMin ? filters.priceMin : ''}${filters.priceMin && filters.priceMax ? '–' : ''}${filters.priceMax ? filters.priceMax : (filters.priceMin ? '+' : '')}`)
  }
  if (filters.bedroomsMin) parts.push(pick(lang, `${filters.bedroomsMin}+ غرف`, `${filters.bedroomsMin}+ bd`, `${filters.bedroomsMin}+ ch`))
  for (const k of ['propertyType', 'carBrand', 'carBody', 'carFuel', 'carTransmission', 'condition', 'marketCategory']) {
    if (filters[k]) parts.push(String(filters[k]))
  }
  return parts.join(' · ') || pick(lang, 'كل النتائج', 'All results', 'Tous les résultats')
}

export function SavedPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const signedIn = Boolean(getStoredGuestSession())
  const [favourites, setFavourites] = useState<PlatformFavourite[]>([])
  const [searches, setSearches] = useState<PlatformSavedSearch[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    try {
      const [f, s] = await Promise.all([fetchFavourites().catch(() => []), fetchSavedSearches().catch(() => [])])
      setFavourites(f)
      setSearches(s)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (signedIn) void load()
    else setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function unfav(listingId: string) {
    setFavourites((cur) => cur.filter((f) => f.listingId !== listingId))
    try { await removeFavourite(listingId) } catch { void load() }
  }

  async function removeSearch(id: string) {
    setSearches((cur) => cur.filter((s) => s.id !== id))
    try { await deleteSavedSearch(id) } catch { void load() }
  }

  async function toggleNotify(s: PlatformSavedSearch) {
    setSearches((cur) => cur.map((x) => (x.id === s.id ? { ...x, notifyOnNew: !x.notifyOnNew } : x)))
    try { await updateSavedSearch(s.id, { notifyOnNew: !s.notifyOnNew }) } catch { void load() }
  }

  if (!signedIn) {
    return (
      <main style={styles.wrap} dir={isAr ? 'rtl' : 'ltr'}>
        <h1 style={styles.h1}>{pick(lang, 'المحفوظات', 'Saved', 'Sauvegardés')}</h1>
        <p style={styles.muted}>{pick(lang, 'سجّل الدخول لحفظ الإعلانات وعمليات البحث وتلقّي تنبيهات الإعلانات الجديدة.', 'Sign in to save listings and searches and get new-listing alerts.', 'Connectez-vous pour sauvegarder des annonces et des recherches.')}</p>
        <button type="button" style={styles.primary} onClick={() => (window.location.hash = '/account')}>{pick(lang, 'تسجيل الدخول', 'Sign in', 'Se connecter')}</button>
      </main>
    )
  }

  return (
    <main style={styles.wrap} dir={isAr ? 'rtl' : 'ltr'}>
      <h1 style={styles.h1}>{pick(lang, 'المحفوظات', 'Saved', 'Sauvegardés')}</h1>

      <section>
        <h2 style={styles.h2}>{pick(lang, 'الإعلانات المحفوظة', 'Saved listings', 'Annonces sauvegardées')} {favourites.length ? `(${favourites.length})` : ''}</h2>
        {loading ? <p style={styles.muted}>…</p> : favourites.length === 0 ? (
          <p style={styles.muted}>{pick(lang, 'لم تحفظ أي إعلان بعد. اضغط ♡ على أي إعلان لحفظه.', 'No saved listings yet. Tap ♡ on any listing to save it.', 'Aucune annonce sauvegardée.')}</p>
        ) : (
          <div style={styles.grid}>
            {favourites.map((f) => {
              const l = f.listing
              const photo = (l?.media && l.media[0] && (l.media[0] as { url?: string }).url) || ''
              return (
                <div key={f.id} style={styles.card}>
                  <button type="button" style={styles.cardMedia} onClick={() => (window.location.hash = `/listing/${f.listingId}`)}>
                    {photo ? <img src={photo} alt="" style={styles.img} /> : <span style={styles.noimg}>SYBNB</span>}
                  </button>
                  <div style={styles.cardBody}>
                    <strong style={styles.cardTitle}>{l?.titleEn || l?.titleAr || f.listingId.slice(0, 8)}</strong>
                    {l ? <span style={styles.price}>{moneyText(l.priceMinor, l.currency, lang)}</span> : null}
                    <button type="button" style={styles.removeLink} onClick={() => unfav(f.listingId)}>{pick(lang, 'إزالة', 'Remove', 'Retirer')}</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section style={{ marginTop: 28 }}>
        <h2 style={styles.h2}>{pick(lang, 'عمليات البحث المحفوظة', 'Saved searches', 'Recherches sauvegardées')} {searches.length ? `(${searches.length})` : ''}</h2>
        {loading ? <p style={styles.muted}>…</p> : searches.length === 0 ? (
          <p style={styles.muted}>{pick(lang, 'احفظ بحثاً من صفحة البحث لتصلك تنبيهات بالإعلانات الجديدة.', 'Save a search from the search page to get alerts on new listings.', 'Sauvegardez une recherche pour recevoir des alertes.')}</p>
        ) : (
          <div style={styles.searchList}>
            {searches.map((s) => (
              <div key={s.id} style={styles.searchRow}>
                <div style={{ display: 'grid', gap: 2 }}>
                  <strong>{s.label || divisionLabel(s.division, lang)}</strong>
                  <span style={styles.muted}>{divisionLabel(s.division, lang)} · {filterSummary(s.filters || {}, lang)}</span>
                </div>
                <div style={styles.searchActions}>
                  <label style={styles.notifyToggle} title={pick(lang, 'تنبيهات الإعلانات الجديدة', 'New-listing alerts', 'Alertes')}>
                    <input type="checkbox" checked={s.notifyOnNew} onChange={() => toggleNotify(s)} />
                    <span>🔔</span>
                  </label>
                  <button type="button" style={styles.viewBtn} onClick={() => (window.location.hash = DIVISION_ROUTE[s.division] || '/')}>{pick(lang, 'عرض', 'View', 'Voir')}</button>
                  <button type="button" style={styles.removeLink} onClick={() => removeSearch(s.id)}>{pick(lang, 'حذف', 'Delete', 'Supprimer')}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { maxWidth: 1000, margin: '0 auto', padding: '24px 16px 48px', display: 'grid', gap: 8 },
  h1: { fontSize: 26, fontWeight: 800, color: '#0b1b3b', margin: '0 0 8px' },
  h2: { fontSize: 18, fontWeight: 700, color: '#0b1b3b', margin: '12px 0 10px' },
  muted: { color: '#64748b', fontSize: 14 },
  primary: { padding: '12px 18px', borderRadius: 10, border: 'none', background: '#0b1b3b', color: '#fff', fontWeight: 700, cursor: 'pointer', justifySelf: 'start' as CSSProperties['justifySelf'] },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 },
  card: { border: '1px solid #e4e9f2', borderRadius: 14, overflow: 'hidden', background: '#fff' },
  cardMedia: { display: 'block', width: '100%', height: 130, border: 'none', padding: 0, cursor: 'pointer', background: '#eef2f8' },
  img: { width: '100%', height: '100%', objectFit: 'cover' },
  noimg: { display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#9aa7bd', fontWeight: 700 },
  cardBody: { padding: 10, display: 'grid', gap: 4 },
  cardTitle: { fontSize: 14, color: '#0b1b3b' },
  price: { fontWeight: 700, color: '#0b1b3b' },
  removeLink: { background: 'none', border: 'none', color: '#d14343', cursor: 'pointer', fontSize: 13, padding: 0, justifySelf: 'start' as CSSProperties['justifySelf'] },
  searchList: { display: 'grid', gap: 10 },
  searchRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, border: '1px solid #e4e9f2', borderRadius: 12, padding: '12px 14px', background: '#fff', flexWrap: 'wrap' },
  searchActions: { display: 'flex', alignItems: 'center', gap: 10 },
  notifyToggle: { display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 14 },
  viewBtn: { padding: '6px 12px', borderRadius: 8, border: '1px solid #c9d3e6', background: '#fff', color: '#0b1b3b', fontWeight: 600, cursor: 'pointer' },
}
