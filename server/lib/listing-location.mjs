// Shared listing-location helpers: governorate slug -> English city/governorate name stored in
// Location.city (what the browse city filter matches against). Must cover every governorate the
// seller wizard offers (SYRIA_GOVERNORATES / countries/syria/data/geo.ts), not just the 5 the
// browse-side quick-filter highlights.
export const GOV_SLUG_TO_CITY = {
  damascus: 'Damascus',
  'rif-dimashq': 'Rif Dimashq',
  aleppo: 'Aleppo',
  homs: 'Homs',
  hama: 'Hama',
  latakia: 'Latakia',
  tartus: 'Tartus',
  idlib: 'Idlib',
  daraa: 'Daraa',
  sweida: 'As-Suwayda',
  'deir-ezzor': 'Deir ez-Zor',
  raqqa: 'Raqqa',
  hasakah: 'Al-Hasakah',
  quneitra: 'Quneitra',
}

// Resolve a governorate/area source (top-level body field or metadata.<field>) to a Location-ready
// city name. Falls back to the raw submitted value if it isn't a known slug — never silently drop
// the location the seller actually provided.
export function resolveListingCityName(govSource) {
  const govSlug = String(govSource || '').toLowerCase().replace(/-city$/, '')
  return GOV_SLUG_TO_CITY[govSlug] || (govSource ? String(govSource) : undefined)
}

// Arabic governorate/city names (as shown in the AR UI) -> the English name stored in
// Location.city. Lets the browse filter accept whatever label the client sends.
const AR_TO_CITY = {
  'دمشق': 'Damascus',
  'ريف دمشق': 'Rif Dimashq',
  'حلب': 'Aleppo',
  'حمص': 'Homs',
  'حماة': 'Hama',
  'حماه': 'Hama',
  'اللاذقية': 'Latakia',
  'طرطوس': 'Tartus',
  'إدلب': 'Idlib',
  'ادلب': 'Idlib',
  'درعا': 'Daraa',
  'السويداء': 'As-Suwayda',
  'دير الزور': 'Deir ez-Zor',
  'الرقة': 'Raqqa',
  'الحسكة': 'Al-Hasakah',
  'القنيطرة': 'Quneitra',
}

const CITY_ALIASES = { lattakia: 'Latakia', ladhiqiyah: 'Latakia', tartous: 'Tartus', suwayda: 'As-Suwayda', 'deir ez-zor': 'Deir ez-Zor', 'deir-ez-zor': 'Deir ez-Zor', hasakah: 'Al-Hasakah', lattaquié: 'Latakia', damas: 'Damascus', alep: 'Aleppo', 'homs': 'Homs' }

// Normalize a browse ?city= value (English name, slug, '-city' slug, Arabic, French) to the stored
// English Location.city. Unknown values pass through unchanged.
export function normalizeBrowseCity(raw) {
  const value = String(raw || '').trim()
  if (!value) return undefined
  if (AR_TO_CITY[value]) return AR_TO_CITY[value]
  const lower = value.toLowerCase()
  const slug = lower.replace(/-city$/, '').replace(/\s+/g, '-')
  if (GOV_SLUG_TO_CITY[slug]) return GOV_SLUG_TO_CITY[slug]
  if (CITY_ALIASES[lower]) return CITY_ALIASES[lower]
  const english = Object.values(GOV_SLUG_TO_CITY).find((name) => name.toLowerCase() === lower)
  return english || value
}
