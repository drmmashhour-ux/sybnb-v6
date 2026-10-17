import { useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { reportListing, type ListingReportReason } from '../../shared/api/platformApi'

type Props = { listingId: string; lang: Lang }

const REASONS: Array<{ id: ListingReportReason; ar: string; en: string; fr: string }> = [
  { id: 'SCAM_OR_FAKE', ar: 'احتيال أو إعلان وهمي', en: 'Scam or fake listing', fr: 'Arnaque ou fausse annonce' },
  { id: 'WRONG_INFO', ar: 'معلومات أو صور غير صحيحة', en: 'Wrong information or photos', fr: 'Informations ou photos incorrectes' },
  { id: 'UNAVAILABLE_AT_CHECKIN', ar: 'غير متاح عند الوصول أو بديل أقل جودة', en: 'Unavailable at check-in or swapped for a worse place', fr: 'Indisponible à l’arrivée ou remplacé par pire' },
  { id: 'INAPPROPRIATE', ar: 'محتوى غير لائق', en: 'Inappropriate content', fr: 'Contenu inapproprié' },
  { id: 'OTHER', ar: 'سبب آخر', en: 'Something else', fr: 'Autre raison' },
]

function errorMessage(lang: Lang, code: string | undefined, fallback: string) {
  if (code === 'AUTH_REQUIRED') return pick(lang, 'سجّل الدخول أولاً لتتمكن من الإبلاغ.', 'Please sign in first to report a listing.', 'Connectez-vous d’abord pour signaler une annonce.')
  if (code === 'REPORT_ALREADY_OPEN') return pick(lang, 'لديك بلاغ مفتوح لهذا الإعلان بالفعل.', 'You already have an open report for this listing.', 'Vous avez déjà un signalement ouvert pour cette annonce.')
  if (code === 'REPORT_OWN_LISTING') return pick(lang, 'لا يمكنك الإبلاغ عن إعلانك.', 'You cannot report your own listing.', 'Vous ne pouvez pas signaler votre propre annonce.')
  if (code === 'REPORT_RATE_LIMITED') return pick(lang, 'بلاغات كثيرة. حاول لاحقاً.', 'Too many reports. Please try again later.', 'Trop de signalements. Réessayez plus tard.')
  return fallback
}

export function ReportListingButton({ listingId, lang }: Props) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<ListingReportReason>('SCAM_OR_FAKE')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const isAr = lang === 'ar'

  async function submit() {
    setBusy(true)
    setError('')
    try {
      await reportListing(listingId, { reason, note: note.trim() || undefined })
      setDone(true)
    } catch (err) {
      const code = (err as { code?: string } | null)?.code
      setError(errorMessage(lang, code, pick(lang, 'تعذّر إرسال البلاغ. حاول مرة أخرى.', 'Could not send the report. Please try again.', 'Impossible d’envoyer le signalement. Réessayez.')))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <p style={styles.thanks} role="status">
        {pick(lang, 'شكراً. استلم فريق SYBNB بلاغك وسيراجعه.', 'Thank you. The SYBNB team received your report and will review it.', 'Merci. L’équipe SYBNB a reçu votre signalement et l’examinera.')}
      </p>
    )
  }

  if (!open) {
    return (
      <button type="button" style={styles.link} onClick={() => setOpen(true)}>
        {pick(lang, 'أبلغ عن هذا الإعلان', 'Report this listing', 'Signaler cette annonce')}
      </button>
    )
  }

  return (
    <section style={styles.box} dir={isAr ? 'rtl' : 'ltr'} aria-label={pick(lang, 'الإبلاغ عن إعلان', 'Report a listing', 'Signaler une annonce')}>
      <strong>{pick(lang, 'ما المشكلة؟', 'What is the problem?', 'Quel est le problème ?')}</strong>
      <div role="radiogroup" style={styles.reasons}>
        {REASONS.map((item) => (
          <label key={item.id} style={styles.reason}>
            <input type="radio" name={`report-reason-${listingId}`} checked={reason === item.id} onChange={() => setReason(item.id)} />
            {item[lang] ?? item.en}
          </label>
        ))}
      </div>
      <textarea
        style={styles.textarea}
        value={note}
        maxLength={1000}
        rows={3}
        onChange={(event) => setNote(event.target.value)}
        placeholder={pick(lang, 'تفاصيل إضافية (اختياري)', 'More details (optional)', 'Détails supplémentaires (facultatif)')}
      />
      {error ? <p style={styles.error} role="alert">{error}</p> : null}
      <div style={styles.actions}>
        <button type="button" style={styles.primary} disabled={busy} onClick={submit}>
          {busy ? '…' : pick(lang, 'إرسال البلاغ', 'Send report', 'Envoyer le signalement')}
        </button>
        <button type="button" style={styles.link} disabled={busy} onClick={() => setOpen(false)}>
          {pick(lang, 'إلغاء', 'Cancel', 'Annuler')}
        </button>
      </div>
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  link: { background: 'none', border: 'none', color: '#7dc7ff', textDecoration: 'underline', cursor: 'pointer', padding: 4, font: 'inherit' },
  box: { border: '1px solid rgba(255,255,255,.18)', borderRadius: 12, padding: 16, display: 'grid', gap: 10, background: 'rgba(255,255,255,.04)' },
  reasons: { display: 'grid', gap: 6 },
  reason: { display: 'flex', gap: 8, alignItems: 'center' },
  textarea: { width: '100%', borderRadius: 8, border: '1px solid rgba(255,255,255,.25)', background: 'rgba(0,0,0,.25)', color: 'inherit', padding: 8, font: 'inherit' },
  actions: { display: 'flex', gap: 12, alignItems: 'center' },
  primary: { borderRadius: 8, border: '1px solid rgba(255,255,255,.3)', background: '#526cff', color: '#fff', padding: '8px 14px', cursor: 'pointer', font: 'inherit' },
  error: { color: '#ff9b9b', margin: 0 },
  thanks: { color: '#9ff0c0', margin: 0 },
}
