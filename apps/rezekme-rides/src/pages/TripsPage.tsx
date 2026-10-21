import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '@platform/engines/language/languageEngine'
import {
  fetchPrototypeOverview,
  getStoredGuestSession,
  openRideInvoice,
  type PlatformRideRequest,
} from '@platform/shared/api/platformApi'
import { moneyText, statusText } from '@platform/shared/i18n/display'
import { RouteViewer } from './RouteViewer'
import { AssistantBox, ReportProblem } from './HelpTools'

type Props = { lang: Lang }

/**
 * "Your trips". There is no dedicated rider ride-history endpoint; GET /api/me/overview (already used
 * by the platform dashboard) returns the account's latest 50 rides, so this page reads that and keeps
 * only the rides this account REQUESTED as a rider. Receipts reuse the existing invoice endpoint.
 */
export function TripsPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const [rides, setRides] = useState<PlatformRideRequest[] | null>(null)
  const [error, setError] = useState('')
  const [openRoute, setOpenRoute] = useState<string | null>(null)
  const [reportFor, setReportFor] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const myId = getStoredGuestSession()?.user?.id
    fetchPrototypeOverview()
      .then((overview) => {
        if (cancelled) return
        const mine = (overview.rides || []).filter((ride) => !myId || ride.riderId === myId)
        mine.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime())
        setRides(mine)
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : pick(lang, 'تعذر تحميل الرحلات', 'Could not load your trips', 'Impossible de charger vos courses'))
      })
    return () => {
      cancelled = true
    }
  }, [lang])

  const title = pick(lang, 'رحلاتي', 'Your trips', 'Vos courses')
  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <h1 style={styles.title}>{title}</h1>
      <AssistantBox lang={lang} role="rider" onSuggestReport={() => setReportFor(rides?.find((r) => r.status === 'COMPLETED')?.id ?? null)} />
      {error && <div style={styles.error}>{error}</div>}
      {!error && rides === null && (
        <div style={styles.list} aria-busy="true">
          <div style={styles.skeleton} />
          <div style={styles.skeleton} />
          <div style={styles.skeleton} />
        </div>
      )}
      {rides && rides.length === 0 && (
        <div style={styles.hint}>{pick(lang, 'لا توجد رحلات بعد.', 'No trips yet.', 'Aucune course pour le moment.')}</div>
      )}
      {rides && rides.length > 0 && (
        <div style={styles.list}>
          {rides.map((ride) => {
            const finished = ride.status === 'COMPLETED' || ride.status === 'CANCELLED'
            const charged = ride.status === 'CANCELLED' ? ride.cancellationFeeMinor ?? 0 : ride.fareMinor ?? 0
            return (
              <article key={ride.id} style={styles.card}>
                <div style={styles.row}>
                  <strong>{statusText(ride.status, lang)}</strong>
                  <span style={styles.muted} dir="ltr">{new Date(ride.requestedAt).toLocaleString(pick(lang, 'ar-SY', 'en-US', 'fr-CA'))}</span>
                </div>
                <div style={styles.route}>
                  <span>{String(ride.metadata?.pickup || '-')}</span>
                  <strong>{String(ride.metadata?.dropoff || '-')}</strong>
                </div>
                <div style={styles.row}>
                  <strong dir={isAr ? 'rtl' : 'ltr'}>{charged > 0 ? moneyText(charged, ride.currency, lang) : '-'}</strong>
                  {(finished || ride.status === 'IN_PROGRESS') && (
                    <button type="button" style={{ ...styles.receiptBtn, background: '#eee', color: '#000' }} onClick={() => setOpenRoute(openRoute === ride.id ? null : ride.id)}>
                      {pick(lang, 'المسار', 'Route', 'Trajet')}
                    </button>
                  )}
                  {finished && charged > 0 && (
                    <button type="button" style={styles.receiptBtn} onClick={() => void openRideInvoice(ride.id)}>
                      {pick(lang, 'الإيصال', 'Receipt', 'Reçu')}
                    </button>
                  )}
                </div>
                {openRoute === ride.id && <RouteViewer rideId={ride.id} lang={lang} />}
                {ride.status === 'COMPLETED' && (reportFor === ride.id
                  ? <ReportProblem lang={lang} role="rider" rideId={ride.id} startOpen onSent={() => setRides((list) => (list ?? []).map((r) => (r.id === ride.id ? { ...r, status: 'DISPUTED' } : r)))} />
                  : <button type="button" style={{ ...styles.receiptBtn, background: '#fff', color: '#000', border: '1px solid #000' }} onClick={() => setReportFor(ride.id)}>⚠ {pick(lang, 'الإبلاغ عن مشكلة', 'Report a problem', 'Signaler un problème')}</button>)}
                {ride.status === 'DISPUTED' && <div style={styles.hint}>{pick(lang, 'قيد مراجعة الإدارة.', 'Under admin review.', 'En cours d’examen par l’administrateur.')}</div>}
              </article>
            )
          })}
        </div>
      )}
      <a href="#/ride" style={styles.back}>{pick(lang, 'طلب رحلة', 'Request a ride', 'Demander une course')}</a>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#fff', color: '#000', padding: '16px 16px 90px', display: 'grid', gap: 16, maxWidth: 520, margin: '0 auto', alignContent: 'start' },
  title: { margin: 0, fontSize: 28, fontWeight: 800 },
  list: { display: 'grid', gap: 12 },
  card: { display: 'grid', gap: 8, background: '#f6f6f6', borderRadius: 14, padding: 14 },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  route: { display: 'grid', gap: 2, fontSize: 14 },
  muted: { color: '#6b6b6b', fontSize: 12 },
  hint: { color: '#6b6b6b', fontSize: 14 },
  error: { background: '#fde8e6', color: '#9b1c12', borderRadius: 10, padding: 12, fontWeight: 600 },
  skeleton: { height: 92, borderRadius: 14, background: '#eee' },
  receiptBtn: { minHeight: 40, border: 0, borderRadius: 999, background: '#000', color: '#fff', fontWeight: 700, padding: '0 16px' },
  back: { justifySelf: 'start', minHeight: 44, display: 'inline-grid', placeItems: 'center', borderRadius: 999, background: '#eee', color: '#000', fontWeight: 700, padding: '0 18px', textDecoration: 'none' },
}
