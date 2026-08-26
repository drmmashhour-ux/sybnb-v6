import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { srRideFilterGroupsFromConfig, type VisualFilterSelection } from '../../engines/filters'
import type { Lang } from '../../engines/language/languageEngine'
import {
  cancelPrototypeSrRide,
  createPrototypeSrRide,
  createSavedPlace,
  deleteSavedPlace,
  fetchPrototypeSrRide,
  fetchPrototypeSrRideThread,
  fetchSavedPlaces,
  fetchSrQuote,
  resolveApiUrl,
  sendPrototypeSrRideMessage,
  sharePrototypeSrRide,
  submitPrototypeLocalWalletProof,
  submitPrototypeSrRideReview,
  type PlatformMessage,
  type PlatformRideRequest,
  type PlatformSavedPlace,
  type PlatformSrQuote,
} from '../../shared/api/platformApi'

const ACTIVE_RIDE_STATUSES = ['DRAFT', 'REQUESTED', 'MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS']
const RIDER_CANCELLABLE_STATUSES = ['DRAFT', 'REQUESTED', 'MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING']
// Matches MESSAGING_ELIGIBLE_RIDE_STATUSES in server/routes/messages.mjs.
const MESSAGING_ELIGIBLE_RIDE_STATUSES = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS', 'COMPLETED']
// Matches LIVE_TRACKING_STATUSES in server/routes/sr-rides.mjs.
const LIVE_TRACKING_STATUSES = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS']
import { moneyText, statusText } from '../../shared/i18n/display'
import { selectedFilterLabels, VisualFilterPanel } from '../../shared/filters/VisualFilterPanel'
import { RideMap } from '../../shared/maps/RideMap'

type Props = {
  lang: Lang
}

const copy = {
  ar: {
    back: 'العودة للرئيسية',
    title: 'سير',
    subtitle: 'طلب رحلة حقيقي محفوظ في قاعدة البيانات، يُعرض مباشرة على السائقين القريبين ليقبلوه بأنفسهم.',
    mode: 'وضع بيانات منخفض',
    pickup: 'نقطة الانطلاق',
    dropoff: 'الوجهة',
    category: 'الفئة',
    fare: 'الأجرة التقديرية',
    distance: 'المسافة التقديرية',
    distanceApprox: '(تقريبية بحسب العنوان)',
    addressUnrecognized: 'تعذّر التعرف على العنوان المدخل. السعر والمسافة تقدير افتراضي وليسا مبنيين على عنوانك الفعلي — تحقق من كتابة اسم الحي بشكل صحيح.',
    request: 'طلب الرحلة',
    refresh: 'تحديث الحالة',
    status: 'حالة الرحلة',
    rideId: 'رقم الرحلة',
    driver: 'السائق',
    location: 'الموقع',
    accuracy: 'دقة الموقع',
    saved: 'تم حفظ الرحلة',
    error: 'تعذر تنفيذ طلب SR',
    saving: 'جار الحفظ',
    gps: 'استخدام موقعي الحالي',
    manualHint: 'يمكن متابعة الطلب حتى بدون GPS عبر العناوين اليدوية.',
    driverNotAssigned: 'لم يُعيّن سائق بعد',
    verifiedDriver: 'هوية موثقة',
    waitingForDriver: 'بانتظار قبول أحد السائقين القريبين للرحلة...',
    driverAssigned: 'تم تعيين سائق لرحلتك.',
    driverArriving: 'السائق في طريقه إليك الآن.',
    inProgress: 'الرحلة جارية الآن.',
    completed: 'اكتملت الرحلة. شكراً لاستخدامك سير.',
    receiptFare: 'المبلغ المدفوع',
    receiptDistance: 'المسافة',
    payTitle: 'تأكيد الدفع',
    payCopy: 'ادفع الأجرة للسائق مباشرة (نقداً أو تحويل)، ثم أدخل رقم مرجع العملية هنا ليتحقق منها فريق SYBNB.',
    payReferencePlaceholder: 'رقم مرجع العملية',
    paySubmit: 'إرسال إثبات الدفع',
    paySubmitting: 'جار الإرسال...',
    paymentPending: 'تم إرسال إثبات الدفع، بانتظار المراجعة.',
    paymentConfirmed: 'تم تأكيد الدفع.',
    paymentRejected: 'تعذر قبول إثبات الدفع السابق. يرجى إرسال رقم مرجع صحيح.',
    cancellationFeeLabel: 'رسوم الإلغاء',
    payFeeTitle: 'تأكيد دفع رسوم الإلغاء',
    payFeeCopy: 'كان السائق قد بدأ التوجه إليك بالفعل. ادفع رسوم الإلغاء له مباشرة (نقداً أو تحويل)، ثم أدخل رقم مرجع العملية هنا ليتحقق منها فريق SYBNB.',
    cancellationFeeWarning: 'قد يترتب على الإلغاء الآن رسوم إلغاء تقريبية قدرها {amount} لأن السائق بدأ التوجه إليك بالفعل.',
    chatTitle: 'راسل السائق',
    chatEmpty: 'لا توجد رسائل بعد.',
    chatPlaceholder: 'اكتب رسالة...',
    chatSend: 'إرسال',
    shareTrip: 'شارك رحلتي',
    sharing: 'جار المشاركة...',
    shareCopied: '✓ تم نسخ رابط المشاركة',
    shareTitle: 'رحلتي مع سير',
    shareText: 'تابع رحلتي مباشرة عبر هذا الرابط.',
    scheduleForLater: 'جدولة الرحلة لوقت لاحق',
    scheduleRide: 'جدولة الرحلة',
    scheduledFor: 'مجدولة في',
    accessibilityRequired: 'أحتاج مركبة تسمح بالوصول لذوي الاحتياجات الخاصة',
    savePlaceLabelPlaceholder: 'اسم المكان (مثال: المنزل)',
    savePlaceButton: 'حفظ عنوان الانطلاق',
    stop: 'محطة',
    addStop: '+ إضافة محطة',
    removeStop: 'إزالة',
    rateTitle: 'قيّم رحلتك',
    rateSubmit: 'إرسال التقييم',
    rateSubmitting: 'جار الإرسال',
    rateCommentPlaceholder: 'ملاحظة اختيارية عن الرحلة (غير إلزامية)',
    rateThanks: 'شكراً لتقييمك',
    yourRating: 'تقييمك',
    cancelled: 'تم إلغاء الرحلة.',
    cancel: 'إلغاء الرحلة',
    cancelling: 'جار الإلغاء',
    newRide: 'طلب رحلة جديدة',
    sos: 'طوارئ SOS',
  },
  en: {
    back: 'Back to landing',
    title: 'SR Ride',
    subtitle: 'Real ride request saved in PostgreSQL, broadcast live to nearby drivers to self-accept.',
    mode: 'Low-data mode',
    pickup: 'Pickup',
    dropoff: 'Dropoff',
    category: 'Category',
    fare: 'Estimated fare',
    distance: 'Estimated distance',
    distanceApprox: '(approximate, from address text)',
    addressUnrecognized: "We couldn't recognize this address. The price and distance are a rough default, not based on your actual location — check that the neighborhood name is spelled correctly.",
    request: 'Request ride',
    refresh: 'Refresh status',
    status: 'Ride status',
    rideId: 'Ride ID',
    driver: 'Driver',
    location: 'Location',
    accuracy: 'Accuracy',
    saved: 'Ride saved',
    error: 'Could not complete SR request',
    saving: 'Saving',
    gps: 'Use my current location',
    manualHint: 'The request can continue without GPS through manual addresses.',
    driverNotAssigned: 'Not assigned yet',
    verifiedDriver: 'Verified identity',
    waitingForDriver: 'Waiting for a nearby driver to accept the ride...',
    driverAssigned: 'A driver has been assigned to your ride.',
    driverArriving: 'Your driver is on the way to you.',
    inProgress: 'Your ride is now in progress.',
    completed: 'Ride completed. Thanks for riding with SR.',
    receiptFare: 'Amount charged',
    receiptDistance: 'Distance',
    payTitle: 'Confirm payment',
    payCopy: "Pay the fare directly to the driver (cash or transfer), then enter the transaction reference here so SYBNB can verify it.",
    payReferencePlaceholder: 'Transaction reference',
    paySubmit: 'Submit payment proof',
    paySubmitting: 'Submitting...',
    paymentPending: 'Payment proof submitted, awaiting review.',
    paymentConfirmed: 'Payment confirmed.',
    paymentRejected: 'The previous payment proof could not be accepted. Please submit a valid reference.',
    cancellationFeeLabel: 'Cancellation fee',
    payFeeTitle: 'Confirm cancellation fee payment',
    payFeeCopy: 'Your driver had already started heading your way. Pay the cancellation fee directly to them (cash or transfer), then enter the transaction reference here so SYBNB can verify it.',
    cancellationFeeWarning: 'Cancelling now may incur an estimated cancellation fee of {amount} because your driver has already started heading your way.',
    chatTitle: 'Message your driver',
    chatEmpty: 'No messages yet.',
    chatPlaceholder: 'Type a message...',
    chatSend: 'Send',
    shareTrip: 'Share my trip',
    sharing: 'Sharing...',
    shareCopied: '✓ Share link copied',
    shareTitle: 'My SR ride',
    shareText: 'Follow my ride live via this link.',
    scheduleForLater: 'Schedule for later',
    scheduleRide: 'Schedule ride',
    scheduledFor: 'Scheduled for',
    accessibilityRequired: 'I need a wheelchair-accessible vehicle',
    savePlaceLabelPlaceholder: 'Place name (e.g. Home)',
    savePlaceButton: 'Save pickup address',
    stop: 'Stop',
    addStop: '+ Add stop',
    removeStop: 'Remove',
    rateTitle: 'Rate your ride',
    rateSubmit: 'Submit rating',
    rateSubmitting: 'Submitting',
    rateCommentPlaceholder: 'Optional note about the ride',
    rateThanks: 'Thanks for your rating',
    yourRating: 'Your rating',
    cancelled: 'This ride was cancelled.',
    cancel: 'Cancel ride',
    cancelling: 'Cancelling',
    newRide: 'Request a new ride',
    sos: 'SOS emergency',
  },
}

const categories = ['SR Economy', 'SR Comfort', 'SR SUV']

const rideCategoryByFilter: Record<string, string> = {
  economy: 'SR Economy',
  comfort: 'SR Comfort',
  premium: 'SR Comfort',
  familyVan: 'SR SUV',
}

export function SrRidePage({ lang }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const [pickup, setPickup] = useState(isAr ? 'دمشق، المالكي' : 'Damascus, Malki')
  const [dropoff, setDropoff] = useState(isAr ? 'دمشق، المزة' : 'Damascus, Mezzeh')
  const [category, setCategory] = useState(categories[0])
  const [lowDataMode, setLowDataMode] = useState(true)
  const [accuracyMeters, setAccuracyMeters] = useState<number | undefined>()
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lng: number } | undefined>()
  const [ride, setRide] = useState<PlatformRideRequest | null>(null)
  const [driverPhotoUrl, setDriverPhotoUrl] = useState<string | null>(null)
  const [quote, setQuote] = useState<PlatformSrQuote | null>(null)
  const [rideFilters, setRideFilters] = useState<VisualFilterSelection>({
    srRideCategory: 'economy',
    srRideRoute: 'cityRide',
    srRideFeatures: ['instantConfirm', 'ac'],
  })
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [reviewRating, setReviewRating] = useState(0)
  const [reviewComment, setReviewComment] = useState('')
  const [reviewStatus, setReviewStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [payProviderRef, setPayProviderRef] = useState('')
  const [payStatus, setPayStatus] = useState<'idle' | 'saving' | 'submitted' | 'error'>('idle')
  const [chatMessages, setChatMessages] = useState<PlatformMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatStatus, setChatStatus] = useState<'idle' | 'sending' | 'error'>('idle')
  const [shareStatus, setShareStatus] = useState<'idle' | 'sharing' | 'copied' | 'error'>('idle')
  const [scheduleForLater, setScheduleForLater] = useState(false)
  const [scheduledFor, setScheduledFor] = useState('')
  const [accessibilityRequired, setAccessibilityRequired] = useState(false)
  const [stops, setStops] = useState<string[]>([])
  const [savedPlaces, setSavedPlaces] = useState<PlatformSavedPlace[]>([])
  const [newPlaceLabel, setNewPlaceLabel] = useState('')
  const [savingPlace, setSavingPlace] = useState(false)
  const rideFilterGroups = useMemo(() => srRideFilterGroupsFromConfig(), [])

  const fallbackFareMinor = useMemo(() => {
    const base = category === 'SR SUV' ? 58000 : category === 'SR Comfort' ? 46000 : 35000
    return lowDataMode ? base : base + 2500
  }, [category, lowDataMode])

  const fareMinor = ride?.fareMinor ?? quote?.fareMinor ?? fallbackFareMinor
  // CAPSULE_RULES.noFakeTrustSignal: quote.estimated alone doesn't distinguish "GPS was imprecise
  // but we still recognized the neighborhood" from "we recognized nothing at all". Both pickup AND
  // dropoff coords coming back null (the gazetteer geocoder found no match for either) means the
  // whole distance/price is a blind default, not a real estimate.
  const addressUnrecognized = Boolean(quote?.estimated) && !quote?.pickupCoords && !quote?.dropoffCoords

  useEffect(() => {
    if (ride) return
    const timer = window.setTimeout(() => {
      fetchSrQuote({ pickup, dropoff, category, lowDataMode, pickupCoords }).then(setQuote).catch(() => setQuote(null))
    }, 400)
    return () => window.clearTimeout(timer)
  }, [pickup, dropoff, category, lowDataMode, pickupCoords, ride])

  useEffect(() => {
    fetchSavedPlaces().then(setSavedPlaces).catch(() => setSavedPlaces([]))
  }, [])

  async function saveCurrentPickupAsPlace() {
    if (!newPlaceLabel.trim() || !pickup.trim()) return
    setSavingPlace(true)
    try {
      const place = await createSavedPlace({
        label: newPlaceLabel.trim(),
        address: pickup,
        lat: pickupCoords?.lat,
        lng: pickupCoords?.lng,
      })
      setSavedPlaces((previous) => [...previous, place])
      setNewPlaceLabel('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setSavingPlace(false)
    }
  }

  async function removeSavedPlace(placeId: string) {
    try {
      await deleteSavedPlace(placeId)
      setSavedPlaces((previous) => previous.filter((place) => place.id !== placeId))
    } catch {
      // Non-critical -- the place simply stays in the list; the next load will reconcile it.
    }
  }

  useEffect(() => {
    // Keep tracking through the whole live lifecycle (assigned → arriving → in progress),
    // not just while waiting for a driver, so the rider follows the trip end to end.
    if (!ride || !ACTIVE_RIDE_STATUSES.includes(ride.status)) return
    const interval = window.setInterval(() => {
      fetchPrototypeSrRide(ride.id).then(setRide).catch(() => {})
    }, 4000)
    return () => window.clearInterval(interval)
  }, [ride])

  useEffect(() => {
    if (!ride || !MESSAGING_ELIGIBLE_RIDE_STATUSES.includes(ride.status)) return
    let cancelled = false
    function poll() {
      if (!ride) return
      fetchPrototypeSrRideThread(ride.id)
        .then((thread) => {
          if (!cancelled) setChatMessages(thread.messages)
        })
        .catch(() => {})
    }
    poll()
    const interval = window.setInterval(poll, 5000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [ride?.id, ride?.status])

  async function sendChatMessage() {
    if (!ride || !chatInput.trim()) return
    setChatStatus('sending')
    try {
      const sent = await sendPrototypeSrRideMessage(ride.id, chatInput.trim())
      setChatMessages((previous) => [...previous, sent])
      setChatInput('')
      setChatStatus('idle')
    } catch (error) {
      setChatStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  async function shareTrip() {
    if (!ride) return
    setShareStatus('sharing')
    try {
      const { rideId, exp, sig } = await sharePrototypeSrRide(ride.id)
      const shareUrl = `${window.location.origin}${window.location.pathname}#/ride/shared/${rideId}?exp=${exp}&sig=${sig}`
      if (navigator.share) {
        await navigator.share({ title: t.shareTitle, text: t.shareText, url: shareUrl })
        setShareStatus('idle')
      } else {
        await navigator.clipboard.writeText(shareUrl)
        setShareStatus('copied')
      }
    } catch (error) {
      // The user closing the native share sheet without picking anything throws AbortError -- not
      // a real failure, so it shouldn't surface as one.
      if (error instanceof Error && error.name === 'AbortError') {
        setShareStatus('idle')
        return
      }
      setShareStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  // signDriverPhotoUrl() mints a fresh signature+expiry on every fetch (server/lib/storage.mjs), so
  // naively rendering ride.driver.driverProfile.photoUrl directly would give <img> a new src on
  // every 4s poll -- interrupting the in-flight image load before it ever finishes decoding. Only
  // re-resolve when the driver actually changes, not on every poll of the same driver.
  useEffect(() => {
    const photoUrl = ride?.driver?.driverProfile?.photoUrl
    setDriverPhotoUrl(photoUrl ? resolveApiUrl(photoUrl) : null)
  }, [ride?.driverId])

  async function useCurrentLocation() {
    setMessage('')
    if (!navigator.geolocation) {
      setAccuracyMeters(undefined)
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setAccuracyMeters(Math.round(position.coords.accuracy))
        setPickupCoords({ lat: position.coords.latitude, lng: position.coords.longitude })
        setPickup(isAr ? 'موقعي الحالي' : 'Current location')
      },
      () => {
        setAccuracyMeters(undefined)
        setPickupCoords(undefined)
        setMessage(t.manualHint)
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 },
    )
  }

  async function requestRide() {
    setStatus('saving')
    setMessage('')

    try {
      const nextRide = await createPrototypeSrRide({
        pickup,
        dropoff,
        category,
        currency: 'SYP',
        lowDataMode,
        accuracyMeters,
        pickupCoords,
        routeType: String(rideFilters.srRideRoute || ''),
        features: Array.isArray(rideFilters.srRideFeatures) ? rideFilters.srRideFeatures : [],
        scheduledFor: scheduleForLater && scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
        accessibilityRequired,
        stops: stops.map((stop) => stop.trim()).filter(Boolean),
      })
      setRide(nextRide)
      setStatus('idle')
      setMessage(t.saved)
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  function updateRideFilters(next: VisualFilterSelection) {
    setRideFilters(next)
    const nextCategory = String(next.srRideCategory || 'economy')
    setCategory(rideCategoryByFilter[nextCategory] || 'SR Economy')
  }

  async function refreshRide() {
    if (!ride) return
    setStatus('saving')
    setMessage('')

    try {
      setRide(await fetchPrototypeSrRide(ride.id))
      setStatus('idle')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  async function cancelRide() {
    if (!ride) return
    setStatus('saving')
    setMessage('')

    try {
      setRide(await cancelPrototypeSrRide(ride.id))
      setStatus('idle')
      setMessage(t.cancelled)
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  async function submitReview() {
    if (!ride || reviewRating < 1) return
    setReviewStatus('saving')
    try {
      await submitPrototypeSrRideReview({ rideId: ride.id, rating: reviewRating, comment: reviewComment.trim() || undefined })
      setRide(await fetchPrototypeSrRide(ride.id))
      setReviewStatus('idle')
    } catch (error) {
      setReviewStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  async function submitPayment() {
    if (!ride || !payProviderRef.trim()) return
    setPayStatus('saving')
    try {
      // amountMinor/currency are sent for display continuity only -- the server derives the real
      // charge from the ride's own locked fareMinor (or, for a cancelled ride, its
      // cancellationFeeMinor), never trusts this value (see server/routes/payments.mjs's
      // local-wallet-proof handler).
      const amountMinor = ride.status === 'CANCELLED' ? ride.cancellationFeeMinor || 0 : ride.fareMinor || 0
      await submitPrototypeLocalWalletProof({
        rideId: ride.id,
        amountMinor,
        currency: ride.currency,
        providerRef: payProviderRef.trim(),
      })
      setRide(await fetchPrototypeSrRide(ride.id))
      setPayStatus('submitted')
    } catch (error) {
      setPayStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  function renderPaymentSection(title: string, copy: string) {
    const latestProof = ride?.paymentProofs?.[0]
    if (latestProof?.status === 'APPROVED') {
      return <div style={styles.message}>✓ {t.paymentConfirmed}</div>
    }
    if (latestProof?.status === 'PENDING_ADMIN_REVIEW') {
      return <div style={styles.message}>{t.paymentPending}</div>
    }
    // A REJECTED proof falls through to the form below so the rider can resubmit.
    return (
      <div style={styles.card}>
        <strong>{title}</strong>
        <span>{copy}</span>
        {latestProof?.status === 'REJECTED' && <p style={styles.addressWarning}>{t.paymentRejected}</p>}
        <input
          style={styles.payInput}
          value={payProviderRef}
          onChange={(event) => setPayProviderRef(event.target.value)}
          placeholder={t.payReferencePlaceholder}
        />
        <button disabled={!payProviderRef.trim() || payStatus === 'saving'} style={styles.primaryButton} onClick={() => void submitPayment()}>
          {payStatus === 'saving' ? t.paySubmitting : t.paySubmit}
        </button>
      </div>
    )
  }

  function startNewRide() {
    setRide(null)
    setQuote(null)
    setStatus('idle')
    setMessage('')
  }

  const canCancel = Boolean(ride && RIDER_CANCELLABLE_STATUSES.includes(ride.status))
  const isTerminal = Boolean(ride && ['COMPLETED', 'CANCELLED'].includes(ride.status))
  // Client-side estimate only, purely so the rider isn't surprised before an irreversible action --
  // the real fee (if any) is computed and stored server-side at the moment of cancellation. Keep
  // this rate in sync with RIDE_CANCELLATION_FEE_PERCENT in server/routes/sr-rides.mjs.
  const driverAlreadyCommitted = Boolean(ride && ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING'].includes(ride.status))
  const estimatedCancellationFeeMinor = driverAlreadyCommitted && ride?.fareMinor ? Math.round((ride.fareMinor * 20) / 100) : 0

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <button style={styles.back} onClick={() => (window.location.hash = '/')}>
        {t.back}
      </button>

      <section style={styles.hero}>
        <p style={styles.eyebrow}>SR / SYBNB</p>
        <h1 style={styles.title}>{t.title}</h1>
        <p style={styles.body}>{t.subtitle}</p>
      </section>

      <section style={styles.grid}>
        <article style={styles.card}>
          <div style={styles.mapPreview}>
            <span style={styles.dot} />
            <strong>{t.location}</strong>
            <p>{t.manualHint}</p>
          </div>

          <button style={styles.secondaryButton} onClick={() => void useCurrentLocation()}>
            {t.gps}
          </button>

          {!ride && savedPlaces.length > 0 && (
            <div style={styles.savedPlacesRow}>
              {savedPlaces.map((place) => (
                <span key={place.id} style={styles.savedPlaceChip}>
                  <button type="button" style={styles.chipButton} onClick={() => setPickup(place.address)}>
                    {place.label}
                  </button>
                  <button type="button" style={styles.chipButton} onClick={() => setDropoff(place.address)}>
                    → {t.dropoff}
                  </button>
                  <button type="button" style={styles.chipButton} onClick={() => void removeSavedPlace(place.id)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <label style={styles.label}>
            {t.pickup}
            <input style={styles.input} value={pickup} onChange={(event) => setPickup(event.target.value)} />
          </label>

          {!ride && (
            <div style={styles.savePlaceRow}>
              <input
                style={styles.payInput}
                value={newPlaceLabel}
                onChange={(event) => setNewPlaceLabel(event.target.value)}
                placeholder={t.savePlaceLabelPlaceholder}
              />
              <button
                type="button"
                disabled={!newPlaceLabel.trim() || !pickup.trim() || savingPlace}
                style={styles.secondaryButton}
                onClick={() => void saveCurrentPickupAsPlace()}
              >
                {t.savePlaceButton}
              </button>
            </div>
          )}

          {!ride &&
            stops.map((stop, index) => (
              <label key={index} style={styles.label}>
                {t.stop} {index + 1}
                <div style={styles.savePlaceRow}>
                  <input
                    style={styles.input}
                    value={stop}
                    onChange={(event) =>
                      setStops((previous) => previous.map((value, valueIndex) => (valueIndex === index ? event.target.value : value)))
                    }
                  />
                  <button
                    type="button"
                    style={styles.secondaryButton}
                    onClick={() => setStops((previous) => previous.filter((_, valueIndex) => valueIndex !== index))}
                  >
                    {t.removeStop}
                  </button>
                </div>
              </label>
            ))}

          {!ride && stops.length < 3 && (
            <button type="button" style={styles.secondaryButton} onClick={() => setStops((previous) => [...previous, ''])}>
              {t.addStop}
            </button>
          )}

          <label style={styles.label}>
            {t.dropoff}
            <input style={styles.input} value={dropoff} onChange={(event) => setDropoff(event.target.value)} />
          </label>

          <section style={styles.categoryCapsule}>
            <span style={styles.categoryTitle}>{t.category}</span>
            <div style={styles.categoryStrip}>
              {categories.map((item) => (
                <button
                  key={item}
                  style={item === category ? styles.categoryActive : styles.categoryButton}
                  onClick={() => setCategory(item)}
                  type="button"
                >
                  {item}
                </button>
              ))}
            </div>
          </section>

          <section style={styles.touchFilters}>
            <div style={styles.filtersHead}>
              <strong>{t.category}</strong>
              <span>{selectedFilterLabels(rideFilterGroups, rideFilters, lang).length}</span>
            </div>
            <VisualFilterPanel
              compact
              groups={rideFilterGroups}
              lang={lang}
              selection={rideFilters}
              onChange={updateRideFilters}
            />
          </section>

          <label style={styles.toggle}>
            <input checked={lowDataMode} type="checkbox" onChange={(event) => setLowDataMode(event.target.checked)} />
            <span>{t.mode}</span>
          </label>

          <div style={styles.stat}>
            <span>{t.distance}</span>
            <strong dir="ltr">
              {quote ? `${quote.distanceKm} km` : '-'} {quote?.estimated ? t.distanceApprox : ''}
            </strong>
          </div>

          <div style={styles.stat}>
            <span>{t.fare}</span>
            <strong dir={isAr ? 'rtl' : 'ltr'}>{moneyText(fareMinor, 'SYP', lang)}</strong>
          </div>

          {!ride && addressUnrecognized && <div style={styles.addressWarning}>⚠ {t.addressUnrecognized}</div>}

          {!ride && (
            <label style={styles.scheduleRow}>
              <input
                type="checkbox"
                checked={accessibilityRequired}
                onChange={(event) => setAccessibilityRequired(event.target.checked)}
              />
              {t.accessibilityRequired}
            </label>
          )}

          {!ride && (
            <label style={styles.scheduleRow}>
              <input type="checkbox" checked={scheduleForLater} onChange={(event) => setScheduleForLater(event.target.checked)} />
              {t.scheduleForLater}
            </label>
          )}
          {!ride && scheduleForLater && (
            <input
              type="datetime-local"
              style={styles.payInput}
              value={scheduledFor}
              min={new Date(Date.now() + 30 * 60 * 1000).toISOString().slice(0, 16)}
              onChange={(event) => setScheduledFor(event.target.value)}
            />
          )}

          <button
            disabled={status === 'saving' || (scheduleForLater && !scheduledFor)}
            style={styles.primaryButton}
            onClick={() => void requestRide()}
          >
            {status === 'saving' ? t.saving : scheduleForLater ? t.scheduleRide : t.request}
          </button>
        </article>

        <article style={styles.card}>
          <h2 style={styles.cardTitle}>{t.status}</h2>
          <Info label={t.rideId} value={ride ? ride.id.slice(0, 8).toUpperCase() : '-'} />
          <Info label={t.status} value={statusText(ride?.status, lang)} dir={isAr ? 'rtl' : 'ltr'} />
          {ride && (ride.pickupCoords || ride.dropoffCoords || ride.driver?.location) && (
            <RideMap
              pickup={ride.pickupCoords}
              dropoff={ride.dropoffCoords}
              stops={ride.stops.filter((stop) => stop.lat != null && stop.lng != null).map((stop) => ({ lat: stop.lat as number, lng: stop.lng as number }))}
              driverLocation={ride.driver?.location}
            />
          )}
          {driverPhotoUrl && <img src={driverPhotoUrl} alt="" style={styles.driverPhoto} />}
          {ride?.driver?.isVerified && <span style={styles.verifiedBadge}>✓ {t.verifiedDriver}</span>}
          <Info label={t.driver} value={driverIdentityLabel(ride, t)} />
          <Info label={t.pickup} value={String(ride?.metadata.pickup || pickup)} />
          {ride?.stops.map((stop, index) => (
            <Info key={index} label={`${t.stop} ${index + 1}`} value={stop.address} />
          ))}
          <Info label={t.dropoff} value={String(ride?.metadata.dropoff || dropoff)} />
          <Info label={t.accuracy} value={accuracyMeters ? `${accuracyMeters}m` : isAr ? 'يدوي' : 'manual'} />
          {ride?.accessibilityRequired && <div style={styles.message}>♿ {t.accessibilityRequired}</div>}

          {ride && MESSAGING_ELIGIBLE_RIDE_STATUSES.includes(ride.status) && (
            <div style={styles.card}>
              <strong>{t.chatTitle}</strong>
              <div style={styles.chatMessages}>
                {chatMessages.length === 0 && <span style={styles.chatEmpty}>{t.chatEmpty}</span>}
                {chatMessages.map((entry) => (
                  <div
                    key={entry.id}
                    style={entry.senderRole === 'RIDER' ? styles.chatBubbleMine : styles.chatBubbleTheirs}
                  >
                    {entry.body}
                  </div>
                ))}
              </div>
              <div style={styles.chatInputRow}>
                <input
                  style={styles.chatInput}
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  placeholder={t.chatPlaceholder}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void sendChatMessage()
                  }}
                />
                <button disabled={!chatInput.trim() || chatStatus === 'sending'} style={styles.secondaryButton} onClick={() => void sendChatMessage()}>
                  {t.chatSend}
                </button>
              </div>
            </div>
          )}

          {ride?.status === 'DRAFT' && ride.scheduledFor && (
            <div style={styles.message}>
              {t.scheduledFor} {new Date(ride.scheduledFor).toLocaleString(isAr ? 'ar-SY' : 'en-US')}
            </div>
          )}
          {ride && ['REQUESTED', 'MATCHING'].includes(ride.status) && (
            <div style={styles.message}>{t.waitingForDriver}</div>
          )}
          {ride?.status === 'DRIVER_ASSIGNED' && (
            <div style={styles.message}>{t.driverAssigned}</div>
          )}
          {ride?.status === 'DRIVER_ARRIVING' && (
            <div style={styles.message}>{t.driverArriving}</div>
          )}
          {ride?.status === 'IN_PROGRESS' && (
            <div style={styles.message}>{t.inProgress}</div>
          )}
          {ride?.status === 'COMPLETED' && (
            <>
              <div style={styles.message}>{t.completed}</div>
              <div style={styles.stat}>
                <span>{t.receiptFare}</span>
                <strong dir={isAr ? 'rtl' : 'ltr'}>{moneyText(ride.fareMinor ?? 0, ride.currency, lang)}</strong>
              </div>
              {typeof ride.metadata.distanceKm === 'number' && (
                <div style={styles.stat}>
                  <span>{t.receiptDistance}</span>
                  <strong dir="ltr">{ride.metadata.distanceKm} km</strong>
                </div>
              )}
              {renderPaymentSection(t.payTitle, t.payCopy)}
              {ride.review ? (
                <div style={styles.message}>
                  {t.yourRating}: {'★'.repeat(ride.review.rating)}
                  {'☆'.repeat(5 - ride.review.rating)}
                </div>
              ) : (
                <div style={styles.card}>
                  <strong>{t.rateTitle}</strong>
                  <div style={styles.starRow}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} style={n <= reviewRating ? styles.starActive : styles.star} onClick={() => setReviewRating(n)}>
                        ★
                      </button>
                    ))}
                  </div>
                  <textarea
                    style={styles.reviewTextarea}
                    value={reviewComment}
                    onChange={(event) => setReviewComment(event.target.value)}
                    placeholder={t.rateCommentPlaceholder}
                  />
                  <button disabled={reviewRating < 1 || reviewStatus === 'saving'} style={styles.primaryButton} onClick={() => void submitReview()}>
                    {reviewStatus === 'saving' ? t.rateSubmitting : t.rateSubmit}
                  </button>
                </div>
              )}
            </>
          )}
          {ride?.status === 'CANCELLED' && (
            <>
              <div style={{ ...styles.message, ...styles.error }}>{t.cancelled}</div>
              {typeof ride.cancellationFeeMinor === 'number' && ride.cancellationFeeMinor > 0 && (
                <>
                  <div style={styles.stat}>
                    <span>{t.cancellationFeeLabel}</span>
                    <strong dir={isAr ? 'rtl' : 'ltr'}>{moneyText(ride.cancellationFeeMinor, ride.currency, lang)}</strong>
                  </div>
                  {renderPaymentSection(t.payFeeTitle, t.payFeeCopy)}
                </>
              )}
            </>
          )}

          {ride && LIVE_TRACKING_STATUSES.includes(ride.status) && (
            <button disabled={shareStatus === 'sharing'} style={styles.secondaryButton} onClick={() => void shareTrip()}>
              {shareStatus === 'copied' ? t.shareCopied : shareStatus === 'sharing' ? t.sharing : t.shareTrip}
            </button>
          )}

          {ride && ride.status !== 'DRAFT' && ACTIVE_RIDE_STATUSES.includes(ride.status) && (
            <button style={styles.sosButton} onClick={() => (window.location.hash = '/trust-center/sos')}>
              {t.sos} ⚠
            </button>
          )}

          {canCancel && estimatedCancellationFeeMinor > 0 && (
            <p style={styles.addressWarning}>
              {t.cancellationFeeWarning.replace('{amount}', moneyText(estimatedCancellationFeeMinor, ride?.currency || 'SYP', lang))}
            </p>
          )}

          <div style={styles.actions}>
            <button disabled={!ride || isTerminal || status === 'saving'} style={styles.secondaryButton} onClick={() => void refreshRide()}>
              {t.refresh}
            </button>
            {isTerminal ? (
              <button disabled={status === 'saving'} style={styles.primaryButton} onClick={startNewRide}>
                {t.newRide}
              </button>
            ) : (
              <button disabled={!canCancel || status === 'saving'} style={styles.cancelButton} onClick={() => void cancelRide()}>
                {status === 'saving' ? t.cancelling : t.cancel}
              </button>
            )}
          </div>

          {message && (
            <div style={{ ...styles.message, ...(status === 'error' ? styles.error : {}) }}>
              {message}
            </div>
          )}
        </article>
      </section>
    </main>
  )
}

// CAPSULE_RULES.noFakeTrustSignal: only ever renders real data returned by the API (driver's real
// displayName + real vehicle fields) -- never fabricates a name or vehicle when the API omits one.
function driverIdentityLabel(ride: PlatformRideRequest | null, t: { driverNotAssigned: string }): string {
  if (!ride?.driver) return t.driverNotAssigned
  const vehicle = [ride.driver.driverProfile?.vehicleMake, ride.driver.driverProfile?.vehicleModel].filter(Boolean).join(' ')
  const plate = ride.driver.driverProfile?.vehiclePlate
  // Never show a rating for a driver with none yet -- an invented "0.0" or a hidden zero would be
  // exactly the kind of unbacked claim CAPSULE_RULES.noFakeTrustSignal exists to prevent.
  const rating = ride.driver.averageRating !== null ? `★${ride.driver.averageRating} (${ride.driver.ratingCount})` : null
  return [ride.driver.displayName, vehicle, plate, rating].filter(Boolean).join(' · ')
}

function Info({ label, value, dir = 'ltr' }: { label: string; value: string; dir?: 'ltr' | 'rtl' }) {
  return (
    <div style={styles.stat}>
      <span>{label}</span>
      <strong dir={dir}>{value}</strong>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#070b12', color: '#fff', padding: '24px 16px 90px', display: 'grid', gap: 16, maxWidth: 1040, margin: '0 auto' },
  back: { justifySelf: 'start', minHeight: 42, border: '1px solid #263651', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  hero: { border: '1px solid #1e2a3c', borderRadius: 8, padding: 18, background: '#101722' },
  eyebrow: { color: '#19d7ff', letterSpacing: 2, fontWeight: 900, fontSize: 11, margin: 0 },
  title: { margin: '6px 0', fontSize: 38, lineHeight: 1.08 },
  body: { color: '#9aa6ba', margin: 0, maxWidth: 720, lineHeight: 1.6 },
  grid: { display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' },
  card: { border: '1px solid #1e2a3c', borderRadius: 8, background: '#101722', padding: 16, display: 'grid', gap: 12 },
  driverPhoto: { width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', border: '2px solid #263651' },
  verifiedBadge: { display: 'inline-block', width: 'fit-content', borderRadius: 999, background: 'rgba(32,210,155,.14)', border: '1px solid rgba(32,210,155,.4)', color: '#20d29b', fontWeight: 900, fontSize: 12, padding: '4px 10px' },
  cardTitle: { fontSize: 22, margin: 0 },
  mapPreview: { minHeight: 170, border: '1px solid #263651', borderRadius: 8, background: 'linear-gradient(135deg,#0c1220,#122033)', display: 'grid', placeItems: 'center', textAlign: 'center', padding: 18, position: 'relative', overflow: 'hidden' },
  dot: { width: 24, height: 24, borderRadius: 999, background: '#19d7ff', boxShadow: '0 0 0 16px rgba(25,215,255,.13), 0 0 36px rgba(25,215,255,.55)' },
  label: { display: 'grid', gap: 7, color: '#9aa6ba', fontSize: 12, fontWeight: 900 },
  input: { minHeight: 52, border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#fff', padding: '0 14px', fontWeight: 900 },
  categoryCapsule: { border: '1px solid #263651', borderRadius: 8, background: '#070b12', display: 'grid', gap: 10, padding: 12 },
  categoryTitle: { color: '#9aa6ba', fontSize: 12, fontWeight: 900 },
  categoryStrip: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))' },
  categoryButton: { minHeight: 48, border: '1px solid #263651', borderRadius: 8, background: '#131e2e', color: '#fff', fontWeight: 900, padding: '0 12px' },
  categoryActive: { minHeight: 48, border: 0, borderRadius: 8, background: '#19d7ff', color: '#051014', fontWeight: 950, padding: '0 12px' },
  touchFilters: { border: '1px solid #263651', borderRadius: 18, background: '#070b12', padding: 12, display: 'grid', gap: 10 },
  filtersHead: { alignItems: 'center', color: '#fff', display: 'flex', justifyContent: 'space-between', gap: 12 },
  toggle: { minHeight: 52, border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#fff', display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', fontWeight: 900 },
  stat: { border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#9aa6ba', display: 'flex', justifyContent: 'space-between', gap: 12, padding: 12 },
  primaryButton: { minHeight: 48, border: 0, borderRadius: 8, background: '#19d7ff', color: '#051014', fontWeight: 950, padding: '0 14px' },
  secondaryButton: { minHeight: 48, border: '1px solid #263651', borderRadius: 8, background: '#131e2e', color: '#fff', fontWeight: 900, padding: '0 14px' },
  cancelButton: { minHeight: 48, border: '1px solid rgba(255,96,96,.45)', borderRadius: 8, background: 'rgba(255,96,96,.12)', color: '#ffd1d1', fontWeight: 900, padding: '0 14px' },
  sosButton: { minHeight: 56, border: '2px solid #ff4c73', borderRadius: 10, background: 'transparent', color: '#ff4c73', fontWeight: 950, fontSize: 16, width: '100%' },
  actions: { display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' },
  message: { border: '1px solid rgba(32,210,155,.35)', borderRadius: 8, background: 'rgba(32,210,155,.1)', color: '#b7ffe8', padding: 12, fontWeight: 900 },
  error: { borderColor: 'rgba(255,96,96,.45)', background: 'rgba(255,96,96,.1)', color: '#ffd1d1' },
  addressWarning: { border: '1px solid rgba(255,176,32,.45)', borderRadius: 8, background: 'rgba(255,176,32,.1)', color: '#ffd98a', padding: 12, fontWeight: 800, fontSize: 13, lineHeight: 1.4 },
  starRow: { display: 'flex', gap: 6 },
  star: { border: 0, background: 'transparent', color: '#3a4459', fontSize: 28, padding: 0, cursor: 'pointer' },
  starActive: { border: 0, background: 'transparent', color: '#e5b80b', fontSize: 28, padding: 0, cursor: 'pointer' },
  reviewTextarea: { minHeight: 64, border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#fff', padding: 10, fontFamily: 'inherit', resize: 'vertical' },
  payInput: { minHeight: 44, border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#fff', padding: '0 10px', fontFamily: 'inherit' },
  chatMessages: { display: 'grid', gap: 6, maxHeight: 220, overflowY: 'auto' },
  chatEmpty: { color: '#5c6b85', fontSize: 13 },
  chatBubbleMine: { justifySelf: 'end', maxWidth: '80%', borderRadius: '10px 10px 2px 10px', background: 'rgba(32,210,155,.14)', border: '1px solid rgba(32,210,155,.35)', color: '#e7fff6', padding: '8px 10px', fontSize: 13 },
  chatBubbleTheirs: { justifySelf: 'start', maxWidth: '80%', borderRadius: '10px 10px 10px 2px', background: '#0d1420', border: '1px solid #263651', color: '#e7ecf5', padding: '8px 10px', fontSize: 13 },
  chatInputRow: { display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 },
  chatInput: { minHeight: 44, border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#fff', padding: '0 10px', fontFamily: 'inherit' },
  scheduleRow: { display: 'flex', alignItems: 'center', gap: 8, color: '#9aa6ba', fontWeight: 800, fontSize: 14 },
  savedPlacesRow: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  savedPlaceChip: { display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid #263651', borderRadius: 999, background: '#131e2e', padding: '2px 2px 2px 10px', fontSize: 13, color: '#fff' },
  chipButton: { border: 0, background: 'transparent', color: '#19d7ff', fontWeight: 800, fontSize: 13, padding: '4px 6px', cursor: 'pointer' },
  savePlaceRow: { display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 },
}
