// Approximate reference coordinates for well-known Damascus-area places. There is no live
// geocoding provider configured for this prototype (no Google/Mapbox key), so free-text
// pickup/dropoff is matched against this local gazetteer instead of resolving arbitrary
// addresses. Coordinates are approximate area centers, not exact street locations.
const KNOWN_PLACES = [
  { keywords: ['مالكي', 'malki'], lat: 33.5169, lng: 36.287 },
  { keywords: ['مزة', 'mezzeh', 'mazzeh'], lat: 33.503, lng: 36.235 },
  { keywords: ['باب توما', 'bab touma', 'bab tuma'], lat: 33.5117, lng: 36.3067 },
  { keywords: ['شعلان', 'shaalan'], lat: 33.5155, lng: 36.289 },
  { keywords: ['كفرسوسة', 'kafr sousa', 'kafarsouseh'], lat: 33.489, lng: 36.265 },
  { keywords: ['دمر', 'dummar', 'dumar'], lat: 33.545, lng: 36.235 },
  { keywords: ['صحنايا', 'sahnaya'], lat: 33.423, lng: 36.202 },
  { keywords: ['جرمانا', 'jaramana'], lat: 33.485, lng: 36.345 },
  { keywords: ['دوما', 'douma', 'duma'], lat: 33.573, lng: 36.402 },
  { keywords: ['حرستا', 'harasta'], lat: 33.565, lng: 36.363 },
  { keywords: ['قابون', 'qaboun'], lat: 33.535, lng: 36.323 },
  { keywords: ['برزة', 'barzeh'], lat: 33.545, lng: 36.315 },
  { keywords: ['ركن الدين', 'rukn al-din', 'rukn eldin'], lat: 33.535, lng: 36.295 },
  { keywords: ['مهاجرين', 'muhajireen', 'muhajirin'], lat: 33.523, lng: 36.283 },
  { keywords: ['أبو رمانة', 'ابو رمانة', 'abu rummaneh', 'abou roumaneh'], lat: 33.5185, lng: 36.286 },
  { keywords: ['مزرعة', 'mazraa'], lat: 33.498, lng: 36.29 },
  { keywords: ['زملكا', 'zamalka'], lat: 33.535, lng: 36.355 },
  { keywords: ['معضمية', 'muadamiyat', 'moadamiyeh'], lat: 33.46, lng: 36.198 },
  { keywords: ['تل', 'tal'], lat: 33.61, lng: 36.308 },
  { keywords: ['مطار دمشق', 'damascus airport', 'airport'], lat: 33.4114, lng: 36.5156 },
  { keywords: ['وسط البلد', 'وسط دمشق', 'downtown', 'city center', 'umayyad'], lat: 33.5138, lng: 36.2765 },
]

// Checked only when no specific neighborhood above matches, so "Damascus, Malki" resolves to
// Malki's coordinates rather than the generic city-center fallback just because "damascus" is
// a longer substring than "malki".
const GENERIC_FALLBACK_PLACES = [{ keywords: ['دمشق', 'damascus'], lat: 33.5138, lng: 36.2765 }]

const DEFAULT_DISTANCE_KM = 5
const EARTH_RADIUS_KM = 6371

function matchPlace(normalized, places) {
  let best = null
  for (const place of places) {
    for (const keyword of place.keywords) {
      if (normalized.includes(keyword.toLowerCase())) {
        if (!best || keyword.length > best.keyword.length) {
          best = { lat: place.lat, lng: place.lng, keyword }
        }
      }
    }
  }
  return best
}

export function resolvePlaceText(text) {
  const normalized = String(text || '').trim().toLowerCase()
  if (!normalized) return null

  const best = matchPlace(normalized, KNOWN_PLACES) || matchPlace(normalized, GENERIC_FALLBACK_PLACES)
  return best ? { lat: best.lat, lng: best.lng } : null
}

export function haversineKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

const CATEGORY_RATES = {
  'SR Economy': { baseMinor: 8000, perKmMinor: 900 },
  'SR Comfort': { baseMinor: 12000, perKmMinor: 1300 },
  'SR SUV': { baseMinor: 18000, perKmMinor: 1800 },
}

// Live-tracking surcharge for riders who opt out of low-data mode, mirroring the previous flat-fare model.
const LIVE_TRACKING_SURCHARGE_MINOR = 2500

// SYBNB SR only operates in Syria. A client-supplied override (device GPS) landing wildly outside
// the country is almost certainly bad data (GPS glitch or manipulation), not a real pickup/dropoff
// — fall back to gazetteer text-matching instead of trusting it and computing a wild fare.
const SYRIA_BOUNDS = { minLat: 32, maxLat: 37.5, minLng: 35, maxLng: 43 }

function isValidCoords(value) {
  return (
    value &&
    Number.isFinite(value.lat) &&
    Number.isFinite(value.lng) &&
    value.lat >= SYRIA_BOUNDS.minLat &&
    value.lat <= SYRIA_BOUNDS.maxLat &&
    value.lng >= SYRIA_BOUNDS.minLng &&
    value.lng <= SYRIA_BOUNDS.maxLng
  )
}

// pickupCoordsOverride comes from the rider's device GPS (navigator.geolocation), which is more
// accurate than gazetteer text-matching and should win whenever it's available.
export function quoteSrRide({ pickup, dropoff, category, lowDataMode, pickupCoordsOverride, dropoffCoordsOverride }) {
  const rates = CATEGORY_RATES[category] || CATEGORY_RATES['SR Economy']
  const pickupCoords = isValidCoords(pickupCoordsOverride) ? pickupCoordsOverride : resolvePlaceText(pickup)
  const dropoffCoords = isValidCoords(dropoffCoordsOverride) ? dropoffCoordsOverride : resolvePlaceText(dropoff)

  let distanceKm = DEFAULT_DISTANCE_KM
  let estimated = true
  if (pickupCoords && dropoffCoords) {
    distanceKm = Math.max(1, haversineKm(pickupCoords, dropoffCoords))
    estimated = false
  }

  const rawFareMinor = rates.baseMinor + rates.perKmMinor * distanceKm + (lowDataMode ? 0 : LIVE_TRACKING_SURCHARGE_MINOR)
  const fareMinor = Math.round(rawFareMinor / 500) * 500

  return {
    fareMinor,
    distanceKm: Math.round(distanceKm * 10) / 10,
    estimated,
    pickupCoords,
    dropoffCoords,
  }
}
