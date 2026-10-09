import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { pick } from '../../engines/language/languageEngine'
import { SYRIA_GOVERNORATES } from '../../engines/search'
import { navigate } from '../../app/routes'

// Airbnb-style search right on the home page: pick what you want, where, then search. It hands the
// choice to the division page through the same session drafts those pages already restore from,
// so the results open already filtered by the chosen governorate.

type Kind = 'stays' | 'rentals' | 'buy' | 'cars' | 'marketplace'

const KINDS: { id: Kind; route: string; ar: string; en: string; fr: string }[] = [
  { id: 'stays', route: '/stays', ar: 'إيجار يومي', en: 'Stays', fr: 'Séjours' },
  { id: 'rentals', route: '/rentals', ar: 'إيجار شهري', en: 'Monthly', fr: 'Au mois' },
  { id: 'buy', route: '/buy', ar: 'شراء عقار', en: 'Buy', fr: 'Acheter' },
  { id: 'cars', route: '/cars', ar: 'سيارات', en: 'Cars', fr: 'Véhicules' },
  { id: 'marketplace', route: '/marketplace', ar: 'السوق', en: 'Market', fr: 'Marché' },
]

// French names for governorates (the geo data only carries ar/en).
const GOV_FR: Record<string, string> = {
  damascus: 'Damas',
  'rif-dimashq': 'Rif Dimachq',
  aleppo: 'Alep',
  homs: 'Homs',
  hama: 'Hama',
  latakia: 'Lattaquié',
  tartus: 'Tartous',
  idlib: 'Idleb',
  daraa: 'Deraa',
  sweida: 'Soueïda',
  'deir-ezzor': 'Deir ez-Zor',
  raqqa: 'Raqqa',
  hasakah: 'Hassaké',
  quneitra: 'Kuneitra',
}

function governorateName(lang: Lang, gov: { key: string; ar: string; en: string }) {
  if (lang === 'ar') return gov.ar
  if (lang === 'fr') return GOV_FR[gov.key] || gov.en
  return gov.en
}

function save(key: string, value: unknown) {
  try {
    const previous = JSON.parse(sessionStorage.getItem(key) || '{}')
    sessionStorage.setItem(key, JSON.stringify({ ...previous, ...(value as object) }))
  } catch {
    /* storage blocked: the page still opens, just unfiltered */
  }
}

export function HeroSearch({ lang }: { lang: Lang }) {
  const [kind, setKind] = useState<Kind>('stays')
  const [governorate, setGovernorate] = useState('')
  const isAr = lang === 'ar'

  function search() {
    const target = KINDS.find((item) => item.id === kind) ?? KINDS[0]
    if (kind === 'rentals' || kind === 'buy') {
      save('sybnb-v6-property-search-geo', { governorate, city: '', street: '', locationApplied: Boolean(governorate) })
    } else {
      save('sybnb-v6-search-draft', { division: kind, governorate, city: '', area: '', locationTouched: Boolean(governorate) })
    }
    navigate(target.route)
  }

  return (
    <form
      dir={isAr ? 'rtl' : 'ltr'}
      style={styles.box}
      onSubmit={(event) => {
        event.preventDefault()
        search()
      }}
      aria-label={pick(lang, 'ابحث في SYBNB', 'Search SYBNB', 'Rechercher sur SYBNB')}
    >
      <div style={styles.kinds} role="tablist">
        {KINDS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={kind === item.id}
            style={{ ...styles.kind, ...(kind === item.id ? styles.kindActive : null) }}
            onClick={() => setKind(item.id)}
          >
            {pick(lang, item.ar, item.en, item.fr)}
          </button>
        ))}
      </div>
      <div style={styles.row}>
        <label style={styles.field}>
          <span style={styles.label}>{pick(lang, 'أين؟', 'Where?', 'Où ?')}</span>
          <select style={styles.select} value={governorate} onChange={(event) => setGovernorate(event.target.value)}>
            <option value="">{pick(lang, 'كل سوريا', 'All of Syria', 'Toute la Syrie')}</option>
            {SYRIA_GOVERNORATES.map((gov) => (
              <option key={gov.key} value={gov.key}>
                {governorateName(lang, gov)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" style={styles.submit}>
          {pick(lang, 'بحث', 'Search', 'Rechercher')}
        </button>
      </div>
    </form>
  )
}

const styles: Record<string, CSSProperties> = {
  box: { width: '100%', maxWidth: 620, display: 'grid', gap: 12, background: '#11131c', border: '1px solid #2a2f45', borderRadius: 18, padding: 14, boxShadow: '0 18px 40px rgba(0,0,0,.35)' },
  kinds: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  kind: { border: '1px solid #2a2f45', background: 'transparent', color: '#aab3c8', borderRadius: 999, padding: '8px 14px', fontWeight: 800, cursor: 'pointer' },
  kindActive: { background: '#5268ff', borderColor: '#5268ff', color: '#fff' },
  row: { display: 'flex', gap: 10, alignItems: 'stretch', flexWrap: 'wrap' },
  field: { flex: '1 1 220px', display: 'grid', gap: 4, background: '#0b0d14', border: '1px solid #2a2f45', borderRadius: 12, padding: '8px 12px' },
  label: { color: '#8d96ad', fontSize: 12, fontWeight: 800 },
  select: { background: 'transparent', border: 0, color: '#fff', fontSize: 16, fontWeight: 800, outline: 'none', width: '100%' },
  submit: { flex: '0 0 auto', minHeight: 56, minWidth: 130, border: 0, borderRadius: 12, background: '#5268ff', color: '#fff', fontWeight: 900, fontSize: 16, cursor: 'pointer' },
}
