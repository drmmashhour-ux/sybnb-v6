import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  createPrototypeBooking,
  fetchListingAvailability,
  fetchListingQuote,
  fetchListingReviews,
  fetchPrototypeListing,
  sendListingInquiryMessage,
  type PlatformBooking,
  type PlatformListing,
  type PlatformListingReview,
} from '../../shared/api/platformApi'
import { divisionText, listingDescriptionText, listingTitleText, moneyText, statusText } from '../../shared/i18n/display'
import { propertyFilterGroup, sellerCarFilterGroupsFromConfig } from '../../engines/filters'
import { googleMapsEmbedUrl, googleMapsSearchUrl, listingMapTarget, offlineMapSnapshot, offlineMapStorageKey } from '../../shared/maps/googleMapCapsule'
import { freeCancellationLabel } from '../../shared/booking/cancellationPolicy'
import { guestFeeSummary } from '../bookings/guestFeeSummary'
import { DateField, DateRangePicker, isValidDate, nightsBetween, type DateRange } from '../search/DateRangePicker'
import { loadSearchDatesDraft } from '../search/UnifiedSearchBar'

type Props = {
  listingId: string
  lang: Lang
}


const GUEST_RETURN_PATH_KEY = 'sybnb.v6.guestReturnPath'
const GUEST_SESSION_TOKEN_KEY = 'sybnb-v6-guest-token'

const copy = {
  ar: {
    back: 'العودة',
    loading: 'جار التحميل',
    error: 'تعذر تحميل الإعلان',
    notFoundHelp: 'قد يكون هذا الإعلان محذوفاً أو انتهت صلاحيته. تصفّح إعلانات أخرى أو عد إلى الرئيسية.',
    browseAll: 'تصفح الإعلانات',
    goHome: 'الصفحة الرئيسية',
    price: 'السعر',
    owner: 'المالك',
    division: 'القسم',
    status: 'الحالة',
    request: 'إرسال الطلب',
    saving: 'جار الإرسال',
    requestStatus: 'حالة الطلب',
    dashboard: 'فتح الحساب / تسجيل الدخول',
    payment: 'متابعة الحجز',
    reference: 'رقم الإعلان',
    syrianPound: 'ل.س',
    protected: 'محمي عبر SYBNB',
    trustScore: 'درجة الثقة',
    verifiedOwner: 'مالك موثق',
    fastResponse: 'رد سريع',
    paymentProtected: 'الدفع محمي',
    aiFit: 'مطابقة البحث',
    nextSteps: 'خطوات العميل',
    accountGate: 'سجّل الدخول أو أنشئ حساباً للمتابعة',
    accountGateCopy: 'مثل Airbnb و Booking، يستطيع العميل التصفح أولاً ثم يحتاج حساباً عند إرسال الحجز والدفع.',
    signIn: 'تسجيل الدخول والمتابعة',
    signUp: 'إنشاء حساب والمتابعة',
    phone: 'رقم الهاتف',
    password: 'كلمة المرور',
    repeatPassword: 'تأكيد كلمة المرور',
    sendCode: 'إرسال الرمز',
    resendCode: 'إعادة إرسال الرمز',
    code: 'رمز التحقق',
    securityError: 'أدخل رقم الهاتف وكلمة المرور وتأكيدها ورمز التحقق قبل المتابعة.',
    accountReady: 'تم تجهيز حساب العميل',
    stepRows: ['راجع تفاصيل الغرفة', 'سجّل الدخول أو أنشئ حساباً', 'أرسل الحجز', 'ادفع داخل SYBNB', 'استلم رقم التأكيد'],
    contact: 'فتح التواصل',
    protectionChoice: 'اختيار الحماية',
    standardRate: 'السعر العادي',
    standardCopy: 'سعر أقل، وتطبق رسوم الإلغاء حسب السياسة.',
    protectedRate: 'السعر المحمي',
    protectedCopy: 'أضف حماية الإلغاء المفاجئ واسترد قيمة الحجز بدون رسوم إلغاء.',
    protectionFee: 'رسوم الحماية',
    totalDue: 'الإجمالي المستحق',
    stayAmount: 'قيمة الحجز',
    cleaningFee: 'رسوم الإزالة والتنظيف',
    taxes: 'الضرائب والرسوم المحلية',
    feesIncluded: 'شامل رسوم التنظيف والضرائب',
    agreementTitle: 'اتفاقية الإيجار اليومي',
    agreementCopy: 'أوافق على صحة بياناتي، احترام سياسة الحجز والإلغاء، الدفع داخل SYBNB فقط، عدم الاتفاق خارج المنصة، الالتزام بقواعد الاستضافة، وتحويل أي نزاع إلى فريق SYBNB قبل أي تصرف خارجي. أعلم أن SYBNB تخصم عمولة خدمة (12% من قيمة الإيجار) من مستحقات المضيف مقابل إدارة الحجز والدفع والحماية.',
    agreementRequired: 'يجب قبول اتفاقية الإيجار اليومي قبل إرسال طلب الحجز.',
    datesTitle: 'اختر تاريخ الإقامة',
    datesRequired: 'اختر تاريخ الدخول والخروج قبل إرسال طلب الحجز.',
    editDates: 'تعديل التواريخ',
    quoteLoading: 'جار حساب السعر...',
    agreementVersion: 'SYBNB_SHORT_TERM_RENTAL_GUEST_AGREEMENT_V1',
    agreementVersionLabel: 'الإصدار 1',
    mapTitle: 'موقع الاستضافة',
    mapCopy: 'موقع الاستضافة المختارة يظهر هنا. افتح خرائط Google لمراجعة المكان قبل إرسال طلب الحجز.',
    mapPin: 'موقع الاستضافة',
    mapApproximate: 'موقع تقريبي حسب بيانات الإعلان',
    openGoogleMaps: 'فتح في خرائط Google',
    saveOfflineMap: 'حفظ الموقع دون إنترنت',
    offlineMapReady: 'تم حفظ الموقع للاستخدام دون إنترنت',
    offlineMapCopy: 'في حال انقطاع الإنترنت سيبقى العنوان والإحداثيات محفوظة داخل جهاز العميل.',
    mapRequiresInternet: 'الخريطة المباشرة تحتاج إنترنت. الموقع النصي محفوظ داخل الحجز.',
    location: 'الموقع',
    host: 'المضيف',
    terms: 'الشروط',
    reviews: 'التقييمات',
    noReviewsYet: 'لا توجد تقييمات بعد',
    reviewsCount: (count: number) => `${count} ${count === 1 ? 'تقييم' : 'تقييمات'}`,
    protectedTitle: 'محمي بواسطة SYBNB',
    rating: 'تقييم الثقة',
    howToBook: 'كيفية الحجز',
    instantBookBadge: '⚡ حجز فوري',
    instantBookExplain: 'هذه الاستضافة تفعّل الحجز الفوري: يتأكد حجزك تلقائياً فور نجاح الدفع، دون انتظار موافقة المضيف.',
    share: 'مشاركة',
    requestOnlyAfterAccount: 'افتح حسابك أو سجّل الدخول أولاً، ثم أرسل طلب الحجز.',
    bottomContact: 'تواصل',
    inquirySentTitle: 'تم إرسال طلبك',
    inquirySentCopy: 'وصل طلبك إلى البائع/المضيف عبر صندوق الرسائل داخل SYBNB. لا حاجة للدفع الآن — سيتواصل معك الطرف الآخر من خلال المنصة.',
    openInbox: 'فتح صندوق الرسائل',
  },
  en: {
    back: 'Back',
    loading: 'Loading',
    error: 'Could not load listing',
    notFoundHelp: 'This listing may have been removed or expired. Browse other listings or return home.',
    browseAll: 'Browse listings',
    goHome: 'Home',
    price: 'Price',
    owner: 'Owner',
    division: 'Division',
    status: 'Status',
    request: 'Send request',
    saving: 'Sending',
    requestStatus: 'Request status',
    dashboard: 'Open account / sign in',
    payment: 'Continue booking',
    reference: 'Listing ref',
    syrianPound: 'SYP',
    protected: 'Protected by SYBNB',
    trustScore: 'Trust score',
    verifiedOwner: 'Verified owner',
    fastResponse: 'Fast response',
    paymentProtected: 'Payment protected',
    aiFit: 'Search fit',
    nextSteps: 'Customer steps',
    accountGate: 'Sign in or create an account to continue',
    accountGateCopy: 'Like Airbnb and Booking, guests can browse first and need an account when they reserve and pay.',
    signIn: 'Sign in and continue',
    signUp: 'Create account and continue',
    phone: 'Phone number',
    password: 'Password',
    repeatPassword: 'Repeat password',
    sendCode: 'Send code',
    resendCode: 'Resend code',
    code: 'Verification code',
    securityError: 'Enter phone, password, repeated password, and verification code before continuing.',
    accountReady: 'Guest account ready',
    stepRows: ['Review room details', 'Sign in or create account', 'Send booking', 'Pay inside SYBNB', 'Receive confirmation number'],
    contact: 'Open contact',
    protectionChoice: 'Protection choice',
    standardRate: 'Standard rate',
    standardCopy: 'Lower price; cancellation fees apply by policy.',
    protectedRate: 'Protected rate',
    protectedCopy: 'Add sudden-cancellation protection and recover the booking amount without cancellation fee.',
    protectionFee: 'Protection fee',
    totalDue: 'Total due',
    stayAmount: 'Booking amount',
    cleaningFee: 'Cleaning fee',
    taxes: 'Taxes and local fees',
    feesIncluded: 'Includes cleaning fee and taxes',
    agreementTitle: 'Short-Term Rental Agreement',
    agreementCopy: 'I agree that my information is accurate, booking and cancellation rules apply, payment happens only inside SYBNB, no outside-platform agreement is allowed, stay rules must be respected, and disputes go to the SYBNB team before any outside action. I understand SYBNB deducts a service commission (12% of the rent amount) from the host payout for managing the booking, payment, and protection.',
    agreementRequired: 'You must accept the short-term rental agreement before sending the booking request.',
    datesTitle: 'Choose your stay dates',
    datesRequired: 'Choose check-in and check-out dates before sending the booking request.',
    editDates: 'Edit dates',
    quoteLoading: 'Calculating price...',
    agreementVersion: 'SYBNB_SHORT_TERM_RENTAL_GUEST_AGREEMENT_V1',
    agreementVersionLabel: 'Version 1',
    mapTitle: 'Stay location',
    mapCopy: 'The selected stay location appears here. Open Google Maps to review the place before sending the booking request.',
    mapPin: 'Stay location',
    mapApproximate: 'Approximate location from listing data',
    openGoogleMaps: 'Open in Google Maps',
    saveOfflineMap: 'Save offline location',
    offlineMapReady: 'Location saved for offline use',
    offlineMapCopy: 'If internet is unavailable, the address and coordinates stay saved on the guest device.',
    mapRequiresInternet: 'Live map requires internet. The text location is saved inside the booking.',
    location: 'Location',
    host: 'Host',
    terms: 'Terms',
    reviews: 'Reviews',
    noReviewsYet: 'No reviews yet',
    reviewsCount: (count: number) => `${count} ${count === 1 ? 'review' : 'reviews'}`,
    protectedTitle: 'SYBNB Protected',
    rating: 'Trust rating',
    howToBook: 'How booking works',
    instantBookBadge: '⚡ Instant Book',
    instantBookExplain: 'This stay has Instant Book enabled: your booking confirms automatically once payment succeeds, no host approval wait.',
    share: 'Share',
    requestOnlyAfterAccount: 'Open an account or sign in first, then send the booking request.',
    bottomContact: 'Contact',
    inquirySentTitle: 'Your request was sent',
    inquirySentCopy: "Your request reached the seller/host through SYBNB's inbox. No payment needed now — they'll follow up with you through the platform.",
    openInbox: 'Open inbox',
  },
}

const CUSTOMER_GATE_KEY = 'sybnb-v6-customer-account-ready'

const DIVISION_IMAGES: Record<string, string> = {
  STAYS: '/assets/divisions/daily-rental.webp',
  RENTALS: '/assets/divisions/monthly-rental.webp',
  BUY: '/assets/divisions/buy-property.webp',
  NEW_CONSTRUCTION: '/assets/divisions/new-construction.webp',
  CARS: '/assets/divisions/cars.webp',
  MARKETPLACE: '/assets/divisions/marketplace.webp',
}

export function ListingDetailPage({ listingId, lang }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const [listing, setListing] = useState<PlatformListing | null>(null)
  const [booking, setBooking] = useState<PlatformBooking | null>(null)
  const [inquirySent, setInquirySent] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const messageRef = useRef<HTMLElement | null>(null)
  const bookingDraft = useMemo(() => loadBookingDraft(listingId), [listingId])
  const [cancellationProtection, setCancellationProtection] = useState(bookingDraft.cancellationProtection ?? false)
  const [acceptedGuestAgreement, setAcceptedGuestAgreement] = useState(bookingDraft.acceptedGuestAgreement ?? false)
  const [customerReady, setCustomerReady] = useState(false)
  const [offlineMapReady, setOfflineMapReady] = useState(false)
  const [activeMedia, setActiveMedia] = useState(0)
  const [activeTab, setActiveTab] = useState<'terms' | 'host' | 'location' | 'reviews'>('terms')
  const [dateRange, setDateRange] = useState<DateRange>(
    bookingDraft.dateRange || loadSearchDatesDraft() || { checkIn: '', checkOut: '' },
  )
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [disabledDates, setDisabledDates] = useState<Set<string>>(new Set())
  const [stayQuote, setStayQuote] = useState<{ totalMinor: number; nights: number } | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [reviewSummary, setReviewSummary] = useState<{ reviews: PlatformListingReview[]; average: number | null; count: number }>({
    reviews: [],
    average: null,
    count: 0,
  })

  const title = listing ? listingTitleText(listing, lang) : ''
  const actionLabel = useMemo(() => actionForDivision(listing?.division || 'STAYS', lang), [lang, listing?.division])
  const detailCopy = useMemo(() => detailCopyForDivision(listing?.division || 'STAYS', lang, t), [lang, listing?.division, t])
  const returnPath = useMemo(() => readListingReturnPath(), [])
  const displayedTotalMinor = stayQuote?.totalMinor ?? listing?.priceMinor ?? 0
  // Same guestFeeSummary() the real receipt (BookingDetailPage) uses, so the price a guest evaluates
  // here already includes the cleaning fee + tax the receipt would otherwise reveal only after
  // booking -- CAPSULE_RULES.noFakeTrustSignal extends to prices, not just verification claims.
  const feeInput = useMemo(
    () => (listing ? { division: listing.division, metadata: listing.metadata } : undefined),
    [listing],
  )
  const feesStandard = useMemo(() => guestFeeSummary({ amountMinor: displayedTotalMinor, listing: feeInput }), [displayedTotalMinor, feeInput])
  const feesProtected = useMemo(
    () => guestFeeSummary({ amountMinor: displayedTotalMinor, listing: feeInput, metadata: { cancellationProtectionPurchased: true } }),
    [displayedTotalMinor, feeInput],
  )
  const protectionFeeMinor = feesProtected.cancellationProtectionFeeMinor
  const protectedTotalMinor = feesProtected.totalMinor
  const mapTarget = listing ? listingMapTarget(listing, title, lang) : null

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const accountKey = customerGateKey(listingId)
      const search = new URLSearchParams(window.location.search)
      const hasResetFlag = search.has('resetAccount')
      const hasLegacyAccountReadyFlag = search.has('accountReady')

      if (hasResetFlag) {
        sessionStorage.removeItem(CUSTOMER_GATE_KEY)
        sessionStorage.removeItem(accountKey)
        sessionStorage.removeItem('sybnb-v6-guest-token')
        sessionStorage.removeItem('sybnb.v6.guestSession')
        setCustomerReady(false)
      } else {
        setCustomerReady(sessionStorage.getItem(CUSTOMER_GATE_KEY) === '1' || sessionStorage.getItem(accountKey) === '1')
      }

      if (hasResetFlag || hasLegacyAccountReadyFlag) {
        search.delete('resetAccount')
        search.delete('accountReady')
        const nextSearch = search.toString()
        const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
        window.history.replaceState(null, '', nextUrl)
      }

      try {
        setOfflineMapReady(localStorage.getItem(offlineMapStorageKey(listingId)) !== null)
      } catch {
        setOfflineMapReady(false)
      }
    }
    void loadListing()
    void loadAvailability()
    void loadReviews()
  }, [listingId])

  async function loadAvailability() {
    const from = toISODate(new Date())
    const to = toISODate(new Date(Date.now() + 1000 * 60 * 60 * 24 * 180))
    const response = await fetchListingAvailability(listingId, from, to)
    const blocked = new Set(response.blockedDates)
    response.bookedRanges.forEach((range) => {
      let day = new Date(`${range.checkIn}T00:00:00`)
      const end = new Date(`${range.checkOut}T00:00:00`)
      while (day < end) {
        blocked.add(toISODate(day))
        day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)
      }
    })
    setDisabledDates(blocked)
  }

  async function loadReviews() {
    try {
      const response = await fetchListingReviews(listingId)
      setReviewSummary({ reviews: response.reviews, average: response.average, count: response.count })
    } catch {
      setReviewSummary({ reviews: [], average: null, count: 0 })
    }
  }

  useEffect(() => {
    if (listing?.division !== 'STAYS' || !isValidDate(dateRange.checkIn) || !isValidDate(dateRange.checkOut)) {
      setStayQuote(null)
      return
    }
    let cancelled = false
    setQuoteLoading(true)
    fetchListingQuote(listingId, dateRange.checkIn, dateRange.checkOut)
      .then((response) => {
        if (!cancelled) setStayQuote({ totalMinor: response.totalMinor, nights: response.nights })
      })
      .catch(() => {
        if (!cancelled) setStayQuote(null)
      })
      .finally(() => {
        if (!cancelled) setQuoteLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [listingId, listing?.division, dateRange.checkIn, dateRange.checkOut])

  useEffect(() => {
    if (message) messageRef.current?.scrollIntoView({ behavior: 'instant', block: 'center' })
  }, [message])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const draft: BookingDraft = { dateRange, cancellationProtection, acceptedGuestAgreement }
    sessionStorage.setItem(bookingDraftKey(listingId), JSON.stringify(draft))
  }, [listingId, dateRange, cancellationProtection, acceptedGuestAgreement])

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

  async function requestListing() {
    if (!listing) return
    if (
      listing.division === 'STAYS' &&
      (!isValidDate(dateRange.checkIn) || !isValidDate(dateRange.checkOut) || nightsBetween(dateRange.checkIn, dateRange.checkOut) < 1)
    ) {
      setActiveTab('terms')
      setMessage(t.datesRequired)
      return
    }
    const hasCustomerAccount = customerReady
    if (!hasCustomerAccount) {
      window.location.hash = `/account/open/${listing.id}`
      return
    }
    if (listing.division === 'STAYS' && !acceptedGuestAgreement) {
      setMessage(t.agreementRequired)
      return
    }
    setStatus('saving')
    setMessage('')

    // Only STAYS is a real paid booking. Every other division ("Contact seller" / "Request
    // item" / "Book visit") is a lightweight inquiry — it must never create a PAYMENT_PENDING
    // booking for the full listing price. Route it through the same message-thread inquiry
    // used by Rentals/Buy instead (see sendListingInquiryMessage / RentalsPage.tsx).
    if (listing.division !== 'STAYS') {
      try {
        const introBody = isAr
          ? `طلب تواصل جديد بخصوص "${title}".`
          : `New inquiry about "${title}".`
        await sendListingInquiryMessage(listing.id, introBody)
        setInquirySent(true)
        setStatus('ready')
      } catch (error) {
        setStatus('error')
        setMessage(error instanceof Error ? error.message : t.error)
      }
      return
    }

    try {
      const nextBooking = await createPrototypeBooking({
        listingId: listing.id,
        amountMinor: displayedTotalMinor,
        currency: listing.currency,
        checkIn: dateRange.checkIn,
        checkOut: dateRange.checkOut,
        cancellationProtectionPurchased: cancellationProtection,
        cancellationProtectionFeeMinor: cancellationProtection ? protectionFeeMinor : undefined,
        acceptedTerms: true,
        termsVersion: t.agreementVersion,
      })
      setBooking(nextBooking)
      setStatus('ready')
      clearBookingDraft(listing.id)
      window.location.hash = `/booking/${nextBooking.id}`
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  function openContactTunnel() {
    if (!listing || typeof window === 'undefined') return
    if (!sessionStorage.getItem(GUEST_SESSION_TOKEN_KEY)) {
      sessionStorage.setItem(GUEST_RETURN_PATH_KEY, '/immocontact')
      window.location.hash = '/account/open'
      return
    }
    window.location.hash = '/immocontact'
  }

  function saveOfflineMap() {
    if (!listing) return
    try {
      localStorage.setItem(offlineMapStorageKey(listing.id), JSON.stringify(offlineMapSnapshot(listing, title, lang)))
      setOfflineMapReady(true)
    } catch {
      setMessage(t.mapRequiresInternet)
    }
  }

  function shareListing() {
    if (typeof window === 'undefined') return
    const url = window.location.href
    if (navigator.share) {
      void navigator.share({ title, url }).catch(() => undefined)
      return
    }
    void navigator.clipboard?.writeText(url)
    setMessage(isAr ? 'تم نسخ رابط الإعلان.' : 'Listing link copied.')
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <section style={styles.flowNav} aria-label={isAr ? 'التنقل بين الخطوات' : 'Step navigation'}>
        <button style={styles.arrowButton} onClick={() => (window.location.hash = returnPath)} aria-label={isAr ? 'السابق' : 'Back'}>
          ‹
        </button>
        <button style={styles.arrowButton} disabled={!listing || status === 'saving'} onClick={() => void requestListing()} aria-label={isAr ? 'التالي' : 'Next'}>
          ›
        </button>
      </section>

      {status === 'loading' && <section style={styles.panel}>{t.loading}</section>}
      {status === 'error' && <section ref={messageRef} style={styles.alert}>{message}</section>}
      {status !== 'error' && message && <section ref={messageRef} style={styles.alert}>{message}</section>}

      {status === 'error' && !listing && (
        <section style={styles.panel}>
          <p style={{ margin: '0 0 14px', lineHeight: 1.7 }}>{t.notFoundHelp}</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button style={styles.recoverPrimary} onClick={() => (window.location.hash = returnPath || '/stays')}>
              {t.browseAll}
            </button>
            <button style={styles.recoverSecondary} onClick={() => (window.location.hash = '/')}>
              {t.goHome}
            </button>
          </div>
        </section>
      )}

      {listing && (
        <>
          <section style={styles.detailHero}>
            <button style={styles.heroIconButton} onClick={shareListing} aria-label={t.share}>
              ↗
            </button>
            <button style={styles.heroNextButton} disabled={status === 'saving'} onClick={() => void requestListing()} aria-label={isAr ? 'التالي' : 'Next'}>
              →
            </button>
            <div style={styles.media}>
              {(() => {
                const mediaUrls = (listing.media || [])
                  .map((item) => item.url || item.src || item.assetUrl)
                  .filter((value): value is string => typeof value === 'string')
                const heroSrc = mediaUrls[activeMedia] || listingImage(listing)
                return (
                  <>
                    <img
                      src={heroSrc}
                      alt={title}
                      style={styles.mediaImage}
                      onError={(event) => {
                        const fallback = DIVISION_IMAGES[listing.division] || '/assets/divisions/daily-rental.webp'
                        if (event.currentTarget.src.endsWith(fallback)) return
                        event.currentTarget.src = fallback
                      }}
                    />
                    {mediaUrls.length > 1 && (
                      <div style={styles.thumbStrip} role="group" aria-label={lang === 'ar' ? 'صور الإعلان' : 'Listing photos'}>
                        {mediaUrls.map((url, index) => (
                          <button
                            key={`${url}-${index}`}
                            type="button"
                            onClick={() => setActiveMedia(index)}
                            aria-label={`${title} ${index + 1}`}
                            aria-current={index === activeMedia}
                            style={index === activeMedia ? styles.thumbActive : styles.thumb}
                          >
                            <img src={url} alt="" style={styles.thumbImg} />
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )
              })()}
              <span style={styles.mediaBadge}>{divisionText(listing.division, lang)}</span>
              {listing.instantBookEnabled && <span style={styles.instantBookBadge}>{t.instantBookBadge}</span>}
            </div>
          </section>

          <section style={styles.detailBody}>
            <div style={styles.titleBlock}>
              <h1 style={styles.title}>{title}</h1>
              <span style={styles.locationLine}>⌖ {mapTarget?.label || divisionText(listing.division, lang)}</span>
            </div>

            <div style={styles.tabRow} role="tablist" aria-label={isAr ? 'تفاصيل الإعلان' : 'Listing details'}>
              <button style={activeTab === 'terms' ? styles.tabActive : styles.tab} onClick={() => setActiveTab('terms')}>{t.terms}</button>
              <button style={activeTab === 'host' ? styles.tabActive : styles.tab} onClick={() => setActiveTab('host')}>{t.host}</button>
              <button style={activeTab === 'location' ? styles.tabActive : styles.tab} onClick={() => setActiveTab('location')}>{t.location}</button>
              <button style={activeTab === 'reviews' ? styles.tabActive : styles.tab} onClick={() => setActiveTab('reviews')}>{t.reviews}</button>
            </div>

            <section style={styles.figmaTrustCard}>
              {/* "Protected" only applies to Stays, the one division that actually transacts through
                  SYBNB — showing it on contact-only divisions would overclaim (matches the gating
                  already applied to the payment-protected card further down). */}
              {listing.division === 'STAYS' && <strong>{t.protectedTitle}</strong>}
              <small>
                {reviewSummary.count > 0
                  ? `${t.rating} ${reviewSummary.average} ★ (${reviewSummary.count})`
                  : t.noReviewsYet}
              </small>
            </section>

            <section style={styles.bookingSteps}>
              <h2>{detailCopy.howToBook}</h2>
              {detailCopy.stepRows.slice(0, 4).map((step, index) => (
                <div key={step} style={styles.bookingStep}>
                  <b>{index + 1}</b>
                  <span>{step}</span>
                </div>
              ))}
              {listing.instantBookEnabled && <p style={styles.instantBookNote}>⚡ {t.instantBookExplain}</p>}
            </section>
          </section>

          {activeTab === 'terms' && (
            <section style={styles.tabPanel}>
              <p style={styles.body}>{listingDescriptionText(listing, lang)}</p>
              {listing.division === 'CARS' && <VehicleSpecs metadata={listing.metadata} lang={lang} />}
              {['BUY', 'RENTALS', 'NEW_CONSTRUCTION'].includes(listing.division) && (
                <PropertySpecs metadata={listing.metadata} lang={lang} division={listing.division} />
              )}
              {!customerReady && <div style={styles.accountHint}>{t.requestOnlyAfterAccount}</div>}
              {listing.division === 'STAYS' && (
                <>
                  <section style={styles.protectionChoice}>
                    <strong>{t.datesTitle}</strong>
                    {showDatePicker ? (
                      <DateRangePicker
                        lang={lang}
                        value={dateRange}
                        onChange={setDateRange}
                        onClose={() => setShowDatePicker(false)}
                        disabledDates={disabledDates}
                        disabledHint={t.datesRequired}
                      />
                    ) : (
                      <div style={styles.dateFieldsRow}>
                        <DateField
                          lang={lang}
                          label={isAr ? 'تاريخ الدخول' : 'Check-in'}
                          value={dateRange.checkIn}
                          onClick={() => setShowDatePicker(true)}
                        />
                        <DateField
                          lang={lang}
                          label={isAr ? 'تاريخ الخروج' : 'Check-out'}
                          value={dateRange.checkOut}
                          onClick={() => setShowDatePicker(true)}
                        />
                      </div>
                    )}
                  </section>

                  <section style={styles.protectionChoice}>
                    <strong>{t.protectionChoice}</strong>
                    <div style={styles.protectionOptions}>
                      <button
                        style={!cancellationProtection ? styles.protectionOptionActive : styles.protectionOption}
                        onClick={() => setCancellationProtection(false)}
                      >
                        <b>{t.standardRate}</b>
                        <span>{t.standardCopy}</span>
                        <em style={styles.cancellationCutoff}>{freeCancellationLabel(dateRange.checkIn, false, lang)}</em>
                        <small>
                          {quoteLoading
                            ? t.quoteLoading
                            : stayQuote
                              ? `${moneyText(feesStandard.totalMinor, listing.currency, lang)} · ${stayQuote.nights} ${isAr ? 'ليالٍ' : 'nights'}`
                              : moneyText(feesStandard.totalMinor, listing.currency, lang)}
                        </small>
                        {!quoteLoading && <small style={styles.feesIncludedNote}>{t.feesIncluded}</small>}
                      </button>
                      <button
                        style={cancellationProtection ? styles.protectionOptionActive : styles.protectionOption}
                        onClick={() => setCancellationProtection(true)}
                      >
                        <b>{t.protectedRate}</b>
                        <span>{t.protectedCopy}</span>
                        <em style={styles.cancellationCutoff}>{freeCancellationLabel(dateRange.checkIn, true, lang)}</em>
                        <small>{t.protectionFee}: {moneyText(protectionFeeMinor, listing.currency, lang)}</small>
                        <small>{t.totalDue}: {moneyText(protectedTotalMinor, listing.currency, lang)}</small>
                        {!quoteLoading && <small style={styles.feesIncludedNote}>{t.feesIncluded}</small>}
                      </button>
                    </div>
                    {!quoteLoading && (feesStandard.cleaningFeeMinor > 0 || feesStandard.taxesMinor > 0) && (
                      <div style={styles.feeBreakdownRow}>
                        <span>{t.stayAmount}: {moneyText(feesStandard.stayAmountMinor, listing.currency, lang)}</span>
                        {feesStandard.cleaningFeeMinor > 0 && (
                          <span>{t.cleaningFee}: {moneyText(feesStandard.cleaningFeeMinor, listing.currency, lang)}</span>
                        )}
                        {feesStandard.taxesMinor > 0 && <span>{t.taxes}: {moneyText(feesStandard.taxesMinor, listing.currency, lang)}</span>}
                      </div>
                    )}
                  </section>
                </>
              )}
            </section>
          )}

          {activeTab === 'location' && (
            <section style={styles.tabPanel}>
              <section style={styles.mapPanel}>
                <div>
                  <strong>{detailCopy.mapTitle}</strong>
                  <span>{detailCopy.mapCopy}</span>
                </div>
                <div style={styles.mapCanvas} aria-label={detailCopy.mapTitle}>
                  <iframe
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    src={googleMapsEmbedUrl(listing, title, lang)}
                    style={styles.mapFrame}
                    title={detailCopy.mapTitle}
                  />
                  <div style={styles.mapLocationCard}>
                    <span style={styles.mapPin}>{detailCopy.mapPin}</span>
                    <strong>{mapTarget?.label}</strong>
                    <small>{mapTarget?.hasCoordinates ? mapTarget.query : t.mapApproximate}</small>
                  </div>
                </div>
                <a href={googleMapsSearchUrl(listing, title, lang)} rel="noreferrer" target="_blank" style={styles.secondaryLinkButton}>
                  {t.openGoogleMaps}
                </a>
                <div style={offlineMapReady ? styles.offlineMapReady : styles.offlineMapCard}>
                  <div>
                    <strong>{offlineMapReady ? t.offlineMapReady : t.mapRequiresInternet}</strong>
                    <span>{t.offlineMapCopy}</span>
                    <small dir="ltr">{mapTarget?.hasCoordinates ? mapTarget.query : mapTarget?.label}</small>
                  </div>
                  <button style={offlineMapReady ? styles.offlineMapSavedButton : styles.offlineMapButton} onClick={saveOfflineMap}>
                    {offlineMapReady ? '✓' : t.saveOfflineMap}
                  </button>
                </div>
              </section>
            </section>
          )}

          {activeTab === 'host' && (
            <section style={styles.trustGrid}>
              <article style={styles.trustCard}>
                <strong>{t.host}</strong>
                <span>{listing.owner?.displayName || listing.ownerId.slice(0, 8).toUpperCase()}</span>
              </article>
              {/* Payment protection only applies to the division that actually transacts (Stays);
                  showing it on contact-only divisions (Rentals/Buy/Cars/Marketplace) would overclaim. */}
              {listing.division === 'STAYS' && (
                <article style={styles.trustCard}>
                  <strong>{t.paymentProtected}</strong>
                  <span>{t.protected}</span>
                </article>
              )}
            </section>
          )}

          {activeTab === 'reviews' && (
            <>
              <section style={styles.grid}>
                <Info
                  label={t.rating}
                  value={reviewSummary.count > 0 ? `${reviewSummary.average} ★ (${t.reviewsCount(reviewSummary.count)})` : t.noReviewsYet}
                />
                {listing.status !== 'APPROVED' && (
                  <Info label={t.status} value={statusText(listing.status, lang)} dir={isAr ? 'rtl' : 'ltr'} />
                )}
                <Info label={t.reference} value={listing.id.slice(0, 8).toUpperCase()} />
              </section>
              {reviewSummary.reviews.length > 0 && (
                <section style={styles.grid}>
                  {reviewSummary.reviews.map((review) => (
                    <article key={review.id} style={styles.info}>
                      <span dir={isAr ? 'rtl' : 'ltr'}>{review.guest?.displayName || (isAr ? 'ضيف' : 'Guest')} · {'★'.repeat(review.rating)}</span>
                      <strong dir={isAr ? 'rtl' : 'ltr'}>{review.comment || ''}</strong>
                    </article>
                  ))}
                </section>
              )}
            </>
          )}

          <section style={styles.grid}>
            <Info label={t.price} value={moneyText(feesStandard.totalMinor, listing.currency, lang)} dir={isAr ? 'rtl' : 'ltr'} />
            <Info label={t.owner} value={listing.owner?.displayName || listing.ownerId.slice(0, 8).toUpperCase()} />
            <Info label={t.division} value={divisionText(listing.division, lang)} dir={isAr ? 'rtl' : 'ltr'} />
            {customerReady ? <Info label={t.accountReady} value="✓" dir={isAr ? 'rtl' : 'ltr'} /> : null}
            {booking ? <Info label={t.requestStatus} value={statusText(booking.status, lang)} dir={isAr ? 'rtl' : 'ltr'} /> : null}
          </section>

          {booking && (
            <section style={styles.panel}>
              <strong>{t.requestStatus}: {statusText(booking.status, lang)}</strong>
              <button style={styles.primaryButton} onClick={() => (window.location.hash = `/booking/${booking.id}`)}>
                {t.payment}
              </button>
            </section>
          )}

          {inquirySent && (
            <section style={styles.panel}>
              <strong>{t.inquirySentTitle}</strong>
              <p style={styles.body}>{t.inquirySentCopy}</p>
              <button style={styles.primaryButton} onClick={() => (window.location.hash = '/immocontact')}>
                {t.openInbox}
              </button>
            </section>
          )}

          <section style={styles.bottomActionBar}>
            {listing.division === 'STAYS' && !booking && (
              <label style={{ ...styles.agreementBox, gridColumn: '1 / -1' }}>
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
                  <strong>{detailCopy.agreementTitle}</strong>
                  <small>{detailCopy.agreementCopy}</small>
                  <em>{t.agreementVersionLabel}</em>
                </span>
              </label>
            )}
            <button style={styles.secondaryButton} onClick={openContactTunnel}>
              {t.bottomContact}
            </button>
            {!inquirySent && (
              <button disabled={status === 'saving'} style={styles.primaryButton} onClick={() => void requestListing()}>
                {status === 'saving' ? t.saving : customerReady ? actionLabel : t.dashboard}
              </button>
            )}
          </section>
        </>
      )}
    </main>
  )
}

function toISODate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function listingImage(listing: PlatformListing) {
  // Prefer the listing's real uploaded photo for every division; generic image is only a fallback.
  const mediaUrl = listing.media?.map((item) => item.url || item.src || item.assetUrl).find((value) => typeof value === 'string')
  if (typeof mediaUrl === 'string') return mediaUrl
  return DIVISION_IMAGES[listing.division] || '/assets/divisions/daily-rental.webp'
}

function Info({ label, value, dir = 'ltr' }: { label: string; value: string; dir?: 'ltr' | 'rtl' }) {
  return (
    <article style={styles.info}>
      <span>{label}</span>
      <strong dir={dir}>{value}</strong>
    </article>
  )
}

function actionForDivision(division: string, lang: Lang) {
  const actions: Record<string, Record<Lang, string>> = {
    STAYS: { ar: 'إرسال طلب الحجز', en: 'Send booking request' },
    RENTALS: { ar: 'طلب تواصل', en: 'Request contact' },
    BUY: { ar: 'طلب زيارة', en: 'Request visit' },
    CARS: { ar: 'تواصل مع البائع', en: 'Contact seller' },
    MARKETPLACE: { ar: 'طلب المنتج', en: 'Request item' },
    NEW_CONSTRUCTION: { ar: 'حجز زيارة', en: 'Book visit' },
  }
  return actions[division]?.[lang] || actions.STAYS[lang]
}

function detailCopyForDivision(division: string, lang: Lang, fallback: typeof copy.ar) {
  const detailCopy: Record<string, Partial<typeof copy.ar>> = {
    STAYS: {},
    RENTALS: {
      mapTitle: lang === 'ar' ? 'موقع العقار' : 'Property location',
      mapCopy: lang === 'ar' ? 'موقع العقار المختار يظهر هنا. افتح خرائط Google لمراجعة المنطقة قبل إرسال الطلب.' : 'The selected property location appears here. Open Google Maps to review the area before sending the request.',
      mapPin: lang === 'ar' ? 'موقع العقار' : 'Property location',
      howToBook: lang === 'ar' ? 'كيف تسير العملية' : 'How it works',
      stepRows: lang === 'ar'
        ? ['راجع تفاصيل العقار', 'سجّل الدخول أو أنشئ حساباً', 'أرسل طلب التواصل', 'تواصل مع المالك داخل SYBNB']
        : ['Review property details', 'Sign in or create account', 'Send contact request', 'Coordinate with the owner inside SYBNB'],
    },
    BUY: {
      mapTitle: lang === 'ar' ? 'موقع العقار' : 'Property location',
      mapCopy: lang === 'ar' ? 'موقع العقار المختار يظهر هنا. راجع المنطقة قبل طلب الزيارة.' : 'The selected property location appears here. Review the area before requesting a visit.',
      mapPin: lang === 'ar' ? 'موقع العقار' : 'Property location',
      howToBook: lang === 'ar' ? 'كيف تسير العملية' : 'How it works',
      stepRows: lang === 'ar'
        ? ['راجع تفاصيل العقار', 'سجّل الدخول أو أنشئ حساباً', 'أرسل طلب الزيارة', 'نسّق موعد الزيارة داخل SYBNB']
        : ['Review property details', 'Sign in or create account', 'Send visit request', 'Coordinate the visit inside SYBNB'],
    },
    CARS: {
      mapTitle: lang === 'ar' ? 'موقع المركبة' : 'Vehicle location',
      mapCopy: lang === 'ar' ? 'موقع المركبة أو المعرض يظهر هنا. افتح خرائط Google قبل التواصل مع البائع.' : 'The vehicle or showroom location appears here. Open Google Maps before contacting the seller.',
      mapPin: lang === 'ar' ? 'موقع المركبة' : 'Vehicle location',
      howToBook: lang === 'ar' ? 'كيف تسير العملية' : 'How it works',
      stepRows: lang === 'ar'
        ? ['راجع تفاصيل المركبة', 'سجّل الدخول أو أنشئ حساباً', 'تواصل مع البائع', 'نسّق الفحص والمعاينة داخل SYBNB']
        : ['Review vehicle details', 'Sign in or create account', 'Contact the seller', 'Coordinate inspection inside SYBNB'],
    },
    MARKETPLACE: {
      mapTitle: lang === 'ar' ? 'موقع العرض' : 'Offer location',
      mapCopy: lang === 'ar' ? 'موقع العرض يظهر هنا. راجع المنطقة قبل إرسال طلب المنتج.' : 'The offer location appears here. Review the area before requesting the item.',
      mapPin: lang === 'ar' ? 'موقع العرض' : 'Offer location',
      howToBook: lang === 'ar' ? 'كيف تسير العملية' : 'How it works',
      stepRows: lang === 'ar'
        ? ['راجع تفاصيل المنتج', 'سجّل الدخول أو أنشئ حساباً', 'أرسل طلب المنتج', 'نسّق الاستلام مع البائع داخل SYBNB']
        : ['Review item details', 'Sign in or create account', 'Send item request', 'Coordinate pickup with the seller inside SYBNB'],
    },
    NEW_CONSTRUCTION: {
      mapTitle: lang === 'ar' ? 'موقع المشروع' : 'Project location',
      mapCopy: lang === 'ar' ? 'موقع المشروع يظهر هنا. افتح خرائط Google قبل حجز الزيارة.' : 'The project location appears here. Open Google Maps before booking a visit.',
      mapPin: lang === 'ar' ? 'موقع المشروع' : 'Project location',
      howToBook: lang === 'ar' ? 'كيف تسير العملية' : 'How it works',
      stepRows: lang === 'ar'
        ? ['راجع تفاصيل المشروع', 'سجّل الدخول أو أنشئ حساباً', 'احجز موعد زيارة', 'نسّق الزيارة داخل SYBNB']
        : ['Review project details', 'Sign in or create account', 'Book a visit', 'Coordinate the visit inside SYBNB'],
    },
  }
  return { ...fallback, ...(detailCopy[division] || {}) }
}

function customerGateKey(listingId: string) {
  return `${CUSTOMER_GATE_KEY}:${listingId}`
}

function bookingDraftKey(listingId: string) {
  return `sybnb-v6-booking-draft:${listingId}`
}

type BookingDraft = {
  dateRange: DateRange
  cancellationProtection: boolean
  acceptedGuestAgreement: boolean
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

function readListingReturnPath() {
  if (typeof window === 'undefined') return '/stays'
  try {
    return sessionStorage.getItem('sybnb-v6-listing-return-path') || '/stays'
  } catch {
    return '/stays'
  }
}

// Renders the vehicle attributes a seller captured (metadata.visualFilters) as a labelled
// spec list, localizing each stored value against the existing car filter option definitions.
// Read-only: it surfaces already-persisted data, it does not add new vehicle schema.
const CAR_SPEC_KEYS = ['carBrand', 'carBody', 'carFuel', 'carTransmission', 'condition'] as const

function VehicleSpecs({ metadata, lang }: { metadata: Record<string, unknown>; lang: Lang }) {
  const groups = useMemo(() => sellerCarFilterGroupsFromConfig(), [])
  const selection = (metadata?.visualFilters as Record<string, unknown> | undefined) || undefined
  if (!selection) return null

  const rows = CAR_SPEC_KEYS.map((key) => {
    const raw = selection[key]
    const value = typeof raw === 'string' ? raw : Array.isArray(raw) ? String(raw[0] || '') : ''
    if (!value || value === 'any') return null
    const group = groups.find((item) => item.id === key)
    const option = group?.options.find((opt) => opt.id === value)
    const label = group ? group.title[lang] : key
    const display = option ? option.label[lang] : value
    return { key, label, display }
  }).filter(Boolean) as Array<{ key: string; label: string; display: string }>

  if (rows.length === 0) return null

  return (
    <section style={styles.specGrid} aria-label={lang === 'ar' ? 'مواصفات المركبة' : 'Vehicle specifications'}>
      <strong>{lang === 'ar' ? 'مواصفات المركبة' : 'Vehicle specifications'}</strong>
      <dl style={styles.specList}>
        {rows.map((row) => (
          <div key={row.key} style={styles.specRow}>
            <dt style={styles.specLabel}>{row.label}</dt>
            <dd style={styles.specValue}>{row.display}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

// Surfaces the property attributes a seller captured (metadata) as a labelled spec list for
// BUY/RENTALS listings. Read-only over already-persisted data; adds no new property schema.
function PropertySpecs({ metadata, lang, division = 'BUY' }: { metadata: Record<string, unknown>; lang: Lang; division?: string }) {
  const isAr = lang === 'ar'
  const md = metadata || {}
  const heading = division === 'NEW_CONSTRUCTION' ? (isAr ? 'تفاصيل المشروع' : 'Project details') : isAr ? 'تفاصيل العقار' : 'Property details'
  const vf = (md.visualFilters as Record<string, unknown> | undefined) || {}
  const typeValue = typeof vf.propertyType === 'string' ? vf.propertyType : typeof md.propertyType === 'string' ? md.propertyType : ''
  const typeOption = propertyFilterGroup.options.find((opt) => opt.id === typeValue)
  const locationLabel = [md.governorateLabel, md.cityLabel, md.areaLabel].filter((part) => typeof part === 'string' && part).join(isAr ? '، ' : ', ')

  const rows = [
    typeValue && typeValue !== 'any' ? { key: 'type', label: isAr ? 'نوع العقار' : 'Property type', display: typeOption ? typeOption.label[lang] : typeValue } : null,
    Number(md.bedrooms) > 0 ? { key: 'beds', label: isAr ? 'غرف النوم' : 'Bedrooms', display: String(md.bedrooms) } : null,
    Number(md.bathrooms) > 0 ? { key: 'baths', label: isAr ? 'الحمامات' : 'Bathrooms', display: String(md.bathrooms) } : null,
    Number(md.sizeSqm) > 0 ? { key: 'size', label: isAr ? 'المساحة (م²)' : 'Size (m²)', display: String(md.sizeSqm) } : null,
    locationLabel ? { key: 'loc', label: isAr ? 'الموقع' : 'Location', display: locationLabel } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; display: string }>

  if (rows.length === 0) return null

  return (
    <section style={styles.specGrid} aria-label={heading}>
      <strong>{heading}</strong>
      <dl style={styles.specList}>
        {rows.map((row) => (
          <div key={row.key} style={styles.specRow}>
            <dt style={styles.specLabel}>{row.label}</dt>
            <dd style={styles.specValue}>{row.display}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  specGrid: { border: '1px solid #e3e8f0', borderRadius: 10, padding: 14, marginTop: 12, display: 'grid', gap: 10 },
  specList: { display: 'grid', gap: 8, margin: 0 },
  specRow: { display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid #f0f3f8', paddingBottom: 6 },
  specLabel: { color: '#5b667a', fontWeight: 700, margin: 0 },
  specValue: { color: '#0f1830', fontWeight: 800, margin: 0 },
  page: { minHeight: '100vh', background: '#0a0a0f', color: '#fff', padding: '24px 16px 112px', display: 'grid', gap: 16, maxWidth: 1080, margin: '0 auto' },
  back: { justifySelf: 'start', minHeight: 42, border: '1px solid #30384d', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  flowNav: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  arrowButton: { width: 54, height: 54, borderRadius: 999, border: '1px solid #30384d', background: '#111827', color: '#fff', fontSize: 34, fontWeight: 900, display: 'grid', placeItems: 'center' },
  detailHero: { border: '1px solid #1e1e2a', borderRadius: 8, background: '#111118', minHeight: 330, overflow: 'hidden', position: 'relative' },
  heroIconButton: { position: 'absolute', top: 18, insetInlineStart: 18, zIndex: 2, width: 52, height: 52, border: 0, borderRadius: 999, background: 'rgba(0,0,0,.42)', color: '#fff', fontSize: 28, fontWeight: 900, display: 'grid', placeItems: 'center', backdropFilter: 'blur(10px)' },
  heroNextButton: { position: 'absolute', top: 18, insetInlineEnd: 18, zIndex: 2, width: 52, height: 52, border: 0, borderRadius: 999, background: 'rgba(0,0,0,.42)', color: '#fff', fontSize: 28, fontWeight: 900, display: 'grid', placeItems: 'center', backdropFilter: 'blur(10px)' },
  media: { minHeight: 330, background: '#0b1120', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 950, textTransform: 'uppercase', position: 'relative', overflow: 'hidden' },
  mediaImage: { width: '100%', height: '100%', minHeight: 330, objectFit: 'cover', display: 'block' },
  thumbStrip: { position: 'absolute', left: 0, right: 0, bottom: 8, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', padding: '0 8px' },
  thumb: { width: 56, height: 42, borderRadius: 8, overflow: 'hidden', border: '2px solid rgba(255,255,255,0.5)', padding: 0, cursor: 'pointer', background: 'transparent' },
  thumbActive: { width: 56, height: 42, borderRadius: 8, overflow: 'hidden', border: '2px solid #6f86ff', padding: 0, cursor: 'pointer', background: 'transparent' },
  thumbImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  mediaBadge: { position: 'absolute', insetInlineStart: 14, bottom: 14, borderRadius: 999, background: 'rgba(8,9,15,.78)', border: '1px solid rgba(255,255,255,.18)', padding: '8px 12px', backdropFilter: 'blur(12px)' },
  instantBookBadge: { position: 'absolute', insetInlineStart: 14, top: 14, borderRadius: 999, background: 'rgba(213,169,21,.9)', color: '#1a1400', fontWeight: 950, border: '1px solid rgba(255,255,255,.25)', padding: '8px 12px', backdropFilter: 'blur(12px)' },
  detailBody: { border: '1px solid #1e1e2a', borderRadius: 8, background: '#111118', padding: 20, display: 'grid', gap: 18 },
  titleBlock: { display: 'grid', gap: 8, justifyItems: 'center', textAlign: 'center' },
  locationLine: { color: '#9aa6ba', fontWeight: 800 },
  tabRow: { display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' },
  tab: { minHeight: 42, border: 0, borderRadius: 999, background: '#20212b', color: '#c8cede', padding: '0 18px', fontWeight: 900 },
  tabActive: { minHeight: 42, border: '1px solid #5268ff', borderRadius: 999, background: '#5268ff', color: '#fff', padding: '0 18px', fontWeight: 950 },
  tabPanel: { display: 'grid', gap: 14 },
  figmaTrustCard: { border: '1px solid #232635', borderRadius: 18, background: '#151620', padding: 18, display: 'grid', gap: 14 },
  trustPills: { display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' },
  bookingSteps: { display: 'grid', gap: 10 },
  bookingStep: { display: 'grid', gridTemplateColumns: '38px minmax(0, 1fr)', alignItems: 'center', gap: 10, color: '#9aa6ba' },
  instantBookNote: { border: '1px solid rgba(213,169,21,.35)', borderRadius: 8, background: 'rgba(213,169,21,.08)', color: '#d5a915', padding: 12, fontWeight: 700 },
  accountHint: { border: '1px solid rgba(82,104,255,.45)', borderRadius: 8, background: 'rgba(82,104,255,.1)', color: '#dfe5ff', padding: 12, fontWeight: 900 },
  heroContent: { padding: 18, display: 'grid', gap: 12, alignContent: 'center' },
  eyebrow: { color: '#d5a915', letterSpacing: 2, fontWeight: 900, fontSize: 11, margin: 0 },
  title: { margin: 0, fontSize: 42, lineHeight: 1.05 },
  body: { color: '#9aa6ba', lineHeight: 1.65, margin: 0 },
  actions: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' },
  primaryButton: { minHeight: 48, border: 0, borderRadius: 8, background: '#20d29b', color: '#06110e', fontWeight: 950, padding: '0 14px' },
  secondaryButton: { minHeight: 44, border: '1px solid #30384d', borderRadius: 8, background: '#171b29', color: '#fff', fontWeight: 900, padding: '0 14px' },
  secondaryLinkButton: { minHeight: 44, border: '1px solid #30384d', borderRadius: 8, background: '#171b29', color: '#fff', fontWeight: 900, padding: '0 14px', display: 'grid', placeItems: 'center', textDecoration: 'none' },
  grid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' },
  trustGrid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' },
  trustCard: { border: '1px solid rgba(32,210,155,.35)', borderRadius: 8, background: 'rgba(32,210,155,.08)', padding: 14, display: 'grid', gap: 8 },
  stepsPanel: { border: '1px solid rgba(213,169,21,.4)', borderRadius: 8, background: 'rgba(213,169,21,.08)', padding: 14, display: 'grid', gap: 12 },
  accountGate: { border: '1px solid rgba(80,105,255,.55)', borderRadius: 8, background: 'rgba(80,105,255,.1)', padding: 16, display: 'grid', gap: 14 },
  secureGateGrid: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' },
  secureInput: { minHeight: 48, border: '1px solid #30384d', borderRadius: 8, background: '#0d1320', color: '#fff', padding: '0 12px', fontWeight: 800 },
  secureError: { color: '#ffabab', fontSize: 13 },
  protectionChoice: { border: '1px solid rgba(213,169,21,.5)', borderRadius: 8, background: 'rgba(213,169,21,.08)', padding: 14, display: 'grid', gap: 12 },
  dateFieldsRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  mapPanel: { border: '1px solid #30384d', borderRadius: 8, background: '#111118', padding: 14, display: 'grid', gap: 12 },
  mapCanvas: { minHeight: 260, border: '1px solid rgba(82,104,255,.4)', borderRadius: 8, background: '#0c1220', display: 'grid', placeItems: 'center', color: '#fff', overflow: 'hidden', position: 'relative' },
  mapFrame: { border: 0, filter: 'saturate(.86) contrast(.9)', height: '100%', inset: 0, minHeight: 260, opacity: .74, position: 'absolute', width: '100%' },
  mapPin: { borderRadius: 999, background: '#5268ff', color: '#fff', padding: '10px 14px', fontWeight: 950, boxShadow: '0 0 0 10px rgba(82,104,255,.16)' },
  mapLocationCard: { borderRadius: 8, background: 'rgba(6,10,18,.88)', border: '1px solid rgba(255,255,255,.16)', padding: 18, display: 'grid', gap: 12, placeItems: 'center', textAlign: 'center', minWidth: 260, maxWidth: '88%', position: 'relative', zIndex: 1 },
  offlineMapCard: { alignItems: 'center', border: '1px solid rgba(229,184,11,.45)', borderRadius: 8, background: 'rgba(229,184,11,.08)', color: '#f7d45f', display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 1fr) auto', padding: 14 },
  offlineMapReady: { alignItems: 'center', border: '1px solid rgba(32,210,155,.5)', borderRadius: 8, background: 'rgba(32,210,155,.1)', color: '#9fffe1', display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 1fr) auto', padding: 14 },
  offlineMapButton: { minHeight: 44, border: '1px solid rgba(229,184,11,.7)', borderRadius: 8, background: '#171b29', color: '#f7d45f', fontWeight: 950, padding: '0 14px' },
  offlineMapSavedButton: { minHeight: 44, border: 0, borderRadius: 8, background: '#20d29b', color: '#06110e', fontWeight: 950, padding: '0 18px' },
  protectionOptions: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' },
  protectionOption: { minHeight: 118, border: '1px solid #30384d', borderRadius: 8, background: '#0d1320', color: '#fff', padding: 14, textAlign: 'start', display: 'grid', gap: 8 },
  protectionOptionActive: { minHeight: 118, border: '1px solid #20d29b', borderRadius: 8, background: 'rgba(32,210,155,.12)', color: '#fff', padding: 14, textAlign: 'start', display: 'grid', gap: 8 },
  cancellationCutoff: { color: '#20d29b', fontStyle: 'normal', fontWeight: 800, fontSize: 13 },
  feesIncludedNote: { color: '#82899b', fontWeight: 700, fontSize: 12 },
  feeBreakdownRow: { display: 'flex', flexWrap: 'wrap', gap: '4px 16px', color: '#a5adc2', fontSize: 12, fontWeight: 700, padding: '2px 2px 0' },
  agreementBox: { border: '1px solid rgba(229,184,11,.58)', borderRadius: 8, background: 'rgba(229,184,11,.08)', color: '#f7d45f', padding: 14, display: 'grid', gap: 12, gridTemplateColumns: '34px minmax(0, 1fr)', alignItems: 'start', lineHeight: 1.5 },
  agreementInput: { width: 28, height: 28, accentColor: '#20d29b', margin: 0 },
  info: { border: '1px solid #30384d', borderRadius: 8, background: '#111118', padding: 14, display: 'grid', gap: 6, color: '#9aa6ba' },
  panel: { border: '1px solid #30384d', borderRadius: 8, background: '#111118', color: '#fff', padding: 14, display: 'grid', gap: 12 },
  recoverPrimary: { minHeight: 46, border: 0, borderRadius: 8, background: '#20d29b', color: '#06110e', fontWeight: 900, padding: '0 18px', cursor: 'pointer' },
  recoverSecondary: { minHeight: 46, border: '1px solid #30384d', borderRadius: 8, background: 'transparent', color: '#fff', fontWeight: 800, padding: '0 18px', cursor: 'pointer' },
  alert: { border: '1px solid rgba(255,96,96,.45)', borderRadius: 8, background: 'rgba(255,96,96,.1)', color: '#ffd1d1', padding: 14 },
  bottomActionBar: { position: 'sticky', bottom: 12, zIndex: 20, border: '1px solid #242a3b', borderRadius: 8, background: 'rgba(13,15,24,.94)', boxShadow: '0 -16px 40px rgba(0,0,0,.35)', backdropFilter: 'blur(16px)', padding: 12, display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' },
}
