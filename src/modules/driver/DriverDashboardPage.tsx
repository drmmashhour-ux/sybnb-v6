import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  claimPrototypeSrRide,
  enablePushNotifications,
  fetchDriverIdentityStatus,
  fetchPendingSrRides,
  fetchPrototypeDriverOverview,
  fetchPrototypeSrRideThread,
  reportPrototypeDriverLocation,
  sendPrototypeSrRideMessage,
  submitDriverPhoto,
  updatePrototypeDriverAccessibility,
  updatePrototypeDriverRideStatus,
  type PlatformDriverOverview,
  type PlatformMessage,
  type PlatformRideRequest,
} from '../../shared/api/platformApi'
import { moneyText, statusText } from '../../shared/i18n/display'

type Props = {
  lang: Lang
}

// Matches MESSAGING_ELIGIBLE_RIDE_STATUSES in server/routes/messages.mjs.
const MESSAGING_ELIGIBLE_RIDE_STATUSES = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS', 'COMPLETED']
// Matches LIVE_TRACKING_STATUSES in server/routes/sr-rides.mjs.
const LIVE_TRACKING_STATUSES = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS']
// Throttles how often an actual network post goes out -- watchPosition can fire far more often
// than this, and the server only needs roughly this cadence to stay within getDriverLocation()'s
// 2-minute freshness window (server/lib/live-map.mjs) with comfortable margin.
const LOCATION_REPORT_INTERVAL_MS = 8000

const copy = {
  ar: {
    back: 'العودة للرئيسية',
    title: 'لوحة سائق SR',
    subtitle: 'الرحلات المسندة للسائق وحالات التنفيذ مباشرة من قاعدة البيانات.',
    refresh: 'تحديث',
    loading: 'جار التحميل',
    saving: 'جار الحفظ',
    error: 'تعذر تحميل رحلات السائق',
    assigned: 'مسندة',
    active: 'نشطة',
    completed: 'مكتملة',
    earnings: 'إيراد مكتمل',
    rating: 'تقييمك',
    rider: 'الراكب',
    pickup: 'الانطلاق',
    dropoff: 'الوجهة',
    status: 'الحالة',
    fare: 'الأجرة',
    arriving: 'في الطريق',
    start: 'بدء الرحلة',
    complete: 'إنهاء',
    cancel: 'إلغاء',
    messageRider: 'راسل الراكب',
    hideChat: 'إخفاء المحادثة',
    chatEmpty: 'لا توجد رسائل بعد.',
    chatPlaceholder: 'اكتب رسالة...',
    chatSend: 'إرسال',
    shareLocation: 'مشاركة موقعي',
    stopSharing: 'إيقاف المشاركة',
    locationDenied: 'تعذر الوصول إلى الموقع. تحقق من إذن الموقع.',
    locationUnsupported: 'الموقع الجغرافي غير مدعوم على هذا الجهاز.',
    accessibilityCapable: 'مركبتي تسمح بالوصول لذوي الاحتياجات الخاصة',
    accessibilityRequired: 'يحتاج مركبة لذوي الاحتياجات الخاصة',
    stopsCount: 'محطات',
    stopLabel: 'محطة',
    enableNotifications: 'تفعيل الإشعارات',
    enablingNotifications: 'جار التفعيل...',
    empty: 'لا توجد رحلات مسندة بعد.',
    dispatch: 'مركز التوجيه',
    safety: 'أمان الرحلة',
    routeConfidence: 'ثقة المسار',
    payout: 'صرف السائق',
    nextBest: 'أفضل إجراء',
    nextBestText: 'ابدأ بالرحلات النشطة، ثم حدّث الحالة فور الوصول لتفعيل ثقة العميل.',
    openOperations: 'فتح العمليات',
    openFinance: 'فتح المالية',
    available: 'متاح',
    accept: 'قبول',
    pendingEmpty: 'لا توجد طلبات رحلات بانتظار سائق الآن.',
    pendingLoading: 'جار البحث عن طلبات قريبة...',
    claiming: 'جار القبول...',
    claimError: 'تعذر قبول الرحلة، ربما قبلها سائق آخر للتو.',
    distance: 'المسافة',
    docsStatus: 'حالة الأمان والوثائق',
    verifiedIdentity: 'الهوية الموثقة',
    identityVerified: 'موثق',
    identityPending: 'قيد المراجعة',
    identityNotVerified: 'غير موثق',
    photoTitle: 'صورتك الشخصية',
    photoCopy: 'ارفع صورة واضحة لوجهك ليتعرف عليك الراكب قبل الرحلة.',
    uploadPhoto: 'رفع صورة',
    uploading: 'جار الرفع...',
    photoSubmitted: 'تم حفظ صورتك.',
    photoError: 'تعذر رفع الصورة.',
    reportIssue: 'إبلاغ عن مشكلة',
    sos: 'طوارئ SOS',
  },
  en: {
    back: 'Back to landing',
    title: 'SR Driver Dashboard',
    subtitle: 'Assigned driver rides and live execution states directly from PostgreSQL.',
    refresh: 'Refresh',
    loading: 'Loading',
    saving: 'Saving',
    error: 'Could not load driver rides',
    assigned: 'Assigned',
    active: 'Active',
    completed: 'Completed',
    earnings: 'Completed earnings',
    rating: 'Your rating',
    rider: 'Rider',
    pickup: 'Pickup',
    dropoff: 'Dropoff',
    status: 'Status',
    fare: 'Fare',
    arriving: 'Arriving',
    start: 'Start ride',
    complete: 'Complete',
    cancel: 'Cancel',
    messageRider: 'Message rider',
    hideChat: 'Hide chat',
    chatEmpty: 'No messages yet.',
    chatPlaceholder: 'Type a message...',
    chatSend: 'Send',
    shareLocation: 'Share my location',
    stopSharing: 'Stop sharing',
    locationDenied: 'Could not access location. Check your location permission.',
    locationUnsupported: 'Geolocation is not supported on this device.',
    accessibilityCapable: 'My vehicle is wheelchair accessible',
    accessibilityRequired: 'Needs accessible vehicle',
    stopsCount: 'stops',
    stopLabel: 'Stop',
    enableNotifications: 'Enable notifications',
    enablingNotifications: 'Enabling...',
    empty: 'No assigned rides yet.',
    dispatch: 'Dispatch center',
    safety: 'Ride safety',
    routeConfidence: 'Route confidence',
    payout: 'Driver payout',
    nextBest: 'Best next action',
    nextBestText: 'Start with active rides, then update arrival state immediately to increase rider confidence.',
    openOperations: 'Open operations',
    openFinance: 'Open finance',
    available: 'Available',
    accept: 'Accept',
    pendingEmpty: 'No ride requests waiting for a driver right now.',
    pendingLoading: 'Looking for nearby requests...',
    claiming: 'Claiming...',
    claimError: 'Could not claim this ride, another driver may have just accepted it.',
    distance: 'Distance',
    docsStatus: 'Safety and document status',
    verifiedIdentity: 'Verified identity',
    identityVerified: 'Verified',
    identityPending: 'Pending review',
    identityNotVerified: 'Not verified',
    photoTitle: 'Your photo',
    photoCopy: 'Upload a clear photo of your face so riders can recognize you before the ride.',
    uploadPhoto: 'Upload photo',
    uploading: 'Uploading...',
    photoSubmitted: 'Your photo was saved.',
    photoError: 'Could not upload the photo.',
    reportIssue: 'Report issue',
    sos: 'SOS emergency',
  },
}

export function DriverDashboardPage({ lang }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const [overview, setOverview] = useState<PlatformDriverOverview | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [activeRideId, setActiveRideId] = useState('')
  const [pendingRides, setPendingRides] = useState<PlatformRideRequest[]>([])
  const [pendingStatus, setPendingStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [claimingRideId, setClaimingRideId] = useState('')
  const [claimError, setClaimError] = useState('')
  const [idDocumentStatus, setIdDocumentStatus] = useState<'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | null>(null)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoStatus, setPhotoStatus] = useState<'idle' | 'uploading' | 'submitted' | 'error'>('idle')
  const [pushStatus, setPushStatus] = useState<'idle' | 'enabling' | 'enabled' | 'error'>('idle')

  useEffect(() => {
    void loadOverview()
    void loadPendingRides()
    void loadIdentityStatus()
    const interval = window.setInterval(() => void loadPendingRides(), 6000)
    return () => window.clearInterval(interval)
  }, [])

  async function loadIdentityStatus() {
    try {
      setIdDocumentStatus(await fetchDriverIdentityStatus())
    } catch {
      setIdDocumentStatus(null)
    }
  }

  async function submitPhoto() {
    if (!photoFile) return
    setPhotoStatus('uploading')
    try {
      await submitDriverPhoto(photoFile)
      setPhotoStatus('submitted')
    } catch {
      setPhotoStatus('error')
    }
  }

  async function enableNotifications() {
    setPushStatus('enabling')
    try {
      await enablePushNotifications(true)
      setPushStatus('enabled')
    } catch {
      setPushStatus('error')
    }
  }

  async function toggleAccessibility(next: boolean) {
    try {
      const driverProfile = await updatePrototypeDriverAccessibility(next)
      setOverview((previous) =>
        previous ? { ...previous, driver: { ...previous.driver, accessibilityCapable: driverProfile.accessibilityCapable } } : previous,
      )
    } catch {
      // Non-critical toggle -- the checkbox simply won't reflect the change; no dedicated error slot.
    }
  }

  async function loadPendingRides() {
    try {
      setPendingRides(await fetchPendingSrRides())
      setPendingStatus('ready')
    } catch {
      setPendingStatus('error')
    }
  }

  async function claimRide(rideId: string) {
    setClaimingRideId(rideId)
    setClaimError('')

    try {
      await claimPrototypeSrRide(rideId)
      await Promise.all([loadOverview(), loadPendingRides()])
    } catch (error) {
      setClaimError(error instanceof Error ? error.message : t.claimError)
      await loadPendingRides()
    } finally {
      setClaimingRideId('')
    }
  }

  const stats = useMemo(() => {
    const base = [
      { label: t.assigned, value: String(overview?.totals.assigned || 0) },
      { label: t.active, value: String(overview?.totals.active || 0) },
      { label: t.completed, value: String(overview?.totals.completed || 0) },
      { label: t.earnings, value: moneyText(overview?.totals.earningsMinor || 0, 'SYP', lang) },
    ]
    // Only ever a real, rider-submitted average -- never a placeholder for a driver with zero
    // ratings yet (CAPSULE_RULES.noFakeTrustSignal).
    if (overview?.rating.ratingCount) {
      base.push({ label: t.rating, value: `★${overview.rating.averageRating} (${overview.rating.ratingCount})` })
    }
    return base
  }, [lang, overview, t])

  async function loadOverview() {
    setStatus('loading')
    setMessage('')

    try {
      setOverview(await fetchPrototypeDriverOverview())
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  async function updateRide(rideId: string, nextStatus: 'DRIVER_ARRIVING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED') {
    setStatus('saving')
    setActiveRideId(rideId)
    setMessage('')

    try {
      await updatePrototypeDriverRideStatus(rideId, nextStatus)
      setOverview(await fetchPrototypeDriverOverview())
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setActiveRideId('')
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
        {pushStatus !== 'enabled' && (
          <button
            style={styles.secondaryButton}
            disabled={pushStatus === 'enabling'}
            onClick={() => void enableNotifications()}
          >
            {pushStatus === 'enabling' ? t.enablingNotifications : t.enableNotifications}
          </button>
        )}
        <div style={styles.stats}>
          {stats.map((item) => (
            <div key={item.label} style={styles.statBox}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
        <button style={styles.primaryButton} onClick={() => void loadOverview()}>
          {status === 'loading' ? t.loading : t.refresh}
        </button>
      </section>

      {status === 'error' && <section style={styles.alert}>{message}</section>}

      <section style={styles.dispatchPanel}>
        <article style={styles.dispatchHero}>
          <span>{t.available}</span>
          <strong>{t.dispatch}</strong>
          {claimError && <p style={styles.insuranceWarning}>{claimError}</p>}
          <div style={styles.offerGrid}>
            {pendingRides.length === 0 ? (
              <p style={{ color: '#9aa6ba' }}>{pendingStatus === 'loading' ? t.pendingLoading : t.pendingEmpty}</p>
            ) : (
              pendingRides.map((pendingRide) => (
                <article key={pendingRide.id} style={styles.offerCard}>
                  <span>{String(pendingRide.metadata.dropoff || '-')}</span>
                  <b dir="ltr">{moneyText(pendingRide.fareMinor || 0, pendingRide.currency, lang)}</b>
                  <i dir="ltr">
                    {pendingRide.metadata.distanceKm ? `${pendingRide.metadata.distanceKm} km` : ''}
                  </i>
                  {pendingRide.accessibilityRequired && <span style={styles.accessibilityBadge}>♿ {t.accessibilityRequired}</span>}
                  {pendingRide.stops.length > 0 && (
                    <span style={styles.accessibilityBadge}>
                      {pendingRide.stops.length} {t.stopsCount}
                    </span>
                  )}
                  <button disabled={claimingRideId === pendingRide.id} onClick={() => void claimRide(pendingRide.id)}>
                    {claimingRideId === pendingRide.id ? t.claiming : t.accept}
                  </button>
                </article>
              ))
            )}
          </div>
        </article>
      </section>

      <section style={{ ...styles.driverIntelligence, gridTemplateColumns: '1fr' }}>
        <article style={styles.docsPanel}>
          <h2>{t.docsStatus}</h2>
          <Info
            label={t.verifiedIdentity}
            value={
              idDocumentStatus === 'APPROVED'
                ? t.identityVerified
                : idDocumentStatus === 'PENDING_REVIEW'
                  ? t.identityPending
                  : t.identityNotVerified
            }
            dir={isAr ? 'rtl' : 'ltr'}
          />
          <label style={styles.locationRow}>
            <input
              type="checkbox"
              checked={overview?.driver.accessibilityCapable || false}
              onChange={(event) => void toggleAccessibility(event.target.checked)}
            />
            {t.accessibilityCapable}
          </label>
          <div style={styles.photoUpload}>
            <strong>{t.photoTitle}</strong>
            <span>{t.photoCopy}</span>
            <label style={styles.photoInputLabel}>
              <input
                accept="image/png,image/jpeg,image/webp"
                style={{ display: 'none' }}
                type="file"
                onChange={(event) => setPhotoFile(event.target.files?.[0] || null)}
              />
              {photoFile ? photoFile.name : t.uploadPhoto}
            </label>
            {photoStatus === 'submitted' && <p style={styles.photoNote}>✓ {t.photoSubmitted}</p>}
            {photoStatus === 'error' && <p style={styles.photoNote}>{t.photoError}</p>}
            <button
              style={styles.photoSubmitButton}
              disabled={!photoFile || photoStatus === 'uploading'}
              onClick={() => void submitPhoto()}
            >
              {photoStatus === 'uploading' ? t.uploading : t.uploadPhoto}
            </button>
          </div>
        </article>
      </section>

      <section style={{ ...styles.earningsPanel, gridTemplateColumns: '1fr' }}>
        <div>
          <span>{t.earnings}</span>
          <strong dir="ltr">{moneyText(overview?.totals.earningsMinor || 0, 'SYP', lang)}</strong>
          <small>{isAr ? `${overview?.totals.completed || 0} رحلة مكتملة` : `${overview?.totals.completed || 0} completed rides`}</small>
        </div>
      </section>

      <section style={styles.driverCtas}>
        <button style={styles.sosButton} onClick={() => (window.location.hash = '/trust-center/sos')}>{t.sos}</button>
        <button style={styles.reportButton} onClick={() => (window.location.hash = '/immocontact')}>{t.reportIssue}</button>
        <button style={styles.startButton} onClick={() => (window.location.hash = '/ride')}>{t.start}</button>
      </section>

      <section style={styles.dispatchPanel}>
        <article style={styles.dispatchActions}>
          <strong>{t.nextBest}</strong>
          <p>{t.nextBestText}</p>
          <div style={styles.actions}>
            <button style={styles.secondaryButton} onClick={() => (window.location.hash = '/operations')}>{t.openOperations}</button>
            <button style={styles.primaryButton} onClick={() => (window.location.hash = '/finance')}>{t.openFinance}</button>
          </div>
        </article>
      </section>

      <section style={styles.grid}>
        {overview?.rides.length ? (
          overview.rides.map((ride) => (
            <RideCard
              key={ride.id}
              ride={ride}
              lang={lang}
              labels={t}
              disabled={activeRideId === ride.id || status === 'saving'}
              onUpdate={(nextStatus) => void updateRide(ride.id, nextStatus)}
            />
          ))
        ) : (
          <section style={styles.panel}>{status === 'loading' ? t.loading : t.empty}</section>
        )}
      </section>
    </main>
  )
}

function RideCard({
  ride,
  lang,
  labels,
  disabled,
  onUpdate,
}: {
  ride: PlatformRideRequest
  lang: Lang
  labels: typeof copy.en
  disabled: boolean
  onUpdate: (status: 'DRIVER_ARRIVING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED') => void
}) {
  return (
    <article style={styles.card}>
      <strong>{String(ride.metadata.category || ride.id.slice(0, 8).toUpperCase())}</strong>
      <Info label={labels.rider} value={ride.rider?.displayName || ride.riderId.slice(0, 8).toUpperCase()} />
      <Info label={labels.pickup} value={String(ride.metadata.pickup || '-')} />
      <Info label={labels.dropoff} value={String(ride.metadata.dropoff || '-')} />
      <Info label={labels.status} value={statusText(ride.status, lang)} dir={lang === 'ar' ? 'rtl' : 'ltr'} />
      <Info label={labels.fare} value={moneyText(ride.fareMinor || 0, ride.currency, lang)} dir={lang === 'ar' ? 'rtl' : 'ltr'} />
      {ride.accessibilityRequired && <span style={styles.accessibilityBadge}>♿ {labels.accessibilityRequired}</span>}
      {ride.stops.map((stop, index) => (
        <Info key={index} label={`${labels.stopLabel} ${index + 1}`} value={stop.address} />
      ))}
      {ride.status !== 'COMPLETED' && ride.status !== 'CANCELLED' && (
        <div style={styles.actions}>
          <button disabled={disabled} style={styles.secondaryButton} onClick={() => onUpdate('DRIVER_ARRIVING')}>
            {labels.arriving}
          </button>
          <button disabled={disabled} style={styles.secondaryButton} onClick={() => onUpdate('IN_PROGRESS')}>
            {labels.start}
          </button>
          <button disabled={disabled} style={styles.primaryButton} onClick={() => onUpdate('COMPLETED')}>
            {labels.complete}
          </button>
          <button disabled={disabled} style={styles.dangerButton} onClick={() => onUpdate('CANCELLED')}>
            {labels.cancel}
          </button>
        </div>
      )}
      {LIVE_TRACKING_STATUSES.includes(ride.status) && <LocationSharingToggle rideId={ride.id} labels={labels} />}
      {MESSAGING_ELIGIBLE_RIDE_STATUSES.includes(ride.status) && <RideChatPanel rideId={ride.id} labels={labels} />}
    </article>
  )
}

// SR Ride vs. Uber gap-closure (P0 #1): mounted only while the ride is in a live-tracking status
// (RideCard's own gate), so leaving that window (completed/cancelled) unmounts this component and
// its cleanup effect stops the watch automatically -- no separate "is this ride still active"
// bookkeeping needed here.
function LocationSharingToggle({ rideId, labels }: { rideId: string; labels: typeof copy.en }) {
  const [sharing, setSharing] = useState(false)
  const [error, setError] = useState('')
  const watchIdRef = useRef<number | null>(null)
  const lastSentAtRef = useRef(0)

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current)
    }
  }, [])

  function toggle() {
    if (sharing) {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
      setSharing(false)
      return
    }
    if (!navigator.geolocation) {
      setError(labels.locationUnsupported)
      return
    }
    setError('')
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const now = Date.now()
        if (now - lastSentAtRef.current < LOCATION_REPORT_INTERVAL_MS) return
        lastSentAtRef.current = now
        void reportPrototypeDriverLocation(position.coords.latitude, position.coords.longitude)
      },
      () => setError(labels.locationDenied),
      { enableHighAccuracy: true, maximumAge: 5000 },
    )
    setSharing(true)
  }

  return (
    <div style={styles.locationRow}>
      <button style={sharing ? styles.dangerButton : styles.secondaryButton} onClick={toggle}>
        {sharing ? labels.stopSharing : labels.shareLocation}
      </button>
      {error && <span style={styles.chatEmpty}>{error}</span>}
    </div>
  )
}

// SR Ride vs. Uber gap-closure (P0 #4): each ride card manages its own chat state independently
// (collapsed by default -- a list of several active rides would otherwise show every thread open
// at once), reusing the same rideId + thread endpoints the rider's SrRidePage.tsx uses, just with
// the driver-session variant of the API calls.
function RideChatPanel({ rideId, labels }: { rideId: string; labels: typeof copy.en }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<PlatformMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    function poll() {
      fetchPrototypeSrRideThread(rideId, true)
        .then((thread) => {
          if (!cancelled) setMessages(thread.messages)
        })
        .catch(() => {})
    }
    poll()
    const interval = window.setInterval(poll, 5000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [open, rideId])

  async function send() {
    if (!input.trim()) return
    setSending(true)
    try {
      const sent = await sendPrototypeSrRideMessage(rideId, input.trim(), true)
      setMessages((previous) => [...previous, sent])
      setInput('')
    } catch {
      // Surfacing a dedicated error here would need its own status slot per card; the send button
      // simply re-enables so the driver can retry, consistent with this card's compact footprint.
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={styles.chatPanel}>
      <button style={styles.secondaryButton} onClick={() => setOpen((value) => !value)}>
        {open ? labels.hideChat : labels.messageRider}
      </button>
      {open && (
        <>
          <div style={styles.chatMessages}>
            {messages.length === 0 && <span style={styles.chatEmpty}>{labels.chatEmpty}</span>}
            {messages.map((entry) => (
              <div key={entry.id} style={entry.senderRole === 'DRIVER' ? styles.chatBubbleMine : styles.chatBubbleTheirs}>
                {entry.body}
              </div>
            ))}
          </div>
          <div style={styles.chatInputRow}>
            <input
              style={styles.chatInput}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={labels.chatPlaceholder}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void send()
              }}
            />
            <button disabled={!input.trim() || sending} style={styles.secondaryButton} onClick={() => void send()}>
              {labels.chatSend}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function Info({ label, value, dir = 'ltr' }: { label: string; value: string; dir?: 'ltr' | 'rtl' }) {
  return (
    <div style={styles.info}>
      <span>{label}</span>
      <b dir={dir}>{value}</b>
    </div>
  )
}

function DispatchItem({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <article style={{ ...styles.dispatchItem, borderColor: `${tone}66` }}>
      <span>{label}</span>
      <strong style={{ color: tone }}>{value}</strong>
    </article>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#08090f', color: '#fff', padding: '24px 16px 90px', display: 'grid', gap: 22, maxWidth: 1120, margin: '0 auto' },
  back: { justifySelf: 'start', minHeight: 42, border: '1px solid #263651', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  hero: { border: '1px solid #1e2a3c', borderRadius: 8, padding: 18, background: '#101722', display: 'grid', gap: 14 },
  eyebrow: { color: '#19d7ff', letterSpacing: 2, fontWeight: 900, fontSize: 11, margin: 0 },
  title: { margin: 0, fontSize: 38, lineHeight: 1.08 },
  body: { color: '#9aa6ba', margin: 0, lineHeight: 1.6 },
  stats: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' },
  statBox: { border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#9aa6ba', display: 'grid', gap: 4, padding: 12 },
  grid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' },
  dispatchPanel: { display: 'grid', gap: 12 },
  dispatchHero: { border: '1px solid rgba(82,108,255,.9)', borderRadius: 14, background: '#101119', padding: 28, display: 'grid', gap: 24 },
  offerGrid: { display: 'grid', gap: 18, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
  offerCard: { border: '1px solid #1e2a3c', borderRadius: 14, background: '#0b0d14', padding: 16, display: 'grid', gap: 10 },
  driverIntelligence: { display: 'grid', gap: 34, gridTemplateColumns: '1fr 1fr' },
  docsPanel: { border: '1px solid #1e2a3c', borderRadius: 14, background: '#101119', padding: 24, display: 'grid', gap: 12 },
  photoUpload: { display: 'grid', gap: 8, borderTop: '1px solid #1e2a3c', paddingTop: 14, marginTop: 4 },
  photoInputLabel: { border: '1px dashed #2f3b52', borderRadius: 10, padding: 12, textAlign: 'center', color: '#9aa6ba', cursor: 'pointer', fontWeight: 800 },
  photoNote: { margin: 0, color: '#9aa6ba', fontSize: 13 },
  photoSubmitButton: { minHeight: 44, border: 0, borderRadius: 10, background: '#19d7ff', color: '#051014', fontWeight: 950 },
  insuranceWarning: { borderRadius: 10, background: 'rgba(255,82,116,.18)', color: '#ff8aa0', padding: 14, margin: 0, fontWeight: 900 },
  earningsPanel: { border: '1px solid #1e2a3c', borderRadius: 14, background: '#101119', padding: 24, display: 'grid', gap: 22, gridTemplateColumns: '1fr 1fr 1fr', alignItems: 'center' },
  driverCtas: { display: 'grid', gap: 28, gridTemplateColumns: '1fr 1fr 1fr' },
  sosButton: { border: 0, borderRadius: 12, background: '#ff5274', color: '#06070c', fontWeight: 950, minHeight: 72, fontSize: 22 },
  reportButton: { border: '1px solid #30384d', borderRadius: 12, background: '#0b0d14', color: '#fff', fontWeight: 950, minHeight: 72, fontSize: 22 },
  startButton: { border: 0, borderRadius: 12, background: '#526cff', color: '#06110e', fontWeight: 950, minHeight: 72, fontSize: 22 },
  dispatchItem: { border: '1px solid #263651', borderRadius: 8, background: '#101722', padding: 14, display: 'grid', gap: 6 },
  dispatchActions: { border: '1px solid #263651', borderRadius: 8, background: '#101722', padding: 14, display: 'grid', gap: 8 },
  card: { border: '1px solid #1e2a3c', borderRadius: 8, background: '#101722', padding: 14, display: 'grid', gap: 10 },
  info: { borderTop: '1px solid #263651', display: 'flex', justifyContent: 'space-between', gap: 12, color: '#9aa6ba', paddingTop: 9 },
  actions: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' },
  primaryButton: { minHeight: 44, border: 0, borderRadius: 8, background: '#19d7ff', color: '#051014', fontWeight: 950, padding: '0 12px' },
  secondaryButton: { minHeight: 44, border: '1px solid #263651', borderRadius: 8, background: '#131e2e', color: '#fff', fontWeight: 900, padding: '0 12px' },
  dangerButton: { minHeight: 44, border: '1px solid rgba(255,96,96,.5)', borderRadius: 8, background: 'rgba(255,96,96,.12)', color: '#ffd1d1', fontWeight: 900, padding: '0 12px' },
  panel: { border: '1px solid #263651', borderRadius: 8, background: '#101722', color: '#9aa6ba', padding: 14 },
  alert: { border: '1px solid rgba(255,96,96,.45)', borderRadius: 8, background: 'rgba(255,96,96,.1)', color: '#ffd1d1', padding: 14 },
  locationRow: { display: 'flex', alignItems: 'center', gap: 10, borderTop: '1px solid #263651', paddingTop: 10 },
  accessibilityBadge: { display: 'inline-block', width: 'fit-content', borderRadius: 999, background: 'rgba(25,215,255,.14)', border: '1px solid rgba(25,215,255,.4)', color: '#19d7ff', fontWeight: 900, fontSize: 12, padding: '4px 10px' },
  chatPanel: { display: 'grid', gap: 8, borderTop: '1px solid #263651', paddingTop: 10 },
  chatMessages: { display: 'grid', gap: 6, maxHeight: 180, overflowY: 'auto' },
  chatEmpty: { color: '#5c6b85', fontSize: 13 },
  chatBubbleMine: { justifySelf: 'end', maxWidth: '80%', borderRadius: '10px 10px 2px 10px', background: 'rgba(25,215,255,.14)', border: '1px solid rgba(25,215,255,.35)', color: '#e7fbff', padding: '8px 10px', fontSize: 13 },
  chatBubbleTheirs: { justifySelf: 'start', maxWidth: '80%', borderRadius: '10px 10px 10px 2px', background: '#0d1420', border: '1px solid #263651', color: '#e7ecf5', padding: '8px 10px', fontSize: 13 },
  chatInputRow: { display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 },
  chatInput: { minHeight: 44, border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#fff', padding: '0 10px', fontFamily: 'inherit' },
}
