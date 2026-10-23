import { pick, type Lang } from '../../engines/language/languageEngine'
import { GRID_SPECS } from '../../shared/listing/gridSpec'

// "Has it" choices (match several stored options): most guests only need the thing to exist.
const HAS_OPTIONS: Record<string, { id: string; label: [string, string, string] }> = {
  connectivity: { id: 'has', label: ['يوجد إنترنت (أي نوع)', 'Has internet (any)', 'Internet disponible (tout type)'] },
  waterSystem: { id: 'hasTank', label: ['يوجد خزان مياه', 'Has a water tank', 'Avec réservoir d’eau'] },
  powerSource: { id: 'backup', label: ['كهرباء بديلة (شمسية/مولد)', 'Has backup power (solar/generator)', 'Électricité de secours (solaire/groupe)'] },
}

// Optional "power / water / internet" filters for stays. Only listings whose host filled the field
// can match, so choosing one narrows results to hosts who published that fact.
export function GridSpecFilters({ lang, value, onChange }: { lang: Lang; value: Record<string, string>; onChange: (next: Record<string, string>) => void }) {
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '10px 0', alignItems: 'center' }} aria-label="grid-spec-filters">
      {GRID_SPECS.map((spec) => (
        <label key={spec.key} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, maxWidth: '100%', flexWrap: 'wrap' }}>
          <span>{spec.icon} {pick(lang, ...spec.title)}</span>
          <select
            // Matches the dark search card (was the browser's default white box). colorScheme makes
            // the open list dark too on browsers that support it.
            style={{ minHeight: 40, maxWidth: '100%', padding: '6px 10px', borderRadius: 10, border: '1px solid #33415c', background: '#0f1526', color: '#eef1f8', colorScheme: 'dark', fontSize: 14 }}
            value={value[spec.key] || ''}
            onChange={(event) => {
              const next = { ...value }
              if (event.target.value) next[spec.key] = event.target.value
              else delete next[spec.key]
              onChange(next)
            }}
          >
            <option value="">{pick(lang, 'أي', 'Any', 'Tous')}</option>
            {HAS_OPTIONS[spec.key] && <option value={HAS_OPTIONS[spec.key].id}>{pick(lang, ...HAS_OPTIONS[spec.key].label)}</option>}
            {spec.options.map((o) => <option key={o.id} value={o.id}>{pick(lang, ...o.label)}</option>)}
          </select>
        </label>
      ))}
    </div>
  )
}
