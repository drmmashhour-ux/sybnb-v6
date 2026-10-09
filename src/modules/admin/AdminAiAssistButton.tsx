import { useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { requestAdminAiAssist, type PlatformAiAssistResult } from '../../shared/api/platformApi'

type Props = {
  kind: 'payment' | 'dispute'
  entityId: string
  lang: Lang
}

const C = {
  blue2: '#7d90ff',
  green: '#22d6a0',
  gold: '#e8bd2a',
  red: '#ff5c7a',
  muted: '#9aa7bd',
  dim: '#6c7b96',
  line: 'rgba(130,150,200,.14)',
}

function recTone(rec: string): string {
  switch (rec) {
    case 'APPROVE': return C.green
    case 'REJECT': return C.red
    case 'HOLD': return C.gold
    default: return C.muted
  }
}

// Self-contained advisory button. It never approves/rejects anything itself — it only fetches a
// recommendation the admin reads before acting with the real decision controls next to it.
export function AdminAiAssistButton({ kind, entityId, lang }: Props) {
  const isAr = lang === 'ar'
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<PlatformAiAssistResult | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)

  async function run(event: React.MouseEvent) {
    event.stopPropagation()
    if (state === 'loading') return
    setState('loading')
    setError('')
    setOpen(true)
    try {
      const res = await requestAdminAiAssist(kind, entityId)
      setResult(res)
      setState('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setState('error')
    }
  }

  const label = pick(lang, 'توصية الذكاء', 'AI advice', 'Avis IA')
  const rec = result?.recommendation

  return (
    <div style={styles.wrap} onClick={(e) => e.stopPropagation()}>
      <button style={styles.button} onClick={run} disabled={state === 'loading'}>
        {state === 'loading' ? (isAr ? '… يفكر' : '… thinking') : `✨ ${label}`}
      </button>

      {open && (state === 'done' || state === 'error') && (
        <div style={styles.panel}>
          <div style={styles.panelHead}>
            <strong style={{ fontSize: 12.5, color: C.blue2 }}>{pick(lang, 'مساعد القرار — استشاري فقط', 'Decision assistant — advisory only', 'Assistant — avis uniquement')}</strong>
            <button style={styles.close} onClick={(e) => { e.stopPropagation(); setOpen(false) }}>✕</button>
          </div>

          {state === 'error' && <p style={{ margin: 0, color: C.red, fontSize: 12.5 }}>{error}</p>}

          {state === 'done' && result && !result.configured && (
            <p style={{ margin: 0, color: C.dim, fontSize: 12.5 }}>
              {pick(lang, 'مساعد الذكاء غير مفعّل (لا يوجد مفتاح API). أضف ANTHROPIC_API_KEY لتفعيله.', 'AI assistant is off (no API key set). Add ANTHROPIC_API_KEY on the backend to enable it.', 'Assistant IA désactivé (aucune clé API).')}
            </p>
          )}

          {state === 'done' && result && result.configured && result.ok === false && (
            <p style={{ margin: 0, color: C.gold, fontSize: 12.5 }}>
              {pick(lang, 'تعذّر الحصول على توصية الآن.', 'Could not get a recommendation right now.', 'Impossible d’obtenir un avis maintenant.')} <span style={{ color: C.dim }}>({result.error})</span>
            </p>
          )}

          {state === 'done' && rec && (
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={styles.recRow}>
                <span style={{ ...styles.badge, color: recTone(rec.recommendation), borderColor: recTone(rec.recommendation) }}>{rec.recommendation}</span>
                <span style={{ color: C.dim, fontSize: 11.5 }}>{pick(lang, 'ثقة', 'confidence', 'confiance')}: {rec.confidence}</span>
              </div>
              {rec.summary && <p style={{ margin: 0, fontSize: 13, color: '#e8eaf2', lineHeight: 1.5 }}>{rec.summary}</p>}
              {rec.reasons.length > 0 && (
                <ul style={styles.list}>
                  {rec.reasons.map((r, i) => <li key={i} style={styles.li}>{r}</li>)}
                </ul>
              )}
              {rec.nextSteps.length > 0 && (
                <div style={{ display: 'grid', gap: 4 }}>
                  <small style={{ color: C.dim, fontWeight: 700 }}>{pick(lang, 'الخطوات المقترحة', 'Suggested next steps', 'Étapes suggérées')}</small>
                  <ul style={styles.list}>
                    {rec.nextSteps.map((r, i) => <li key={i} style={styles.li}>{r}</li>)}
                  </ul>
                </div>
              )}
              <small style={{ color: C.dim, fontSize: 11 }}>
                {pick(lang, 'هذه توصية استشارية — القرار النهائي لك.', 'Advisory only — the final decision is yours.', 'Avis consultatif — la décision finale vous revient.')} · {result?.model}
              </small>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { display: 'grid', gap: 8, gridColumn: '1 / -1' },
  button: { minHeight: 40, border: '1px solid rgba(123,144,255,.5)', borderRadius: 10, background: 'linear-gradient(135deg, rgba(91,116,255,.2), rgba(91,116,255,.08))', color: '#cdd6ff', fontWeight: 800, fontSize: 12.5, cursor: 'pointer', padding: '0 12px' },
  panel: { background: 'linear-gradient(180deg, rgba(16,26,44,.95), #0b1220)', border: '1px solid rgba(123,144,255,.3)', borderRadius: 12, padding: 12, display: 'grid', gap: 8 },
  panelHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  close: { background: 'transparent', border: 0, color: C.dim, cursor: 'pointer', fontSize: 13, fontWeight: 800 },
  recRow: { display: 'flex', alignItems: 'center', gap: 10 },
  badge: { border: '1px solid', borderRadius: 999, fontSize: 11.5, fontWeight: 900, padding: '3px 11px' },
  list: { margin: 0, paddingInlineStart: 18, display: 'grid', gap: 3 },
  li: { color: C.muted, fontSize: 12.5, lineHeight: 1.5 },
}

export default AdminAiAssistButton
