import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  fetchAdminSrRides,
  resolveAdminRideDispute,
  reverseAdminRidePayment,
  type PlatformAdminSrRide,
} from '../../shared/api/platformApi'
import { moneyText } from '../../shared/i18n/display'

type Props = { lang: Lang }

// Re-audit follow-up (2026-10-10): the operator screen for live-ride ops. Lists active + disputed
// rides (or a chosen status), resolves a disputed ride (CONFIRM the fare, or REVERSE + refund), and
// reverses a wrongly-approved fare on a completed ride. Wires GET /api/admin/sr/rides +
// PATCH .../resolve-dispute + PATCH .../reverse-payment, which previously had no UI.

const copy = {
  ar: {
    back: 'لوحة الإدارة',
    title: 'الرحلات المباشرة والنزاعات — سير',
    subtitle: 'الرحلات النشطة والمتنازع عليها. الأحدث أولاً.',
    loading: 'جار التحميل...',
    error: 'تعذر تحميل الرحلات',
    empty: 'لا توجد رحلات في هذه الحالة.',
    filterActive: 'النشطة',
    filterDisputed: 'المتنازع عليها',
    filterCompleted: 'المكتملة',
    rider: 'الراكب',
    driver: 'السائق',
    fare: 'الأجرة',
    noDriver: 'لم يُعيَّن سائق',
    requested: 'طُلبت',
    scheduled: 'مجدولة',
    reasonPlaceholder: 'السبب (اختياري)',
    confirmFare: 'تأكيد الأجرة',
    reverseRefund: 'عكس وإرجاع',
    reversePayment: 'عكس الدفعة',
    confirmReverse: 'سيؤدي هذا إلى عكس أموال الرحلة. متابعة؟',
    done: 'تم',
  },
  en: {
    back: 'Admin panel',
    title: 'Live rides & disputes — SR',
    subtitle: 'Active and disputed rides. Newest first.',
    loading: 'Loading...',
    error: 'Could not load rides',
    empty: 'No rides in this state.',
    filterActive: 'Active',
    filterDisputed: 'Disputed',
    filterCompleted: 'Completed',
    rider: 'Rider',
    driver: 'Driver',
    fare: 'Fare',
    noDriver: 'No driver assigned',
    requested: 'Requested',
    scheduled: 'Scheduled',
    reasonPlaceholder: 'Reason (optional)',
    confirmFare: 'Confirm fare',
    reverseRefund: 'Reverse & refund',
    reversePayment: 'Reverse payment',
    confirmReverse: 'This reverses the ride’s money. Continue?',
    done: 'Done',
  },
  fr: {
    back: 'Administration',
    title: 'Courses en direct & litiges — SR',
    subtitle: 'Courses actives et en litige. Les plus récentes d’abord.',
    loading: 'Chargement...',
    error: 'Impossible de charger les courses',
    empty: 'Aucune course dans cet état.',
    filterActive: 'Actives',
    filterDisputed: 'En litige',
    filterCompleted: 'Terminées',
    rider: 'Passager',
    driver: 'Chauffeur',
    fare: 'Tarif',
    noDriver: 'Aucun chauffeur',
    requested: 'Demandée',
    scheduled: 'Planifiée',
    reasonPlaceholder: 'Motif (facultatif)',
    confirmFare: 'Confirmer le tarif',
    reverseRefund: 'Annuler & rembourser',
    reversePayment: 'Annuler le paiement',
    confirmReverse: 'Ceci annule l’argent de la course. Continuer ?',
    done: 'Terminé',
  },
}

type Filter = 'ACTIVE' | 'DISPUTED' | 'COMPLETED'

function fmt(ts: string | null | undefined) {
  if (!ts) return ''
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
}

export function AdminLiveRidesPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const t = copy[lang]
  const [rides, setRides] = useState<PlatformAdminSrRide[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [filter, setFilter] = useState<Filter>('ACTIVE')
  const [message, setMessage] = useState('')
  const [reason, setReason] = useState('')
  const [busyId, setBusyId] = useState('')

  useEffect(() => {
    void load(filter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  async function load(f: Filter) {
    setStatus('loading')
    try {
      // 'ACTIVE' = no status param (server returns the active+disputed set); others filter exactly.
      setRides(await fetchAdminSrRides(f === 'ACTIVE' ? undefined : f))
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  async function confirmDispute(rideId: string) {
    setBusyId(rideId)
    setMessage('')
    try {
      await resolveAdminRideDispute(rideId, { resolution: 'CONFIRM', reason: reason.trim() || undefined })
      setReason('')
      await load(filter)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setBusyId('')
    }
  }

  async function reverseDispute(rideId: string) {
    if (!window.confirm(t.confirmReverse)) return
    setBusyId(rideId)
    setMessage('')
    try {
      await resolveAdminRideDispute(rideId, { resolution: 'REVERSE', reason: reason.trim() || undefined })
      setReason('')
      await load(filter)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setBusyId('')
    }
  }

  async function reversePayment(rideId: string) {
    if (!window.confirm(t.confirmReverse)) return
    setBusyId(rideId)
    setMessage('')
    try {
      await reverseAdminRidePayment(rideId, { reason: reason.trim() || undefined })
      setReason('')
      await load(filter)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setBusyId('')
    }
  }

  const filters: Array<{ key: Filter; label: string }> = [
    { key: 'ACTIVE', label: t.filterActive },
    { key: 'DISPUTED', label: t.filterDisputed },
    { key: 'COMPLETED', label: t.filterCompleted },
  ]

  function statusStyle(s: string): CSSProperties {
    if (s === 'DISPUTED') return styles.badgeDisputed
    if (s === 'COMPLETED') return styles.badgeDone
    return styles.badgeActive
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <button style={styles.back} onClick={() => (window.location.hash = '/admin/review')}>
        ← {t.back}
      </button>
      <h1 style={styles.title}>{t.title}</h1>
      <p style={styles.subtitle}>{t.subtitle}</p>

      <div style={styles.filterRow}>
        {filters.map((f) => (
          <button
            key={f.key}
            style={f.key === filter ? styles.filterActive2 : styles.filterButton}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {status === 'loading' && <p>{t.loading}</p>}
      {status === 'error' && <p style={styles.error}>{message}</p>}
      {status === 'ready' && rides.length === 0 && <p>{t.empty}</p>}
      {message && status !== 'error' && <p style={styles.error}>{message}</p>}

      {rides.some((r) => r.status === 'DISPUTED' || r.status === 'COMPLETED') && (
        <input
          style={styles.input}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={t.reasonPlaceholder}
        />
      )}

      <div style={styles.grid}>
        {rides.map((ride) => (
          <article key={ride.id} style={styles.card}>
            <div style={styles.cardHead}>
              <span dir="ltr" style={styles.rideId}>{ride.id.slice(0, 8)}</span>
              <span style={statusStyle(ride.status)}>{ride.status}</span>
            </div>
            <b dir="ltr">
              {t.fare}: {moneyText(ride.fareMinor || 0, ride.currency, lang)}
              {ride.cancellationFeeMinor ? ` (+${moneyText(ride.cancellationFeeMinor, ride.currency, lang)})` : ''}
            </b>
            <span dir="ltr" style={styles.dim}>{t.rider}: {ride.riderId.slice(0, 8)}</span>
            <span dir="ltr" style={styles.dim}>
              {t.driver}: {ride.driverId ? ride.driverId.slice(0, 8) : t.noDriver}
            </span>
            {ride.accessibilityRequired && <span style={styles.tag}>♿</span>}
            {ride.scheduledFor && (
              <span dir="ltr" style={styles.dim}>{t.scheduled}: {fmt(ride.scheduledFor)}</span>
            )}
            <span dir="ltr" style={styles.dim}>{t.requested}: {fmt(ride.requestedAt)}</span>

            {ride.status === 'DISPUTED' && (
              <div style={styles.actions}>
                <button style={styles.primaryButton} disabled={busyId === ride.id} onClick={() => void confirmDispute(ride.id)}>
                  {t.confirmFare}
                </button>
                <button style={styles.dangerButton} disabled={busyId === ride.id} onClick={() => void reverseDispute(ride.id)}>
                  {t.reverseRefund}
                </button>
              </div>
            )}
            {ride.status === 'COMPLETED' && (
              <div style={styles.actions}>
                <button style={styles.dangerButton} disabled={busyId === ride.id} onClick={() => void reversePayment(ride.id)}>
                  {t.reversePayment}
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#08090f', color: '#fff', padding: '24px 16px 90px', display: 'grid', gap: 16, maxWidth: 1000, margin: '0 auto' },
  back: { justifySelf: 'start', minHeight: 42, border: '1px solid #263651', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  title: { margin: 0, fontSize: 28 },
  subtitle: { color: '#9aa6ba', margin: 0 },
  filterRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  filterButton: { minHeight: 38, border: '1px solid #263651', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 800 },
  filterActive2: { minHeight: 38, border: '1px solid #19d7ff', borderRadius: 8, background: 'rgba(25,215,255,.14)', color: '#19d7ff', padding: '0 14px', fontWeight: 900 },
  grid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' },
  card: { border: '1px solid #1e2a3c', borderRadius: 8, background: '#101722', padding: 16, display: 'grid', gap: 6 },
  cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  rideId: { color: '#9aa6ba', fontSize: 13, fontWeight: 700 },
  dim: { color: '#9aa6ba', fontSize: 13 },
  tag: { width: 'fit-content', borderRadius: 999, background: 'rgba(25,215,255,.14)', border: '1px solid rgba(25,215,255,.4)', color: '#19d7ff', fontWeight: 900, fontSize: 12, padding: '2px 8px' },
  actions: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 },
  primaryButton: { minHeight: 40, border: 0, borderRadius: 8, background: '#19d7ff', color: '#051014', padding: '0 14px', fontWeight: 950 },
  dangerButton: { minHeight: 40, border: '1px solid rgba(255,96,96,.5)', borderRadius: 8, background: 'rgba(255,96,96,.12)', color: '#ff8aa0', padding: '0 14px', fontWeight: 900 },
  input: { minHeight: 44, border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#fff', padding: '0 10px', fontFamily: 'inherit' },
  badgeActive: { borderRadius: 999, background: 'rgba(32,210,155,.14)', border: '1px solid rgba(32,210,155,.4)', color: '#20d29b', fontWeight: 900, fontSize: 12, padding: '4px 10px' },
  badgeDisputed: { borderRadius: 999, background: 'rgba(255,96,96,.14)', border: '1px solid rgba(255,96,96,.4)', color: '#ff8aa0', fontWeight: 900, fontSize: 12, padding: '4px 10px' },
  badgeDone: { borderRadius: 999, background: 'rgba(154,166,186,.14)', border: '1px solid rgba(154,166,186,.4)', color: '#9aa6ba', fontWeight: 900, fontSize: 12, padding: '4px 10px' },
  error: { color: '#ff8aa0', margin: 0 },
}

export default AdminLiveRidesPage
