import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { localeForLang } from '../../shared/country/presentation'
import {
  cancelVisit,
  fetchVisitForListing,
  getStoredGuestSession,
  requestVisit,
  type PlatformListing,
  type PlatformVisit,
} from '../../shared/api/platformApi'

type Props = { listing: PlatformListing; lang: Lang }

const GUEST_RETURN_PATH_KEY = 'sybnb.v6.guestReturnPath'

function statusLabel(status: PlatformVisit['status'], lang: Lang): string {
  switch (status) {
    case 'PENDING': return pick(lang, 'بانتظار تأكيد المالك', 'Awaiting owner confirmation', 'En attente')
    case 'CONFIRMED': return pick(lang, 'مؤكدة ✓', 'Confirmed ✓', 'Confirmée ✓')
    case 'DECLINED': return pick(lang, 'مرفوضة', 'Declined', 'Refusée')
    case 'CANCELLED': return pick(lang, 'ملغاة', 'Cancelled', 'Annulée')
    default: return status
  }
}

function visitSubjectNoun(division: string, lang: Lang): string {
  switch (division) {
    case 'CARS': return pick(lang, 'المركبة', 'the vehicle', 'le véhicule')
    case 'MARKETPLACE': return pick(lang, 'الغرض', 'the item', 'l’article')
    case 'NEW_CONSTRUCTION': return pick(lang, 'المشروع', 'the project', 'le projet')
    default: return pick(lang, 'العقار', 'the property', 'le bien')
  }
}

function fmt(dt: string, lang: Lang): string {
  try { return new Date(dt).toLocaleString(localeForLang(lang), { dateStyle: 'medium', timeStyle: 'short' }) } catch { return dt }
}

export function ScheduleVisitPanel({ listing, lang }: Props) {
  const isAr = lang === 'ar'
  const [existing, setExisting] = useState<PlatformVisit | null>(null)
  const [when, setWhen] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const signedIn = Boolean(getStoredGuestSession())

  useEffect(() => {
    fetchVisitForListing(listing.id).then(setExisting).catch(() => {})
  }, [listing.id])

  function goSignIn() {
    try { sessionStorage.setItem(GUEST_RETURN_PATH_KEY, `/listing/${listing.id}`) } catch { /* noop */ }
    window.location.hash = `/account/open/${listing.id}`
  }

  async function submit() {
    if (!when) { setError(pick(lang, 'اختر التاريخ والوقت.', 'Pick a date and time.', 'Choisissez une date et une heure.')); return }
    const iso = new Date(when).toISOString()
    setBusy(true); setError(null)
    try {
      const v = await requestVisit({ listingId: listing.id, proposedAt: iso, note: note || undefined })
      setExisting(v)
    } catch (err) {
      const e = err as { code?: string; message?: string }
      if (e.code === 'GUEST_SESSION_REQUIRED') return goSignIn()
      setError(e.message || pick(lang, 'تعذر إرسال الطلب.', 'Could not send the request.', 'Échec de l’envoi.'))
    } finally { setBusy(false) }
  }

  async function doCancel() {
    if (!existing) return
    setBusy(true)
    try { await cancelVisit(existing.id); setExisting({ ...existing, status: 'CANCELLED' }) }
    catch { /* noop */ } finally { setBusy(false) }
  }

  const activeExisting = existing && (existing.status === 'PENDING' || existing.status === 'CONFIRMED')

  return (
    <section style={styles.wrap} dir={isAr ? 'rtl' : 'ltr'} aria-label={pick(lang, 'حجز زيارة', 'Schedule a visit', 'Planifier une visite')}>
      <strong style={styles.title}>{pick(lang, 'حجز زيارة', 'Schedule a visit', 'Planifier une visite')}</strong>

      {activeExisting ? (
        <div style={styles.statusBox}>
          <div style={styles.statusRow}><span style={styles.muted}>{pick(lang, 'موعدك المقترح', 'Your requested time', 'Heure demandée')}</span><strong>{fmt(existing!.proposedAt, lang)}</strong></div>
          <div style={styles.statusRow}><span style={styles.muted}>{pick(lang, 'الحالة', 'Status', 'Statut')}</span><strong style={{ color: existing!.status === 'CONFIRMED' ? '#1e9e62' : '#a06a00' }}>{statusLabel(existing!.status, lang)}</strong></div>
          {existing!.responseNote ? <p style={styles.muted}>“{existing!.responseNote}”</p> : null}
          {existing!.status === 'PENDING' ? (
            <button type="button" style={styles.linkBtn} disabled={busy} onClick={doCancel}>{pick(lang, 'إلغاء الطلب', 'Cancel request', 'Annuler')}</button>
          ) : null}
        </div>
      ) : (
        <>
          <p style={styles.muted}>{pick(lang, `اقترح موعداً لمعاينة ${visitSubjectNoun(listing.division, 'ar')}، ويؤكده المالك.`, `Propose a time to view ${visitSubjectNoun(listing.division, 'en')} — the owner confirms it.`, `Proposez une heure pour voir ${visitSubjectNoun(listing.division, 'fr')} — le propriétaire confirme.`)}</p>
          <label style={styles.field}>
            <span>{pick(lang, 'التاريخ والوقت', 'Date & time', 'Date et heure')}</span>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={styles.input} />
          </label>
          <label style={styles.field}>
            <span>{pick(lang, 'ملاحظة (اختياري)', 'Note (optional)', 'Note (optionnel)')}</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} rows={2} style={styles.input} placeholder={pick(lang, 'مثال: أفضّل بعد الظهر', 'e.g. afternoons work best', 'ex. l’après-midi')} />
          </label>
          {existing && existing.status === 'DECLINED' ? <p style={{ ...styles.muted, color: '#a06a00' }}>{pick(lang, 'طلبك السابق رُفض — يمكنك اقتراح موعد آخر.', 'Your previous request was declined — you can propose another time.', 'Demande précédente refusée — proposez une autre heure.')}</p> : null}
          {signedIn ? (
            <button type="button" style={styles.primary} disabled={busy} onClick={submit}>{busy ? '…' : pick(lang, 'طلب زيارة', 'Request visit', 'Demander une visite')}</button>
          ) : (
            <button type="button" style={styles.primary} onClick={goSignIn}>{pick(lang, 'سجّل الدخول لحجز زيارة', 'Sign in to request a visit', 'Connexion pour demander')}</button>
          )}
        </>
      )}
      {error ? <div style={styles.error}>{error}</div> : null}
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { border: '1px solid #e4e9f2', borderRadius: 16, padding: 16, background: '#fbfcff', display: 'grid', gap: 10, marginTop: 16 },
  title: { fontSize: 16, color: '#0b1b3b' },
  muted: { color: '#64748b', fontSize: 13, margin: 0 },
  field: { display: 'grid', gap: 6, fontSize: 13, color: '#334155' },
  input: { padding: '10px 12px', borderRadius: 10, border: '1px solid #c9d3e6', fontSize: 15, fontFamily: 'inherit' },
  primary: { padding: '12px 16px', borderRadius: 10, border: 'none', background: '#0b1b3b', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 15 },
  statusBox: { display: 'grid', gap: 8, background: '#fff', border: '1px solid #eef1f7', borderRadius: 12, padding: 12 },
  statusRow: { display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 14 },
  linkBtn: { background: 'none', border: 'none', color: '#d14343', cursor: 'pointer', fontSize: 13, padding: 0, justifySelf: 'start' as CSSProperties['justifySelf'] },
  error: { color: '#d14343', fontSize: 13, fontWeight: 600 },
}
