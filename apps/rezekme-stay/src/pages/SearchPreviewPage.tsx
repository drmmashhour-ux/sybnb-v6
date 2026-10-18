import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { pick, type Lang } from '@platform/engines/language/languageEngine'
import { governorateCityName, GOVERNORATE_CITY_NAME, labelFor, SYRIA_GOVERNORATES } from '@platform/engines/search'
import {
  addFavourite,
  createSavedSearch,
  fetchApprovedListings,
  fetchFavouriteIds,
  isSampleListing,
  removeFavourite,
  type PlatformListing,
} from '@platform/shared/api/platformApi'
import { MarketInsightsPanel } from '@platform/modules/search/MarketInsightsPanel'
import { listingDisplayTitle } from '@platform/shared/listing/displayTitle'
import { FavouriteButton } from './FavouriteButton'
import { listingPriceText } from './listingPriceText'
import { SearchStateCard } from './SearchStates'
import { restoredSearchValue, UnifiedSearchBar, type LocationRequest, type UnifiedSearchValue } from './UnifiedSearchBar'

// Leaflet (and its CSS) only download when the guest asks for the map.
const PropertyMap = lazy(() => import('@platform/shared/maps/PropertyMap').then((module) => ({ default: module.PropertyMap })))

type SearchPreviewPageProps = {
  lang: Lang
}

const SKELETON_COUNT = 8

// Daily stays only. The search request is built exactly like the platform page builds it for the
// STAYS division (same filters, same server-side city narrowing, same cursor pagination).
export function SearchPreviewPage({ lang }: SearchPreviewPageProps) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [lastSearch, setLastSearch] = useState<UnifiedSearchValue | null>(null)
  const [listings, setListings] = useState<PlatformListing[]>([])
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [lastQuery, setLastQuery] = useState<{ division: string; filters?: Parameters<typeof fetchApprovedListings>[1] } | null>(null)
  const [locationRequest, setLocationRequest] = useState<LocationRequest | null>(null)
  const [activeGov, setActiveGov] = useState('')
  // Only the newest request may update the list (choosing a governorate searches immediately).
  const requestSeq = useRef(0)
  const [favIds, setFavIds] = useState<Set<string>>(new Set())
  const [favBusy, setFavBusy] = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState<'idle' | 'saved' | 'error'>('idle')

  useEffect(() => {
    fetchFavouriteIds().then((ids) => setFavIds(new Set(ids))).catch(() => {})
  }, [])

  useEffect(() => {
    // Start from exactly what the bar shows (a location chosen earlier in the session narrows the
    // first list too).
    const restored = restoredSearchValue('stays')
    void runLiveSearch(restored.locationTouched ? restored : undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function toggleFavourite(listingId: string) {
    const active = favIds.has(listingId)
    setFavBusy(listingId)
    setFavIds((prev) => { const n = new Set(prev); if (active) n.delete(listingId); else n.add(listingId); return n })
    try {
      if (active) await removeFavourite(listingId)
      else await addFavourite(listingId)
    } catch (err) {
      setFavIds((prev) => { const n = new Set(prev); if (active) n.add(listingId); else n.delete(listingId); return n })
      if ((err as { code?: string })?.code === 'GUEST_SESSION_REQUIRED') window.location.hash = '/account'
    } finally {
      setFavBusy(null)
    }
  }

  async function saveCurrentSearch() {
    if (!lastQuery) return
    const f = (lastQuery.filters || {}) as Record<string, unknown>
    const attrs = (f.attributes && typeof f.attributes === 'object' ? f.attributes : {}) as Record<string, unknown>
    const flat: Record<string, unknown> = { ...attrs, priceMin: f.priceMin, priceMax: f.priceMax, bedroomsMin: f.bedroomsMin, bathroomsMin: f.bathroomsMin, city: f.city, sort: f.sort, priceBand: f.priceBand }
    try {
      await createSavedSearch({ division: lastQuery.division, filters: flat })
      setSavedMsg('saved')
    } catch (err) {
      if ((err as { code?: string })?.code === 'GUEST_SESSION_REQUIRED') { window.location.hash = '/account'; return }
      setSavedMsg('error')
    }
  }

  const isSampleMode = listings.some(isSampleListing)
  const hasSearched = lastSearch !== null
  const countText = `${listings.length}${nextCursor ? '+' : ''}`

  async function runLiveSearch(value?: UnifiedSearchValue) {
    const seq = ++requestSeq.current
    setState('loading')
    setLastSearch(value || null)
    setSavedMsg('idle')
    setActiveGov(value?.locationTouched ? value.governorate : '')

    try {
      const filters = value
        ? {
            attributes: {
              carBrand: value.carBrand,
              carBody: value.carBody,
              carFuel: value.carFuel,
              carTransmission: value.carTransmission,
              condition: value.condition,
              propertyType: value.propertyType,
              marketCategory: value.marketCategory,
              amenities: value.amenities,
              views: value.views,
              access: value.access,
            },
            priceMin: Number(value.minPrice) || undefined,
            priceMax: Number(value.maxPrice) || undefined,
            sort: value.sort,
            priceBand: value.priceBand,
            bedroomsMin: value.bedroomsCount > 1 ? value.bedroomsCount : undefined,
            // 1 is the stepper's floor and means "any": sending it dropped listings without bathroom data.
            bathroomsMin: value.bathrooms > 1 ? value.bathrooms : undefined,
            // Only once the guest actually picked a place -- an untouched default is never a filter.
            city: value.locationTouched && value.governorate ? governorateCityName(value.governorate) : undefined,
          }
        : undefined
      const division = 'STAYS'
      const results = await fetchApprovedListings(division, filters)
      if (seq !== requestSeq.current) return
      setListings(results.listings)
      setNextCursor(results.nextCursor)
      setLastQuery({ division, filters })
      setState('ready')
    } catch {
      if (seq !== requestSeq.current) return
      setListings([])
      setNextCursor(null)
      setLastQuery(null)
      setState('error')
    }
  }

  async function loadMoreResults() {
    if (!nextCursor || loadingMore || !lastQuery) return
    setLoadingMore(true)
    const seq = requestSeq.current
    try {
      const results = await fetchApprovedListings(lastQuery.division, lastQuery.filters, nextCursor)
      if (seq !== requestSeq.current) return
      setListings((prev) => [...prev, ...results.listings])
      setNextCursor(results.nextCursor)
    } catch {
      // Keep whatever is already shown; just stop offering more rather than clearing real results.
      setNextCursor(null)
    } finally {
      setLoadingMore(false)
    }
  }

  // "Reset" / "Show all Syria": drop every filter, clear the saved draft, reload the broad list.
  function resetSearch() {
    try {
      window.sessionStorage.removeItem('sybnb-v6-search-draft')
    } catch {
      // Blocked storage only means the bar keeps its previous values.
    }
    setLocationRequest({ governorate: '', nonce: Date.now() })
    void runLiveSearch()
  }

  function pickGovernorate(key: string) {
    setLocationRequest({ governorate: key, nonce: Date.now() })
  }

  function openListing(listing: PlatformListing) {
    try {
      window.sessionStorage.setItem('sybnb-v6-listing-return-path', '/stays')
    } catch {
      // storage blocked: the listing page falls back to /stays
    }
    window.location.hash = `/listing/${listing.id}`
  }

  const governorates = useMemo(() => SYRIA_GOVERNORATES.filter((item) => item.key in GOVERNORATE_CITY_NAME), [])
  const loadingInitial = state === 'loading' && listings.length === 0

  return (
    <main dir={lang === 'ar' ? 'rtl' : 'ltr'} className="str-page str-search-page">
      <div className="str-search-sticky">
        <UnifiedSearchBar lang={lang} onSearch={(value) => void runLiveSearch(value)} locationRequest={locationRequest} />
        <div className="str-chip-row" role="group" aria-label={pick(lang, 'المحافظات', 'Governorates', 'Gouvernorats')}>
          <button type="button" className={`str-chip${activeGov === '' ? ' is-active' : ''}`} aria-pressed={activeGov === ''} onClick={() => pickGovernorate('')}>
            {pick(lang, 'كل سوريا', 'All Syria', 'Toute la Syrie')}
          </button>
          {governorates.map((gov) => (
            <button
              key={gov.key}
              type="button"
              className={`str-chip${activeGov === gov.key ? ' is-active' : ''}`}
              aria-pressed={activeGov === gov.key}
              onClick={() => pickGovernorate(gov.key)}
            >
              {labelFor(lang, gov)}
            </button>
          ))}
        </div>
      </div>

      <section className="str-results" aria-busy={state === 'loading'}>
        <div className="str-results-head">
          <h1 className="str-h1">{pick(lang, 'أماكن للإقامة', 'Places to stay', 'Logements')}</h1>
          {hasSearched && state === 'ready' ? <span className="str-muted">{countText}</span> : null}
          {state === 'loading' && listings.length > 0 ? <span className="str-muted">{pick(lang, 'جارٍ البحث…', 'Searching…', 'Recherche en cours…')}</span> : null}
          {hasSearched && lastQuery ? (
            <button type="button" className="str-link-btn" onClick={() => void saveCurrentSearch()}>
              {savedMsg === 'saved'
                ? pick(lang, '✓ تم حفظ البحث', '✓ Search saved', '✓ Recherche sauvegardée')
                : savedMsg === 'error'
                  ? pick(lang, 'تعذر الحفظ - حاول مرة أخرى', 'Could not save - retry', 'Échec - réessayer')
                  : pick(lang, 'احفظ هذا البحث', 'Save this search', 'Sauvegarder cette recherche')}
            </button>
          ) : null}
        </div>

        {isSampleMode ? (
          <p className="str-note">{pick(lang, 'بيانات تجريبية - قاعدة البيانات غير متصلة', 'Sample data - database unavailable', 'Données de démonstration - base de données indisponible')}</p>
        ) : null}

        {state === 'error' || (state === 'ready' && listings.length === 0) ? (
          <SearchStateCard
            lang={lang}
            state={state === 'error' ? 'error' : 'empty'}
            onReset={resetSearch}
            onShowAll={resetSearch}
            onRetry={() => void runLiveSearch(lastSearch || undefined)}
          />
        ) : null}

        {hasSearched && lastQuery ? (
          <MarketInsightsPanel
            division={lastQuery.division}
            city={(lastQuery.filters as { city?: string } | undefined)?.city}
            currency={listings[0]?.currency || 'USD'}
            lang={lang}
          />
        ) : null}

        {loadingInitial ? (
          <div className="str-grid" aria-hidden="true">
            {Array.from({ length: SKELETON_COUNT }, (_, index) => (
              <div key={index} className="str-card str-card-skeleton">
                <div className="str-card-media str-skeleton" />
                <div className="str-skeleton str-skeleton-line" style={{ width: '70%' }} />
                <div className="str-skeleton str-skeleton-line" style={{ width: '45%' }} />
                <div className="str-skeleton str-skeleton-line" style={{ width: '30%' }} />
              </div>
            ))}
          </div>
        ) : null}

        {listings.length > 0 ? (
          viewMode === 'map' ? (
            <Suspense fallback={<div className="str-skeleton str-map-skeleton" />}>
              <PropertyMap listings={listings} lang={lang} />
            </Suspense>
          ) : (
            <div className="str-grid" style={state === 'loading' ? { opacity: 0.55 } : undefined}>
              {listings.map((listing, index) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  lang={lang}
                  eager={index < 2}
                  favourite={favIds.has(listing.id)}
                  favBusy={favBusy === listing.id}
                  onToggleFavourite={() => void toggleFavourite(listing.id)}
                  onOpen={() => openListing(listing)}
                />
              ))}
            </div>
          )
        ) : null}

        {viewMode === 'list' && nextCursor ? (
          <div className="str-center">
            <button type="button" className="str-btn str-btn-outline" onClick={() => void loadMoreResults()} disabled={loadingMore}>
              {loadingMore ? pick(lang, 'جار التحميل...', 'Loading...', 'Chargement...') : pick(lang, 'عرض المزيد', 'Show more', 'Afficher plus')}
            </button>
          </div>
        ) : null}
      </section>

      {listings.length > 0 ? (
        <button type="button" className="str-float-btn" onClick={() => setViewMode((mode) => (mode === 'list' ? 'map' : 'list'))}>
          {viewMode === 'list'
            ? pick(lang, 'عرض الخريطة', 'Show map', 'Afficher la carte')
            : pick(lang, 'عرض القائمة', 'Show list', 'Afficher la liste')}
        </button>
      ) : null}
    </main>
  )
}

function ListingCard({
  listing,
  lang,
  eager,
  favourite,
  favBusy,
  onToggleFavourite,
  onOpen,
}: {
  listing: PlatformListing
  lang: Lang
  eager: boolean
  favourite: boolean
  favBusy: boolean
  onToggleFavourite: () => void
  onOpen: () => void
}) {
  const card = cardText(listing, lang)
  const photo = listingPhoto(listing)
  const rating = listingRating(listing)
  const priceText = listingPriceText(listing, lang)
  return (
    <article className="str-card">
      <div className="str-card-media">
        <button type="button" className="str-card-open" onClick={onOpen} aria-label={card.title}>
          {photo ? (
            <img src={photo} alt={card.title} loading={eager ? 'eager' : 'lazy'} decoding="async" width={400} height={300} />
          ) : (
            <span className="str-card-nophoto">{pick(lang, 'لا توجد صور بعد', 'No photos yet', 'Pas encore de photos')}</span>
          )}
        </button>
        <div className="str-card-heart">
          <FavouriteButton active={favourite} busy={favBusy} onToggle={onToggleFavourite} lang={lang} />
        </div>
        {card.demo ? <span className="str-card-badge">{pick(lang, 'تجريبي', 'Demo', 'Démo')}</span> : listing.instantBookEnabled ? (
          <span className="str-card-badge">{pick(lang, 'حجز فوري', 'Instant book', 'Réservation instantanée')}</span>
        ) : null}
      </div>
      <button type="button" className="str-card-body" onClick={onOpen}>
        <span className="str-card-row">
          <strong className="str-card-title">{card.title}</strong>
          {rating !== null ? <span className="str-card-rating" dir="ltr">★ {rating.toFixed(1)}</span> : null}
        </span>
        {card.place ? <span className="str-card-sub">{card.place}</span> : null}
        <span className="str-card-price" dir={lang === 'ar' ? 'rtl' : 'ltr'}>{priceText}</span>
      </button>
    </article>
  )
}

// The listing's own uploaded photo, or nothing: a generic photo repeated on every card made every
// result look like the same real apartment.
function listingPhoto(listing: PlatformListing) {
  const mediaUrl = listing.media?.map((item) => item.url || item.src || item.assetUrl).find((value) => typeof value === 'string')
  return typeof mediaUrl === 'string' ? mediaUrl : ''
}

// Optional: shown only when the listing payload carries a numeric rating.
function listingRating(listing: PlatformListing): number | null {
  const md = (listing.metadata || {}) as Record<string, unknown>
  const raw = md.ratingAverage ?? md.averageRating ?? md.rating
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  return Number.isFinite(value) && value > 0 ? value : null
}

const DEMO_TITLE_PREFIX = /^\s*(?:تجريبي|Demo|Démo)\s*[—–-]\s*/
const ARABIC_SCRIPT = /[؀-ۿ]/

function textValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

// Card copy for the current language: the demo prefix becomes a badge and the place line never
// mixes Arabic and Latin script.
function cardText(listing: PlatformListing, lang: Lang) {
  const rawTitle = listingDisplayTitle(listing, lang)
  const metadata = (listing.metadata || {}) as Record<string, unknown>
  const demo = metadata.demo === true || DEMO_TITLE_PREFIX.test(rawTitle)
  const title = rawTitle.replace(DEMO_TITLE_PREFIX, '').trim() || rawTitle
  return { demo, title, place: placeLine(listing, lang) }
}

function placeLine(listing: PlatformListing, lang: Lang) {
  const location = (listing.location || {}) as Record<string, unknown>
  const metadata = (listing.metadata || {}) as Record<string, unknown>
  const cityEn = textValue(location.city)
  const governorateRaw = textValue(location.governorate)
  const govKey = Object.keys(GOVERNORATE_CITY_NAME).find(
    (key) => GOVERNORATE_CITY_NAME[key].toLowerCase() === (cityEn || governorateRaw).toLowerCase(),
  )
  const governorate = SYRIA_GOVERNORATES.find(
    (item) => item.key === govKey || item.ar === governorateRaw || item.en.toLowerCase() === governorateRaw.toLowerCase(),
  )
  let parts: string[]
  if (lang === 'ar') {
    const gov = governorate?.ar || governorateRaw
    const area = [textValue(location.area), textValue(metadata.area)].find((item) => ARABIC_SCRIPT.test(item)) || ''
    parts = [gov, area].filter((item) => item && ARABIC_SCRIPT.test(item))
  } else {
    const cityName = cityEn || governorate?.en || ''
    const area = textValue(metadata.areaEn) || textValue(location.area)
    parts = [cityName, area].filter((item) => item && !ARABIC_SCRIPT.test(item))
  }
  return Array.from(new Set(parts)).join(' · ')
}
