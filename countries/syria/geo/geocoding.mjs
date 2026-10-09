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

// SR SMART VARIABLE PRICING (owner decision 2026-10-09, USD). Fares are priced in USD, not SYP: the
// Syrian pound is volatile (parallel market ~13,000 old SYP/USD, Aug 2026) and the Syria profile
// already advertises in USD, so a USD anchor keeps the real fare stable as the pound moves. Amounts
// are whole USD (the platform renders money in whole currency units). Rate LEVELS are calibrated to
// the LOCAL Syrian market, NOT tourist taxi aggregators: Enab Baladi (2025) puts a cross-town app
// trip (~8-9 km) near 42,000 old SYP ~= $3, so SR Economy at that distance lands ~$3 here.
//
// Final fare = BASE x variable factors:
//   base   = baseUsd + perKmUsd*km + perMinUsd*min (+ airport surcharge), floored at minFareUsd
//   x (1 + fuel%)   -- FACTOR 2 fuel/gas cost pass-through (raise when pump prices rise)
//   x peak          -- FACTOR 1 automatic rush-hour multiplier (time of day)
//   x demand        -- FACTOR 3 operator "live" knob for demand/weather/holidays (other factors)
// then rounded to the nearest whole USD (min $1). Every factor is env-tunable with a safe default,
// so pricing is steered without a code change.
const CATEGORY_RATES = {
  'SR Bike':    { baseUsd: 0.8, perKmUsd: 0.11, perMinUsd: 0.015, minFareUsd: 1 },
  'SR Economy': { baseUsd: 1.2, perKmUsd: 0.18, perMinUsd: 0.02,  minFareUsd: 2 },
  'SR Comfort': { baseUsd: 1.5, perKmUsd: 0.22, perMinUsd: 0.028, minFareUsd: 3 },
  'SR SUV':     { baseUsd: 2.2, perKmUsd: 0.32, perMinUsd: 0.045, minFareUsd: 4 },
  'SR Van':     { baseUsd: 2.8, perKmUsd: 0.38, perMinUsd: 0.055, minFareUsd: 5 },
}
const SR_FARE_CURRENCY = 'USD'

// Read a numeric env with a default and a safe clamp (out-of-range or non-numeric -> default).
function srEnvNum(name, def, min, max) {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw >= min && raw <= max ? raw : def
}

// FACTOR 1 -- Peak-hour surge (time). Env SR_PEAK_SURGE_MULTIPLIER (1..3), default 1.25 (+25%).
const SR_PEAK_SURGE_MULTIPLIER = srEnvNum('SR_PEAK_SURGE_MULTIPLIER', 1.25, 1, 3)
// Damascus local time is a fixed UTC+3 (Syria abolished daylight saving in 2022). Peaks: 07:00-09:59
// and 16:00-19:59 local.
const SYRIA_UTC_OFFSET_HOURS = 3
export function isPeakHour(date = new Date()) {
  const localHour = (date.getUTCHours() + SYRIA_UTC_OFFSET_HOURS) % 24
  return (localHour >= 7 && localHour < 10) || (localHour >= 16 && localHour < 20)
}

// FACTOR 2 -- Fuel/gas surcharge %. Added to the base fare so a rise in pump prices passes through.
// Env SR_FUEL_SURCHARGE_PERCENT (0..100), default 0 (off until fuel rises).
const SR_FUEL_SURCHARGE_PERCENT = srEnvNum('SR_FUEL_SURCHARGE_PERCENT', 0, 0, 100)

// FACTOR 3 -- Demand / "other factors" surge. One live multiplier the operator raises for high
// demand, weather, holidays, etc. Env SR_DEMAND_SURGE_MULTIPLIER (1..5), default 1 (no surge).
const SR_DEMAND_SURGE_MULTIPLIER = srEnvNum('SR_DEMAND_SURGE_MULTIPLIER', 1, 1, 5)

// FACTOR 4 -- Airport zone surcharge. Airport runs are specially priced everywhere (highway, waiting,
// empty return leg), so a linear per-km fare underprices them. Fixed USD add-on when pickup OR dropoff
// is Damascus airport. Env SR_AIRPORT_SURCHARGE_USD (0..50), default 5.
const SR_AIRPORT_SURCHARGE_USD = srEnvNum('SR_AIRPORT_SURCHARGE_USD', 5, 0, 50)
const DAMASCUS_AIRPORT_COORDS = { lat: 33.4114, lng: 36.5156 }
const AIRPORT_RADIUS_KM = 3
function isAirportPoint(coords) {
  return Boolean(coords) && haversineKm(coords, DAMASCUS_AIRPORT_COORDS) <= AIRPORT_RADIUS_KM
}

// Average city speed to estimate trip minutes from distance (quote is pre-trip). Env-tunable.
const SR_AVG_SPEED_KMH = srEnvNum('SR_AVG_SPEED_KMH', 28, 1, 200)

// Live-tracking surcharge (USD) for riders who opt out of low-data mode.
const LIVE_TRACKING_SURCHARGE_USD = 0.2

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

  // Base fare (USD): base + per-km + per-minute + optional live-tracking + airport surcharge, floored
  // at the category minimum.
  const airportTrip = isAirportPoint(pickupCoords) || isAirportPoint(dropoffCoords)
  const airportSurchargeUsd = airportTrip ? SR_AIRPORT_SURCHARGE_USD : 0
  const rawBaseUsd = rates.baseUsd
    + rates.perKmUsd * distanceKm
    + rates.perMinUsd * estimatedMinutes
    + (lowDataMode ? 0 : LIVE_TRACKING_SURCHARGE_USD)
    + airportSurchargeUsd
  const baseFareUsd = Math.max(rates.minFareUsd || 0, rawBaseUsd)

  // Variable factors on the base fare: fuel% (cost) -> peak (time) -> demand (other factors).
  const peak = isPeakHour()
  const peakMultiplier = peak ? SR_PEAK_SURGE_MULTIPLIER : 1
  const fuelMultiplier = 1 + SR_FUEL_SURCHARGE_PERCENT / 100
  const demandMultiplier = SR_DEMAND_SURGE_MULTIPLIER
  const surgeMultiplier = Math.round(peakMultiplier * fuelMultiplier * demandMultiplier * 1000) / 1000
  const variedUsd = baseFareUsd * fuelMultiplier * peakMultiplier * demandMultiplier

  // The platform renders money in whole currency units, so round to the nearest whole USD (min $1).
  const fareMinor = Math.max(1, Math.round(variedUsd))

  return {
    fareMinor,
    currency: SR_FARE_CURRENCY,
    distanceKm: Math.round(distanceKm * 10) / 10,
    estimatedMinutes,
    estimated,
    baseFareMinor: Math.round(baseFareUsd),
    airportSurcharge: airportSurchargeUsd,
    airportTrip,
    fuelSurchargePercent: SR_FUEL_SURCHARGE_PERCENT,
    peakMultiplier,
    demandMultiplier,
    surgeMultiplier,
    isPeak: peak,
    pickupCoords,
    dropoffCoords,
    stopCoords,
  }
}
