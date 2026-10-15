import { Suspense, lazy, useEffect, useState, type CSSProperties } from 'react'
import { getCurrentPath, navigate } from '@platform/app/routes'
import { getInitialLanguage, persistLanguage, pick, type Lang } from '@platform/engines/language/languageEngine'
import { getStoredGuestSession, signOutGuest } from '@platform/shared/api/platformApi'

// Same shell discipline as apps/sr: heavy pages load on demand for weak connections.
const GuestAccountPage = lazy(() =>
  import('@platform/modules/account/GuestAccountPage').then((m) => ({ default: m.GuestAccountPage })),
)
const LegalDocumentPage = lazy(() =>
  import('@platform/modules/legal/LegalDocumentPage').then((m) => ({ default: m.LegalDocumentPage })),
)
const EatsPage = lazy(() => import('./pages/EatsPage').then((m) => ({ default: m.EatsPage })))
const MyOrdersPage = lazy(() => import('./pages/MyOrdersPage').then((m) => ({ default: m.MyOrdersPage })))

const RETURN_PATH_KEY = 'sybnb.v6.guestReturnPath'
const LANGS: Lang[] = ['ar', 'en', 'fr']

export function App() {
  const [lang, setLang] = useState<Lang>(() => getInitialLanguage())
  const [path, setPath] = useState(() => getCurrentPath())
  const [, setAuthVersion] = useState(0)

  useEffect(() => {
    persistLanguage(lang)
  }, [lang])

  useEffect(() => {
    const sync = () => setPath(getCurrentPath())
    const syncAuth = () => setAuthVersion((version) => version + 1)
    window.addEventListener('hashchange', sync)
    window.addEventListener('sybnb-session-changed', syncAuth)
    return () => {
      window.removeEventListener('hashchange', sync)
      window.removeEventListener('sybnb-session-changed', syncAuth)
    }
  }, [])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [path])

  const isAr = lang === 'ar'
  const hasGuestSession = Boolean(getStoredGuestSession())
  const isEatsRoute = path === '/' || path === '/eats'
  const isOrdersRoute = path === '/orders'
  const isAccountRoute = /^\/account\/open(?:\/[^/]+)?$/.test(path)
  const needsGate = (isEatsRoute || isOrdersRoute) && !hasGuestSession

  if (needsGate) {
    try {
      sessionStorage.setItem(RETURN_PATH_KEY, path)
    } catch {
      /* storage blocked: sign-in just returns to the default route */
    }
  }

  async function handleSignOut() {
    const { serverRevoked } = await signOutGuest()
    if (!serverRevoked) {
      window.alert(
        pick(
          lang,
          'تم تسجيل الخروج من هذا الجهاز، لكن تعذّر الوصول إلى الخادم لإنهاء الجلسة. أعد المحاولة عند عودة الاتصال.',
          'Signed out on this device, but the server could not be reached to end the session. Try again once you are back online.',
          'Déconnecté sur cet appareil, mais le serveur est injoignable pour fermer la session. Réessayez une fois en ligne.',
        ),
      )
    }
    navigate('/')
  }

  let content
  if (needsGate || isAccountRoute) {
    content = <GuestAccountPage lang={lang} flow="generic" returnPath={needsGate ? path : '/'} />
  } else if (isOrdersRoute) {
    content = <MyOrdersPage lang={lang} />
  } else if (path === '/terms') {
    content = <LegalDocumentPage lang={lang} page="terms" />
  } else if (path === '/privacy') {
    content = <LegalDocumentPage lang={lang} page="privacy" />
  } else {
    content = <EatsPage lang={lang} />
  }

  return (
    <div dir={isAr ? 'rtl' : 'ltr'} style={styles.shell}>
      <header style={styles.bar}>
        <div style={styles.barInner}>
          <a href="#/" style={styles.wordmark}>
            SYBNB <span style={styles.wordmarkAccent}>{pick(lang, 'طعام', 'Eats', 'Eats')}</span>
          </a>
          <div style={styles.barRight}>
            <div role="group" aria-label="Language" style={styles.langGroup}>
              {LANGS.map((code) => (
                <button
                  key={code}
                  type="button"
                  aria-pressed={code === lang}
                  style={code === lang ? { ...styles.langBtn, ...styles.langBtnActive } : styles.langBtn}
                  onClick={() => setLang(code)}
                >
                  {code.toUpperCase()}
                </button>
              ))}
            </div>
            {hasGuestSession ? (
              <>
                <a href="#/orders" style={styles.barLink}>{pick(lang, 'طلباتي', 'Orders', 'Commandes')}</a>
                <button type="button" style={styles.barButton} onClick={() => void handleSignOut()}>
                  {pick(lang, 'خروج', 'Sign out', 'Quitter')}
                </button>
              </>
            ) : (
              <a href="#/account/open" style={styles.barLink}>{pick(lang, 'دخول', 'Sign in', 'Connexion')}</a>
            )}
          </div>
        </div>
      </header>
      <Suspense fallback={<div style={styles.loading}><span style={styles.skeleton} /><span style={{ ...styles.skeleton, width: '45%' }} /></div>}>
        {content}
      </Suspense>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  shell: { minHeight: '100vh', background: '#fff', color: '#000' },
  bar: { position: 'sticky', top: 0, zIndex: 30, background: '#166534', color: '#fff' },
  barInner: { maxWidth: 520, margin: '0 auto', minHeight: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '0 16px' },
  wordmark: { color: '#fff', fontWeight: 800, fontSize: 20, letterSpacing: 1, textDecoration: 'none' },
  wordmarkAccent: { color: '#bbf7d0', fontWeight: 700 },
  barRight: { display: 'flex', alignItems: 'center', gap: 8 },
  langGroup: { display: 'flex', gap: 2 },
  langBtn: { minHeight: 32, minWidth: 32, border: 0, borderRadius: 999, background: 'transparent', color: '#cde9d6', fontSize: 12, fontWeight: 700, padding: '0 8px' },
  langBtnActive: { background: '#fff', color: '#166534' },
  barLink: { color: '#fff', fontSize: 13, fontWeight: 700, textDecoration: 'none', padding: '0 6px' },
  barButton: { minHeight: 32, border: 0, borderRadius: 999, background: '#fff', color: '#166534', fontSize: 12, fontWeight: 700, padding: '0 12px' },
  loading: { maxWidth: 520, margin: '0 auto', padding: 16, display: 'grid', gap: 12 },
  skeleton: { display: 'block', height: 28, width: '80%', borderRadius: 8, background: '#eee' },
}
