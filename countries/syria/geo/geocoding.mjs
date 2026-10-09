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
// Rate LEVELS recalibrated 2026-10-09 to the real Damascus market reported by Enab Baladi (2025):
// a cross-town app trip (al-Dweila -> al-Mazzeh, ~9 km / ~20 min) runs ~42,000 SYP, so SR Economy at
// that distance now lands near that figure instead of ~half of it.
const CATEGORY_RATES = {
  'SR Bike':    { baseMinor: 6000,  perKmMinor: 1100, perMinMinor: 150, minFareMinor: 8000 },
  'SR Economy': { baseMinor: 12000, perKmMinor: 2200, perMinMinor: 300, minFareMinor: 15000 },
  'SR Comfort': { baseMinor: 16000, perKmMinor: 2800, perMinMinor: 400, minFareMinor: 22000 },
  'SR SUV':     { baseMinor: 22000, perKmMinor: 3600, perMinMinor: 550, minFareMinor: 32000 },
  'SR Van':     { baseMinor: 26000, perKmMinor: 4200, perMinMinor: 650, minFareMinor: 40000 },
}

// Peak-hour surge. Syrian ride apps raise fares during rush hours; SR mirrors that with a single
// multiplier applied to the whole fare during morning and evening peaks. Env-tunable
// (SR_PEAK_SURGE_MULTIPLIER, a 1..3 factor); default 1.25 (a 25% peak premium).
const SR_PEAK_SURGE_MULTIPLIER = (() => {
  const raw = Number(process.env.SR_PEAK_SURGE_MULTIPLIER)
  return Number.isFinite(raw) && raw >= 1 && raw <= 3 ? raw : 1.25
})()
// Damascus local time is a fixed UTC+3 (Syria abolished daylight saving in 2022), so local hour is
// UTC+3 with no DST branch. Peak windows: 07:00-09:59 and 16:00-19:59 local.
const SYRIA_UTC_OFFSET_HOURS = 3
export function isPeakHour(date = new Date()) {
  const localHour = (date.getUTCHours() + SYRIA_UTC_OFFSET_HOURS) % 24
  return (localHour >= 7 && localHour < 10) || (localHour >= 16 && localHour < 20)
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
  // Floor at the category minimum fare so very short/slow trips are never underpriced, THEN apply the
  // peak-hour surge to the floored amount so even minimum-fare trips carry the rush-hour premium.
  const flooredMinor = Math.max(minFareMinor, computedMinor)
  const peak = isPeakHour()
  const surgeMultiplier = peak ? SR_PEAK_SURGE_MULTIPLIER : 1
  const surgedMinor = flooredMinor * surgeMultiplier
  const fareMinor = Math.round(surgedMinor / 500) * 500

  return {
    fareMinor,
    distanceKm: Math.round(distanceKm * 10) / 10,
    estimatedMinutes,
    estimated,
    surgeMultiplier,
    isPeak: peak,
    pickupCoords,
    dropoffCoords,
    stopCoords,
  }
}
