import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'

type Props = { lang: Lang; path: string }

const copy = {
  ar: {
    code: '٤٠٤',
    title: 'الصفحة غير موجودة',
    body: 'الرابط الذي فتحته غير صحيح أو تم نقله. يمكنك العودة إلى الرئيسية أو تصفح الإقامات.',
    home: 'الصفحة الرئيسية',
    browse: 'تصفح الإقامات',
  },
  en: {
    code: '404',
    title: 'Page not found',
    body: 'The link you opened is incorrect or has moved. Return home or browse stays.',
    home: 'Home',
    browse: 'Browse stays',
  },
}

// Proper not-found experience for unmatched routes — replaces silently rendering Home under a wrong
// URL, which disoriented users. Read-only, no data or business logic.
export function NotFoundPage({ lang, path }: Props) {
  const isAr = lang === 'ar'
  const t = copy[lang]
  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <section style={styles.card}>
        <span style={styles.code}>{t.code}</span>
        <h1 style={styles.title}>{t.title}</h1>
        <p style={styles.body}>{t.body}</p>
        <code style={styles.path} dir="ltr">{path}</code>
        <div style={styles.actions}>
          <button style={styles.primary} onClick={() => (window.location.hash = '/')}>{t.home}</button>
          <button style={styles.secondary} onClick={() => (window.location.hash = '/stays')}>{t.browse}</button>
        </div>
      </section>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '70vh', display: 'grid', placeItems: 'center', padding: 24, color: '#fff' },
  card: { width: 'min(560px, 100%)', border: '1px solid #27324d', borderRadius: 18, background: '#101522', padding: 32, textAlign: 'center' },
  code: { fontSize: 44, fontWeight: 950, color: '#6f86ff', letterSpacing: 1 },
  title: { margin: '10px 0 8px', fontSize: 26 },
  body: { color: '#aab4ca', lineHeight: 1.8, margin: '0 0 14px' },
  path: { display: 'inline-block', maxWidth: '100%', overflowWrap: 'anywhere', color: '#8b95ad', background: '#0b1120', border: '1px solid #27324d', borderRadius: 8, padding: '6px 10px', marginBottom: 20, fontSize: 13 },
  actions: { display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' },
  primary: { minHeight: 48, border: 0, borderRadius: 10, background: '#5268ff', color: '#fff', fontWeight: 900, padding: '0 20px', cursor: 'pointer' },
  secondary: { minHeight: 48, border: '1px solid #27324d', borderRadius: 10, background: 'transparent', color: '#fff', fontWeight: 800, padding: '0 20px', cursor: 'pointer' },
}
