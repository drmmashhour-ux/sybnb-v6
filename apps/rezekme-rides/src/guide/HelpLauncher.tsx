import { useEffect, useState, type CSSProperties } from 'react'
import { pick, type Lang } from '@platform/engines/language/languageEngine'
import { AssistantBox } from '../pages/HelpTools'

/** Floating ✨ button on every screen: ask the AI helper; if the question matches a guided task it opens the screens and walks you through. */
export function HelpLauncher({ lang, path }: { lang: Lang; path: string }) {
  const [open, setOpen] = useState(false)
  const [guiding, setGuiding] = useState(() => { try { return Boolean(sessionStorage.getItem('rezekme.guide')) } catch { return false } })
  useEffect(() => {
    const sync = () => { try { setGuiding(Boolean(sessionStorage.getItem('rezekme.guide'))) } catch { setGuiding(false) } }
    window.addEventListener('rezekme-guide', sync)
    return () => window.removeEventListener('rezekme-guide', sync)
  }, [])
  if (guiding || /^\/ride\/shared\//.test(path)) return null
  const role = path.startsWith('/driver') ? 'driver' : 'rider'
  return (
    <>
      {open && (
        <div style={S.panel}>
          <AssistantBox lang={lang} role={role} startOpen onGuide={() => setOpen(false)} />
        </div>
      )}
      <button type="button" style={S.fab} aria-label={pick(lang, 'المساعد الذكي', 'AI helper', 'Assistant IA')} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? '✕' : '✨'}
      </button>
    </>
  )
}

const S: Record<string, CSSProperties> = {
  fab: { position: 'fixed', insetInlineEnd: 14, bottom: 14, width: 56, height: 56, borderRadius: 28, border: 0, background: '#111', color: '#f5b301', fontSize: 24, cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,0,0,.3)', zIndex: 2147482000 },
  panel: { position: 'fixed', insetInlineEnd: 14, bottom: 80, width: 'min(380px, calc(100vw - 28px))', zIndex: 2147482000, boxShadow: '0 8px 30px rgba(0,0,0,.3)', borderRadius: 14 },
}
