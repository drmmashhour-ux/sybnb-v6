// Governorate slug -> the English city name stored in Location.city (what the browse/search
// city filter matches against). This MUST mirror the server's authoritative map
// (server/lib/listing-location.mjs GOV_SLUG_TO_CITY), which is what listing creation writes to
// Location.city for every governorate the seller wizard offers. Covering only a subset here means
// a guest can pick a governorate, see it in the search summary, yet the fetch is never narrowed —
// the location filter silently does nothing for the uncovered governorates.
export const GOVERNORATE_CITY_NAME: Record<string, string> = {
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

// Resolve a governorate slug to the stored city name used by the server's city filter. Mirrors
// server/lib/listing-location.mjs resolveListingCityName: tolerate a trailing '-city' suffix and
// fall back to the raw value rather than silently dropping a location the data may carry.
export function governorateCityName(govKey: string | undefined): string | undefined {
  const slug = String(govKey || '').toLowerCase().replace(/-city$/, '')
  if (!slug) return undefined
  return GOVERNORATE_CITY_NAME[slug] || slug
}
