import { useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react'
import { pick, type Lang } from '@platform/engines/language/languageEngine'

/**
 * Test / demo view (#/split): the client app and the driver app in one page, like a video call --
 * one screen big, the other in a small floating window you can drag and swap. Or side by side.
 * Both frames are this same site, so they use this browser's sign-ins (client account in the client
 * frame, driver account in the driver frame). Nothing here bypasses any check.
 */
const PHONE_W = 390
const PHONE_H = 844

export function SplitView({ lang }: { lang: Lang }) {
  const t = (ar: string, en: string, fr: string) => pick(lang, ar, en, fr)
  const base = window.location.pathname
  const [mode, setMode] = useState<'pip' | 'side'>('pip')
  const [bigIsDriver, setBigIsDriver] = useState(true)
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 16, y: 70 })
  const drag = useRef<{ dx: number; dy: number } | null>(null)

  const client = <iframe title="client" src={`${base}#/ride`} style={S.frame} allow="geolocation" />
  const driver = <iframe title="driver" src={`${base}#/driver`} style={S.frame} allow="geolocation" />
  const label = (isDriver: boolean) => (isDriver ? t('السائق', 'Driver', 'Chauffeur') : t('الراكب', 'Client', 'Client'))

  function down(e: RPointerEvent<HTMLDivElement>) {
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function move(e: RPointerEvent<HTMLDivElement>) {
    if (!drag.current) return
    setPos({ x: Math.max(0, Math.min(window.innerWidth - 120, e.clientX - drag.current.dx)), y: Math.max(50, Math.min(window.innerHeight - 120, e.clientY - drag.current.dy)) })
  }
  function up() {
    drag.current = null
  }

  const smallScale = 0.42
  return (
    <div style={S.page} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div style={S.bar}>
        <strong>Rezekme</strong>
        <span style={S.hint}>{t('شاشة الراكب وشاشة السائق معاً', 'Client and driver screens together', 'Écrans client et chauffeur ensemble')}</span>
        <button type="button" style={S.btn} onClick={() => setMode(mode === 'pip' ? 'side' : 'pip')}>
          {mode === 'pip' ? t('جنباً إلى جنب', 'Side by side', 'Côte à côte') : t('نافذة عائمة', 'Floating window', 'Fenêtre flottante')}
        </button>
        {mode === 'pip' && (
          <button type="button" style={S.btn} onClick={() => setBigIsDriver(!bigIsDriver)}>⇄ {t('تبديل', 'Swap', 'Inverser')}</button>
        )}
        <a href="#/ride" style={S.btn}>{t('خروج', 'Exit', 'Quitter')}</a>
      </div>

      {mode === 'side' ? (
        <div style={S.side}>
          <figure style={S.fig}><figcaption style={S.cap}>{label(false)}</figcaption><div style={S.phone}>{client}</div></figure>
          <figure style={S.fig}><figcaption style={S.cap}>{label(true)}</figcaption><div style={S.phone}>{driver}</div></figure>
        </div>
      ) : (
        <div style={S.stage}>
          <div style={S.bigPhone}>
            <span style={S.tag}>{label(bigIsDriver)}</span>
            {bigIsDriver ? driver : client}
          </div>
          <div style={{ ...S.pip, left: pos.x, top: pos.y, width: PHONE_W * smallScale, height: PHONE_H * smallScale + 26 }}>
            <div style={S.handle} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
              <span>⠿ {label(!bigIsDriver)}</span>
              <button type="button" style={S.mini} onClick={() => setBigIsDriver(!bigIsDriver)} aria-label={t('تبديل', 'Swap', 'Inverser')}>⇄</button>
            </div>
            <div style={{ width: PHONE_W, height: PHONE_H, transform: `scale(${smallScale})`, transformOrigin: '0 0' }}>{bigIsDriver ? client : driver}</div>
          </div>
        </div>
      )}
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#111', color: '#fff', display: 'flex', flexDirection: 'column' },
  bar: { display: 'flex', gap: 8, alignItems: 'center', padding: '10px 16px', flexWrap: 'wrap' },
  hint: { color: '#bbb', fontSize: 13, flex: 1, minWidth: 120 },
  btn: { color: '#fff', background: 'transparent', fontWeight: 700, fontSize: 13, textDecoration: 'none', border: '1px solid #555', borderRadius: 999, padding: '6px 14px', cursor: 'pointer' },
  side: { display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap', padding: '0 16px 16px' },
  fig: { margin: 0, display: 'flex', flexDirection: 'column', gap: 6, width: `min(${PHONE_W}px, 100%)` },
  cap: { fontSize: 13, fontWeight: 700, color: '#ddd', textAlign: 'center' },
  phone: { width: '100%', height: `min(${PHONE_H}px, calc(100vh - 100px))`, borderRadius: 22, overflow: 'hidden', background: '#fff' },
  stage: { position: 'relative', flex: 1, display: 'flex', justifyContent: 'center', padding: '0 16px 16px' },
  bigPhone: { position: 'relative', width: `min(${PHONE_W + 40}px, 100%)`, height: `min(${PHONE_H}px, calc(100vh - 80px))`, borderRadius: 24, overflow: 'hidden', background: '#fff' },
  tag: { position: 'absolute', bottom: 10, insetInlineStart: 10, zIndex: 5, background: 'rgba(0,0,0,.7)', color: '#fff', borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 700, pointerEvents: 'none' },
  pip: { position: 'fixed', zIndex: 3000, borderRadius: 16, overflow: 'hidden', background: '#fff', boxShadow: '0 10px 30px rgba(0,0,0,.55)', border: '2px solid #fff' },
  handle: { height: 26, background: '#222', color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px', cursor: 'grab', touchAction: 'none', userSelect: 'none' },
  mini: { background: 'transparent', color: '#fff', border: 0, fontSize: 14, cursor: 'pointer', padding: 0 },
  frame: { width: '100%', height: '100%', border: 0, display: 'block', background: '#fff' },
}
