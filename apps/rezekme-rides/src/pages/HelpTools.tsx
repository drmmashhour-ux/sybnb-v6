import { useState, type CSSProperties } from 'react'
import { pick, type Lang } from '@platform/engines/language/languageEngine'
import { getStoredGuestSession, getStoredStaffSession } from '@platform/shared/api/platformApi'

/**
 * Help tools shared by the client and driver screens:
 *  - ReportProblem: opens a dispute on a COMPLETED ride (PATCH /api/sr/rides/:id/dispute). The ride goes under admin review.
 *  - AssistantBox: asks the AI helper (POST /api/sr/assistant). Advisory only; with no AI key on the server it says so plainly.
 */
export type HelpRole = 'rider' | 'driver'
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3051'

async function api<T>(role: HelpRole, method: string, path: string, body: unknown): Promise<T> {
  const token = role === 'driver' ? getStoredStaffSession('DRIVER')?.token : getStoredGuestSession()?.token
  if (!token) throw new Error('Sign in to continue.')
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: { message?: string; code?: string } } & T
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error?.message || `Request failed: ${response.status}`)
  return payload
}

type AssistantReply = { configured: boolean; ok?: boolean; answer?: string; suggestReport?: boolean; error?: string }

export function AssistantBox({ lang, role, onSuggestReport }: { lang: Lang; role: HelpRole; onSuggestReport?: () => void }) {
  const t = (ar: string, en: string, fr: string) => pick(lang, ar, en, fr)
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState<AssistantReply | null>(null)
  const [error, setError] = useState('')

  const ask = async () => {
    const q = question.trim()
    if (!q || busy) return
    setBusy(true); setError(''); setReply(null)
    try {
      setReply(await api<AssistantReply>(role, 'POST', '/api/sr/assistant', { role, question: q }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={S.box}>
      <button type="button" style={S.toggle} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        ✨ {t('اسأل المساعد الذكي', 'Ask the AI helper', 'Demander à l’assistant IA')}
      </button>
      {open && (
        <div style={S.body}>
          <textarea
            style={S.area}
            rows={2}
            maxLength={600}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={role === 'driver'
              ? t('مثال: متى أستلم أرباحي؟', 'Example: when do I get my earnings?', 'Ex. : quand reçois-je mes gains ?')
              : t('مثال: لماذا رصيدي صفر؟', 'Example: why is my balance 0?', 'Ex. : pourquoi mon solde est à 0 ?')}
          />
          <button type="button" style={S.primary} disabled={busy || !question.trim()} onClick={() => void ask()}>
            {busy ? '…' : t('إرسال', 'Ask', 'Envoyer')}
          </button>
          {error && <div style={S.err}>{error}</div>}
          {reply && reply.configured === false && (
            <div style={S.note}>{t('المساعد الذكي غير متاح الآن. استخدم «الإبلاغ عن مشكلة» أو انتظر مراجعة الإدارة.', 'The AI helper is not available right now. Use “Report a problem” or wait for the admin.', 'L’assistant IA n’est pas disponible pour le moment. Utilisez « Signaler un problème » ou attendez l’administrateur.')}</div>
          )}
          {reply && reply.configured && reply.ok === false && (
            <div style={S.note}>{t('تعذر الحصول على إجابة الآن. حاول لاحقاً.', 'Could not get an answer right now. Please try again later.', 'Impossible d’obtenir une réponse pour le moment. Réessayez plus tard.')}</div>
          )}
          {reply?.ok && reply.answer && (
            <div style={S.answer}>
              <div>{reply.answer}</div>
              <div style={S.small}>{t('إجابة آلية للإرشاد فقط. القرار النهائي للإدارة.', 'Automatic guidance only. Decisions are made by the admin.', 'Conseil automatique uniquement. Les décisions reviennent à l’administrateur.')}</div>
              {reply.suggestReport && onSuggestReport && (
                <button type="button" style={S.secondary} onClick={onSuggestReport}>{t('الإبلاغ عن مشكلة', 'Report a problem', 'Signaler un problème')}</button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ReportProblem({ lang, role, rideId, startOpen = false, onSent }: { lang: Lang; role: HelpRole; rideId: string; startOpen?: boolean; onSent?: () => void }) {
  const t = (ar: string, en: string, fr: string) => pick(lang, ar, en, fr)
  const [open, setOpen] = useState(startOpen)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  if (done) return <div style={S.ok}>{t('تم إرسال بلاغك. ستراجعه الإدارة وتتواصل معك.', 'Your report was sent. The admin will review it.', 'Votre signalement a été envoyé. L’administrateur va l’examiner.')}</div>
  if (!open) return <button type="button" style={S.secondary} onClick={() => setOpen(true)}>⚠ {t('الإبلاغ عن مشكلة', 'Report a problem', 'Signaler un problème')}</button>

  const send = async () => {
    const text = reason.trim()
    if (text.length < 10) { setError(t('اشرح المشكلة بجملة أو جملتين على الأقل.', 'Please describe the problem in a sentence or two.', 'Décrivez le problème en une ou deux phrases.')); return }
    setBusy(true); setError('')
    try {
      await api(role, 'PATCH', `/api/sr/rides/${encodeURIComponent(rideId)}/dispute`, { reason: text })
      setDone(true); onSent?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={S.body}>
      <strong>{t('الإبلاغ عن مشكلة في هذه الرحلة', 'Report a problem with this trip', 'Signaler un problème avec cette course')}</strong>
      <textarea style={S.area} rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder={t('ماذا حدث؟ (المسار، الأجرة، السلوك…)', 'What happened? (route, fare, behaviour…)', 'Que s’est-il passé ? (trajet, tarif, comportement…)')} />
      {error && <div style={S.err}>{error}</div>}
      <button type="button" style={S.primary} disabled={busy} onClick={() => void send()}>{busy ? '…' : t('إرسال البلاغ', 'Send report', 'Envoyer')}</button>
      <div style={S.small}>{t('تُجمَّد الرحلة للمراجعة. لا يتم أي استرداد إلا بقرار من الإدارة.', 'The trip is held for review. Any refund is decided by the admin.', 'La course est mise en examen. Tout remboursement est décidé par l’administrateur.')}</div>
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  box: { border: '1px solid #e2e2e2', borderRadius: 14, background: '#fff', overflow: 'hidden' },
  toggle: { width: '100%', minHeight: 48, border: 0, background: '#f4f1ff', color: '#2b1d6b', fontWeight: 700, fontSize: 15, padding: '0 14px', textAlign: 'start', cursor: 'pointer' },
  body: { display: 'grid', gap: 8, padding: 12 },
  area: { width: '100%', boxSizing: 'border-box', borderRadius: 10, border: '1px solid #ccc', padding: 10, fontSize: 15, background: '#fff', color: '#000', resize: 'vertical' },
  primary: { minHeight: 44, borderRadius: 12, border: 0, background: '#000', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer' },
  secondary: { minHeight: 44, borderRadius: 12, border: '1px solid #000', background: '#fff', color: '#000', fontWeight: 700, fontSize: 15, padding: '0 14px', cursor: 'pointer' },
  answer: { background: '#f6f6f6', borderRadius: 10, padding: 10, display: 'grid', gap: 8, fontSize: 15 },
  note: { background: '#fff4e0', border: '1px solid #f0d49a', borderRadius: 10, padding: '8px 10px', fontSize: 14 },
  err: { background: '#fde8e6', color: '#9b1c12', borderRadius: 10, padding: '8px 10px', fontSize: 14 },
  ok: { background: '#e6f6ec', color: '#0a5a2a', borderRadius: 10, padding: '10px 12px', fontSize: 14, fontWeight: 600 },
  small: { color: '#666', fontSize: 12 },
}
