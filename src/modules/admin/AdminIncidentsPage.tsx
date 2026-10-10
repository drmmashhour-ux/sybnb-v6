import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  fetchAdminIncidents,
  fetchAdminRideTrail,
  fetchAdminDriverSafety,
  fetchAdminRideAiSummary,
  resolveAdminIncident,
  type PlatformIncident,
  type PlatformRideTrail,
  type PlatformDriverSafety,
  type PlatformRideAiAnalysis,
} from '../../shared/api/platformApi'

type Props = { lang: Lang }

const copy = {
  ar: {
    back: 'العودة للرئيسية',
    title: 'بلاغات السلامة — سير',
    subtitle: 'بلاغات الطوارئ (SOS) والبلاغات على الرحلات. المفتوحة أولاً، ثم الأحدث.',
    loading: 'جار التحميل...',
    error: 'تعذر تحميل البلاغات',
    empty: 'لا توجد بلاغات.',
    open: 'مفتوح',
    acknowledged: 'تم الاطلاع',
    resolved: 'تم الحل',
    sos: 'طوارئ',
    report: 'بلاغ',
    rider: 'راكب',
    driver: 'سائق',
    ride: 'الرحلة',
    reporter: 'المُبلِّغ',
    note: 'ملاحظة',
    viewTrail: 'عرض مسار الرحلة',
    acknowledge: 'تم الاطلاع',
    resolve: 'إغلاق كمحلول',
    resolveNote: 'ملاحظة الحل (اختياري)',
    trailTitle: 'مسار الرحلة (الصندوق الأسود)',
    snapshot: 'لقطة الرحلة',
    vehicle: 'المركبة',
    noSnapshot: 'لا توجد لقطة (لم يُعيَّن سائق بعد).',
    events: 'الأحداث',
    noEvents: 'لا توجد أحداث.',
    close: 'إغلاق',
    at: 'في',
  },
  en: {
    back: 'Back to landing',
    title: 'Safety Incidents — SR Ride',
    subtitle: 'SOS/panic pulls and trip reports. Open first, then newest.',
    loading: 'Loading...',
    error: 'Could not load incidents',
    empty: 'No incidents.',
    open: 'Open',
    acknowledged: 'Acknowledged',
    resolved: 'Resolved',
    sos: 'SOS',
    report: 'Report',
    rider: 'Rider',
    driver: 'Driver',
    ride: 'Ride',
    reporter: 'Reporter',
    note: 'Note',
    viewTrail: 'View ride trail',
    acknowledge: 'Acknowledge',
    resolve: 'Resolve',
    resolveNote: 'Resolution note (optional)',
    trailTitle: 'Ride trail (black box)',
    snapshot: 'Trip snapshot',
    vehicle: 'Vehicle',
    noSnapshot: 'No snapshot (no driver was assigned yet).',
    events: 'Events',
    noEvents: 'No events.',
    close: 'Close',
    at: 'at',
  },
  fr: {
    back: 'Retour à l’accueil',
    title: 'Incidents de sécurité — SR Ride',
    subtitle: 'Déclenchements SOS et signalements. Ouverts d’abord, puis les plus récents.',
    loading: 'Chargement...',
    error: 'Impossible de charger les incidents',
    empty: 'Aucun incident.',
    open: 'Ouvert',
    acknowledged: 'Pris en compte',
    resolved: 'Résolu',
    sos: 'SOS',
    report: 'Signalement',
    rider: 'Passager',
    driver: 'Chauffeur',
    ride: 'Course',
    reporter: 'Déclarant',
    note: 'Note',
    viewTrail: 'Voir le parcours',
    acknowledge: 'Prendre en compte',
    resolve: 'Résoudre',
    resolveNote: 'Note de résolution (facultatif)',
    trailTitle: 'Parcours (boîte noire)',
    snapshot: 'Instantané de la course',
    vehicle: 'Véhicule',
    noSnapshot: 'Aucun instantané (aucun chauffeur assigné).',
    events: 'Événements',
    noEvents: 'Aucun événement.',
    close: 'Fermer',
    at: 'à',
  },
}

function fmt(ts: string | null | undefined) {
  if (!ts) return ''
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
}

export function AdminIncidentsPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const t = copy[lang]
  const tr = (ar: string, en: string, fr: string) => (lang === 'ar' ? ar : lang === 'fr' ? fr : en)
  const [incidents, setIncidents] = useState<PlatformIncident[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [trail, setTrail] = useState<PlatformRideTrail | null>(null)
  const [trailLoading, setTrailLoading] = useState(false)
  const [safety, setSafety] = useState<PlatformDriverSafety | null>(null)
  const [safetyLoading, setSafetyLoading] = useState(false)
  const [ai, setAi] = useState<PlatformRideAiAnalysis | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [resolveNote, setResolveNote] = useState('')
  const [busyId, setBusyId] = useState('')

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setStatus('loading')
    try {
      setIncidents(await fetchAdminIncidents())
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  async function openTrail(rideId: string | null) {
    if (!rideId) return
    setTrailLoading(true)
    setTrail(null)
    setSafety(null)
    setAi(null)
    try {
      setTrail(await fetchAdminRideTrail(rideId))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setTrailLoading(false)
    }
  }

  async function loadAiSummary(rideId: string, refresh = false) {
    setAiLoading(true)
    try {
      setAi(await fetchAdminRideAiSummary(rideId, { refresh }))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setAiLoading(false)
    }
  }

  async function openSafety(driverId: string) {
    setSafetyLoading(true)
    setSafety(null)
    try {
      setSafety(await fetchAdminDriverSafety(driverId))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load driver safety record.')
    } finally {
      setSafetyLoading(false)
    }
  }

  async function act(incidentId: string, next: 'ACKNOWLEDGED' | 'RESOLVED') {
    setBusyId(incidentId)
    setMessage('')
    try {
      await resolveAdminIncident(incidentId, { status: next, note: resolveNote.trim() || undefined })
      setResolveNote('')
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setBusyId('')
    }
  }

  function statusBadge(s: string) {
    if (s === 'OPEN') return { label: t.open, style: styles.badgeOpen }
    if (s === 'ACKNOWLEDGED') return { label: t.acknowledged, style: styles.badgeAck }
    return { label: t.resolved, style: styles.badgeResolved }
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <button style={styles.back} onClick={() => (window.location.hash = '/')}>
        {t.back}
      </button>
      <h1 style={styles.title}>{t.title}</h1>
      <p style={styles.subtitle}>{t.subtitle}</p>

      {status === 'loading' && <p>{t.loading}</p>}
      {status === 'error' && <p style={styles.error}>{message}</p>}
      {status === 'ready' && incidents.length === 0 && <p>{t.empty}</p>}

      <div style={styles.grid}>
        {incidents.map((incident) => {
          const badge = statusBadge(incident.status)
          const role = incident.reporterRole === 'DRIVER' ? t.driver : t.rider
          return (
            <article key={incident.id} style={styles.card}>
              <div style={styles.cardHead}>
                <span style={incident.type === 'SOS' ? styles.sosTag : styles.reportTag}>
                  {incident.type === 'SOS' ? `⚠ ${t.sos}` : t.report}
                </span>
                <span style={badge.style}>{badge.label}</span>
              </div>
              <span>
                {t.reporter}: {role}
                {typeof incident.meta?.reporterDisplayName === 'string' ? ` — ${incident.meta.reporterDisplayName}` : ''}
              </span>
              <span dir="ltr" style={styles.dim}>{fmt(incident.createdAt)}</span>
              {incident.note && (
                <span>
                  {t.note}: {incident.note}
                </span>
              )}
              {incident.meta && typeof incident.meta.ai === 'object' && incident.meta.ai !== null && (
                <div style={styles.aiInline}>
                  <div style={styles.cardHead}>
                    <span style={styles.dim}>{tr('قراءة الذكاء الاصطناعي', 'AI read', 'Lecture IA')}</span>
                  </div>
                  <AiAnalysisView analysis={incident.meta.ai as unknown as PlatformRideAiAnalysis} tr={tr} />
                </div>
              )}
              {incident.ride && (
                <span style={styles.dim} dir="ltr">
                  {t.ride}: {incident.ride.status} · {incident.ride.id.slice(0, 8)}
                </span>
              )}
              {(incident.lat != null && incident.lng != null) && (
                <a
                  dir="ltr"
                  style={styles.link}
                  href={`https://www.openstreetmap.org/?mlat=${incident.lat}&mlon=${incident.lng}#map=17/${incident.lat}/${incident.lng}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {incident.lat.toFixed(5)}, {incident.lng.toFixed(5)}
                </a>
              )}
              <div style={styles.actions}>
                {incident.rideId && (
                  <button style={styles.secondaryButton} onClick={() => void openTrail(incident.rideId)}>
                    {t.viewTrail}
                  </button>
                )}
                {incident.status !== 'RESOLVED' && (
                  <>
                    {incident.status === 'OPEN' && (
                      <button
                        style={styles.secondaryButton}
                        disabled={busyId === incident.id}
                        onClick={() => void act(incident.id, 'ACKNOWLEDGED')}
                      >
                        {t.acknowledge}
                      </button>
                    )}
                    <button
                      style={styles.primaryButton}
                      disabled={busyId === incident.id}
                      onClick={() => void act(incident.id, 'RESOLVED')}
                    >
                      {t.resolve}
                    </button>
                  </>
                )}
              </div>
            </article>
          )
        })}
      </div>

      {incidents.some((i) => i.status !== 'RESOLVED') && (
        <input
          style={styles.input}
          value={resolveNote}
          onChange={(event) => setResolveNote(event.target.value)}
          placeholder={t.resolveNote}
        />
      )}
      {message && <p style={styles.error}>{message}</p>}

      {(trailLoading || trail) && (
        <section style={styles.trailPanel}>
          <div style={styles.cardHead}>
            <strong>{t.trailTitle}</strong>
            <button style={styles.secondaryButton} onClick={() => { setTrail(null); setSafety(null) }}>
              {t.close}
            </button>
          </div>
          {trailLoading && <p>{t.loading}</p>}
          {trail && (
            <>
              <div style={styles.snapshotBox}>
                <strong>{t.snapshot}</strong>
                {trail.snapshot ? (
                  <SnapshotView snapshot={trail.snapshot} t={t} />
                ) : (
                  <span style={styles.dim}>{t.noSnapshot}</span>
                )}
              </div>
              {trail.ride.driverId && (
                <div style={styles.snapshotBox}>
                  <div style={styles.cardHead}>
                    <strong>{tr('سجل أمان السائق', 'Driver safety record', 'Dossier de sécurité du chauffeur')}</strong>
                    <button style={styles.secondaryButton} onClick={() => void openSafety(trail.ride.driverId as string)}>
                      {safetyLoading
                        ? t.loading
                        : tr('عرض سجل الأمان', 'View safety record', 'Voir le dossier')}
                    </button>
                  </div>
                  {safety && safety.driverId === trail.ride.driverId && (
                    <div style={styles.snapshotGrid}>
                      <span>{tr('السائق', 'Driver', 'Chauffeur')}: {safety.displayName}</span>
                      <span dir="ltr">
                        {tr('الرحلات', 'Rides', 'Courses')}: {safety.totalRides} · {tr('مكتملة', 'completed', 'terminées')} {safety.completed}
                        {safety.completionRate != null ? ` (${Math.round(safety.completionRate * 100)}%)` : ''}
                      </span>
                      <span dir="ltr">
                        {tr('ملغاة', 'Cancelled', 'Annulées')}: {safety.cancelledByDriver} · {tr('نزاعات', 'disputes', 'litiges')} {safety.disputesInvolved} · SOS {safety.sosInvolved}
                      </span>
                      <span dir="ltr">
                        {tr('التقييم', 'Rating', 'Note')}: {safety.avgRating != null ? `${safety.avgRating.toFixed(2)} (${safety.ratingCount})` : '—'}
                      </span>
                      <span dir="ltr">
                        {tr('المركبة', 'Vehicle', 'Véhicule')}: {safety.currentVehicleStatus ?? '—'} · {tr('الفحص', 'inspection', 'inspection')} {safety.inspectionStatus ?? '—'}
                      </span>
                      <span dir="ltr">
                        {tr('الهوية', 'ID', 'Pièce')}: {safety.idDocumentStatus ?? '—'} · {tr('أُنشئ', 'joined', 'inscrit')} {fmt(safety.accountCreatedAt)}
                      </span>
                      <span dir="ltr">
                        {tr('انتهاء التسجيل', 'Registration expires', 'Expiration immatriculation')}: {safety.registrationExpiresAt ? fmt(safety.registrationExpiresAt) : '—'}
                      </span>
                    </div>
                  )}
                </div>
              )}
              <div style={styles.snapshotBox}>
                <div style={styles.cardHead}>
                  <strong>{tr('تحليل الذكاء الاصطناعي', 'AI analysis', 'Analyse IA')}</strong>
                  <div style={styles.actions}>
                    <button
                      style={styles.secondaryButton}
                      disabled={aiLoading}
                      onClick={() => void loadAiSummary(trail.ride.id, false)}
                    >
                      {aiLoading
                        ? t.loading
                        : ai
                          ? tr('تحديث', 'Refresh', 'Actualiser')
                          : tr('تشغيل التحليل', 'Run analysis', 'Lancer l’analyse')}
                    </button>
                  </div>
                </div>
                {!ai && !aiLoading && (
                  <span style={styles.dim}>
                    {tr('اضغط لتوليد قراءة أمان بالذكاء الاصطناعي لهذه الرحلة.', 'Generate an AI safety read for this trip.', 'Générez une lecture de sécurité IA pour cette course.')}
                  </span>
                )}
                {ai && <AiAnalysisView analysis={ai} tr={tr} />}
              </div>
              <div>
                <strong>{t.events}</strong>
                {trail.events.length === 0 ? (
                  <p style={styles.dim}>{t.noEvents}</p>
                ) : (
                  <ol style={styles.timeline}>
                    {trail.events.map((event) => (
                      <li key={event.id} style={styles.timelineItem}>
                        <span style={styles.eventType}>{event.type}</span>
                        <span dir="ltr" style={styles.dim}>
                          {t.at} {fmt(event.createdAt)}
                          {event.actorRole ? ` · ${event.actorRole}` : ''}
                          {event.lat != null && event.lng != null ? ` · ${event.lat.toFixed(4)},${event.lng.toFixed(4)}` : ''}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </>
          )}
        </section>
      )}
    </main>
  )
}

const SEVERITY_CHIP: Record<string, CSSProperties> = {
  none: { borderRadius: 999, background: 'rgba(154,166,186,.14)', border: '1px solid rgba(154,166,186,.4)', color: '#9aa6ba', fontWeight: 900, fontSize: 12, padding: '4px 10px' },
  low: { borderRadius: 999, background: 'rgba(32,210,155,.14)', border: '1px solid rgba(32,210,155,.4)', color: '#20d29b', fontWeight: 900, fontSize: 12, padding: '4px 10px' },
  medium: { borderRadius: 999, background: 'rgba(255,210,122,.14)', border: '1px solid rgba(255,210,122,.4)', color: '#ffd27a', fontWeight: 900, fontSize: 12, padding: '4px 10px' },
  high: { borderRadius: 999, background: 'rgba(255,96,96,.14)', border: '1px solid rgba(255,96,96,.4)', color: '#ff8aa0', fontWeight: 900, fontSize: 12, padding: '4px 10px' },
}

function SeverityChip({ severity, tr }: { severity: string; tr: (ar: string, en: string, fr: string) => string }) {
  const label =
    severity === 'high'
      ? tr('خطورة عالية', 'High severity', 'Gravité élevée')
      : severity === 'medium'
        ? tr('خطورة متوسطة', 'Medium severity', 'Gravité moyenne')
        : severity === 'low'
          ? tr('خطورة منخفضة', 'Low severity', 'Gravité faible')
          : tr('لا خطورة', 'No concern', 'Aucun risque')
  return <span style={SEVERITY_CHIP[severity] ?? SEVERITY_CHIP.low}>{label}</span>
}

function AiAnalysisView({
  analysis,
  tr,
}: {
  analysis: PlatformRideAiAnalysis
  tr: (ar: string, en: string, fr: string) => string
}) {
  if (!analysis.configured) {
    return (
      <span style={styles.dim}>
        {tr('تحليل الذكاء الاصطناعي غير مُفعَّل.', 'AI analysis not enabled.', 'Analyse IA non activée.')}
      </span>
    )
  }
  if (analysis.error) {
    return (
      <span style={styles.dim}>
        {tr('تعذّر إنشاء التحليل. حاول مرة أخرى.', 'Could not generate the analysis. Try again.', 'Impossible de générer l’analyse. Réessayez.')}
      </span>
    )
  }
  return (
    <div style={styles.snapshotGrid}>
      <SeverityChip severity={analysis.severity} tr={tr} />
      {analysis.summary && <span>{analysis.summary}</span>}
      {analysis.concerns.length > 0 && (
        <div>
          <span style={styles.dim}>{tr('مخاوف السلامة', 'Safety concerns', 'Préoccupations de sécurité')}:</span>
          <ul style={styles.concernList}>
            {analysis.concerns.map((concern, index) => (
              <li key={index}>{concern}</li>
            ))}
          </ul>
        </div>
      )}
      {analysis.recommendation && (
        <span>
          <strong>{tr('التوصية', 'Recommendation', 'Recommandation')}:</strong> {analysis.recommendation}
        </span>
      )}
    </div>
  )
}

function SnapshotView({ snapshot, t }: { snapshot: Record<string, unknown>; t: (typeof copy)['en'] }) {
  const driver = (snapshot.driver || {}) as Record<string, unknown>
  const vehicle = (snapshot.vehicle || {}) as Record<string, unknown>
  const rider = (snapshot.rider || {}) as Record<string, unknown>
  const vehicleParts = [vehicle.color, vehicle.make, vehicle.model, vehicle.year, vehicle.plate, vehicle.category]
    .filter((part) => part != null && part !== '')
    .join(' · ')
  return (
    <div style={styles.snapshotGrid}>
      <span>
        {t.driver}: {String(driver.displayName ?? '—')}
      </span>
      <span dir="ltr">
        {t.vehicle}: {vehicleParts || '—'}
      </span>
      <span>
        {t.rider}: {String(rider.displayName ?? '—')}
      </span>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#08090f', color: '#fff', padding: '24px 16px 90px', display: 'grid', gap: 16, maxWidth: 1000, margin: '0 auto' },
  back: { justifySelf: 'start', minHeight: 42, border: '1px solid #263651', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  title: { margin: 0, fontSize: 28 },
  subtitle: { color: '#9aa6ba', margin: 0 },
  grid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' },
  card: { border: '1px solid #1e2a3c', borderRadius: 8, background: '#101722', padding: 16, display: 'grid', gap: 8 },
  cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  dim: { color: '#9aa6ba', fontSize: 13 },
  link: { color: '#19d7ff', fontSize: 13, textDecoration: 'underline' },
  actions: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 },
  secondaryButton: { minHeight: 40, border: '1px solid #263651', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 12px', fontWeight: 800 },
  primaryButton: { minHeight: 40, border: 0, borderRadius: 8, background: '#19d7ff', color: '#051014', padding: '0 14px', fontWeight: 950 },
  input: { minHeight: 44, border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#fff', padding: '0 10px', fontFamily: 'inherit' },
  sosTag: { color: '#ff8aa0', fontWeight: 950 },
  reportTag: { color: '#ffd27a', fontWeight: 900 },
  badgeOpen: { borderRadius: 999, background: 'rgba(255,96,96,.14)', border: '1px solid rgba(255,96,96,.4)', color: '#ff8aa0', fontWeight: 900, fontSize: 12, padding: '4px 10px' },
  badgeAck: { borderRadius: 999, background: 'rgba(255,210,122,.14)', border: '1px solid rgba(255,210,122,.4)', color: '#ffd27a', fontWeight: 900, fontSize: 12, padding: '4px 10px' },
  badgeResolved: { borderRadius: 999, background: 'rgba(32,210,155,.14)', border: '1px solid rgba(32,210,155,.4)', color: '#20d29b', fontWeight: 900, fontSize: 12, padding: '4px 10px' },
  trailPanel: { border: '1px solid #1e2a3c', borderRadius: 8, background: '#0b111b', padding: 16, display: 'grid', gap: 14 },
  snapshotBox: { border: '1px solid #1e2a3c', borderRadius: 8, background: '#101722', padding: 12, display: 'grid', gap: 8 },
  snapshotGrid: { display: 'grid', gap: 4 },
  concernList: { margin: '4px 0 0', paddingInlineStart: 18, display: 'grid', gap: 2 },
  aiInline: { border: '1px solid #1e2a3c', borderRadius: 8, background: '#0b111b', padding: 10, display: 'grid', gap: 6, marginTop: 4 },
  timeline: { margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 8 },
  timelineItem: { display: 'grid', gap: 2, borderInlineStart: '2px solid #263651', paddingInlineStart: 10 },
  eventType: { fontWeight: 900, color: '#19d7ff', fontSize: 14 },
  error: { color: '#ff8aa0', margin: 0 },
}

export default AdminIncidentsPage
