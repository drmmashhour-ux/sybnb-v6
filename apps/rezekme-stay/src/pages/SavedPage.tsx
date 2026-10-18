import { useEffect, useState } from 'react'
import { pick, type Lang } from '@platform/engines/language/languageEngine'
import { moneyText } from '@platform/shared/i18n/display'
import {
  deleteSavedSearch,
  fetchFavourites,
  fetchSavedSearches,
  getStoredGuestSession,
  removeFavourite,
  updateSavedSearch,
  type PlatformFavourite,
  type PlatformSavedSearch,
} from '@platform/shared/api/platformApi'

type Props = { lang: Lang }

function filterSummary(filters: Record<string, unknown>, lang: Lang): string {
  const parts: string[] = []
  if (filters.city) parts.push(String(filters.city))
  if (filters.priceMin || filters.priceMax) {
    parts.push(`${filters.priceMin ? filters.priceMin : ''}${filters.priceMin && filters.priceMax ? '–' : ''}${filters.priceMax ? filters.priceMax : (filters.priceMin ? '+' : '')}`)
  }
  if (filters.bedroomsMin) parts.push(pick(lang, `${filters.bedroomsMin}+ غرف`, `${filters.bedroomsMin}+ bd`, `${filters.bedroomsMin}+ ch`))
  for (const k of ['propertyType', 'condition']) {
    if (filters[k] && filters[k] !== 'any') parts.push(String(filters[k]))
  }
  return parts.join(' · ') || pick(lang, 'كل النتائج', 'All results', 'Tous les résultats')
}

// Favourites (wishlist) and saved searches. Same API calls as the platform page; this app only
// shows the daily-stays ones (favourites whose listing is a stay, saved searches for STAYS).
export function SavedPage({ lang }: Props) {
  const signedIn = Boolean(getStoredGuestSession())
  const [favourites, setFavourites] = useState<PlatformFavourite[]>([])
  const [searches, setSearches] = useState<PlatformSavedSearch[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    try {
      const [f, s] = await Promise.all([fetchFavourites().catch(() => []), fetchSavedSearches().catch(() => [])])
      setFavourites(f.filter((item) => !item.listing || String(item.listing.division).toUpperCase() === 'STAYS'))
      setSearches(s.filter((item) => String(item.division || '').toUpperCase() === 'STAYS'))
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

  const title = pick(lang, 'المحفوظات', 'Wishlists', 'Favoris')

  if (!signedIn) {
    return (
      <main className="str-page str-narrow" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <h1 className="str-h1">{title}</h1>
        <p className="str-muted">{pick(lang, 'سجّل الدخول لحفظ الإقامات وعمليات البحث وتلقّي تنبيهات الإعلانات الجديدة.', 'Log in to save stays and searches and get new-listing alerts.', 'Connectez-vous pour sauvegarder des logements et des recherches.')}</p>
        <button type="button" className="str-btn str-btn-primary str-btn-inline" onClick={() => (window.location.hash = '/account/open')}>
          {pick(lang, 'تسجيل الدخول', 'Log in', 'Se connecter')}
        </button>
      </main>
    )
  }

  return (
    <main className="str-page str-narrow" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <h1 className="str-h1">{title}</h1>

      <section>
        <h2 className="str-h2">{pick(lang, 'الإقامات المحفوظة', 'Saved stays', 'Logements sauvegardés')} {favourites.length ? `(${favourites.length})` : ''}</h2>
        {loading ? (
          <div className="str-grid" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="str-card str-card-skeleton">
                <div className="str-card-media str-skeleton" />
                <div className="str-skeleton str-skeleton-line" style={{ width: '60%' }} />
              </div>
            ))}
          </div>
        ) : favourites.length === 0 ? (
          <p className="str-muted">{pick(lang, 'لم تحفظ أي إقامة بعد. اضغط على القلب في أي إعلان لحفظه.', 'Nothing saved yet. Tap the heart on any stay to save it.', 'Rien de sauvegardé. Touchez le cœur sur un logement pour le sauvegarder.')}</p>
        ) : (
          <div className="str-grid">
            {favourites.map((f) => {
              const l = f.listing
              const photo = (l?.media && l.media[0] && (l.media[0] as { url?: string }).url) || ''
              const name = (lang === 'ar' ? l?.titleAr || l?.titleEn : l?.titleEn || l?.titleAr) || f.listingId.slice(0, 8)
              return (
                <article key={f.id} className="str-card">
                  <div className="str-card-media">
                    <button type="button" className="str-card-open" onClick={() => (window.location.hash = `/listing/${f.listingId}`)} aria-label={name}>
                      {photo ? <img src={photo} alt="" loading="lazy" decoding="async" width={400} height={300} /> : <span className="str-card-nophoto">Rezekme</span>}
                    </button>
                  </div>
                  <div className="str-card-body">
                    <strong className="str-card-title">{name}</strong>
                    {l ? <span className="str-card-price">{moneyText(l.priceMinor, l.currency, lang)} / {pick(lang, 'ليلة', 'night', 'nuit')}</span> : null}
                    <button type="button" className="str-link-btn str-link-danger" onClick={() => void unfav(f.listingId)}>{pick(lang, 'إزالة', 'Remove', 'Retirer')}</button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 className="str-h2">{pick(lang, 'عمليات البحث المحفوظة', 'Saved searches', 'Recherches sauvegardées')} {searches.length ? `(${searches.length})` : ''}</h2>
        {loading ? null : searches.length === 0 ? (
          <p className="str-muted">{pick(lang, 'احفظ بحثاً من صفحة الاستكشاف لتصلك تنبيهات بالإعلانات الجديدة.', 'Save a search from Explore to get alerts on new listings.', 'Sauvegardez une recherche pour recevoir des alertes.')}</p>
        ) : (
          <div className="str-list">
            {searches.map((s) => (
              <div key={s.id} className="str-list-row">
                <div className="str-list-main">
                  <strong>{s.label || pick(lang, 'إيجار يومي', 'Daily stays', 'Séjours')}</strong>
                  <span className="str-muted">{filterSummary(s.filters || {}, lang)}</span>
                </div>
                <div className="str-list-actions">
                  <label className="str-check" title={pick(lang, 'تنبيهات الإعلانات الجديدة', 'New-listing alerts', 'Alertes')}>
                    <input type="checkbox" checked={s.notifyOnNew} onChange={() => void toggleNotify(s)} />
                    <span>{pick(lang, 'تنبيه', 'Alerts', 'Alertes')}</span>
                  </label>
                  <button type="button" className="str-btn str-btn-outline str-btn-sm" onClick={() => (window.location.hash = '/stays')}>{pick(lang, 'عرض', 'View', 'Voir')}</button>
                  <button type="button" className="str-link-btn str-link-danger" onClick={() => void removeSearch(s.id)}>{pick(lang, 'حذف', 'Delete', 'Supprimer')}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
