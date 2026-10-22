import type { NavStep } from './roadRoute'
import type { LatLng } from './mapTypes'

type L = 'ar' | 'en' | 'fr' | string
const tr = (lang: L, ar: string, en: string, fr: string) => (lang === 'ar' ? ar : lang === 'fr' ? fr : en)

/** Metres between two points (equirectangular; fine for city distances). */
export function metersBetween(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad)
  const y = (b.lat - a.lat) * rad
  return Math.sqrt(x * x + y * y) * 6371000
}

/** Shortest distance (m) from a point to a polyline: used to notice the driver left the route. */
export function distanceToLine(p: LatLng, line: LatLng[]): number {
  let best = Infinity
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]
    const b = line[i + 1]
    const ab = metersBetween(a, b) || 1
    const ap = metersBetween(a, p)
    const bp = metersBetween(b, p)
    // projection via the cosine rule, clamped to the segment
    const t = Math.max(0, Math.min(1, (ap * ap - bp * bp + ab * ab) / (2 * ab * ab)))
    const q = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }
    best = Math.min(best, metersBetween(p, q))
  }
  return best
}

export function formatDistance(m: number, lang: L): string {
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} ${tr(lang, 'كم', 'km', 'km')}`
  const r = m >= 100 ? Math.round(m / 50) * 50 : Math.max(10, Math.round(m / 10) * 10)
  return `${r} ${tr(lang, 'م', 'm', 'm')}`
}

/** Arrow glyph for the banner (rotated text arrows read well in every language). */
export function stepArrow(step: NavStep): string {
  if (step.type === 'arrive') return '⚑'
  if (step.type === 'roundabout' || step.type === 'rotary') return '⟳'
  switch (step.modifier) {
    case 'uturn': return '↶'
    case 'sharp right': return '↘'
    case 'right': return '→'
    case 'slight right': return '↗'
    case 'sharp left': return '↙'
    case 'left': return '←'
    case 'slight left': return '↖'
    default: return '↑'
  }
}

export function stepText(step: NavStep, lang: L): string {
  const onto = step.name ? tr(lang, ` إلى ${step.name}`, ` onto ${step.name}`, ` sur ${step.name}`) : ''
  const m = step.modifier
  const dir = (() => {
    switch (m) {
      case 'right': return tr(lang, 'انعطف يميناً', 'Turn right', 'Tournez à droite')
      case 'left': return tr(lang, 'انعطف يساراً', 'Turn left', 'Tournez à gauche')
      case 'slight right': return tr(lang, 'انعطف قليلاً إلى اليمين', 'Bear right', 'Serrez à droite')
      case 'slight left': return tr(lang, 'انعطف قليلاً إلى اليسار', 'Bear left', 'Serrez à gauche')
      case 'sharp right': return tr(lang, 'انعطف بحدة إلى اليمين', 'Sharp right', 'Virage serré à droite')
      case 'sharp left': return tr(lang, 'انعطف بحدة إلى اليسار', 'Sharp left', 'Virage serré à gauche')
      case 'uturn': return tr(lang, 'استدر للخلف', 'Make a U-turn', 'Faites demi-tour')
      default: return tr(lang, 'تابع مباشرة', 'Continue straight', 'Continuez tout droit')
    }
  })()
  switch (step.type) {
    case 'depart': return tr(lang, 'ابدأ القيادة', 'Head out', 'Partez') + onto
    case 'arrive': return tr(lang, 'وصلت إلى الوجهة', 'You have arrived', 'Vous êtes arrivé')
    case 'roundabout':
    case 'rotary': {
      const exit = step.exit ? tr(lang, ` واخرج من المخرج ${step.exit}`, `, take exit ${step.exit}`, `, prenez la sortie ${step.exit}`) : ''
      return tr(lang, 'ادخل الدوّار', 'Enter the roundabout', 'Entrez dans le rond-point') + exit + onto
    }
    case 'merge': return tr(lang, 'اندمج', 'Merge', 'Insérez-vous') + onto
    case 'on ramp': return tr(lang, 'خذ المنحدر', 'Take the ramp', 'Prenez la bretelle') + onto
    case 'off ramp': return tr(lang, 'اخرج من الطريق', 'Take the exit', 'Prenez la sortie') + onto
    case 'fork': return (m.includes('left') ? tr(lang, 'الزم اليسار', 'Keep left', 'Restez à gauche') : tr(lang, 'الزم اليمين', 'Keep right', 'Restez à droite')) + onto
    case 'end of road': return dir + onto
    case 'continue':
    case 'new name': return tr(lang, 'تابع', 'Continue', 'Continuez') + onto
    default: return dir + onto
  }
}
