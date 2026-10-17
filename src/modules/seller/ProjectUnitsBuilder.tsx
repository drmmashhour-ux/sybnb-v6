import { useMemo, useState } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { createProjectUnits, type HostDashboardMode, type ProjectUnitInput } from '../../shared/api/platformApi'

// Developer tool: describe a building once (floors x units per floor, base price, price step per
// floor) and generate every unit listing in one go instead of creating 40 listings by hand.
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function generateUnits(o: { fromFloor: number; toFloor: number; perFloor: number; basePrice: number; stepPerFloor: number; bedrooms?: number; sizeSqm?: number; view?: string }): ProjectUnitInput[] {
  const out: ProjectUnitInput[] = []
  for (let floor = o.fromFloor; floor <= o.toFloor; floor += 1) {
    for (let i = 0; i < o.perFloor; i += 1) {
      out.push({
        label: `${floor}${LETTERS[i] || i + 1}`,
        floor,
        priceMinor: Math.max(1, Math.round(o.basePrice + (floor - o.fromFloor) * o.stepPerFloor)),
        ...(o.bedrooms ? { bedrooms: o.bedrooms } : {}),
        ...(o.sizeSqm ? { sizeSqm: o.sizeSqm } : {}),
        ...(o.view ? { view: o.view } : {}),
      })
    }
  }
  return out
}

export function ProjectUnitsBuilder({ projectId, lang, mode, onCreated }: { projectId: string; lang: Lang; mode: HostDashboardMode; onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ fromFloor: '1', toFloor: '5', perFloor: '2', basePrice: '', stepPerFloor: '0', bedrooms: '', sizeSqm: '', view: '' })
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((cur) => ({ ...cur, [k]: e.target.value }))

  const units = useMemo(() => {
    const fromFloor = Number(f.fromFloor), toFloor = Number(f.toFloor), perFloor = Number(f.perFloor), basePrice = Number(f.basePrice)
    if (![fromFloor, toFloor, perFloor, basePrice].every(Number.isFinite) || basePrice <= 0 || perFloor < 1 || perFloor > 26 || toFloor < fromFloor) return []
    return generateUnits({ fromFloor, toFloor, perFloor, basePrice, stepPerFloor: Number(f.stepPerFloor) || 0, bedrooms: Number(f.bedrooms) || undefined, sizeSqm: Number(f.sizeSqm) || undefined, view: f.view.trim() || undefined })
  }, [f])

  async function submit() {
    setState('saving'); setMessage('')
    try {
      const res = await createProjectUnits(projectId, units, mode)
      setState('done'); setMessage(pick(lang, `تم إنشاء ${res.created} وحدة وهي بانتظار المراجعة.`, `${res.created} units created and sent for review.`, `${res.created} unités créées et envoyées pour vérification.`))
      onCreated()
    } catch (error) {
      setState('error'); setMessage(error instanceof Error ? error.message : 'Error')
    }
  }

  if (!open) {
    return <button type="button" onClick={() => setOpen(true)}>{pick(lang, '+ إضافة وحدات للمشروع', '+ Add units to this project', '+ Ajouter des unités au projet')}</button>
  }
  const field = (k: keyof typeof f, label: string, type = 'number') => (
    <label style={{ display: 'grid', gap: 2, fontSize: 13 }}>{label}<input type={type} value={f[k]} onChange={set(k)} /></label>
  )
  return (
    <div style={{ display: 'grid', gap: 8, padding: 10, border: '1px solid #c9d3e6', borderRadius: 10 }}>
      <strong>{pick(lang, 'إنشاء وحدات دفعة واحدة', 'Create units in bulk', 'Créer des unités en lot')}</strong>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
        {field('fromFloor', pick(lang, 'من طابق', 'From floor', 'De l’étage'))}
        {field('toFloor', pick(lang, 'إلى طابق', 'To floor', 'À l’étage'))}
        {field('perFloor', pick(lang, 'وحدات لكل طابق', 'Units per floor', 'Unités par étage'))}
        {field('basePrice', pick(lang, 'سعر أول طابق', 'First-floor price', 'Prix du 1er étage'))}
        {field('stepPerFloor', pick(lang, 'زيادة السعر لكل طابق', 'Price step per floor', 'Hausse par étage'))}
        {field('bedrooms', pick(lang, 'غرف النوم', 'Bedrooms', 'Chambres'))}
        {field('sizeSqm', pick(lang, 'المساحة م²', 'Area m²', 'Superficie m²'))}
        {field('view', pick(lang, 'الإطلالة', 'View', 'Vue'), 'text')}
      </div>
      <small>
        {units.length
          ? pick(lang, `سيتم إنشاء ${units.length} وحدة (${units[0].label} … ${units[units.length - 1].label}).`, `Will create ${units.length} units (${units[0].label} … ${units[units.length - 1].label}).`, `Créera ${units.length} unités (${units[0].label} … ${units[units.length - 1].label}).`)
          : pick(lang, 'أدخل الطوابق والسعر.', 'Enter floors and a price.', 'Saisissez les étages et un prix.')}
        {units.length > 100 ? ` ${pick(lang, '(الحد 100 وحدة لكل عملية)', '(max 100 per batch)', '(max 100 par lot)')}` : ''}
      </small>
      {message && <small style={{ color: state === 'error' ? '#b91c1c' : '#166534' }}>{message}</small>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" disabled={!units.length || units.length > 100 || state === 'saving'} onClick={() => void submit()}>
          {state === 'saving' ? pick(lang, 'جارٍ الإنشاء…', 'Creating…', 'Création…') : pick(lang, 'إنشاء الوحدات', 'Create units', 'Créer les unités')}
        </button>
        <button type="button" onClick={() => setOpen(false)}>{pick(lang, 'إغلاق', 'Close', 'Fermer')}</button>
      </div>
    </div>
  )
}
