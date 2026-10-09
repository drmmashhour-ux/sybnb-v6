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

// SR fare model (owner decision 2026-10-09): base + per-km + per-minute, floored at a per-category
// minimum fare — the standard Uber/Careem/Bolt shape (time + distance + a floor), not distance-only.
// Five categories, matching how regional apps tier by vehicle class: a budget motorbike tier (common
// across MENA, e.g. Careem bikes), Economy, Comfort, SUV, and a Van/XL for groups. All SYP minor.
const CATEGORY_RATES = {
  'SR Bike':    { baseMinor: 4000,  perKmMinor: 500,  perMinMinor: 100, minFareMinor: 6000 },
  'SR Economy': { baseMinor: 8000,  perKmMinor: 900,  perMinMinor: 150, minFareMinor: 12000 },
  'SR Comfort': { baseMinor: 12000, perKmMinor: 1300, perMinMinor: 200, minFareMinor: 18000 },
  'SR SUV':     { baseMinor: 18000, perKmMinor: 1800, perMinMinor: 300, minFareMinor: 28000 },
  'SR Van':     { baseMinor: 20000, perKmMinor: 2000, perMinMinor: 350, minFareMinor: 32000 },
}

// Average city speed used to estimate trip minutes from distance for the per-minute component (the
// quote is pre-trip, so actual minutes aren't known yet). Env-tunable; the server re-quotes the real route.
const SR_AVG_SPEED_KMH = (() => {
  const raw = Number(process.env.SR_AVG_SPEED_KMH)
  return Number.isFinite(raw) && raw > 0 ? raw : 28
})()

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
// SR Ride vs. Uber gap-closure (P2 #14): multi-stop rides. `stops` is an ordered list of
// intermediate address texts between pickup and dropoff -- resolved the exact same way pickup/
// dropoff already are (device-GPS override wins, else gazetteer text match). The base fare and
// surcharge apply once for the whole trip, not once per leg -- only distance accumulates across
// legs, matching how Uber's own multi-stop pricing extends a single trip rather than stacking
// multiple flat fares.
export function quoteSrRide({
  pickup,
  dropoff,
  category,
  lowDataMode,
  pickupCoordsOverride,
  dropoffCoordsOverride,
  stops,
  stopCoordsOverrides,
}) {
  const rates = CATEGORY_RATES[category] || CATEGORY_RATES['SR Economy']
  const pickupCoords = isValidCoords(pickupCoordsOverride) ? pickupCoordsOverride : resolvePlaceText(pickup)
  const dropoffCoords = isValidCoords(dropoffCoordsOverride) ? dropoffCoordsOverride : resolvePlaceText(dropoff)
  const stopList = Array.isArray(stops) ? stops : []
  const stopCoords = stopList.map((stopText, index) => {
    const override = Array.isArray(stopCoordsOverrides) ? stopCoordsOverrides[index] : undefined
    return isValidCoords(override) ? override : resolvePlaceText(stopText)
  })

  let distanceKm = DEFAULT_DISTANCE_KM
  let estimated = true
  const routePoints = [pickupCoords, ...stopCoords, dropoffCoords]
  if (routePoints.every(Boolean)) {
    let total = 0
    for (let i = 0; i < routePoints.length - 1; i += 1) {
      total += haversineKm(routePoints[i], routePoints[i + 1])
    }
    distanceKm = Math.max(1, total)
    estimated = false
  }

  // Per-minute (time) component: the quote is pre-trip, so estimate minutes from distance at the
  // city average speed. per-km + per-min together is the standard time-and-distance model.
  const estimatedMinutes = Math.max(1, Math.round((distanceKm / SR_AVG_SPEED_KMH) * 60))
  const perMinMinor = rates.perMinMinor || 0
  const minFareMinor = rates.minFareMinor || 0
  const computedMinor = rates.baseMinor
    + rates.perKmMinor * distanceKm
    + perMinMinor * estimatedMinutes
    + (lowDataMode ? 0 : LIVE_TRACKING_SURCHARGE_MINOR)
  // Floor at the category minimum fare so very short/slow trips are never underpriced.
  const flooredMinor = Math.max(minFareMinor, computedMinor)
  const fareMinor = Math.round(flooredMinor / 500) * 500

  return {
    fareMinor,
    distanceKm: Math.round(distanceKm * 10) / 10,
    estimatedMinutes,
    estimated,
    pickupCoords,
    dropoffCoords,
    stopCoords,
  }
}
