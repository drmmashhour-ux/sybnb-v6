import type { CSSProperties } from 'react'
import type { Lang } from '@platform/engines/language/languageEngine'

type SearchStatesProps = {
  lang: Lang
  state: 'empty' | 'error'
  onReset?: () => void
  onShowAll?: () => void
  onRetry?: () => void
}

const T = {
  ar: {
    emptyTitle: 'لا توجد نتائج مطابقة',
    emptyBody: 'جرّب تغيير المنطقة أو تعديل بعض الخيارات.',
    errorTitle: 'تعذر إكمال البحث',
    errorBody: 'الاتصال غير مستقر. حاول مرة أخرى.',
    reset: 'إعادة ضبط',
    allSyria: 'عرض كل سوريا',
    retry: 'إعادة المحاولة',
  },
  en: {
    emptyTitle: 'No matching places',
    emptyBody: 'Try changing the area or removing some filters.',
    errorTitle: 'Search could not finish',
    errorBody: 'Connection is unstable. Please try again.',
    reset: 'Reset',
    allSyria: 'Show all Syria',
    retry: 'Try again',
  },
  fr: {
    emptyTitle: 'Aucun logement correspondant',
    emptyBody: 'Essayez de changer de zone ou de retirer certains filtres.',
    errorTitle: 'La recherche n’a pas pu aboutir',
    errorBody: 'La connexion est instable. Réessayez.',
    reset: 'Réinitialiser',
    allSyria: 'Afficher toute la Syrie',
    retry: 'Réessayer',
  },
}

// Empty / error card for the results area (Airbnb-style: plain, centred, one clear action).
export function SearchStateCard({ lang, state, onReset, onShowAll, onRetry }: SearchStatesProps) {
  const t = T[lang]
  const copy = state === 'error' ? { title: t.errorTitle, body: t.errorBody } : { title: t.emptyTitle, body: t.emptyBody }
  return (
    <section style={styles.card} role={state === 'error' ? 'alert' : 'status'}>
      <h3 style={styles.title}>{copy.title}</h3>
      <p style={styles.body}>{copy.body}</p>
      <div style={styles.actions}>
        {state === 'error' ? <button type="button" style={styles.primary} onClick={onRetry}>{t.retry}</button> : null}
        <button type="button" style={state === 'error' ? styles.secondary : styles.primary} onClick={onShowAll}>{t.allSyria}</button>
        <button type="button" style={styles.secondary} onClick={onReset}>{t.reset}</button>
      </div>
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  card: { border: '1px solid #ebebeb', borderRadius: 16, background: '#fff', padding: '28px 18px', textAlign: 'center', display: 'grid', gap: 6, justifyItems: 'center' },
  title: { margin: 0, color: '#222', fontSize: 20 },
  body: { color: '#717171', margin: '4px auto 14px', maxWidth: 440 },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  primary: { minHeight: 46, border: 0, borderRadius: 12, background: '#2457f5', color: '#fff', fontWeight: 700, padding: '0 20px' },
  secondary: { minHeight: 46, border: '1px solid #222', borderRadius: 12, background: '#fff', color: '#222', fontWeight: 700, padding: '0 20px' },
}
