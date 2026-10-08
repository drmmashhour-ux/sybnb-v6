import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { getInitialLanguage } from '../engines/language/languageEngine'

// Top-level React error boundary. Without one, any render error in a lazy-loaded page would unmount
// the whole tree and leave a blank screen for the user. This catches it, shows a minimal bilingual
// recovery screen, and offers a reload — no app behavior changes on the happy path.
type Props = { children: ReactNode }
type State = { hasError: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log for diagnostics; do not expose internals to the user.
    // eslint-disable-next-line no-console
    console.error('[sybnb] render error', error?.message, info?.componentStack)
  }

  render() {
    if (!this.state.hasError) return this.props.children
    let lang: 'ar' | 'en' | 'fr' = 'ar'
    try {
      lang = getInitialLanguage()
    } catch {
      /* default ar */
    }
    const t = {
      ar: { title: 'حدث خطأ غير متوقع', body: 'نعتذر، حدث خلل في هذه الصفحة. أعد التحميل أو عُد إلى الرئيسية.', reload: 'إعادة التحميل', home: 'الصفحة الرئيسية' },
      en: { title: 'Something went wrong', body: 'Sorry, this page hit a problem. Reload it or go back home.', reload: 'Reload', home: 'Home page' },
      fr: { title: 'Une erreur est survenue', body: 'Désolé, cette page a rencontré un problème. Rechargez-la ou revenez à l’accueil.', reload: 'Recharger', home: 'Accueil' },
    }[lang]
    return (
      <main
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
        style={{
          minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24,
          background: '#0b0f1a', color: '#e8ecf4', fontFamily: 'system-ui, sans-serif', textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: 420, display: 'grid', gap: 12 }}>
          <strong style={{ fontSize: 20 }}>{t.title}</strong>
          <span style={{ opacity: 0.8 }}>{t.body}</span>
          <button
            onClick={() => window.location.reload()}
            style={{
              minHeight: 44, border: 0, borderRadius: 8, background: '#526cff', color: '#fff',
              fontWeight: 800, padding: '0 18px', cursor: 'pointer',
            }}
          >
            {t.reload}
          </button>
          <button
            onClick={() => {
              window.location.hash = '/'
              window.location.reload()
            }}
            style={{ minHeight: 40, border: '1px solid #2a3150', borderRadius: 8, background: 'transparent', color: '#cfd7ff', fontWeight: 700, cursor: 'pointer' }}
          >
            {t.home}
          </button>
          <a href="mailto:support@sybnb.app" style={{ color: '#8fa2ff', fontSize: 13 }}>support@sybnb.app</a>
        </div>
      </main>
    )
  }
}
