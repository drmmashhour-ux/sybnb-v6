import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { srRideFilterGroupsFromConfig, type VisualFilterSelection } from '../../engines/filters'
import type { Lang } from '../../engines/language/languageEngine'
import {
  createPrototypeSrRide,
  fetchPrototypeSrRide,
  fetchSrQuote,
  type PlatformRideRequest,
  type PlatformSrQuote,
} from '../../shared/api/platformApi'
import { moneyText, statusText } from '../../shared/i18n/display'
import { selectedFilterLabels, VisualFilterPanel } from '../../shared/filters/VisualFilterPanel'
import { sypMinorToRoundedUsdMinor } from '../../shared/currency'

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
    payCurrency: 'عملة الدفع',
    payCash: 'نقداً (ل.س)',
    payUsd: 'دولار أمريكي',
    usdRoundingNote: 'الأجرة بالدولار تُقرّب للأعلى لأقرب ٥$ لتفادي الحاجة لفكة.',
    distance: 'المسافة التقديرية',
    distanceApprox: '(تقريبية بحسب العنوان)',
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
    waitingForDriver: 'بانتظار قبول أحد السائقين القريبين للرحلة...',
    driverAssigned: 'تم تعيين سائق لرحلتك.',
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
    payCurrency: 'Payment currency',
    payCash: 'Cash (SYP)',
    payUsd: 'US Dollar',
    usdRoundingNote: 'USD fares round up to the nearest $5 so no one needs to make change.',
    distance: 'Estimated distance',
    distanceApprox: '(approximate, from address text)',
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
    waitingForDriver: 'Waiting for a nearby driver to accept the ride...',
    driverAssigned: 'A driver has been assigned to your ride.',
  },
}

const ACTIVE_RIDE_ID_KEY = 'sybnb.v6.activeSrRideId'

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
  const [payCurrency, setPayCurrency] = useState<'SYP' | 'USD'>('SYP')
  const [lowDataMode, setLowDataMode] = useState(true)
  const [accuracyMeters, setAccuracyMeters] = useState<number | undefined>()
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lng: number } | undefined>()
  const [ride, setRide] = useState<PlatformRideRequest | null>(null)
  const [quote, setQuote] = useState<PlatformSrQuote | null>(null)
  const [rideFilters, setRideFilters] = useState<VisualFilterSelection>({
    srRideCategory: 'economy',
    srRideRoute: 'cityRide',
    srRideFeatures: ['instantConfirm', 'verifiedDriver', 'ac'],
    payments: ['localWallet'],
  })
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const rideFilterGroups = useMemo(() => srRideFilterGroupsFromConfig(), [])

  const fallbackFareSypMinor = useMemo(() => {
    const base = category === 'SR SUV' ? 58000 : category === 'SR Comfort' ? 46000 : 35000
    return lowDataMode ? base : base + 2500
  }, [category, lowDataMode])
  const fallbackFareMinor = payCurrency === 'USD' ? sypMinorToRoundedUsdMinor(fallbackFareSypMinor) : fallbackFareSypMinor

  const fareMinor = quote?.fareMinor ?? fallbackFareMinor

  useEffect(() => {
    if (ride) return
    const timer = window.setTimeout(() => {
      fetchSrQuote({ pickup, dropoff, category, currency: payCurrency, lowDataMode, pickupCoords }).then(setQuote).catch(() => setQuote(null))
    }, 400)
    return () => window.clearTimeout(timer)
  }, [pickup, dropoff, category, payCurrency, lowDataMode, pickupCoords, ride])

  // The active ride otherwise lives only in this component's state — reloading the page or
  // navigating away and back loses all track of it even though it's fully real and persisted
  // server-side. Restore it from the last-known id on mount so the rider can still see live
  // driver-assignment/status updates after leaving and returning to this page.
  useEffect(() => {
    const storedRideId = sessionStorage.getItem(ACTIVE_RIDE_ID_KEY)
    if (!storedRideId) return
    fetchPrototypeSrRide(storedRideId)
      .then(setRide)
      .catch(() => sessionStorage.removeItem(ACTIVE_RIDE_ID_KEY))
    // Mount-only restore; requestRide() below is the sole subsequent writer of `ride`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Poll through every non-terminal state, not just REQUESTED/MATCHING — this previously
    // stopped the instant a driver was assigned, so the rider never saw DRIVER_ARRIVING,
    // IN_PROGRESS, or COMPLETED without manually clicking refresh (confirmed live: the ride sat
    // on "driver assigned" through the driver's entire arrive/start/complete sequence).
    if (!ride || ['COMPLETED', 'CANCELLED'].includes(ride.status)) return
    const interval = window.setInterval(() => {
      fetchPrototypeSrRide(ride.id).then(setRide).catch(() => {})
    }, 4000)
    return () => window.clearInterval(interval)
  }, [ride])

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
        currency: payCurrency,
        lowDataMode,
        accuracyMeters,
        pickupCoords,
      })
      setRide(nextRide)
      sessionStorage.setItem(ACTIVE_RIDE_ID_KEY, nextRide.id)
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

          <label style={styles.label}>
            {t.pickup}
            <input style={styles.input} value={pickup} onChange={(event) => setPickup(event.target.value)} />
          </label>

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

          <section style={styles.categoryCapsule}>
            <span style={styles.categoryTitle}>{t.payCurrency}</span>
            <div style={styles.categoryStrip}>
              <button
                style={payCurrency === 'SYP' ? styles.categoryActive : styles.categoryButton}
                onClick={() => setPayCurrency('SYP')}
                type="button"
              >
                {t.payCash}
              </button>
              <button
                style={payCurrency === 'USD' ? styles.categoryActive : styles.categoryButton}
                onClick={() => setPayCurrency('USD')}
                type="button"
              >
                {t.payUsd}
              </button>
            </div>
            {payCurrency === 'USD' && <small>{t.usdRoundingNote}</small>}
          </section>

          <div style={styles.stat}>
            <span>{t.distance}</span>
            <strong dir="ltr">
              {quote ? `${quote.distanceKm} km` : '-'} {quote?.estimated ? t.distanceApprox : ''}
            </strong>
          </div>

          <div style={styles.stat}>
            <span>{t.fare}</span>
            <strong dir={isAr ? 'rtl' : 'ltr'}>{moneyText(fareMinor, payCurrency, lang)}</strong>
          </div>

          <button disabled={status === 'saving'} style={styles.primaryButton} onClick={() => void requestRide()}>
            {status === 'saving' ? t.saving : t.request}
          </button>
        </article>

        <article style={styles.card}>
          <h2 style={styles.cardTitle}>{t.status}</h2>
          <Info label={t.rideId} value={ride ? ride.id.slice(0, 8).toUpperCase() : '-'} />
          <Info label={t.status} value={statusText(ride?.status, lang)} dir={isAr ? 'rtl' : 'ltr'} />
          <Info label={t.driver} value={ride?.driverId ? ride.driverId.slice(0, 8).toUpperCase() : '-'} />
          <Info label={t.pickup} value={String(ride?.metadata.pickup || pickup)} />
          <Info label={t.dropoff} value={String(ride?.metadata.dropoff || dropoff)} />
          <Info label={t.accuracy} value={accuracyMeters ? `${accuracyMeters}m` : isAr ? 'يدوي' : 'manual'} />

          {ride && ['REQUESTED', 'MATCHING'].includes(ride.status) && (
            <div style={styles.message}>{t.waitingForDriver}</div>
          )}
          {ride?.driverId && (
            <div style={styles.message}>{t.driverAssigned}</div>
          )}

          <div style={styles.actions}>
            <button disabled={!ride || status === 'saving'} style={styles.secondaryButton} onClick={() => void refreshRide()}>
              {t.refresh}
            </button>
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
  actions: { display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' },
  message: { border: '1px solid rgba(32,210,155,.35)', borderRadius: 8, background: 'rgba(32,210,155,.1)', color: '#b7ffe8', padding: 12, fontWeight: 900 },
  error: { borderColor: 'rgba(255,96,96,.45)', background: 'rgba(255,96,96,.1)', color: '#ffd1d1' },
}
