import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  createPrototypeBooking,
  fetchListingQuote,
  fetchPrototypeListing,
  type PlatformListing,
} from '../../shared/api/platformApi'
import { listingTitleText, moneyText } from '../../shared/i18n/display'
import { freeCancellationLabel } from '../../shared/booking/cancellationPolicy'
import { isValidDate, nightsBetween, type DateRange } from '../search/DateRangePicker'
import { sypMinorToRoundedUsdMinor } from '../../shared/currency'

type Props = {
  listingId: string
  lang: Lang
}

// This page is SYBNB's equivalent of Airbnb's "Request to book" / Booking.com's checkout step —
// the one deliberate point of no return. ListingDetailPage (the PDP) only ever lets a guest
// browse and configure a stay; the real reservation is created here, and only here, right next
// to the terms checkbox and the single unambiguous confirm button. Keeping this on its own route
// (rather than a section of the PDP) is what makes "still deciding" and "about to pay" visibly
// different screens, the way real platforms do it.

const copy = {
  ar: {
    back: 'العودة إلى الإعلان',
    loading: 'جار التحميل',
    error: 'تعذر تحميل تفاصيل الحجز',
    title: 'مراجعة الحجز',
    subtitle: 'راجع تفاصيل إقامتك والسعر قبل إرسال طلب الحجز.',
    tripSummary: 'ملخص الرحلة',
    checkIn: 'تاريخ الدخول',
    checkOut: 'تاريخ الخروج',
    nights: (n: number) => `${n} ${n === 1 ? 'ليلة' : 'ليالٍ'}`,
    priceBreakdown: 'تفاصيل السعر',
    stayAmount: 'قيمة الحجز',
    cancellationProtection: 'حماية الإلغاء',
    totalDue: 'الإجمالي المستحق',
    agreementTitle: 'اتفاقية الإيجار اليومي',
    agreementCopy: 'أوافق على صحة بياناتي، احترام سياسة الحجز والإلغاء، الدفع داخل SYBNB فقط، عدم الاتفاق خارج المنصة، الالتزام بقواعد الاستضافة، وتحويل أي نزاع إلى فريق SYBNB قبل أي تصرف خارجي. أعلم أن SYBNB تخصم عمولة خدمة (10% من قيمة الإيجار) من مستحقات المضيف مقابل إدارة الحجز والدفع والحماية.',
    agreementRequired: 'يجب قبول اتفاقية الإيجار اليومي قبل إرسال طلب الحجز.',
    agreementVersion: 'SYBNB_SHORT_TERM_RENTAL_GUEST_AGREEMENT_V1',
    agreementVersionLabel: 'الإصدار 1',
    confirm: 'تأكيد وإرسال طلب الحجز',
    saving: 'جار الإرسال',
    datesMissing: 'اختر تاريخ الدخول والخروج من صفحة الإعلان أولاً.',
    freeCancellation: 'إلغاء مجاني',
  },
  en: {
    back: 'Back to listing',
    loading: 'Loading',
    error: 'Could not load booking details',
    title: 'Review your booking',
    subtitle: 'Review your stay details and price before sending the booking request.',
    tripSummary: 'Trip summary',
    checkIn: 'Check-in',
    checkOut: 'Check-out',
    nights: (n: number) => `${n} ${n === 1 ? 'night' : 'nights'}`,
    priceBreakdown: 'Price breakdown',
    stayAmount: 'Booking amount',
    cancellationProtection: 'Cancellation protection',
    totalDue: 'Total due',
    agreementTitle: 'Short-Term Rental Agreement',
    agreementCopy: 'I agree that my information is accurate, booking and cancellation rules apply, payment happens only inside SYBNB, no outside-platform agreement is allowed, stay rules must be respected, and disputes go to the SYBNB team before any outside action. I understand SYBNB deducts a service commission (10% of the rent amount) from the host payout for managing the booking, payment, and protection.',
    agreementRequired: 'You must accept the short-term rental agreement before sending the booking request.',
    agreementVersion: 'SYBNB_SHORT_TERM_RENTAL_GUEST_AGREEMENT_V1',
    agreementVersionLabel: 'Version 1',
    confirm: 'Confirm and send booking request',
    saving: 'Sending',
    datesMissing: 'Choose check-in and check-out dates on the listing page first.',
    freeCancellation: 'Free cancellation',
  },
}

const CUSTOMER_GATE_KEY = 'sybnb-v6-customer-account-ready'

const DIVISION_IMAGES: Record<string, string> = {
  STAYS: '/assets/divisions/daily-rental.webp',
}

export function BookingReviewPage({ listingId, lang }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const [listing, setListing] = useState<PlatformListing | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const draft = useMemo(() => loadBookingDraft(listingId), [listingId])
  const [acceptedGuestAgreement, setAcceptedGuestAgreement] = useState(false)
  const [stayQuote, setStayQuote] = useState<{ totalMinor: number; nights: number } | null>(null)
  const dateRange: DateRange = draft.dateRange || { checkIn: '', checkOut: '' }
  const cancellationProtection = draft.cancellationProtection ?? false
  const payCurrency = draft.payCurrency ?? 'SYP'

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const ready = sessionStorage.getItem(CUSTOMER_GATE_KEY) === '1' || sessionStorage.getItem(`${CUSTOMER_GATE_KEY}:${listingId}`) === '1'
      if (!ready) {
        window.location.hash = `/account/open/${listingId}`
        return
      }
      if (!isValidDate(dateRange.checkIn) || !isValidDate(dateRange.checkOut) || nightsBetween(dateRange.checkIn, dateRange.checkOut) < 1) {
        window.location.hash = `/listing/${listingId}`
        return
      }
    }
    void loadListing()
    void loadQuote()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId])

  async function loadListing() {
    setStatus('loading')
    setMessage('')
    try {
      setListing(await fetchPrototypeListing(listingId))
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  async function loadQuote() {
    try {
      const response = await fetchListingQuote(listingId, dateRange.checkIn, dateRange.checkOut, payCurrency === 'USD' ? 'USD' : undefined)
      setStayQuote({ totalMinor: response.totalMinor, nights: response.nights })
    } catch {
      setStayQuote(null)
    }
  }

  const nights = stayQuote?.nights ?? (isValidDate(dateRange.checkIn) && isValidDate(dateRange.checkOut) ? nightsBetween(dateRange.checkIn, dateRange.checkOut) : 0)
  const stayAmountMinor = stayQuote?.totalMinor ?? (
    payCurrency === 'USD' ? sypMinorToRoundedUsdMinor(listing?.priceMinor ?? 0) : listing?.priceMinor ?? 0
  )
  const protectionFeeMinor = cancellationProtection ? Math.round(stayAmountMinor * 0.03) : 0
  const totalDueMinor = stayAmountMinor + protectionFeeMinor

  async function confirmBooking() {
    if (!listing) return
    if (!acceptedGuestAgreement) {
      setMessage(t.agreementRequired)
      return
    }
    setStatus('saving')
    setMessage('')
    try {
      const booking = await createPrototypeBooking({
        listingId: listing.id,
        amountMinor: totalDueMinor,
        currency: payCurrency,
        checkIn: dateRange.checkIn,
        checkOut: dateRange.checkOut,
        cancellationProtectionPurchased: cancellationProtection,
        cancellationProtectionFeeMinor: cancellationProtection ? protectionFeeMinor : undefined,
        acceptedTerms: true,
        termsVersion: t.agreementVersion,
      })
      clearBookingDraft(listing.id)
      window.location.hash = `/booking/${booking.id}`
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  const title = listing ? listingTitleText(listing, lang) : ''

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <section style={styles.flowNav}>
        <button style={styles.arrowButton} onClick={() => (window.location.hash = `/listing/${listingId}`)} aria-label={t.back}>
          ‹
        </button>
      </section>

      {status === 'loading' && <section style={styles.panel}>{t.loading}</section>}
      {message && <section style={styles.alert}>{message}</section>}

      {listing && (
        <>
          <div style={styles.titleBlock}>
            <h1 style={styles.title}>{t.title}</h1>
            <p style={styles.subtitle}>{t.subtitle}</p>
          </div>

          <section style={styles.listingRecap}>
            <img
              src={listingImage(listing)}
              alt={title}
              style={styles.recapImage}
              onError={(event) => {
                const fallback = DIVISION_IMAGES.STAYS
                if (event.currentTarget.src.endsWith(fallback)) return
                event.currentTarget.src = fallback
              }}
            />
            <div>
              <strong>{title}</strong>
              <span>{listing.owner?.displayName || (isAr ? 'مضيف SYBNB' : 'SYBNB Host')}</span>
            </div>
          </section>

          <section style={styles.card}>
            <h2 style={styles.sectionTitle}>{t.tripSummary}</h2>
            <div style={styles.grid}>
              <Info label={t.checkIn} value={dateRange.checkIn} />
              <Info label={t.checkOut} value={dateRange.checkOut} />
              <Info label={t.nights(nights)} value={moneyText(stayAmountMinor / Math.max(nights, 1), payCurrency, lang)} />
            </div>
            <em style={styles.cancellationCutoff}>
              {t.freeCancellation}: {freeCancellationLabel(dateRange.checkIn, cancellationProtection, lang)}
            </em>
          </section>

          <section style={styles.card}>
            <h2 style={styles.sectionTitle}>{t.priceBreakdown}</h2>
            <Info label={t.stayAmount} value={moneyText(stayAmountMinor, payCurrency, lang)} />
            {protectionFeeMinor > 0 && <Info label={t.cancellationProtection} value={moneyText(protectionFeeMinor, payCurrency, lang)} />}
            <Info label={t.totalDue} value={moneyText(totalDueMinor, payCurrency, lang)} strong />
          </section>

          <section style={styles.bottomActionBar}>
            <label style={styles.agreementBox}>
              <input
                checked={acceptedGuestAgreement}
                onChange={(event) => {
                  setAcceptedGuestAgreement(event.target.checked)
                  if (event.target.checked && message === t.agreementRequired) setMessage('')
                }}
                style={styles.agreementInput}
                type="checkbox"
              />
              <span>
                <strong>{t.agreementTitle}</strong>
                <small>{t.agreementCopy}</small>
                <em>{t.agreementVersionLabel}</em>
              </span>
            </label>
            <button disabled={status === 'saving'} style={styles.primaryButton} onClick={() => void confirmBooking()}>
              {status === 'saving' ? t.saving : t.confirm}
            </button>
          </section>
        </>
      )}
    </main>
  )
}

function listingImage(listing: PlatformListing) {
  const mediaUrl = listing.media?.map((item) => item.url || item.src || item.assetUrl).find((value) => typeof value === 'string')
  if (typeof mediaUrl === 'string') return mediaUrl
  return DIVISION_IMAGES.STAYS
}

function Info({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <article style={styles.info}>
      <span>{label}</span>
      <strong style={strong ? styles.infoStrong : undefined}>{value}</strong>
    </article>
  )
}

function bookingDraftKey(listingId: string) {
  return `sybnb-v6-booking-draft:${listingId}`
}

type BookingDraft = {
  dateRange: DateRange
  cancellationProtection: boolean
  payCurrency: 'SYP' | 'USD'
}

function loadBookingDraft(listingId: string): Partial<BookingDraft> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = sessionStorage.getItem(bookingDraftKey(listingId))
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function clearBookingDraft(listingId: string) {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem(bookingDraftKey(listingId))
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#0a0a0f', color: '#fff', padding: '24px 16px 112px', display: 'grid', gap: 16, maxWidth: 720, margin: '0 auto' },
  flowNav: { display: 'flex', gap: 12, alignItems: 'center' },
  arrowButton: { width: 54, height: 54, borderRadius: 999, border: '1px solid #30384d', background: '#111827', color: '#fff', fontSize: 34, fontWeight: 900, display: 'grid', placeItems: 'center' },
  titleBlock: { display: 'grid', gap: 6 },
  title: { margin: 0, fontSize: 28 },
  subtitle: { margin: 0, color: '#9aa6ba' },
  listingRecap: { display: 'grid', gridTemplateColumns: '84px minmax(0, 1fr)', gap: 14, alignItems: 'center', border: '1px solid #1e1e2a', borderRadius: 8, background: '#111118', padding: 14 },
  recapImage: { width: 84, height: 84, borderRadius: 8, objectFit: 'cover' },
  card: { border: '1px solid #1e1e2a', borderRadius: 8, background: '#111118', padding: 18, display: 'grid', gap: 12 },
  sectionTitle: { margin: 0, fontSize: 18 },
  grid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' },
  info: { display: 'grid', gap: 4, color: '#9aa6ba' },
  infoStrong: { color: '#20d29b', fontSize: 18 },
  cancellationCutoff: { color: '#20d29b', fontStyle: 'normal', fontWeight: 800, fontSize: 13 },
  panel: { border: '1px solid #30384d', borderRadius: 8, background: '#111118', color: '#fff', padding: 14 },
  alert: { border: '1px solid rgba(255,96,96,.45)', borderRadius: 8, background: 'rgba(255,96,96,.1)', color: '#ffd1d1', padding: 14 },
  bottomActionBar: { position: 'sticky', bottom: 12, border: '1px solid #242a3b', borderRadius: 8, background: 'rgba(13,15,24,.94)', boxShadow: '0 -16px 40px rgba(0,0,0,.35)', backdropFilter: 'blur(16px)', padding: 12, display: 'grid', gap: 12 },
  agreementBox: { border: '1px solid rgba(229,184,11,.58)', borderRadius: 8, background: 'rgba(229,184,11,.08)', color: '#f7d45f', padding: 14, display: 'grid', gap: 12, gridTemplateColumns: '34px minmax(0, 1fr)', alignItems: 'start', lineHeight: 1.5 },
  agreementInput: { width: 28, height: 28, accentColor: '#20d29b', margin: 0 },
  primaryButton: { minHeight: 48, border: 0, borderRadius: 8, background: '#20d29b', color: '#06110e', fontWeight: 950, padding: '0 14px' },
}
