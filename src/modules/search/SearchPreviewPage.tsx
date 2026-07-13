import { useEffect, useState } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { fetchApprovedListings, isSampleListing, type ListingSearchFilters, type PlatformListing } from '../../shared/api/platformApi'
import { listingDescriptionText, listingTitleText, moneyText, statusText } from '../../shared/i18n/display'
import { SearchStateCard } from './SearchStates'
import { UnifiedSearchBar } from './UnifiedSearchBar'
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
    price: 'السعر',
    book: 'فتح تفاصيل الغرفة',
    details: 'عرض التفاصيل',
    filterTitle: 'اختيار ذكي',
    resultTitle: 'النتائج المناسبة',
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
    price: 'Price',
    book: 'Open room details',
    details: 'View details',
    filterTitle: 'Smart selection',
    resultTitle: 'Matched results',
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
}

const DIVISION_IMAGES: Record<string, string> = {
  STAYS: '/assets/divisions/daily-rental.webp',
  RENTALS: '/assets/divisions/monthly-rental.webp',
  BUY: '/assets/divisions/buy-property.webp',
  NEW_CONSTRUCTION: '/assets/divisions/new-construction.webp',
  CARS: '/assets/divisions/cars.webp',
  MARKETPLACE: '/assets/divisions/marketplace.webp',
}

export function SearchPreviewPage({ lang, initialDivision = 'stays', entry = 'general' }: SearchPreviewPageProps) {
  const t = T[lang]
  const [effectiveInitialDivision, setEffectiveInitialDivision] = useState<SearchDivision>(() => readInitialSearchDivision(initialDivision))
  const [state, setState] = useState<'loading' | 'empty' | 'error'>('empty')
  const [lastSearch, setLastSearch] = useState<UnifiedSearchValue | null>(null)
  const [listings, setListings] = useState<PlatformListing[]>([])
  const isStaysEntry = entry === 'stays'
  const isDirectDivisionEntry = isStaysEntry || initialDivision !== 'stays'
  const divisionCopy = t.divisionCopy[effectiveInitialDivision]
  const isSampleMode = listings.some(isSampleListing)

  useEffect(() => {
    setEffectiveInitialDivision(readInitialSearchDivision(initialDivision))
  }, [initialDivision])

  useEffect(() => {
    void runLiveSearch()
  }, [effectiveInitialDivision])

  async function runLiveSearch(value?: UnifiedSearchValue) {
    setState('loading')
    setLastSearch(value || null)

    try {
      const results = await fetchApprovedListings(
        toApiDivision(value?.division || effectiveInitialDivision),
        value ? toListingSearchFilters(value) : {},
      )
      setListings(results)
      setState('empty')
    } catch {
      setListings([])
      setState('error')
    }
  }

  function openListing(listing: PlatformListing) {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('sybnb-v6-listing-return-path', routeForDivision(listing.division))
    }
    window.location.hash = `/listing/${listing.id}`
  }

  return (
    <main dir={lang === 'ar' ? 'rtl' : 'ltr'} className="search-experience">
      <section style={flowStyles.nav} aria-label={lang === 'ar' ? 'التنقل بين الخطوات' : 'Step navigation'}>
        <button style={flowStyles.arrow} onClick={() => (window.location.hash = '/')} aria-label={lang === 'ar' ? 'السابق' : 'Back'}>
          ‹
        </button>
        <button
          style={flowStyles.arrow}
          disabled={!listings[0]}
          onClick={() => listings[0] && openListing(listings[0])}
          aria-label={lang === 'ar' ? 'التالي' : 'Next'}
        >
          ›
        </button>
      </section>

      <section className="search-hero">
        <div>
          <p>{divisionCopy?.ready || (isStaysEntry ? t.staysReady : t.ready)}</p>
          <h1>{divisionCopy?.title || (isStaysEntry ? t.staysTitle : lang === 'ar' ? 'محرك بحث SYBNB' : 'SYBNB Search Engine')}</h1>
          <span>{divisionCopy?.body || (isStaysEntry ? t.staysBody : t.body)}</span>
        </div>
        <div className="search-hero-metrics" aria-label={lang === 'ar' ? 'حالة البحث' : 'Search status'}>
          <strong>{listings.length}</strong>
          <small>{isSampleMode ? t.sampleResults : t.liveResults}</small>
        </div>
      </section>

      <UnifiedSearchBar
        lang={lang}
        initialDivision={effectiveInitialDivision}
        lockedDivision={isDirectDivisionEntry}
        onSearch={(value) => void runLiveSearch(value)}
      />

      {(state !== 'empty' || listings.length === 0) && (
        <SearchStateCard lang={lang} state={state} onReset={() => setLastSearch(null)} />
      )}

      <section className="search-results">
        <div className="search-results-head">
          <span>{t.resultTitle}</span>
          <strong>{listings.length}</strong>
        </div>
        {listings.length ? (
          <div className="search-result-grid">
            {listings.map((listing) => (
              <article key={listing.id} className="search-result-card">
                <img src={listingImage(listing)} alt="" loading="lazy" />
                <div className="search-result-body">
                  <span className="search-result-status">{statusText(listing.status, lang)}</span>
                  {listing.hasActiveOffer && (
                    <span className="search-result-offer-badge">{lang === 'ar' ? '🔥 عرض خاص' : '🔥 Special offer'}</span>
                  )}
                  <h2>{listingTitleText(listing, lang)}</h2>
                  <p>{listingDescriptionText(listing, lang) || t.pendingOnly}</p>
                  <div className="search-result-meta">
                    <span>{t.price}</span>
                    <strong dir={lang === 'ar' ? 'rtl' : 'ltr'}>{moneyText(listing.priceMinor, listing.currency, lang)}</strong>
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
            ))}
          </div>
        ) : (
          <p className="search-empty-copy">{t.pendingOnly}</p>
        )}
      </section>

      <section className="search-last">
        <span>{t.lastSearch}</span>
        <b>{lastSearch ? searchSummary(lastSearch, lang) : t.none}</b>
      </section>
    </main>
  )
}

const flowStyles = {
  nav: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  arrow: { width: 54, height: 54, borderRadius: 999, border: '1px solid #30384d', background: '#111827', color: '#fff', fontSize: 34, fontWeight: 900, display: 'grid', placeItems: 'center' },
} as const

function listingImage(listing: PlatformListing) {
  if (listing.division === 'CARS' || listing.division === 'NEW_CONSTRUCTION' || listing.division === 'MARKETPLACE') {
    return DIVISION_IMAGES[listing.division]
  }
  const mediaUrl = listing.media?.map((item) => item.url || item.src || item.assetUrl).find((value) => typeof value === 'string')
  if (typeof mediaUrl === 'string') return mediaUrl
  return DIVISION_IMAGES[listing.division] || '/assets/divisions/daily-rental.webp'
}

function searchSummary(value: UnifiedSearchValue, lang: Lang) {
  const divisionLabel: Record<UnifiedSearchValue['division'], Record<Lang, string>> = {
    stays: { ar: 'إيجار يومي', en: 'Daily rental' },
    rentals: { ar: 'إيجار شهري', en: 'Monthly rental' },
    buy: { ar: 'شراء عقار', en: 'Buy property' },
    newConstruction: { ar: 'مشاريع جديدة', en: 'New construction' },
    cars: { ar: 'مركبات', en: 'Cars' },
    marketplace: { ar: 'السوق', en: 'Marketplace' },
  }
  return [
    divisionLabel[value.division][lang],
    value.customPlaceName || value.area || value.city || value.governorate,
    value.checkIn,
    value.checkOut,
    value.keyword,
  ].filter(Boolean).join(' · ')
}

// Nightly-rate bands in SYP for the "price" quick filter chip (any/low/mid/high). These are a
// product-level judgment call, not derived from data — adjust here if the bands feel off.
const PRICE_BANDS: Record<string, { minPrice?: number; maxPrice?: number }> = {
  low: { maxPrice: 150000 },
  mid: { minPrice: 150000, maxPrice: 300000 },
  high: { minPrice: 300000 },
}

function toListingSearchFilters(value: UnifiedSearchValue): ListingSearchFilters {
  const band = value.priceBand && value.priceBand !== 'any' ? PRICE_BANDS[value.priceBand] : undefined
  const isStaysSearch = value.division === 'stays'
  return {
    governorate: value.governorate || undefined,
    city: value.city || undefined,
    area: value.area || undefined,
    propertyType: value.propertyType && value.propertyType !== 'any' ? value.propertyType : undefined,
    roomType: isStaysSearch && value.roomType && value.roomType !== 'any' ? value.roomType : undefined,
    bedType: isStaysSearch && value.bedType && value.bedType !== 'any' ? value.bedType : undefined,
    bedrooms: isStaysSearch && value.bedroomsCount > 0 ? value.bedroomsCount : undefined,
    bathrooms: isStaysSearch && value.bathrooms > 0 ? value.bathrooms : undefined,
    amenities: value.amenities?.length ? value.amenities : undefined,
    checkIn: isStaysSearch && value.checkIn ? value.checkIn : undefined,
    checkOut: isStaysSearch && value.checkOut ? value.checkOut : undefined,
    sort: value.sort === 'priceLow' ? 'priceAsc' : value.sort === 'priceHigh' ? 'priceDesc' : undefined,
    ...band,
  }
}

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
