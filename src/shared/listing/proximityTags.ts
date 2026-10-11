import { pick, type Lang } from '../../engines/language/languageEngine'

// Neighborhood proximity tags (Centris-parity "what's nearby", adapted to Syria — no Walk Score /
// census). Seller-selected, stored in listing.metadata.proximity as an array of these keys.
export type ProximityKey =
  | 'school' | 'university' | 'hospital' | 'pharmacy' | 'mosque' | 'church'
  | 'market' | 'bakery' | 'park' | 'transport' | 'mainRoad' | 'bank' | 'restaurant' | 'gym'

export const PROXIMITY_TAGS: Array<{ key: ProximityKey; icon: string; ar: string; en: string; fr: string }> = [
  { key: 'school', icon: '🏫', ar: 'مدرسة', en: 'School', fr: 'École' },
  { key: 'university', icon: '🎓', ar: 'جامعة', en: 'University', fr: 'Université' },
  { key: 'hospital', icon: '🏥', ar: 'مستشفى', en: 'Hospital', fr: 'Hôpital' },
  { key: 'pharmacy', icon: '💊', ar: 'صيدلية', en: 'Pharmacy', fr: 'Pharmacie' },
  { key: 'mosque', icon: '🕌', ar: 'مسجد', en: 'Mosque', fr: 'Mosquée' },
  { key: 'church', icon: '⛪', ar: 'كنيسة', en: 'Church', fr: 'Église' },
  { key: 'market', icon: '🛒', ar: 'سوق / بقالة', en: 'Market', fr: 'Marché' },
  { key: 'bakery', icon: '🥖', ar: 'مخبز', en: 'Bakery', fr: 'Boulangerie' },
  { key: 'park', icon: '🌳', ar: 'حديقة', en: 'Park', fr: 'Parc' },
  { key: 'transport', icon: '🚌', ar: 'مواصلات', en: 'Public transport', fr: 'Transports' },
  { key: 'mainRoad', icon: '🛣️', ar: 'طريق رئيسي', en: 'Main road', fr: 'Route principale' },
  { key: 'bank', icon: '🏦', ar: 'بنك / صرّاف', en: 'Bank / ATM', fr: 'Banque' },
  { key: 'restaurant', icon: '🍽️', ar: 'مطاعم ومقاهي', en: 'Restaurants & cafés', fr: 'Restaurants' },
  { key: 'gym', icon: '🏋️', ar: 'نادٍ رياضي', en: 'Gym', fr: 'Salle de sport' },
]

const BY_KEY = new Map(PROXIMITY_TAGS.map((t) => [t.key, t]))

export function proximityLabel(key: string, lang: Lang): string {
  const t = BY_KEY.get(key as ProximityKey)
  if (!t) return key
  return pick(lang, t.ar, t.en, t.fr)
}

// Normalize an unknown metadata value into a clean list of known proximity keys.
export function readProximity(value: unknown): ProximityKey[] {
  if (!Array.isArray(value)) return []
  const out: ProximityKey[] = []
  for (const v of value) {
    const k = String(v) as ProximityKey
    if (BY_KEY.has(k) && !out.includes(k)) out.push(k)
  }
  return out
}

// Divisions where "what's nearby" makes sense (property / place-based, not cars/marketplace items).
export const PROXIMITY_DIVISIONS = new Set(['STAYS', 'RENTALS', 'BUY', 'NEW_CONSTRUCTION'])
