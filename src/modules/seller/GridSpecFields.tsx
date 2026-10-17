import { pick, type Lang } from '../../engines/language/languageEngine'
import type { VisualFilterSelection } from '../../engines/filters'
import { GRID_SPECS } from '../../shared/listing/gridSpec'

// Three optional dropdowns on the host's listing form. Values go into visualFilters, which the
// wizard already saves into listing.metadata.visualFilters.
export function GridSpecFields({ lang, selection, onChange }: { lang: Lang; selection: VisualFilterSelection; onChange: (next: VisualFilterSelection) => void }) {
  return (
    <fieldset style={{ border: '1px solid #d6deee', borderRadius: 12, padding: 12, margin: '12px 0' }}>
      <legend style={{ fontWeight: 700, padding: '0 6px' }}>
        {pick(lang, 'الكهرباء والمياه والإنترنت (اختياري، لكنه يقلل الخلافات)', 'Power, water & internet (optional, but it prevents disputes)', 'Électricité, eau et internet (facultatif, évite les litiges)')}
      </legend>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        {GRID_SPECS.map((spec) => (
          <label key={spec.key} style={{ display: 'grid', gap: 4, fontSize: 14 }}>
            <span>{spec.icon} {pick(lang, ...spec.title)}</span>
            <select
              value={String(selection[spec.key] || '')}
              onChange={(event) => {
                const next = { ...selection }
                if (event.target.value) next[spec.key] = event.target.value
                else delete next[spec.key]
                onChange(next)
              }}
            >
              <option value="">{pick(lang, 'غير محدد', 'Not specified', 'Non précisé')}</option>
              {spec.options.map((o) => <option key={o.id} value={o.id}>{pick(lang, ...o.label)}</option>)}
            </select>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
