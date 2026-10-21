import { Suspense, lazy, useEffect, useState, type ComponentType, type CSSProperties } from 'react'
import { getCurrentPath, navigate } from '@platform/app/routes'
import { getInitialLanguage, persistLanguage, pick, type Lang } from '@platform/engines/language/languageEngine'
import { getStoredStaffSession, signOutStaff } from '@platform/shared/api/platformApi'

/**
 * Rezekme Admin. Every screen here is an existing, tested admin page (same server authorization: ADMIN role on every call);
 * this app only chooses which ones a Rezekme operator needs and draws them in a Rezekme shell. Stays, food, hosts and
 * listing pages are deliberately not included.
 */
type PageProps = { lang: Lang }
const page = (load: () => Promise<Record<string, unknown>>, name: string) =>
  lazy(() => load().then((m) => ({ default: m[name] as ComponentType<PageProps> })))

const StaffAccessPage = lazy(() => import('@platform/modules/account/StaffAccessPage').then((m) => ({ default: m.StaffAccessPage })))
const LiveRides = page(() => import('@platform/modules/admin/AdminLiveRidesPage'), 'AdminLiveRidesPage')
const Drivers = page(() => import('@platform/modules/admin/AdminDriversPage'), 'AdminDriversPage')
const Vehicles = page(() => import('@platform/modules/admin/AdminVehiclesPage'), 'AdminVehiclesPage')
const Review = page(() => import('@platform/modules/admin/AdminReviewPage'), 'AdminReviewPage')
const MoneyFlow = page(() => import('@platform/modules/admin/AdminMoneyFlowPage'), 'AdminMoneyFlowPage')
const Money = page(() => import('@platform/modules/admin/AdminMoneyPage'), 'AdminMoneyPage')
const Incidents = page(() => import('@platform/modules/admin/AdminIncidentsPage'), 'AdminIncidentsPage')
const Customers = page(() => import('@platform/modules/admin/AdminCustomerPage'), 'AdminCustomerPage')
const Ops = page(() => import('@platform/modules/admin/AdminOperationsPage'), 'AdminOperationsPage')
const Promo = page(() => import('@platform/modules/sr/AdminPromoCodesPage'), 'AdminPromoCodesPage')
const Business = page(() => import('@platform/modules/sr/AdminBusinessAccountsPage'), 'AdminBusinessAccountsPage')

type Item = { path: string; ar: string; en: string; fr: string; Page: ComponentType<PageProps> }
const ITEMS: Item[] = [
  { path: '/admin/ops', ar: 'نظرة عامة', en: 'Overview', fr: 'Aperçu', Page: Ops },
  { path: '/admin/sr/rides', ar: 'الرحلات المباشرة', en: 'Live rides', fr: 'Courses en direct', Page: LiveRides },
  { path: '/admin/drivers', ar: 'السائقون', en: 'Drivers', fr: 'Chauffeurs', Page: Drivers },
  { path: '/admin/vehicles', ar: 'المركبات', en: 'Vehicles', fr: 'Véhicules', Page: Vehicles },
  { path: '/admin/review', ar: 'مراجعة الدفعات', en: 'Payment review', fr: 'Vérif. paiements', Page: Review },
  { path: '/admin/money-flow', ar: 'حركة الأموال', en: 'Money flow', fr: 'Flux d’argent', Page: MoneyFlow },
  { path: '/admin/money', ar: 'الصرف والاسترداد', en: 'Payouts & refunds', fr: 'Versements', Page: Money },
  { path: '/admin/sr/incidents', ar: 'الحوادث', en: 'Incidents', fr: 'Incidents', Page: Incidents },
  { path: '/admin/customers', ar: 'العملاء', en: 'Customers', fr: 'Clients', Page: Customers },
  { path: '/admin/sr/promo-codes', ar: 'أكواد الخصم', en: 'Promo codes', fr: 'Codes promo', Page: Promo },
  { path: '/admin/sr/business-accounts', ar: 'حسابات الأعمال', en: 'Business accounts', fr: 'Comptes entreprise', Page: Business },
]
const LANGS: Lang[] = ['ar', 'en', 'fr']

export function App() {
  const [lang, setLang] = useState<Lang>(() => getInitialLanguage())
  const [path, setPath] = useState(() => getCurrentPath())
  const [, setAuthVersion] = useState(0)

  useEffect(() => { persistLanguage(lang) }, [lang])
  useEffect(() => {
    const sync = () => setPath(getCurrentPath())
    const syncAuth = () => setAuthVersion((v) => v + 1)
    window.addEventListener('hashchange', sync)
    window.addEventListener('sybnb-session-changed', syncAuth)
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('sybnb-session-changed', syncAuth) }
  }, [])

  const t = (ar: string, en: string, fr: string) => pick(lang, ar, en, fr)
  const session = getStoredStaffSession('ADMIN')
  const basePath = path.split('?')[0]
  const current = ITEMS.find((i) => basePath === i.path || (i.path === '/admin/customers' && basePath.startsWith('/admin/customers/')))

  // Unknown or empty paths land on the live rides screen.
  useEffect(() => { if (session && !current) navigate('/admin/sr/rides') }, [session, current])

  const shell = (children: React.ReactNode) => (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'} style={S.root}>
      <header style={S.bar}>
        <strong style={S.brand}>Rezekme <span style={S.badge}>{t('الإدارة', 'Admin', 'Admin')}</span></strong>
        <div style={S.right}>
          {LANGS.map((l) => <button key={l} style={{ ...S.lang, ...(l === lang ? S.langOn : null) }} onClick={() => setLang(l)}>{l.toUpperCase()}</button>)}
          {session && <button style={S.out} onClick={() => { void signOutStaff().finally(() => navigate('/')) }}>{t('خروج', 'Sign out', 'Sortir')}</button>}
        </div>
      </header>
      {session && (
        <nav style={S.nav} aria-label="Rezekme admin">
          {ITEMS.map((i) => (
            <a key={i.path} href={`#${i.path}`} style={{ ...S.link, ...(current?.path === i.path ? S.linkOn : null) }}>{t(i.ar, i.en, i.fr)}</a>
          ))}
        </nav>
      )}
      <Suspense fallback={<p style={S.loading}>…</p>}>{children}</Suspense>
    </div>
  )

  if (!session) return shell(<StaffAccessPage lang={lang} role="ADMIN" returnPath="/admin/sr/rides" />)
  const Current = current?.Page
  return shell(Current ? <Current lang={lang} /> : null)
}

const S: Record<string, CSSProperties> = {
  root: { minHeight: '100vh', background: '#0b1220', color: '#e8ecf4' },
  bar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', background: '#14261f', position: 'sticky', top: 0, zIndex: 20 },
  brand: { fontSize: 20, color: '#fff' },
  badge: { fontSize: 12, background: '#e07a52', color: '#14261f', borderRadius: 999, padding: '2px 10px', marginInlineStart: 8, fontWeight: 800 },
  right: { display: 'flex', alignItems: 'center', gap: 6 },
  lang: { background: 'transparent', border: '1px solid #3a5a4c', color: '#cfe0d8', borderRadius: 8, padding: '4px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 700 },
  langOn: { background: '#e07a52', borderColor: '#e07a52', color: '#14261f' },
  out: { background: '#fff', color: '#14261f', border: 0, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontWeight: 700 },
  nav: { display: 'flex', gap: 6, overflowX: 'auto', padding: '10px 16px', background: '#101b2e', borderBottom: '1px solid #1f2d46', position: 'sticky', top: 56, zIndex: 19 },
  link: { whiteSpace: 'nowrap', textDecoration: 'none', color: '#b8c4da', padding: '8px 12px', borderRadius: 10, fontSize: 14, fontWeight: 600 },
  linkOn: { background: '#e07a52', color: '#14261f' },
  loading: { padding: 24, textAlign: 'center', color: '#8fa0bd' },
}
