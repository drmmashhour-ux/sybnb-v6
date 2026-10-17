import { pick, type Lang } from '../../engines/language/languageEngine'

// "Syria grid-spec": the three infrastructure facts a guest needs before booking a stay, stored by
// the host in listing.metadata.visualFilters.{powerSource,waterSystem,connectivity}. Optional: a
// listing without them simply shows no row (nothing is inferred).
type Tri = [ar: string, en: string, fr: string]
type Spec = { key: 'powerSource' | 'waterSystem' | 'connectivity'; icon: string; title: Tri; options: Array<{ id: string; label: Tri }> }

export const GRID_SPECS: Spec[] = [
  {
    key: 'powerSource', icon: '🔋', title: ['مصدر الكهرباء', 'Power source', 'Source d’électricité'],
    options: [
      { id: 'solar', label: ['طاقة شمسية', 'Solar', 'Solaire'] },
      { id: 'grid', label: ['الشبكة العامة فقط', 'Main grid only', 'Réseau public seulement'] },
      { id: 'generator', label: ['مولد مشترك', 'Shared generator', 'Générateur partagé'] },
      { id: 'mixed', label: ['شمسية + شبكة/مولد', 'Solar + grid/generator', 'Solaire + réseau/générateur'] },
    ],
  },
  {
    key: 'waterSystem', icon: '💧', title: ['نظام المياه', 'Water system', 'Eau'],
    options: [
      { id: 'tank', label: ['خزان آلي', 'Automated tank', 'Réservoir automatique'] },
      { id: 'city', label: ['مياه المدينة بجدول', 'Scheduled city water', 'Eau de ville (horaires)'] },
      { id: 'both', label: ['خزان + مياه المدينة', 'Tank + city water', 'Réservoir + eau de ville'] },
    ],
  },
  {
    key: 'connectivity', icon: '🌐', title: ['الإنترنت', 'Connectivity', 'Connexion'],
    options: [
      { id: 'fiber', label: ['ألياف ضوئية', 'Fiber', 'Fibre'] },
      { id: 'router4g', label: ['راوتر 4G متوفر', '4G router included', 'Routeur 4G inclus'] },
      { id: 'none', label: ['لا يوجد إنترنت', 'No web', 'Pas d’internet'] },
    ],
  },
]

export function gridSpecLabel(spec: Spec, id: string, lang: Lang) {
  const option = spec.options.find((o) => o.id === id)
  return option ? pick(lang, ...option.label) : ''
}
