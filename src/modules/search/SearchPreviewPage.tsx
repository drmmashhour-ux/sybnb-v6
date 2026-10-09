import { useEffect, useMemo, useRef, useState } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { getCity, getGovernorate, GOVERNORATE_CITY_NAME, governorateCityName, labelFor, listingMatchesKeyword, SYRIA_GOVERNORATES } from '../../engines/search'
import { fetchApprovedListings, isSampleListing, type PlatformListing } from '../../shared/api/platformApi'
import { listingDescriptionText, statusText } from '../../shared/i18n/display'
import { listingDisplayTitle } from '../../shared/listing/displayTitle'
import { listingPriceText } from './listingPriceText'
import { SearchStateCard } from './SearchStates'
import { restoredSearchValue, UnifiedSearchBar } from './UnifiedSearchBar'
import type { SearchDivision, UnifiedSearchValue } from './UnifiedSearchBar'

type SearchPreviewPageProps = {
  lang: Lang
  initialDivision?: SearchDivision
  entry?: 'general' | 'stays'
}

const T = {
  ar: {
    title: 'معاينة محرك البحث',
    body: 'ابحث بالفئة، الصور، الموقع، التاريخ، السعر، والخدمات ثم افتح تفاصيل الغرفة قبل الحجز.',
    loading: 'تحميل',
    empty: 'لا نتائج',
    error: 'خطأ',
    lastSearch: 'آخر بحث',
    none: 'لم يتم البحث بعد',
    liveResults: 'نتائج مباشرة من قاعدة البيانات',
    sampleResults: 'بيانات تجريبية - قاعدة البيانات غير متصلة',
    pendingOnly: 'الإعلانات قيد المراجعة لا تظهر هنا حتى يوافق فريق SYBNB.',
    noResults: 'لا توجد نتائج مطابقة لبحثك. جرّب توسيع الفلاتر أو تغيير الموقع.',
    price: 'السعر',
    book: 'فتح تفاصيل الغرفة',
    details: 'عرض التفاصيل',
    filterTitle: 'اختيار ذكي',
    resultTitle: 'النتائج المناسبة',
    loadMore: 'عرض المزيد',
    loadingMore: 'جار التحميل...',
    noPhotoYet: 'لا توجد صور بعد',
    ready: 'جاهز للبحث',
    staysReady: 'جاهز لحجز استضافة',
    staysTitle: 'بحث الإيجار اليومي',
    staysBody: 'اختر التاريخ، الضيوف، نوع الغرفة، السرير، والخدمات ثم افتح تفاصيل الاستضافة قبل طلب الحجز.',
    divisionCopy: {
      stays: {
        ready: 'جاهز لحجز استضافة',
        title: 'بحث الإيجار اليومي',
        body: 'اختر التاريخ، الضيوف، نوع الغرفة، السرير، والخدمات ثم افتح تفاصيل الاستضافة قبل طلب الحجز.',
        action: 'فتح تفاصيل الاستضافة',
      },
      rentals: {
        ready: 'جاهز للبحث عن إيجار',
        title: 'بحث الإيجار الشهري',
        body: 'اختر المحافظة، المدينة، الحي، نوع العقار، الغرف، والخدمات ثم افتح تفاصيل العقار قبل إرسال الطلب.',
        action: 'فتح تفاصيل العقار',
      },
      buy: {
        ready: 'جاهز للبحث عن شراء',
        title: 'بحث شراء عقار',
        body: 'اختر الموقع، نوع العقار، السعر، والمساحة ثم افتح تفاصيل العقار قبل التواصل أو إرسال الطلب.',
        action: 'فتح تفاصيل العقار',
      },
      newConstruction: {
        ready: 'جاهز لمراجعة المشاريع',
        title: 'بحث المشاريع الجديدة',
        body: 'اختر المدينة، نوع المشروع، السعر، والخطة ثم افتح تفاصيل المشروع قبل حجز زيارة أو التواصل.',
        action: 'فتح تفاصيل المشروع',
      },
      cars: {
        ready: 'جاهز للبحث عن مركبة',
        title: 'بحث المركبات',
        body: 'اختر الموقع، السعر، النوع، والمواصفات ثم افتح تفاصيل المركبة قبل التواصل مع البائع.',
        action: 'فتح تفاصيل المركبة',
      },
      marketplace: {
        ready: 'جاهز للبحث في السوق',
        title: 'بحث السوق',
        body: 'اختر التصنيف، الموقع، السعر، وحالة المنتج ثم افتح تفاصيل المنتج قبل إرسال الطلب.',
        action: 'فتح تفاصيل المنتج',
      },
    },
  },
  en: {
    title: 'Search Engine Preview',
    body: 'Search by division, photos, location, dates, price, and services, then open room details before booking.',
    loading: 'Loading',
    empty: 'No results',
    error: 'Error',
    lastSearch: 'Last search',
    none: 'No search yet',
    liveResults: 'Live database results',
    sampleResults: 'Sample data - database unavailable',
    pendingOnly: 'Listings under review stay hidden here until SYBNB approves them.',
    noResults: 'No results match your search. Try widening the filters or changing the location.',
    price: 'Price',
    book: 'Open room details',
    details: 'View details',
    filterTitle: 'Smart selection',
    resultTitle: 'Matched results',
    loadMore: 'Load more',
    loadingMore: 'Loading...',
    noPhotoYet: 'No photos yet',
    ready: 'Ready to search',
    staysReady: 'Ready to book a stay',
    staysTitle: 'Daily Stay Search',
    staysBody: 'Choose dates, guests, room type, bed type, and services, then open hosting details before requesting a booking.',
    divisionCopy: {
      stays: {
        ready: 'Ready to book a stay',
        title: 'Daily Stay Search',
        body: 'Choose dates, guests, room type, bed type, and services, then open hosting details before requesting a booking.',
        action: 'Open hosting details',
      },
      rentals: {
        ready: 'Ready to search rentals',
        title: 'Monthly Rental Search',
        body: 'Choose governorate, city, area, property type, rooms, and services, then open property details before sending a request.',
        action: 'Open property details',
      },
      buy: {
        ready: 'Ready to buy property',
        title: 'Buy Property Search',
        body: 'Choose location, property type, price, and size, then open property details before contacting or sending a request.',
        action: 'Open property details',
      },
      newConstruction: {
        ready: 'Ready to review projects',
        title: 'New Construction Search',
        body: 'Choose city, project type, price, and plan, then open project details before booking a visit or contacting.',
        action: 'Open project details',
      },
      cars: {
        ready: 'Ready to search vehicles',
        title: 'Vehicle Search',
        body: 'Choose location, price, type, and specs, then open vehicle details before contacting the seller.',
        action: 'Open vehicle details',
      },
      marketplace: {
        ready: 'Ready to search marketplace',
        title: 'Marketplace Search',
        body: 'Choose category, location, price, and item condition, then open product details before sending a request.',
        action: 'Open product details',
      },
    },
  },
  fr: {
    title: 'Aperçu du moteur de recherche',
    body: 'Recherchez par catégorie, photos, lieu, dates, prix et services, puis consultez le détail de la chambre avant de réserver.',
    loading: 'Chargement',
    empty: 'Aucun résultat',
    error: 'Erreur',
    lastSearch: 'Dernière recherche',
    none: 'Aucune recherche pour le moment',
    liveResults: 'Résultats en direct de la base de données',
    sampleResults: 'Données de démonstration - base de données indisponible',
    pendingOnly: 'Les annonces en cours de vérification restent masquées ici jusqu’à leur approbation par SYBNB.',
    noResults: 'Aucun résultat ne correspond à votre recherche. Élargissez les filtres ou changez de lieu.',
    price: 'Prix',
    book: 'Voir le détail de la chambre',
    details: 'Voir le détail',
    filterTitle: 'Sélection intelligente',
    resultTitle: 'Résultats correspondants',
    loadMore: 'Afficher plus',
    loadingMore: 'Chargement...',
    noPhotoYet: 'Pas encore de photos',
    ready: 'Prêt à rechercher',
    staysReady: 'Prêt à réserver un séjour',
    staysTitle: 'Recherche de séjours',
    staysBody: 'Choisissez les dates, les voyageurs, le type de chambre, le type de lit et les services, puis consultez le détail du logement avant de demander une réservation.',
    divisionCopy: {
      stays: {
        ready: 'Prêt à réserver un séjour',
        title: 'Recherche de séjours',
        body: 'Choisissez les dates, les voyageurs, le type de chambre, le type de lit et les services, puis consultez le détail du logement avant de demander une réservation.',
        action: 'Voir le détail du logement',
      },
      rentals: {
        ready: 'Prêt à chercher une location',
        title: 'Recherche de locations au mois',
        body: 'Choisissez le gouvernorat, la ville, le quartier, le type de bien, les pièces et les services, puis consultez le détail du bien avant d’envoyer une demande.',
        action: 'Voir le détail du bien',
      },
      buy: {
        ready: 'Prêt à acheter un bien',
        title: 'Recherche de biens à vendre',
        body: 'Choisissez le lieu, le type de bien, le prix et la superficie, puis consultez le détail du bien avant de prendre contact ou d’envoyer une demande.',
        action: 'Voir le détail du bien',
      },
      newConstruction: {
        ready: 'Prêt à découvrir les projets',
        title: 'Recherche de projets neufs',
        body: 'Choisissez la ville, le type de projet, le prix et le plan, puis consultez le détail du projet avant de réserver une visite ou de prendre contact.',
        action: 'Voir le détail du projet',
      },
      cars: {
        ready: 'Prêt à chercher un véhicule',
        title: 'Recherche de véhicules',
        body: 'Choisissez le lieu, le prix, le type et les caractéristiques, puis consultez le détail du véhicule avant de contacter le vendeur.',
        action: 'Voir le détail du véhicule',
      },
      marketplace: {
        ready: 'Prêt à explorer le marché',
        title: 'Recherche sur le marché',
        body: 'Choisissez la catégorie, le lieu, le prix et l’état de l’article, puis consultez le détail du produit avant d’envoyer une demande.',
        action: 'Voir le détail du produit',
      },
    },
  },
}

export function SearchPreviewPage({ lang, initialDivision = 'stays', entry = 'general' }: SearchPreviewPageProps) {
  const t = T[lang]
  const [effectiveInitialDivision, setEffectiveInitialDivision] = useState<SearchDivision>(() => readInitialSearchDivision(initialDivision))
  const [state, setState] = useState<'loading' | 'empty' | 'error'>('empty')
  const [lastSearch, setLastSearch] = useState<UnifiedSearchValue | null>(null)
  const [listings, setListings] = useState<PlatformListing[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [lastQuery, setLastQuery] = useState<{ division: string; filters?: Parameters<typeof fetchApprovedListings>[1] } | null>(null)
  // Keyword filtering is client-side over the loaded results (the listings API has no keyword
  // parameter): titles (AR/EN) and description, case-insensitive, Arabic-normalized.
  const [activeKeyword, setActiveKeyword] = useState('')
  // The bar is remounted (fresh from the cleared draft) when the guest resets the search.
  const [barKey, setBarKey] = useState(0)
  // Only the newest request may update the list (choosing a governorate searches immediately, so
  // several requests can be in flight).
  const requestSeq = useRef(0)
  const isStaysEntry = entry === 'stays'
  const isDirectDivisionEntry = isStaysEntry || initialDivision !== 'stays'
  const divisionCopy = t.divisionCopy[effectiveInitialDivision]
  const isSampleMode = listings.some(isSampleListing)
  const visibleListings = useMemo(
    () => (activeKeyword.trim() ? listings.filter((listing) => listingMatchesKeyword(listing, activeKeyword)) : listings),
    [listings, activeKeyword],
  )
  // A count is only meaningful once the guest has searched or filtered; before that the list is
  // just a sample of the newest listings, so no number is shown.
  const hasSearched = lastSearch !== null
  const countText = `${visibleListings.length}${nextCursor ? '+' : ''}`

  useEffect(() => {
    setEffectiveInitialDivision(readInitialSearchDivision(initialDivision))
  }, [initialDivision])

  useEffect(() => {
    // Start from exactly what the bar shows: when the session already carries a chosen location
    // (e.g. returning from a listing), the first list is narrowed by it too.
    const restored = restoredSearchValue(effectiveInitialDivision)
    void runLiveSearch(restored.locationTouched ? restored : undefined)
  }, [effectiveInitialDivision])

  async function runLiveSearch(value?: UnifiedSearchValue) {
    const seq = ++requestSeq.current
    setState('loading')
    setLastSearch(value || null)
    setActiveKeyword(value && value.division !== 'stays' ? value.keyword : '')

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
            // A real bug caught by an independent re-audit: bedroomsCount/bathrooms default to 1
            // and their only editable UI (the counter steppers in UnifiedSearchBar) is gated to
            // isStay -- so for every other division these were silently sent as bedroomsMin=1/
            // bathroomsMin=1 on every explicit search. CARS/MARKETPLACE listings have no
            // bedrooms/bathrooms metadata at all, so that JSON-path filter matched nothing and
            // every filtered search returned zero results while blaming the user's filters. Only
            // send these for the divisions that actually carry that metadata.
            bedroomsMin: HAS_BEDROOM_BATHROOM_FILTERS.has(value.division) && value.bedroomsCount > 1 ? value.bedroomsCount : undefined,
            // 1 is the stepper's floor and means "any": sending it dropped every listing without bedroom data.
            bathroomsMin: HAS_BEDROOM_BATHROOM_FILTERS.has(value.division) && value.bathrooms > 1 ? value.bathrooms : undefined,
            // Wire the chosen location to the server so results actually narrow to the selected
            // governorate (maps the capsule key to the stored English city name). Only once the
            // guest actually touches the location picker -- UnifiedSearchBar's governorate/city
            // default to Damascus for display, and CARS/MARKETPLACE listings are almost never
            // geotagged, so applying that untouched default as a filter silently zeroed out
            // every explicit search in those divisions.
            city: value.locationTouched && value.governorate ? governorateCityName(value.governorate) : undefined,
          }
        : undefined
      const division = toApiDivision(value?.division || effectiveInitialDivision)
      const results = await fetchApprovedListings(division, filters)
      if (seq !== requestSeq.current) return
      setListings(results.listings)
      setNextCursor(results.nextCursor)
      setLastQuery({ division, filters })
      setState('empty')
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

  // "Reset" / "Show all Syria": drop every filter (location and keyword included), clear the
  // saved draft so the remounted bar starts empty, and reload the broad list.
  function resetSearch() {
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.removeItem('sybnb-v6-search-draft')
      } catch {
        // Blocked storage only means the bar keeps its previous values.
      }
    }
    setBarKey((key) => key + 1)
    void runLiveSearch()
  }

  function openListing(listing: PlatformListing) {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('sybnb-v6-listing-return-path', routeForDivision(listing.division))
    }
    window.location.hash = `/listing/${listing.id}`
  }

  return (
    <main dir={lang === 'ar' ? 'rtl' : 'ltr'} className="search-experience">
      <section className="search-hero">
        <div>
          <p>{divisionCopy?.ready || (isStaysEntry ? t.staysReady : t.ready)}</p>
          <h1>{divisionCopy?.title || (isStaysEntry ? t.staysTitle : pick(lang, 'محرك بحث SYBNB', 'SYBNB Search Engine', 'Moteur de recherche SYBNB'))}</h1>
          <span>{divisionCopy?.body || (isStaysEntry ? t.staysBody : t.body)}</span>
          {effectiveInitialDivision === 'stays' && (
            <button
              type="button"
              className="stays-host-cta"
              onClick={() => (window.location.hash = '/host')}
            >
              {pick(lang, 'هل لديك مكان؟ أدرج مكانك واستضِف', 'Have a place? List your place & host', 'Vous avez un logement ? Publiez-le et devenez hôte')}
            </button>
          )}
        </div>
        <div className="search-hero-photo" aria-hidden="true">
          <img src={HERO_PHOTOS[effectiveInitialDivision] || HERO_PHOTOS.stays} alt="" />
          {hasSearched ? <strong>{countText}</strong> : null}
        </div>
      </section>

      <UnifiedSearchBar
        key={barKey}
        lang={lang}
        initialDivision={effectiveInitialDivision}
        lockedDivision={isDirectDivisionEntry}
        onSearch={(value) => void runLiveSearch(value)}
      />

      <section className="search-results" aria-busy={state === 'loading'}>
        <div className="search-results-head">
          <span>{t.resultTitle}</span>
          {state === 'loading' ? (
            <small className="search-results-loading">{pick(lang, 'جارٍ البحث…', 'Searching…', 'Recherche en cours…')}</small>
          ) : hasSearched ? (
            <strong>{countText}</strong>
          ) : null}
        </div>
        {(state === 'error' || (state === 'empty' && visibleListings.length === 0)) && (
          <SearchStateCard
            lang={lang}
            state={state}
            onReset={resetSearch}
            onShowAll={resetSearch}
            onRetry={() => void runLiveSearch(lastSearch || undefined)}
          />
        )}
        {visibleListings.length ? (
          <div className="search-result-grid">
            {visibleListings.map((listing) => {
              const card = cardText(listing, lang)
              const photo = listingPhoto(listing)
              return (
                <article key={listing.id} className="search-result-card">
                  <button type="button" className="search-result-media" onClick={() => openListing(listing)} aria-label={card.title}>
                    {photo ? (
                      <img src={photo} alt={card.title} loading="lazy" />
                    ) : (
                      <span className="search-result-placeholder">
                        <DivisionIcon division={listing.division} />
                        <small>{t.noPhotoYet}</small>
                      </span>
                    )}
                    {card.demo ? <span className="search-result-demo">{pick(lang, 'تجريبي', 'Demo', 'Démo')}</span> : null}
                  </button>
                  <div className="search-result-body">
                    {listing.status !== 'APPROVED' && (
                      <span className="search-result-status">{statusText(listing.status, lang)}</span>
                    )}
                    <h2>{card.title}</h2>
                    {card.place ? <span className="search-result-place">{card.place}</span> : null}
                    {card.description ? <p>{card.description}</p> : null}
                    <div className="search-result-meta">
                      <span>{t.price}</span>
                      <strong dir={lang === 'ar' ? 'rtl' : 'ltr'}>{listingPriceText(listing, lang)}</strong>
                    </div>
                    <div className="search-result-actions">
                      <button
                        type="button"
                        onClick={() => openListing(listing)}
                      >
                        {divisionCopy?.action || t.book}
                      </button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        ) : null}
        {nextCursor && (
          <div className="search-results-load-more">
            <button type="button" onClick={() => void loadMoreResults()} disabled={loadingMore}>
              {loadingMore ? t.loadingMore : t.loadMore}
            </button>
          </div>
        )}
      </section>

      <section className="search-last">
        <span>{t.lastSearch}</span>
        <b>{lastSearch ? searchSummary(lastSearch, lang) : t.none}</b>
      </section>
    </main>
  )
}

// The listing's own uploaded photo, or nothing: a generic division photo repeated on every card
// made every result look like the same real apartment, so photo-less cards get a neutral placeholder.
function listingPhoto(listing: PlatformListing) {
  const mediaUrl = listing.media?.map((item) => item.url || item.src || item.assetUrl).find((value) => typeof value === 'string')
  return typeof mediaUrl === 'string' ? mediaUrl : ''
}

const DEMO_TITLE_PREFIX = /^\s*(?:تجريبي|Demo|Démo)\s*[—–-]\s*/
// Trailing "(إعلان تجريبي للعرض فقط — غير متاح للحجز.)" / "(Demo listing for display only — ...)".
const DEMO_DESCRIPTION_NOTE = /\s*\((?:[^()]*تجريبي[^()]*|[^()]*\bd[ée]mo\b[^()]*)\)\s*$/i
const ARABIC_SCRIPT = /[\u0600-\u06FF]/

function textValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

// Card copy for the current language: the demo prefix becomes a badge, the demo note is dropped
// from the description, and the place line never mixes Arabic and Latin script.
function cardText(listing: PlatformListing, lang: Lang) {
  const rawTitle = listingDisplayTitle(listing, lang)
  const metadata = (listing.metadata || {}) as Record<string, unknown>
  const demo = metadata.demo === true || DEMO_TITLE_PREFIX.test(rawTitle)
  const title = rawTitle.replace(DEMO_TITLE_PREFIX, '').trim() || rawTitle
  const description = listingDescriptionText(listing, lang).replace(DEMO_DESCRIPTION_NOTE, '').trim()
  return { demo, title, description, place: placeLine(listing, lang) }
}

function placeLine(listing: PlatformListing, lang: Lang) {
  const location = (listing.location || {}) as Record<string, unknown>
  const metadata = (listing.metadata || {}) as Record<string, unknown>
  const cityEn = textValue(location.city)
  const governorateRaw = textValue(location.governorate)
  // Match the stored governorate (Arabic or English) or the English city to the geo data.
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

function DivisionIcon({ division }: { division: string }) {
  if (division === 'CARS') {
    return (
      <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round">
        <path d="M8 30v-6l4-9a3 3 0 0 1 2.8-2h18.4a3 3 0 0 1 2.8 2l4 9v6a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2z" />
        <path d="M8 24h32" />
        <circle cx="15" cy="32" r="3.5" />
        <circle cx="33" cy="32" r="3.5" />
      </svg>
    )
  }
  if (division === 'MARKETPLACE') {
    return (
      <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round">
        <path d="M10 16h28l-2 24H12z" />
        <path d="M18 16v-3a6 6 0 0 1 12 0v3" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round">
      <path d="M8 22 24 9l16 13" />
      <path d="M12 19v20h24V19" />
      <path d="M20 39V28h8v11" />
    </svg>
  )
}

function searchSummary(value: UnifiedSearchValue, lang: Lang) {
  // Localized place labels only -- never the raw keys (e.g. "damascus-city").
  const governorate = value.locationTouched ? getGovernorate(value.governorate) : undefined
  const city = governorate ? getCity(value.governorate, value.city) : undefined
  const area = city?.areas.find((item) => item.key === value.area)
  const placeLabel = value.customPlaceName.trim() || labelFor(lang, area) || labelFor(lang, city) || labelFor(lang, governorate)
  const divisionLabel: Record<UnifiedSearchValue['division'], Record<Lang, string>> = {
    stays: { ar: 'إيجار يومي', en: 'Daily rental', fr: 'Séjour' },
    rentals: { ar: 'إيجار شهري', en: 'Monthly rental', fr: 'Location au mois' },
    buy: { ar: 'شراء عقار', en: 'Buy property', fr: 'Achat immobilier' },
    newConstruction: { ar: 'مشاريع جديدة', en: 'New construction', fr: 'Projets neufs' },
    cars: { ar: 'مركبات', en: 'Cars', fr: 'Voitures' },
    marketplace: { ar: 'السوق', en: 'Marketplace', fr: 'Marché' },
  }
  return [
    divisionLabel[value.division][lang],
    placeLabel,
    value.checkIn,
    value.checkOut,
    value.keyword,
  ].filter(Boolean).join(' · ')
}

// Map the search capsule's governorate key to the English city name listings store in location.city,
// so the server-side city filter actually matches (Syria's 5 covered governorates).
// Only real-estate divisions carry bedrooms/bathrooms metadata server-side (see
// server/routes/listings.mjs's bedroomsMin/bathroomsMin JSON-path filter) -- CARS and
// MARKETPLACE listings never do, so sending these for them matches nothing.
// UX-4A fix (Priority B, 2026-08-31): 'newConstruction' removed. The only
// division actually routed through this component that used to be in this
// Set -- 'rentals'/'buy' route through a separate RentalsPage.tsx instead
// -- so 'newConstruction' was silently sending bedroomsMin=1/bathroomsMin=1
// on every search with zero visible or editable UI for it (UnifiedSearchBar's
// steppers are `isStay`-only). This does remove a real filter capability
// New Construction listings could otherwise support (its sellers do capture
// real bedroom/bathroom metadata via SellerListingWizard) -- the correct
// long-term fix is real stepper UI for this division, not yet authorized;
// this closes the invisible-default bug without building that UI.
// Photo shown beside each division's search title (replaces the old "live database results" box).
const HERO_PHOTOS: Record<string, string> = {
  stays: '/assets/divisions/daily-rental.webp',
  rentals: '/assets/divisions/monthly-rental.webp',
  buy: '/assets/divisions/buy-property.webp',
  newConstruction: '/assets/divisions/new-construction.webp',
  cars: '/assets/divisions/cars.webp',
  marketplace: '/assets/divisions/marketplace.webp',
}

const HAS_BEDROOM_BATHROOM_FILTERS = new Set<UnifiedSearchValue['division']>(['stays', 'rentals', 'buy'])

function toApiDivision(division: UnifiedSearchValue['division']) {
  const map: Record<UnifiedSearchValue['division'], string> = {
    stays: 'STAYS',
    rentals: 'RENTALS',
    buy: 'BUY',
    newConstruction: 'NEW_CONSTRUCTION',
    cars: 'CARS',
    marketplace: 'MARKETPLACE',
  }
  return map[division]
}

function readInitialSearchDivision(fallback: SearchDivision) {
  if (typeof window === 'undefined') return fallback
  if (fallback !== 'stays') {
    window.sessionStorage.removeItem('sybnb-v6-search-initial-division')
    return fallback
  }
  const raw = window.sessionStorage.getItem('sybnb-v6-search-initial-division')
  window.sessionStorage.removeItem('sybnb-v6-search-initial-division')
  if (raw === 'stays' || raw === 'rentals' || raw === 'buy' || raw === 'newConstruction' || raw === 'cars' || raw === 'marketplace') {
    return raw
  }
  return fallback
}

function routeForDivision(division: string) {
  const routes: Record<string, string> = {
    STAYS: '/stays',
    RENTALS: '/rentals',
    BUY: '/buy',
    NEW_CONSTRUCTION: '/new-construction',
    CARS: '/cars',
    MARKETPLACE: '/marketplace',
  }
  return routes[division] || '/stays'
}
