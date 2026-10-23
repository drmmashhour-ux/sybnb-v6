import { useState, type CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'

/**
 * Test / demo view for Rezekme Stays (#/split), like rides.rezekme.com/#/split: the guest app, the
 * host app and the admin console side by side. The guest and host panels are this same site, so
 * each panel is named ('rzk-split-guest' / 'rzk-split-host') and keeps its own sign-in (see
 * authStorage) -- a host cannot book their own stay, so the guest needs a different account. The
 * admin panel is its own site with its own sign-in. Nothing here bypasses any check.
 */
const ADMIN_URL = ((import.meta.env.VITE_ADMIN_URL as string | undefined)?.trim() || '') + '/#/admin/review'

type Mode = 'three' | 'two'

export function StaysSplitView({ lang }: { lang: Lang }) {
  const t = (ar: string, en: string, fr: string) => pick(lang, ar, en, fr)
  const base = window.location.pathname
  const [mode, setMode] = useState<Mode>('three')
  const [reloadKey, setReloadKey] = useState(0)

  const panels = [
    { key: 'guest', label: t('الضيف', 'Guest', 'Voyageur'), src: `${base}#/stays`, name: 'rzk-split-guest', wide: false },
    { key: 'host', label: t('المضيف', 'Host', 'Hôte'), src: `${base}#/host`, name: 'rzk-split-host', wide: false },
    ...(mode === 'three' && ADMIN_URL.startsWith('http')
      ? [{ key: 'admin', label: t('الإدارة', 'Admin', 'Admin'), src: ADMIN_URL, name: 'rzk-split-admin', wide: true }]
      : []),
  ]

  return (
    <div style={S.page} dir={lang === 'ar' ? 'rtl' : 'ltr'} data-testid="stays-split">
      <div style={S.bar}>
        <strong>Rezekme</strong>
        <span style={S.hint}>{t('شاشة الضيف والمضيف والإدارة معاً', 'Guest, host and admin screens together', 'Écrans voyageur, hôte et admin ensemble')}</span>
        <button type="button" style={{ ...S.btn, ...(mode === 'three' ? S.btnOn : null) }} onClick={() => setMode('three')}>
          {t('٣ شاشات + الإدارة', '3 screens + admin', '3 écrans + admin')}
        </button>
        <button type="button" style={{ ...S.btn, ...(mode === 'two' ? S.btnOn : null) }} onClick={() => setMode('two')}>
          {t('الضيف والمضيف', 'Guest and host', 'Voyageur et hôte')}
        </button>
        <button type="button" style={S.btn} onClick={() => setReloadKey((k) => k + 1)}>↻ {t('تحديث الكل', 'Reload all', 'Tout recharger')}</button>
        <a href="#/stays" style={S.btn}>{t('خروج', 'Exit', 'Quitter')}</a>
      </div>
      <p style={S.note}>
        {t(
          'كل شاشة لها تسجيل دخول خاص: سجّل دخول المضيف في شاشة المضيف، وحساباً آخر للضيف في شاشة الضيف (المضيف لا يستطيع حجز مكانه).',
          'Each screen has its own sign-in: sign the host in on the host screen and a different account on the guest screen (a host cannot book their own stay).',
          'Chaque écran a sa propre connexion : l’hôte dans l’écran hôte, un autre compte dans l’écran voyageur.',
        )}
      </p>
      <div style={S.row}>
        {panels.map((panel) => (
          <figure key={panel.key} style={{ ...S.fig, ...(panel.wide ? S.figWide : null) }}>
            <figcaption style={S.cap}>{panel.label}</figcaption>
            <div style={S.phone}>
              <iframe key={`${panel.key}-${reloadKey}`} title={panel.label} name={panel.name} src={panel.src} style={S.frame} data-testid={`split-${panel.key}`} />
            </div>
          </figure>
        ))}
      </div>
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#111', color: '#fff', padding: '12px 16px 24px', boxSizing: 'border-box' },
  bar: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 },
  hint: { color: '#bbb', fontSize: 14, marginInlineEnd: 'auto' },
  btn: { minHeight: 38, padding: '0 14px', borderRadius: 999, border: '1px solid #444', background: '#222', color: '#fff', fontWeight: 700, cursor: 'pointer', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' },
  btnOn: { background: '#fff', color: '#111', borderColor: '#fff' },
  note: { color: '#aaa', fontSize: 13, margin: '0 0 10px' },
  row: { display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' },
  fig: { margin: 0, flex: '0 1 390px', width: 'min(390px, 100%)', display: 'grid', gap: 6 },
  figWide: { flex: '1 1 460px', width: 'min(620px, 100%)' },
  cap: { textAlign: 'center', fontWeight: 700, color: '#ddd' },
  phone: { height: 'min(844px, calc(100vh - 150px))', minHeight: 520, borderRadius: 22, overflow: 'hidden', border: '1px solid #333', background: '#000' },
  frame: { width: '100%', height: '100%', border: 0, display: 'block' },
}
