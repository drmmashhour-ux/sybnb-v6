import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { SUPPORT_EMAIL, SUPPORT_WHATSAPP_LOCAL } from '../../shared/support/contactChannels'
import { LEGAL_DOCS, LEGAL_META, legalText, type LegalDocKey } from './legalContent'

type Props = {
  lang: Lang
  page: LegalDocKey
}

export function LegalDocumentPage({ lang, page }: Props) {
  const isAr = lang === 'ar'
  const doc = LEGAL_DOCS[page]

  const t = {
    effective: pick(lang, 'ساري اعتباراً من', 'Effective', 'En vigueur le'),
    version: pick(lang, 'الإصدار', 'Version', 'Version'),
    other: pick(lang, 'مستندات قانونية أخرى', 'Other legal documents', 'Autres documents juridiques'),
    contact: pick(
      lang,
      `لأي استفسار حول هذا المستند، تواصل معنا عبر البريد ${SUPPORT_EMAIL} أو واتساب ${SUPPORT_WHATSAPP_LOCAL}.`,
      `For any question about this document, reach us by email at ${SUPPORT_EMAIL} or WhatsApp ${SUPPORT_WHATSAPP_LOCAL}.`,
      `Pour toute question sur ce document, écrivez-nous à ${SUPPORT_EMAIL} ou sur WhatsApp au ${SUPPORT_WHATSAPP_LOCAL}.`,
    ),
    fmtDate: (() => {
      try {
        return new Date(doc.effectiveDate).toLocaleDateString(isAr ? 'ar' : lang === 'fr' ? 'fr' : 'en', { year: 'numeric', month: 'long', day: 'numeric' })
      } catch {
        return doc.effectiveDate
      }
    })(),
  }

  const others = (Object.keys(LEGAL_META) as LegalDocKey[]).filter((k) => k !== page)

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <article style={styles.card}>
        <header style={styles.header}>
          <h1 style={styles.title}>{legalText(doc.title, lang)}</h1>
          <div style={styles.meta}>
            <span>{t.version} {doc.version}</span>
            <span style={styles.dot}>·</span>
            <span>{t.effective} {t.fmtDate}</span>
          </div>
        </header>

        {doc.intro.map((p, i) => (
          <p key={`intro-${i}`} style={styles.intro}>{legalText(p, lang)}</p>
        ))}

        {doc.sections.map((section) => (
          <section key={section.id} style={styles.section}>
            <h2 style={styles.h2}>{legalText(section.title, lang)}</h2>
            {section.body.map((p, i) => (
              <p key={`${section.id}-${i}`} style={styles.body}>{legalText(p, lang)}</p>
            ))}
          </section>
        ))}

        <p style={styles.contact}>{t.contact}</p>

        <footer style={styles.footer}>
          <span style={styles.footerLabel}>{t.other}:</span>
          {others.map((k) => (
            <button key={k} style={styles.link} onClick={() => (window.location.hash = LEGAL_META[k].path)}>
              {legalText(LEGAL_META[k].title, lang)}
            </button>
          ))}
        </footer>
      </article>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    display: 'flex',
    justifyContent: 'center',
    padding: '48px 16px 96px',
    background: 'radial-gradient(1000px 480px at 50% -10%, rgba(91,116,255,.12), transparent 60%), #070b16',
    minHeight: '100vh',
  },
  card: {
    background: 'linear-gradient(180deg,#111b2e,#0c1322)',
    border: '1px solid rgba(130,150,200,.14)',
    borderRadius: 18,
    boxShadow: '0 1px 0 rgba(255,255,255,.05) inset, 0 18px 40px -22px rgba(0,0,0,.8)',
    maxWidth: 760,
    padding: '36px 34px',
    width: '100%',
    color: '#e9edf8',
  },
  header: { marginBottom: 22, borderBottom: '1px solid rgba(130,150,200,.14)', paddingBottom: 18 },
  title: { color: '#fff', fontSize: 28, fontWeight: 900, margin: '0 0 10px', letterSpacing: '-.01em', lineHeight: 1.15 },
  meta: { color: '#6c7b96', fontSize: 12.5, fontWeight: 700, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  dot: { color: '#3a4763' },
  intro: { color: '#9aa7bd', fontSize: 15, lineHeight: 1.75, margin: '0 0 16px' },
  section: { margin: '0 0 22px' },
  h2: { color: '#cdd6ff', fontSize: 16.5, fontWeight: 800, margin: '0 0 8px' },
  body: { color: '#c3ccdd', fontSize: 14.5, lineHeight: 1.8, margin: '0 0 10px' },
  contact: { color: '#9aa7bd', fontSize: 13.5, lineHeight: 1.7, margin: '24px 0 0', paddingTop: 18, borderTop: '1px solid rgba(130,150,200,.14)' },
  footer: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 20 },
  footerLabel: { color: '#6c7b96', fontSize: 13, fontWeight: 700 },
  link: { background: 'transparent', border: 0, color: '#7d90ff', fontWeight: 800, fontSize: 13.5, cursor: 'pointer', padding: 0, textDecoration: 'underline' },
}

export default LegalDocumentPage
