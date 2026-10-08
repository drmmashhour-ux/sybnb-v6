import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { becomeHost, getStoredGuestSession } from '../../shared/api/platformApi'

// Airbnb-style "Become a host": a signed-in customer turns on hosting for the SAME account with one
// tap. No second account, no second sign-in. After it succeeds the app re-renders and the host area
// (returnPath, e.g. /host/stays) opens with the existing session.

type Props = { lang: Lang; returnPath: string }

const copy = {
  ar: {
    title: 'استضف على SYBNB',
    body: 'حسابك نفسه يصلح للحجز وللاستضافة. فعّل الاستضافة لتنشر إعلانك وتستقبل طلبات الحجز.',
    points: ['أضف إعلانك بالصور والسعر', 'استقبل الطلبات وأكّدها أو ارفضها', 'تابع أرباحك من لوحة المضيف'],
    signedInAs: 'مسجّل الدخول باسم',
    cta: 'ابدأ الاستضافة',
    back: 'العودة إلى الحجز',
    error: 'تعذّر تفعيل الاستضافة. حاول مرة أخرى.',
  },
  en: {
    title: 'Host on SYBNB',
    body: 'Your same account works for booking and hosting. Turn on hosting to publish your listing and receive booking requests.',
    points: ['Add your listing with photos and price', 'Receive requests and accept or decline them', 'Track your earnings from the host dashboard'],
    signedInAs: 'Signed in as',
    cta: 'Start hosting',
    back: 'Back to booking',
    error: 'Could not turn on hosting. Please try again.',
  },
}

export function BecomeHostPage({ lang, returnPath }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const session = getStoredGuestSession()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function start() {
    setBusy(true)
    setError('')
    try {
      await becomeHost()
      // Airbnb-style next step: build the host profile first, then land where they were heading.
      try {
        sessionStorage.setItem('sybnb.v6.hostProfileNext', returnPath)
      } catch {
        /* ignore */
      }
      window.location.hash = '/host/profile'
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t.error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <section style={styles.card}>
        <h1 style={styles.title}>{t.title}</h1>
        <p style={styles.body}>{t.body}</p>
        <ul style={styles.list}>
          {t.points.map((point) => (
            <li key={point} style={styles.item}>✓ {point}</li>
          ))}
        </ul>
        {session?.user ? (
          <p style={styles.signedIn}>
            {t.signedInAs} <strong dir="ltr">{session.user.email}</strong>
          </p>
        ) : null}
        {error ? <strong role="alert" style={styles.error}>{error}</strong> : null}
        <button style={{ ...styles.primary, opacity: busy ? 0.7 : 1 }} onClick={() => void start()} disabled={busy}>
          {busy ? '…' : t.cta}
        </button>
        <button style={styles.link} onClick={() => (window.location.hash = '/stays')}>
          {t.back}
        </button>
      </section>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: 'calc(100vh - 160px)', background: '#08090e', color: '#fff', padding: '24px 16px 90px', display: 'grid', alignContent: 'start', justifyItems: 'center' },
  card: { width: '100%', maxWidth: 520, border: '1px solid #232638', borderRadius: 16, background: '#0e0f16', padding: 28, display: 'grid', gap: 16 },
  title: { margin: 0, fontSize: 26, fontWeight: 900 },
  body: { margin: 0, color: '#aab3c8', lineHeight: 1.7 },
  list: { margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 10 },
  item: { color: '#dce3ff', fontWeight: 700 },
  signedIn: { margin: 0, color: '#9aa6ba', fontSize: 14 },
  error: { color: '#ff8f9f' },
  primary: { minHeight: 54, border: 0, borderRadius: 10, background: '#5268ff', color: '#fff', fontWeight: 900, fontSize: 16, cursor: 'pointer' },
  link: { justifySelf: 'center', border: 0, background: 'transparent', color: '#9fb0ff', fontWeight: 800, textDecoration: 'underline', cursor: 'pointer' },
}
