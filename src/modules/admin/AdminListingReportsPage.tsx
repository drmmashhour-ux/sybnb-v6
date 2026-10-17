import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import {
  decideAdminListingReport,
  fetchAdminListingReports,
  type PlatformListingReport,
} from '../../shared/api/platformApi'

type Props = { lang: Lang }
type Filter = 'OPEN' | 'RESOLVED' | 'DISMISSED'

const REASON_TEXT: Record<string, { ar: string; en: string; fr: string }> = {
  SCAM_OR_FAKE: { ar: 'احتيال أو إعلان وهمي', en: 'Scam or fake listing', fr: 'Arnaque ou fausse annonce' },
  WRONG_INFO: { ar: 'معلومات أو صور غير صحيحة', en: 'Wrong information or photos', fr: 'Informations ou photos incorrectes' },
  UNAVAILABLE_AT_CHECKIN: { ar: 'غير متاح عند الوصول', en: 'Unavailable at check-in / swapped', fr: 'Indisponible à l’arrivée / remplacé' },
  INAPPROPRIATE: { ar: 'محتوى غير لائق', en: 'Inappropriate content', fr: 'Contenu inapproprié' },
  OTHER: { ar: 'سبب آخر', en: 'Something else', fr: 'Autre raison' },
}

export function AdminListingReportsPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const [filter, setFilter] = useState<Filter>('OPEN')
  const [reports, setReports] = useState<PlatformListingReport[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState('')

  async function load(next: Filter) {
    setState('loading')
    setMessage('')
    try {
      setReports(await fetchAdminListingReports(next))
      setState('ready')
    } catch (error) {
      setState('error')
      setMessage(error instanceof Error ? error.message : pick(lang, 'تعذر تحميل البلاغات', 'Could not load reports', 'Impossible de charger les signalements'))
    }
  }

  useEffect(() => {
    void load(filter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  async function decide(report: PlatformListingReport, status: 'RESOLVED' | 'DISMISSED') {
    setBusyId(report.id)
    setMessage('')
    try {
      await decideAdminListingReport(report.id, { status, note: notes[report.id]?.trim() || undefined })
      setReports((current) => current.filter((item) => item.id !== report.id))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : pick(lang, 'تعذر حفظ القرار', 'Could not save the decision', 'Impossible d’enregistrer la décision'))
    } finally {
      setBusyId('')
    }
  }

  const filters: Array<{ id: Filter; label: string }> = [
    { id: 'OPEN', label: pick(lang, 'مفتوحة', 'Open', 'Ouverts') },
    { id: 'RESOLVED', label: pick(lang, 'تم الحل', 'Resolved', 'Résolus') },
    { id: 'DISMISSED', label: pick(lang, 'مرفوضة', 'Dismissed', 'Rejetés') },
  ]

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <button style={styles.back} onClick={() => (window.location.hash = '/admin/review')}>
        {pick(lang, 'العودة للإدارة', 'Back to admin', 'Retour à l’administration')}
      </button>
      <h1 style={styles.title}>{pick(lang, 'بلاغات الإعلانات', 'Listing reports', 'Signalements d’annonces')}</h1>
      <p style={styles.dim}>
        {pick(lang, 'بلاغات المستخدمين عن الإعلانات. الأقدم أولاً.', 'Reports users filed against listings. Oldest first.', 'Signalements déposés contre des annonces. Les plus anciens d’abord.')}
      </p>

      <div style={styles.actions} role="tablist">
        {filters.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} style={filter === item.id ? styles.primary : styles.secondary} onClick={() => setFilter(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      {message ? <p style={styles.error} role="alert">{message}</p> : null}
      {state === 'loading' ? <p style={styles.dim}>{pick(lang, 'جار التحميل...', 'Loading...', 'Chargement...')}</p> : null}
      {state === 'ready' && reports.length === 0 ? <p style={styles.dim}>{pick(lang, 'لا توجد بلاغات.', 'No reports.', 'Aucun signalement.')}</p> : null}

      <div style={styles.grid}>
        {reports.map((report) => {
          const reason = REASON_TEXT[report.reason]
          const title = (isAr ? report.listing?.titleAr : report.listing?.titleEn) || report.listing?.titleEn || report.listing?.titleAr || report.listingId.slice(0, 8)
          return (
            <article key={report.id} style={styles.card}>
              <strong>{reason ? reason[lang] : report.reason}</strong>
              <a style={styles.link} href={`#/listing/${report.listingId}`}>{title}</a>
              <span style={styles.dim}>
                {report.listing ? `${report.listing.division} · ${report.listing.status} · ` : ''}
                {new Date(report.createdAt).toLocaleString()}
              </span>
              {report.note ? <p style={styles.note}>{report.note}</p> : null}
              {report.status === 'OPEN' ? (
                <>
                  <input
                    style={styles.input}
                    value={notes[report.id] ?? ''}
                    maxLength={1000}
                    placeholder={pick(lang, 'ملاحظة القرار (اختياري)', 'Decision note (optional)', 'Note de décision (facultatif)')}
                    onChange={(event) => setNotes((current) => ({ ...current, [report.id]: event.target.value }))}
                  />
                  <div style={styles.actions}>
                    <button type="button" style={styles.primary} disabled={busyId === report.id} onClick={() => void decide(report, 'RESOLVED')}>
                      {pick(lang, 'تم الحل', 'Resolve', 'Résoudre')}
                    </button>
                    <button type="button" style={styles.secondary} disabled={busyId === report.id} onClick={() => void decide(report, 'DISMISSED')}>
                      {pick(lang, 'رفض البلاغ', 'Dismiss', 'Rejeter')}
                    </button>
                  </div>
                </>
              ) : report.resolutionNote ? (
                <span style={styles.dim}>{report.resolutionNote}</span>
              ) : null}
            </article>
          )
        })}
      </div>
    </main>
  )
}

export default AdminListingReportsPage

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#08090f', color: '#fff', padding: '24px 16px 90px', display: 'grid', gap: 16, maxWidth: 1000, margin: '0 auto', alignContent: 'start' },
  back: { justifySelf: 'start', minHeight: 42, border: '1px solid #263651', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', cursor: 'pointer' },
  title: { margin: 0, fontSize: 28 },
  dim: { color: '#9aa6ba', margin: 0, fontSize: 13 },
  grid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' },
  card: { border: '1px solid #1e2a3c', borderRadius: 8, background: '#101722', padding: 16, display: 'grid', gap: 8 },
  link: { color: '#19d7ff', textDecoration: 'underline' },
  note: { margin: 0, whiteSpace: 'pre-wrap' },
  input: { minHeight: 40, borderRadius: 8, border: '1px solid #263651', background: '#0b1220', color: '#fff', padding: '0 10px', font: 'inherit' },
  actions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  secondary: { minHeight: 40, border: '1px solid #263651', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 12px', cursor: 'pointer' },
  primary: { minHeight: 40, border: 0, borderRadius: 8, background: '#19d7ff', color: '#051014', padding: '0 14px', fontWeight: 700, cursor: 'pointer' },
  error: { color: '#ff9b9b', margin: 0 },
}
