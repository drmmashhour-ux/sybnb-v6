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
