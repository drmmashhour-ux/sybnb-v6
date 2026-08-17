import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Division, DivisionId } from '../../engines/navigation/divisions'
import type { Lang } from '../../engines/language/languageEngine'
import { text } from '../../engines/language/languageEngine'
import {
  fetchApprovedListings,
  isSampleListing,
  type PlatformListing,
} from '../../shared/api/platformApi'
import { listingDescriptionText, listingTitleText, moneyText, statusText } from '../../shared/i18n/display'

type Props = {
  division: Division
  lang: Lang
}

const divisionApi: Partial<Record<DivisionId, string>> = {
  stays: 'STAYS',
  rentals: 'RENTALS',
  buy: 'BUY',
  cars: 'CARS',
  marketplace: 'MARKETPLACE',
  'new-construction': 'NEW_CONSTRUCTION',
}

const pageCopy = {
  ar: {
    back: 'العودة للرئيسية',
    liveInventory: 'مخزون مباشر',
    sampleInventory: 'بيانات تجريبية',
    search: 'بحث الإعلانات',
    hostPortal: 'إضافة إعلان',
    loading: 'جار التحميل',
    empty: 'لا توجد إعلانات منشورة بعد.',
    price: 'السعر',
    details: 'تفاصيل الإعلان',
    openDetails: 'فتح تفاصيل الإعلان',
    requestStatus: 'حالة الطلب',
    saving: 'جار الحفظ',
    database: 'القسم',
    error: 'تعذر تحميل القسم',
    untitled: 'إعلان',
  },
  en: {
    back: 'Back to landing',
    liveInventory: 'Live inventory',
    sampleInventory: 'Sample inventory',
    search: 'Search listings',
    hostPortal: 'Add listing',
    loading: 'Loading',
    empty: 'No published listings yet.',
    price: 'Price',
    details: 'Listing details',
    openDetails: 'Open listing details',
    requestStatus: 'Request status',
    saving: 'Saving',
    database: 'PostgreSQL',
    error: 'Could not load division',
    untitled: 'Listing',
  },
}

const divisionCopy: Record<Lang, Partial<Record<DivisionId, Partial<typeof pageCopy.ar>>>> = {
  ar: {
    stays: {
      search: 'بحث الإيجار اليومي',
      hostPortal: 'أصبح مضيفاً',
      empty: 'لا توجد إقامات منشورة بعد.',
      details: 'تفاصيل الإقامة',
      openDetails: 'فتح تفاصيل الإقامة',
      untitled: 'إقامة',
    },
    rentals: {
      search: 'بحث الإيجار الشهري',
      empty: 'لا توجد عقارات للإيجار الشهري بعد.',
      details: 'تفاصيل الإيجار',
      openDetails: 'فتح تفاصيل الإيجار',
      untitled: 'عقار للإيجار',
    },
    buy: {
      search: 'بحث شراء عقار',
      empty: 'لا توجد عقارات للبيع بعد.',
      details: 'تفاصيل العقار',
      openDetails: 'فتح تفاصيل العقار',
      untitled: 'عقار للبيع',
    },
    cars: {
      search: 'بحث المركبات',
      empty: 'لا توجد مركبات منشورة بعد.',
      details: 'تفاصيل المركبة',
      openDetails: 'فتح تفاصيل المركبة',
      untitled: 'مركبة',
    },
    marketplace: {
      search: 'بحث السوق',
      empty: 'لا توجد منتجات منشورة بعد.',
      details: 'تفاصيل المنتج',
      openDetails: 'فتح تفاصيل المنتج',
      untitled: 'منتج',
    },
    'new-construction': {
      search: 'بحث المشاريع الجديدة',
      empty: 'لا توجد مشاريع منشورة بعد.',
      details: 'تفاصيل المشروع',
      openDetails: 'فتح تفاصيل المشروع',
      untitled: 'مشروع جديد',
    },
  },
  en: {
    stays: {
      search: 'Search daily stays',
      hostPortal: 'Become a host',
      empty: 'No published stays yet.',
      details: 'Stay details',
      openDetails: 'Open stay details',
      untitled: 'Stay',
    },
    rentals: {
      search: 'Search monthly rentals',
      empty: 'No monthly rentals published yet.',
      details: 'Rental details',
      openDetails: 'Open rental details',
      untitled: 'Rental property',
    },
    buy: {
      search: 'Search property sales',
      empty: 'No sale properties published yet.',
      details: 'Property details',
      openDetails: 'Open property details',
      untitled: 'Sale property',
    },
    cars: {
      search: 'Search vehicles',
      empty: 'No vehicles published yet.',
      details: 'Vehicle details',
      openDetails: 'Open vehicle details',
      untitled: 'Vehicle',
    },
    marketplace: {
      search: 'Search marketplace',
      empty: 'No marketplace items published yet.',
      details: 'Item details',
      openDetails: 'Open item details',
      untitled: 'Item',
    },
    'new-construction': {
      search: 'Search new projects',
      empty: 'No new construction projects published yet.',
      details: 'Project details',
      openDetails: 'Open project details',
      untitled: 'New project',
    },
  },
}

export function DivisionLivePage({ division, lang }: Props) {
  const t = { ...pageCopy[lang], ...(divisionCopy[lang][division.id] || {}) }
  const apiDivision = divisionApi[division.id]
  const [listings, setListings] = useState<PlatformListing[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const isCompact = useCompactCards()

  const isAr = lang === 'ar'
  const isSampleMode = listings.some(isSampleListing)

  const stats = useMemo(
    () => [
      { label: isSampleMode ? t.sampleInventory : t.liveInventory, value: String(listings.length) },
      { label: t.database, value: isAr ? text(division.title, 'ar') : apiDivision || division.id },
      { label: t.requestStatus, value: '→' },
    ],
    [apiDivision, division.id, division.title, isAr, isSampleMode, listings.length, t],
  )

  useEffect(() => {
    void loadListings()
  }, [apiDivision])

  async function loadListings() {
    if (!apiDivision) return
    setStatus('loading')
    setMessage('')

    try {
      const nextListings = await fetchApprovedListings(apiDivision)
      setListings(nextListings)
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  function openListing(listingId: string) {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('sybnb-v6-listing-return-path', division.route)
    }
    window.location.hash = `/listing/${listingId}`
  }

  function openDivisionSearch() {
    if (division.id === 'rentals' || division.id === 'buy') {
      window.location.hash = division.route
      return
    }
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('sybnb-v6-search-initial-division', searchDivisionForRoute(division.id))
    }
    window.location.hash = '/search-preview'
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <button style={styles.back} onClick={() => (window.location.hash = '/')}>
        {t.back}
      </button>

      <section style={{ ...styles.hero, border: `1px solid ${division.accent}66` }}>
        <p style={{ ...styles.eyebrow, color: division.accent }}>{text(division.kicker, lang)}</p>
        <h1 style={styles.title}>{text(division.title, lang)}</h1>
        <p style={styles.body}>{text(division.description, lang)}</p>
        <div style={styles.stats}>
          {stats.map((item) => (
            <div key={item.label} style={styles.stat}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
        <div style={styles.heroActions}>
          <button style={{ ...styles.primaryButton, background: division.accent }} onClick={openDivisionSearch}>
            {t.search}
          </button>
          {providerPortalRoute(division.id) && (
            <button style={styles.secondaryButton} onClick={() => (window.location.hash = providerPortalRoute(division.id) || '/host')}>
              {providerPortalLabel(division.id, lang)}
            </button>
          )}
        </div>
      </section>

      {status === 'loading' && <section style={styles.panel}>{t.loading}</section>}
      {message && <section role="alert" aria-live="assertive" style={styles.alert}>{message}</section>}

      <section style={styles.grid}>
        {listings.length ? (
          listings.map((listing) => (
            <article key={listing.id} style={isCompact ? styles.compactCard : styles.card}>
              <div style={styles.cardHeader}>
                <h2 style={isCompact ? styles.compactCardTitle : styles.cardTitle}>{listingTitleText(listing, lang)}</h2>
                {listing.status !== 'APPROVED' && (
                  <span style={{ ...styles.statusPill, borderColor: `${division.accent}66`, color: division.accent }}>
                    {statusText(listing.status, lang)}
                  </span>
                )}
              </div>
              {!isCompact && <p style={styles.cardBody}>{listingDescriptionText(listing, lang)}</p>}
              <div style={isCompact ? styles.compactMetaGrid : styles.metaStack}>
                <div style={styles.meta}>
                  <span>{t.price}</span>
                  <strong dir={isAr ? 'rtl' : 'ltr'}>{moneyText(listing.priceMinor, listing.currency, lang)}</strong>
                </div>
              </div>
              <div style={styles.cardActions}>
                <button
                  style={{ ...styles.primaryButton, background: division.accent }}
                  onClick={() => openListing(listing.id)}
                >
                  {t.openDetails}
                </button>
                <button style={styles.secondaryButton} onClick={() => openListing(listing.id)}>
                  {t.details}
                </button>
              </div>
            </article>
          ))
        ) : (
          status !== 'loading' && <section role="status" style={styles.panel}>{t.empty}</section>
        )}
      </section>
    </main>
  )
}

function searchDivisionForRoute(divisionId: DivisionId) {
  const map: Partial<Record<DivisionId, string>> = {
    stays: 'stays',
    rentals: 'rentals',
    buy: 'buy',
    cars: 'cars',
    marketplace: 'marketplace',
    'new-construction': 'newConstruction',
  }
  return map[divisionId] || 'stays'
}

function providerPortalRoute(divisionId: DivisionId) {
  const map: Partial<Record<DivisionId, string>> = {
    stays: '/host/stays',
    cars: '/host/cars',
    marketplace: '/host/marketplace',
    'new-construction': '/host/new-construction',
  }
  return map[divisionId] || ''
}

function providerPortalLabel(divisionId: DivisionId, lang: Lang) {
  const isAr = lang === 'ar'
  if (divisionId === 'stays') return isAr ? 'أصبح مضيفاً' : 'Become a host'
  if (divisionId === 'cars') return isAr ? 'لوحة بائع المركبات' : 'Vehicle seller dashboard'
  if (divisionId === 'new-construction') return isAr ? 'لوحة المطور العقاري' : 'Developer dashboard'
  if (divisionId === 'marketplace') return isAr ? 'لوحة بائع السوق' : 'Marketplace seller dashboard'
  return isAr ? 'لوحة البائع' : 'Seller dashboard'
}

function useCompactCards() {
  const [compact, setCompact] = useState(() => (typeof window === 'undefined' ? false : window.innerWidth < 760))

  useEffect(() => {
    if (typeof window === 'undefined') return
    const update = () => setCompact(window.innerWidth < 760)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return compact
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#0a0a0f', color: '#fff', padding: '24px 16px 90px', display: 'grid', gap: 16, maxWidth: 1080, margin: '0 auto' },
  back: { justifySelf: 'start', minHeight: 42, border: '1px solid #30384d', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  hero: { border: '1px solid #1e1e2a', borderRadius: 8, padding: 18, background: '#111118', display: 'grid', gap: 14 },
  eyebrow: { letterSpacing: 2, fontWeight: 900, fontSize: 11, margin: 0 },
  title: { margin: 0, fontSize: 38, lineHeight: 1.08 },
  body: { color: '#9aa6ba', margin: 0, maxWidth: 720, lineHeight: 1.6 },
  stats: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' },
  stat: { border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', color: '#9aa6ba', display: 'grid', gap: 4, padding: 12 },
  grid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' },
  card: { border: '1px solid #30384d', borderRadius: 8, background: '#111118', padding: 14, display: 'grid', gap: 10 },
  compactCard: { border: '1px solid #30384d', borderRadius: 12, background: '#111118', padding: 12, display: 'grid', gap: 10 },
  cardHeader: { alignItems: 'start', display: 'grid', gap: 8, gridTemplateColumns: 'minmax(0, 1fr) auto' },
  statusPill: { border: '1px solid #30384d', borderRadius: 999, background: '#0c1220', fontSize: 11, fontWeight: 950, padding: '5px 8px', whiteSpace: 'nowrap' },
  cardTitle: { margin: 0, fontSize: 22, lineHeight: 1.15 },
  compactCardTitle: { margin: 0, fontSize: 19, lineHeight: 1.2, overflowWrap: 'anywhere' },
  cardBody: { color: '#9aa6ba', lineHeight: 1.55, margin: 0 },
  metaStack: { display: 'grid', gap: 10 },
  compactMetaGrid: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' },
  meta: { borderTop: '1px solid #27314a', display: 'flex', justifyContent: 'space-between', gap: 12, paddingTop: 10, color: '#9aa6ba' },
  cardActions: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  primaryButton: { minHeight: 48, border: 0, borderRadius: 8, color: '#051014', fontWeight: 950, padding: '0 14px' },
  secondaryButton: { minHeight: 44, border: '1px solid #30384d', borderRadius: 8, background: '#171b29', color: '#fff', fontWeight: 900, padding: '0 14px' },
  heroActions: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' },
  panel: { border: '1px solid #30384d', borderRadius: 8, background: '#111118', color: '#9aa6ba', padding: 14 },
  alert: { border: '1px solid rgba(255,96,96,.45)', borderRadius: 8, background: 'rgba(255,96,96,.1)', color: '#ffd1d1', padding: 14 },
}
