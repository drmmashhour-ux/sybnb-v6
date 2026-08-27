import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'

type SearchStatesProps = {
  lang: Lang
  state: 'loading' | 'empty' | 'error'
  onReset?: () => void
  onShowAll?: () => void
  onRetry?: () => void
}

const T = {
  ar: {
    loadingTitle: 'جاري البحث',
    loadingBody: 'نراجع النتائج المناسبة لك داخل سوريا.',
    emptyTitle: 'لا توجد نتائج مطابقة',
    emptyBody: 'جرّب تغيير المنطقة أو تعديل بعض الخيارات.',
    errorTitle: 'تعذر إكمال البحث',
    errorBody: 'الاتصال غير مستقر. حاول مرة أخرى أو اعرض النتائج المحفوظة.',
    reset: 'إعادة ضبط',
    allSyria: 'عرض كل سوريا',
    retry: 'إعادة المحاولة',
  },
  en: {
    loadingTitle: 'Searching',
    loadingBody: 'We are checking matching results across Syria.',
    emptyTitle: 'No matching results',
    emptyBody: 'Try changing the area or removing some filters.',
    errorTitle: 'Search could not finish',
    errorBody: 'Connection is unstable. Try again or view cached results.',
    reset: 'Reset',
    allSyria: 'Show all Syria',
    retry: 'Try again',
  },
}

export function SearchStateCard({ lang, state, onReset, onShowAll, onRetry }: SearchStatesProps) {
  const t = T[lang]
  const copy = {
    loading: { icon: '⌛', title: t.loadingTitle, body: t.loadingBody, tone: '#4f6cff' },
    empty: { icon: '⌕', title: t.emptyTitle, body: t.emptyBody, tone: '#d5a915' },
    error: { icon: '!', title: t.errorTitle, body: t.errorBody, tone: '#ff5f76' },
  }[state]

  return (
    <section style={{ ...styles.card, border: `1px solid ${copy.tone}55` }}>
      <div style={{ ...styles.icon, background: `${copy.tone}22`, color: copy.tone }}>{copy.icon}</div>
      <h3 style={styles.title}>{copy.title}</h3>
      <p style={styles.body}>{copy.body}</p>
      <div style={styles.actions}>
        <button type="button" style={styles.secondary} onClick={onReset}>{t.reset}</button>
        <button type="button" style={styles.secondary} onClick={onShowAll}>{t.allSyria}</button>
        <button type="button" style={styles.primary} onClick={onRetry}>{t.retry}</button>
      </div>
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  card: { border: '1px solid #30384d', borderRadius: 20, background: '#111118', padding: 18, textAlign: 'center' },
  icon: { width: 52, height: 52, borderRadius: 18, display: 'grid', placeItems: 'center', margin: '0 auto 10px', fontSize: 24, fontWeight: 900 },
  title: { margin: 0, color: '#fff', fontSize: 20 },
  body: { color: '#9aa6ba', margin: '8px auto 16px', maxWidth: 440 },
  actions: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 },
  primary: { minHeight: 48, border: 0, borderRadius: 14, background: '#4f6cff', color: '#fff', fontWeight: 900 },
  secondary: { minHeight: 48, border: '1px solid #30384d', borderRadius: 14, background: '#171b29', color: '#fff', fontWeight: 900 },
}
