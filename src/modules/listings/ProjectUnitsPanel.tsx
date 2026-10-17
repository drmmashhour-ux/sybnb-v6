import { useEffect, useState } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { fetchProjectUnits, type ProjectUnit } from '../../shared/api/platformApi'
import { moneyText } from '../../shared/i18n/display'

// Buyer view of a project: its available units with floor, view, size and price.
export function ProjectUnitsPanel({ projectId, lang }: { projectId: string; lang: Lang }) {
  const [units, setUnits] = useState<ProjectUnit[]>([])
  useEffect(() => {
    let off = false
    fetchProjectUnits(projectId).then((u) => { if (!off) setUnits(u) }).catch(() => { if (!off) setUnits([]) })
    return () => { off = true }
  }, [projectId])
  if (!units.length) return null
  return (
    <section aria-label="project-units" style={{ margin: '16px 0' }}>
      <h3>{pick(lang, `الوحدات المتاحة (${units.length})`, `Available units (${units.length})`, `Unités disponibles (${units.length})`)}</h3>
      <div style={{ display: 'grid', gap: 8 }}>
        {units.map((u) => (
          <button key={u.id} type="button" onClick={() => { window.location.hash = `/listing/${u.id}` }}
            style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 10, border: '1px solid #d6deee', borderRadius: 10, background: '#fff', cursor: 'pointer', textAlign: 'start' }}>
            <strong style={{ minWidth: 48 }}>{u.label}</strong>
            <span style={{ flex: 1, fontSize: 13, color: '#52607a' }}>
              {[u.floor != null ? pick(lang, `طابق ${u.floor}`, `Floor ${u.floor}`, `Étage ${u.floor}`) : '', u.bedrooms != null ? pick(lang, `${u.bedrooms} غرف`, `${u.bedrooms} bd`, `${u.bedrooms} ch.`) : '', u.sizeSqm ? `${u.sizeSqm} m²` : '', u.view || ''].filter(Boolean).join(' · ')}
            </span>
            <strong>{moneyText(u.priceMinor, u.currency, lang)}</strong>
          </button>
        ))}
      </div>
    </section>
  )
}
