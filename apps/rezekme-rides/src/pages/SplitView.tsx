import type { CSSProperties } from 'react'
import { pick, type Lang } from '@platform/engines/language/languageEngine'

/**
 * Test / demo view: the rider app and the driver app side by side in one page (#/split).
 * Both frames are this same site, so they share this browser's sign-ins: the rider frame uses the
 * signed-in client account, the driver frame the signed-in driver account. Nothing here bypasses
 * any check; it is just two normal screens next to each other.
 */
export function SplitView({ lang }: { lang: Lang }) {
  const t = (ar: string, en: string, fr: string) => pick(lang, ar, en, fr)
  const base = window.location.pathname
  return (
    <div style={S.page} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div style={S.bar}>
        <strong>Rezekme</strong>
        <span style={S.hint}>{t('شاشة الراكب وشاشة السائق معاً', 'Client and driver screens together', 'Écrans client et chauffeur côte à côte')}</span>
        <a href="#/ride" style={S.exit}>{t('خروج', 'Exit', 'Quitter')}</a>
      </div>
      <div style={S.frames}>
        <figure style={S.fig}>
          <figcaption style={S.cap}>{t('الراكب', 'Client', 'Client')}</figcaption>
          <iframe title="client" src={`${base}#/ride`} style={S.frame} allow="geolocation" />
        </figure>
        <figure style={S.fig}>
          <figcaption style={S.cap}>{t('السائق', 'Driver', 'Chauffeur')}</figcaption>
          <iframe title="driver" src={`${base}#/driver`} style={S.frame} allow="geolocation" />
        </figure>
      </div>
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#111', color: '#fff', display: 'flex', flexDirection: 'column' },
  bar: { display: 'flex', gap: 12, alignItems: 'center', padding: '10px 16px', flexWrap: 'wrap' },
  hint: { color: '#bbb', fontSize: 13, flex: 1 },
  exit: { color: '#fff', fontWeight: 700, textDecoration: 'none', border: '1px solid #555', borderRadius: 999, padding: '6px 14px' },
  frames: { display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap', padding: '0 16px 16px', flex: 1 },
  fig: { margin: 0, display: 'flex', flexDirection: 'column', gap: 6, width: 'min(420px, 100%)' },
  cap: { fontSize: 13, fontWeight: 700, color: '#ddd', textAlign: 'center' },
  frame: { width: '100%', height: 'min(860px, calc(100vh - 90px))', border: 0, borderRadius: 18, background: '#fff' },
}
