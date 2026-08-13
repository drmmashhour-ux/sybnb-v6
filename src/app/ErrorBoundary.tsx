import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

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
    return (
      <main
        dir="rtl"
        style={{
          minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24,
          background: '#0b0f1a', color: '#e8ecf4', fontFamily: 'system-ui, sans-serif', textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: 420, display: 'grid', gap: 12 }}>
          <strong style={{ fontSize: 20 }}>حدث خطأ غير متوقع</strong>
          <span style={{ opacity: 0.8 }}>Something went wrong. Please reload the page.</span>
          <button
            onClick={() => window.location.reload()}
            style={{
              minHeight: 44, border: 0, borderRadius: 8, background: '#526cff', color: '#fff',
              fontWeight: 800, padding: '0 18px', cursor: 'pointer',
            }}
          >
            إعادة التحميل · Reload
          </button>
          <a href="mailto:support@sybnb.app" style={{ color: '#8fa2ff', fontSize: 13 }}>support@sybnb.app</a>
        </div>
      </main>
    )
  }
}
