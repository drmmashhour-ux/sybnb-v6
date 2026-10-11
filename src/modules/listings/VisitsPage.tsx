import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { localeForLang } from '../../shared/country/presentation'
import {
  cancelVisit,
  fetchVisits,
  getStoredGuestSession,
  respondVisit,
  type PlatformVisit,
} from '../../shared/api/platformApi'

type Props = { lang: Lang }

function fmt(dt: string, lang: Lang): string {
  try { return new Date(dt).toLocaleString(localeForLang(lang), { dateStyle: 'medium', timeStyle: 'short' }) } catch { return dt }
}
function statusLabel(s: PlatformVisit['status'], lang: Lang): string {
  switch (s) {
    case 'PENDING': return pick(lang, 'قيد الانتظار', 'Pending', 'En attente')
    case 'CONFIRMED': return pick(lang, 'مؤكدة ✓', 'Confirmed ✓', 'Confirmée ✓')
    case 'DECLINED': return pick(lang, 'مرفوضة', 'Declined', 'Refusée')
    case 'CANCELLED': return pick(lang, 'ملغاة', 'Cancelled', 'Annulée')
    default: return s
  }
}
function statusColor(s: PlatformVisit['status']): string {
  return s === 'CONFIRMED' ? '#1e9e62' : s === 'DECLINED' || s === 'CANCELLED' ? '#94a3b8' : '#a06a00'
}

export function VisitsPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const signedIn = Boolean(getStoredGuestSession())
  const [asRequester, setAsRequester] = useState<PlatformVisit[]>([])
  const [asOwner, setAsOwner] = useState<PlatformVisit[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    try { const r = await fetchVisits(); setAsRequester(r.asRequester); setAsOwner(r.asOwner) }
    catch { /* noop */ } finally { setLoading(false) }
  }
  useEffect(() => { if (signedIn) void load(); else setLoading(false) /* eslint-disable-next-line */ }, [])

  async function respond(v: PlatformVisit, status: 'CONFIRMED' | 'DECLINED') {
    setBusy(v.id)
    setAsOwner((cur) => cur.map((x) => (x.id === v.id ? { ...x, status } : x)))
    try { await respondVisit(v.id, status) } catch { void load() } finally { setBusy(null) }
  }
  async function cancel(v: PlatformVisit) {
    setBusy(v.id)
    setAsRequester((cur) => cur.map((x) => (x.id === v.id ? { ...x, status: 'CANCELLED' } : x)))
    try { await cancelVisit(v.id) } catch { void load() } finally { setBusy(null) }
  }

  if (!signedIn) {
    return (
      <main style={styles.wrap} dir={isAr ? 'rtl' : 'ltr'}>
        <h1 style={styles.h1}>{pick(lang, 'الزيارات', 'Visits', 'Visites')}</h1>
        <p style={styles.muted}>{pick(lang, 'سجّل الدخول لإدارة طلبات الزيارة.', 'Sign in to manage your visit requests.', 'Connectez-vous pour gérer vos visites.')}</p>
        <button type="button" style={styles.primary} onClick={() => (window.location.hash = '/account')}>{pick(lang, 'تسجيل الدخول', 'Sign in', 'Se connecter')}</button>
      </main>
    )
  }

  return (
    <main style={styles.wrap} dir={isAr ? 'rtl' : 'ltr'}>
      <h1 style={styles.h1}>{pick(lang, 'الزيارات', 'Visits', 'Visites')}</h1>

      <section>
        <h2 style={styles.h2}>{pick(lang, 'طلبات واردة', 'Incoming requests', 'Demandes reçues')} {asOwner.length ? `(${asOwner.length})` : ''}</h2>
        {loading ? <p style={styles.muted}>…</p> : asOwner.length === 0 ? (
          <p style={styles.muted}>{pick(lang, 'لا توجد طلبات زيارة لإعلاناتك بعد.', 'No visit requests for your listings yet.', 'Aucune demande pour vos annonces.')}</p>
        ) : (
          <div style={styles.list}>
            {asOwner.map((v) => (
              <div key={v.id} style={styles.row}>
                <div style={{ display: 'grid', gap: 2 }}>
                  <strong>{v.listingTitle}</strong>
                  <span style={styles.muted}>{v.requesterName || pick(lang, 'مستخدم', 'A user', 'Un utilisateur')} · {fmt(v.proposedAt, lang)}</span>
                  {v.note ? <span style={styles.muted}>“{v.note}”</span> : null}
                </div>
                <div style={styles.actions}>
                  {v.status === 'PENDING' ? (
                    <>
                      <button type="button" style={styles.confirm} disabled={busy === v.id} onClick={() => respond(v, 'CONFIRMED')}>{pick(lang, 'تأكيد', 'Confirm', 'Confirmer')}</button>
                      <button type="button" style={styles.decline} disabled={busy === v.id} onClick={() => respond(v, 'DECLINED')}>{pick(lang, 'رفض', 'Decline', 'Refuser')}</button>
                    </>
                  ) : <span style={{ color: statusColor(v.status), fontWeight: 600 }}>{statusLabel(v.status, lang)}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={{ marginTop: 28 }}>
        <h2 style={styles.h2}>{pick(lang, 'طلباتي', 'My requests', 'Mes demandes')} {asRequester.length ? `(${asRequester.length})` : ''}</h2>
        {loading ? <p style={styles.muted}>…</p> : asRequester.length === 0 ? (
          <p style={styles.muted}>{pick(lang, 'لم تطلب أي زيارة بعد.', 'You have not requested any visits yet.', 'Aucune visite demandée.')}</p>
        ) : (
          <div style={styles.list}>
            {asRequester.map((v) => (
              <div key={v.id} style={styles.row}>
                <button type="button" style={styles.titleBtn} onClick={() => (window.location.hash = `/listing/${v.listingId}`)}>
                  <strong>{v.listingTitle}</strong>
                  <span style={styles.muted}>{fmt(v.proposedAt, lang)}</span>
                </button>
                <div style={styles.actions}>
                  <span style={{ color: statusColor(v.status), fontWeight: 600 }}>{statusLabel(v.status, lang)}</span>
                  {v.status === 'PENDING' ? <button type="button" style={styles.linkBtn} disabled={busy === v.id} onClick={() => cancel(v)}>{pick(lang, 'إلغاء', 'Cancel', 'Annuler')}</button> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { maxWidth: 900, margin: '0 auto', padding: '24px 16px 48px', display: 'grid', gap: 8 },
  h1: { fontSize: 26, fontWeight: 800, color: '#0b1b3b', margin: '0 0 8px' },
  h2: { fontSize: 18, fontWeight: 700, color: '#0b1b3b', margin: '12px 0 10px' },
  muted: { color: '#64748b', fontSize: 13 },
  primary: { padding: '12px 18px', borderRadius: 10, border: 'none', background: '#0b1b3b', color: '#fff', fontWeight: 700, cursor: 'pointer', justifySelf: 'start' as CSSProperties['justifySelf'] },
  list: { display: 'grid', gap: 10 },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, border: '1px solid #e4e9f2', borderRadius: 12, padding: '12px 14px', background: '#fff', flexWrap: 'wrap' },
  titleBtn: { display: 'grid', gap: 2, background: 'none', border: 'none', textAlign: isAr(), cursor: 'pointer', padding: 0, color: '#0b1b3b' },
  actions: { display: 'flex', alignItems: 'center', gap: 10 },
  confirm: { padding: '8px 14px', borderRadius: 8, border: 'none', background: '#0b1b3b', color: '#fff', fontWeight: 700, cursor: 'pointer' },
  decline: { padding: '8px 14px', borderRadius: 8, border: '1px solid #c9d3e6', background: '#fff', color: '#0b1b3b', fontWeight: 600, cursor: 'pointer' },
  linkBtn: { background: 'none', border: 'none', color: '#d14343', cursor: 'pointer', fontSize: 13, padding: 0 },
}

function isAr(): CSSProperties['textAlign'] { return 'start' }
