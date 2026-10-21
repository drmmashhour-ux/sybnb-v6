import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { getCurrentPath, navigate } from '@platform/app/routes'
import { pick, type Lang } from '@platform/engines/language/languageEngine'
import { guideLabel, taskById, type GuideTask } from './tasks'

/** Active guide is kept in sessionStorage so it survives page changes and reloads. Start it with startGuide(). */
const KEY = 'rezekme.guide'
type State = { id: string; role: 'rider' | 'driver'; step: number }
const read = (): State | null => { try { const v = sessionStorage.getItem(KEY); return v ? (JSON.parse(v) as State) : null } catch { return null } }
const write = (s: State | null) => { try { if (s) sessionStorage.setItem(KEY, JSON.stringify(s)); else sessionStorage.removeItem(KEY) } catch { /* ignore */ } window.dispatchEvent(new Event('rezekme-guide')) }

export function startGuide(id: string, role: 'rider' | 'driver') { write({ id, role, step: 0 }) }
export function stopGuide() { write(null) }

export function GuideOverlay({ lang }: { lang: Lang }) {
  const [state, setState] = useState<State | null>(() => read())
  const [rect, setRect] = useState<DOMRect | null>(null)
  const startedStep = useRef('')
  useEffect(() => {
    const sync = () => setState(read())
    window.addEventListener('rezekme-guide', sync)
    return () => window.removeEventListener('rezekme-guide', sync)
  }, [])
  const task: GuideTask | null = state ? taskById(state.id, state.role) : null
  const step = task && state ? task.steps[Math.min(state.step, task.steps.length - 1)] : null

  // Open the page of this step and click its harmless "open" control once.
  useEffect(() => {
    if (!state || !step) return
    const mark = `${state.id}:${state.step}`
    if (startedStep.current === mark) return
    startedStep.current = mark
    if (step.route && getCurrentPath() !== step.route) navigate(step.route)
    if (step.open) {
      let tries = 0
      const timer = window.setInterval(() => {
        const el = document.querySelector<HTMLElement>(step.open as string)
        if (el) { el.click(); window.clearInterval(timer) } else if (++tries > 20) window.clearInterval(timer)
      }, 250)
      return () => window.clearInterval(timer)
    }
  }, [state, step])

  // Follow the target (it may appear late or move).
  useEffect(() => {
    if (!step?.target) { setRect(null); return }
    let scrolled = false
    const tick = () => {
      const el = document.querySelector(step.target as string)
      if (!el) { setRect(null); return }
      if (!scrolled) { const r = el.getBoundingClientRect(); window.scrollTo({ top: Math.max(0, window.scrollY + r.top - window.innerHeight / 2 + r.height / 2), left: 0, behavior: 'smooth' }); scrolled = true }
      setRect(el.getBoundingClientRect())
    }
    tick()
    const timer = window.setInterval(tick, 250)
    return () => window.clearInterval(timer)
  }, [step])

  const go = useCallback((delta: number) => {
    if (!state || !task) return
    const next = state.step + delta
    if (next < 0) return
    if (next >= task.steps.length) { write(null); return }
    write({ ...state, step: next })
  }, [state, task])

  if (!state || !task || !step) return null
  const isAr = lang === 'ar'
  const last = state.step >= task.steps.length - 1
  const bubbleOnTop = rect ? rect.top > window.innerHeight / 2 : false
  return (
    <div style={S.layer} aria-live="polite">
      {rect && <div style={{ ...S.ring, top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }} />}
      <div dir={isAr ? 'rtl' : 'ltr'} style={{ ...S.bubble, ...(bubbleOnTop ? { top: 12 } : { bottom: 12 }) }}>
        <div style={S.head}>
          <span>✨ {guideLabel(task.title, lang)} · {state.step + 1}/{task.steps.length}</span>
          <button type="button" style={S.x} aria-label={pick(lang, 'إغلاق', 'Close', 'Fermer')} onClick={stopGuide}>✕</button>
        </div>
        <div style={S.text}>{guideLabel(step.text, lang)}</div>
        {step.target && !rect && <div style={S.wait}>{pick(lang, 'لم أجد هذا الزر على الشاشة بعد. أكمل بيانات الرحلة أعلاه ثم تابع.', 'I cannot see this control yet. Fill in the trip details above, then continue.', 'Je ne vois pas encore ce bouton. Renseignez le trajet plus haut puis continuez.')}</div>}
        <div style={S.row}>
          <button type="button" style={S.ghost} disabled={state.step === 0} onClick={() => go(-1)}>{pick(lang, 'رجوع', 'Back', 'Retour')}</button>
          <button type="button" style={S.primary} onClick={() => go(1)}>{last ? pick(lang, 'تم', 'Done', 'Terminé') : pick(lang, 'التالي', 'Next', 'Suivant')}</button>
        </div>
      </div>
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  layer: { position: 'fixed', inset: 0, zIndex: 2147483000, pointerEvents: 'none' },
  ring: { position: 'fixed', borderRadius: 12, border: '3px solid #f5b301', boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)', transition: 'all .2s', pointerEvents: 'none' },
  bubble: { position: 'fixed', left: 12, right: 12, maxWidth: 440, margin: '0 auto', background: '#111', color: '#fff', borderRadius: 16, padding: 14, display: 'grid', gap: 10, pointerEvents: 'auto', boxShadow: '0 8px 30px rgba(0,0,0,.35)' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, color: '#f5b301', fontWeight: 700 },
  x: { background: 'none', border: 0, color: '#fff', fontSize: 18, cursor: 'pointer', minWidth: 32, minHeight: 32 },
  text: { fontSize: 16, lineHeight: 1.45 },
  wait: { fontSize: 13, color: '#ffd978' },
  row: { display: 'flex', gap: 8, justifyContent: 'flex-end' },
  ghost: { minHeight: 44, padding: '0 16px', borderRadius: 12, border: '1px solid #666', background: 'transparent', color: '#fff', fontWeight: 600, cursor: 'pointer' },
  primary: { minHeight: 44, padding: '0 20px', borderRadius: 12, border: 0, background: '#f5b301', color: '#111', fontWeight: 800, cursor: 'pointer' },
}
