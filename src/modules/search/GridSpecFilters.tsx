import { pick, type Lang } from '../../engines/language/languageEngine'
import { GRID_SPECS } from '../../shared/listing/gridSpec'

// Optional "power / water / internet" filters for stays. Only listings whose host filled the field
// can match, so choosing one narrows results to hosts who published that fact.
export function GridSpecFilters({ lang, value, onChange }: { lang: Lang; value: Record<string, string>; onChange: (next: Record<string, string>) => void }) {
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '10px 0', alignItems: 'center' }} aria-label="grid-spec-filters">
      {GRID_SPECS.map((spec) => (
        <label key={spec.key} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
          <span>{spec.icon} {pick(lang, ...spec.title)}</span>
          <select
            value={value[spec.key] || ''}
            onChange={(event) => {
              const next = { ...value }
              if (event.target.value) next[spec.key] = event.target.value
              else delete next[spec.key]
              onChange(next)
            }}
          >
            <option value="">{pick(lang, 'أي', 'Any', 'Tous')}</option>
            {spec.options.map((o) => <option key={o.id} value={o.id}>{pick(lang, ...o.label)}</option>)}
          </select>
        </label>
      ))}
    </div>
  )
}
