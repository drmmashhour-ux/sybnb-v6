import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import {
  fetchAgentReviews,
  submitAgentReview,
  getStoredGuestSession,
  type PlatformAgentReview,
} from '../../shared/api/platformApi'

// Agent reviews (Centris-depth, 2026-10-11). A signed-in buyer rates a verified agent 1-5 + comment,
// one review per author (upserted server-side). Average + list shown on the agent profile.
function Stars({ n }: { n: number }) {
  return <span style={{ color: '#e6a817', letterSpacing: 1 }}>{'★'.repeat(n)}{'☆'.repeat(5 - n)}</span>
}

export function AgentReviewsPanel({ agentId, lang }: { agentId: string; lang: Lang }) {
  const isAr = lang === 'ar'
  const [reviews, setReviews] = useState<PlatformAgentReview[]>([])
  const [average, setAverage] = useState<number | null>(null)
  const [count, setCount] = useState(0)
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const session = getStoredGuestSession()
  const canReview = !!session && session.user?.id !== agentId

  const reload = () => {
    fetchAgentReviews(agentId).then((r) => { setReviews(r.reviews); setAverage(r.average); setCount(r.count) }).catch(() => {})
  }
  useEffect(reload, [agentId])

  const submit = async () => {
    setError('')
    if (rating < 1) { setError(pick(lang, 'اختر تقييماً من 1 إلى 5.', 'Pick a rating from 1 to 5.', 'Choisissez une note de 1 à 5.')); return }
    setBusy(true)
    try {
      await submitAgentReview(agentId, { rating, comment: comment.trim() || undefined })
      setDone(true); setComment('')
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : pick(lang, 'تعذّر الإرسال.', 'Could not submit.', 'Échec.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section style={styles.wrap} dir={isAr ? 'rtl' : 'ltr'}>
      <h2 style={styles.h2}>
        {pick(lang, 'تقييمات الوسيط', 'Agent reviews', 'Avis sur l’agent')}
        {count > 0 && average != null ? <span style={styles.avg}> — {average.toFixed(1)} <Stars n={Math.round(average)} /> ({count})</span> : null}
      </h2>

      {count === 0 && <p style={styles.muted}>{pick(lang, 'لا توجد تقييمات بعد. كن أول من يقيّم هذا الوسيط.', 'No reviews yet. Be the first to review this agent.', 'Aucun avis pour le moment.')}</p>}

      {reviews.length > 0 && (
        <ul style={styles.list}>
          {reviews.map((r) => (
            <li key={r.id} style={styles.item}>
              <div style={styles.itemHead}>
                <strong>{r.author?.displayName || pick(lang, 'مستخدم', 'User', 'Utilisateur')}</strong>
                <Stars n={r.rating} />
              </div>
              {r.comment && <p style={styles.comment}>{r.comment}</p>}
            </li>
          ))}
        </ul>
      )}

      {canReview ? (
        done ? (
          <p style={styles.thanks}>{pick(lang, '✓ شكراً، تم حفظ تقييمك.', '✓ Thanks, your review was saved.', '✓ Merci, votre avis est enregistré.')}</p>
        ) : (
          <div style={styles.form}>
            <strong>{pick(lang, 'أضف تقييمك', 'Add your review', 'Ajoutez votre avis')}</strong>
            <div style={styles.starPick}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setRating(n)} style={{ ...styles.starBtn, color: n <= rating ? '#e6a817' : '#c9d3e6' }} aria-label={`${n}`}>★</button>
              ))}
            </div>
            <textarea value={comment} maxLength={1500} onChange={(e) => setComment(e.target.value)} style={styles.textarea}
              placeholder={pick(lang, 'كيف كانت تجربتك مع هذا الوسيط؟ (اختياري)', 'How was your experience with this agent? (optional)', 'Comment s’est passée votre expérience ? (optionnel)')} />
            {error && <span style={styles.error}>{error}</span>}
            <button type="button" style={styles.submitBtn} disabled={busy} onClick={submit}>
              {busy ? pick(lang, 'جارٍ الإرسال…', 'Submitting…', 'Envoi…') : pick(lang, 'إرسال التقييم', 'Submit review', 'Envoyer')}
            </button>
          </div>
        )
      ) : (
        !session && <p style={styles.muted}>{pick(lang, 'سجّل الدخول لإضافة تقييم.', 'Sign in to add a review.', 'Connectez-vous pour laisser un avis.')}</p>
      )}
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { display: 'grid', gap: 10, marginTop: 24 },
  h2: { fontSize: 18, fontWeight: 700, color: '#0b1b3b', margin: 0 },
  avg: { fontSize: 15, fontWeight: 600, color: '#334155' },
  muted: { color: '#64748b', fontSize: 14, margin: 0 },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 },
  item: { border: '1px solid #e4e9f2', borderRadius: 12, padding: 12, background: '#fff', display: 'grid', gap: 4 },
  itemHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  comment: { margin: 0, color: '#334155', fontSize: 14, lineHeight: 1.5 },
  form: { border: '1px solid #e4e9f2', borderRadius: 12, padding: 14, background: '#f8fafc', display: 'grid', gap: 8, marginTop: 6 },
  starPick: { display: 'flex', gap: 4 },
  starBtn: { background: 'none', border: 'none', fontSize: 28, lineHeight: 1, cursor: 'pointer', padding: 0 },
  textarea: { minHeight: 70, borderRadius: 8, border: '1px solid #cfd6de', padding: 10, fontSize: 14, fontFamily: 'inherit', resize: 'vertical' },
  error: { color: '#b23b3b', fontSize: 13 },
  submitBtn: { border: 'none', background: '#0b1b3b', color: '#fff', borderRadius: 10, padding: '10px 14px', fontSize: 14, cursor: 'pointer', justifySelf: 'start' },
  thanks: { color: '#1e9e62', fontWeight: 600, fontSize: 14 },
}
