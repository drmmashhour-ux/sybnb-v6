// Country-neutral RIDE-GEOCODING seam (MASTER). Fail-closed.
//
// The master platform does not import any country's geocoder directly. It resolves one EXPLICITLY by
// the active country (SYBNB_COUNTRY / the loaded profile). Unknown/missing/unsupported country →
// throws, never a silent default. Adding a country = register its geocoder here + ship it under
// countries/<country>/geo. No country inherits another's gazetteer, bounds, or fare rates.
//
// There is NO external geocoding provider (local gazetteer only) — this seam adds no network call.

import * as syriaGeocoding from '../../countries/syria/geo/geocoding.mjs'

// Explicit registry — the ONLY sanctioned bridge from master to a country's geocoder.
const GEOCODERS = {
  syria: syriaGeocoding,
}

// The capability surface a country geocoder must provide (mirrors existing behavior exactly).
function assertGeocoderComplete(mod, key) {
  for (const fn of ['resolvePlaceText', 'haversineKm', 'quoteSrRide']) {
    if (typeof mod[fn] !== 'function') throw new Error(`geocoder for country '${key}' is incomplete: missing ${fn} (fail-closed)`)
  }
}

// Resolve the ride geocoder for a country. Fail closed on missing/unsupported/incomplete.
export function resolveRideGeocoder(country) {
  const key = String(country || '').trim().toLowerCase()
  if (!key) throw new Error('ride geocoder: no country selected (fail-closed)')
  const mod = GEOCODERS[key]
  if (!mod) throw new Error(`ride geocoder: country '${key}' is not supported (fail-closed)`)
  assertGeocoderComplete(mod, key)
  return mod
}

// Convenience for routes: resolve from the active country (env) and quote. Since startup fail-closes
// without a valid SYBNB_COUNTRY, this always has a valid active country at runtime.
export function quoteSrRideForActiveCountry(input, env = process.env) {
  return resolveRideGeocoder(env.SYBNB_COUNTRY).quoteSrRide(input)
}

export function supportedRideGeocoderCountries() {
  return Object.keys(GEOCODERS)
}
