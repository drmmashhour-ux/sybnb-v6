import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { PROXIMITY_TAGS, readProximity } from '../../shared/listing/proximityTags'

type Props = { metadata: Record<string, unknown> | null | undefined; lang: Lang }

// "What's nearby" chips on the listing detail page (reads metadata.proximity). Renders nothing when
// the seller selected none, so it never shows an empty section.
export function NearbyTags({ metadata, lang }: Props) {
  const isAr = lang === 'ar'
  const keys = readProximity((metadata || {}).proximity)
  if (!keys.length) return null
  const tags = PROXIMITY_TAGS.filter((t) => keys.includes(t.key))
  return (
    <section style={styles.wrap} dir={isAr ? 'rtl' : 'ltr'} aria-label={pick(lang, 'ما حولك', 'What’s nearby', 'À proximité')}>
      <strong style={styles.title}>{pick(lang, 'ما حولك', 'What’s nearby', 'À proximité')}</strong>
      <div style={styles.chips}>
        {tags.map((t) => (
          <span key={t.key} style={styles.chip}>
            <span aria-hidden="true">{t.icon}</span>
            <span>{pick(lang, t.ar, t.en, t.fr)}</span>
          </span>
        ))}
      </div>
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { marginTop: 16, display: 'grid', gap: 10 },
  title: { fontSize: 16, color: '#0b1b3b' },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  chip: { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#f1f5f9', borderRadius: 999, padding: '6px 12px', fontSize: 13, color: '#334155' },
}
