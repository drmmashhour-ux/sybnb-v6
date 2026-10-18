// Approximate reference coordinates for well-known Damascus-area places. There is no live
// geocoding provider configured for this prototype (no Google/Mapbox key), so free-text
// pickup/dropoff is matched against this local gazetteer instead of resolving arbitrary
// addresses. Coordinates are approximate area centers, not exact street locations.
import { ringFeeUsd, ringOf, dayFactor, airportBaseUsd, SR_RING_FEE_USD } from './sr-zones.mjs'

const KNOWN_PLACES = [
  { keywords: ['مالكي', 'malki'], lat: 33.5169, lng: 36.287 },
  { keywords: ['مزة', 'المزة', 'mezzeh', 'mazzeh', 'mazeh', 'mezze', 'mezzah'], lat: 33.503, lng: 36.235 },
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
  // --- All-governorate coverage (2026-10-15, Yallago gap-closure #1): specific places for the
  // remaining 13 governorates. City-NAME fallbacks live in GENERIC_FALLBACK_PLACES below so
  // "Aleppo, Aziziyeh" resolves to the neighborhood, not the city center. Airports carry keywords
  // longer than the bare 'airport' above, so longest-keyword precedence picks the right one.
  // Aleppo (حلب)
  { keywords: ['مطار حلب', 'aleppo airport', 'aleppo international'], lat: 36.1807, lng: 37.2244 },
  { keywords: ['عزيزية', 'aziziyeh', 'aziziyah', 'azizieh'], lat: 36.2082, lng: 37.1487 },
  { keywords: ['حلب الجديدة', 'new aleppo'], lat: 36.2186, lng: 37.0909 },
  { keywords: ['صلاح الدين', 'salaheddine', 'salah al-din'], lat: 36.1819, lng: 37.1203 },
  { keywords: ['الحمدانية', 'حمدانية', 'hamdaniyeh', 'hamdaniya'], lat: 36.1699, lng: 37.1047 },
  { keywords: ['جامعة حلب', 'aleppo university'], lat: 36.2109, lng: 37.1259 },
  { keywords: ['قلعة حلب', 'aleppo citadel', 'citadel'], lat: 36.1994, lng: 37.1629 },
  // Homs (حمص)
  { keywords: ['الوعر', 'al-waer', 'al waer', 'alwaer'], lat: 34.7399, lng: 36.6611 },
  { keywords: ['الإنشاءات', 'انشاءات', 'inshaat'], lat: 34.7169, lng: 36.6988 },
  { keywords: ['ساعة حمص', 'homs clock', 'clock tower homs'], lat: 34.7306, lng: 36.7094 },
  // Hama (حماة)
  { keywords: ['نواعير حماة', 'norias', 'hama norias'], lat: 35.1354, lng: 36.7442 },
  // Latakia (اللاذقية)
  { keywords: ['مطار الباسل', 'مطار اللاذقية', 'basel al-assad airport', 'latakia airport', 'bassel airport'], lat: 35.4011, lng: 35.9487 },
  { keywords: ['الزراعة', 'ziraa', 'al-ziraa'], lat: 35.5312, lng: 35.7823 },
  { keywords: ['مشروع الصليبة', 'الصليبة', 'saliba'], lat: 35.5262, lng: 35.7847 },
  { keywords: ['جبلة', 'jableh', 'jablah'], lat: 35.3617, lng: 35.9272 },
  // Tartus (طرطوس)
  { keywords: ['بانياس', 'baniyas', 'banias'], lat: 35.1818, lng: 35.9483 },
  { keywords: ['صافيتا', 'safita'], lat: 34.8203, lng: 36.1183 },
  // Idlib (إدلب)
  { keywords: ['معرة النعمان', 'maarat al-numan', 'maarrat'], lat: 35.6383, lng: 36.6793 },
  { keywords: ['سراقب', 'saraqib', 'saraqeb'], lat: 35.8643, lng: 36.8052 },
  // Daraa (درعا)
  { keywords: ['بصرى', 'bosra', 'busra'], lat: 32.5178, lng: 36.4816 },
  { keywords: ['نوى', 'nawa'], lat: 32.8893, lng: 36.0441 },
  // As-Suwayda (السويداء)
  { keywords: ['شهبا', 'shahba'], lat: 32.8542, lng: 36.6291 },
  { keywords: ['صلخد', 'salkhad'], lat: 32.4921, lng: 36.7106 },
  // Quneitra (القنيطرة)
  { keywords: ['خان أرنبة', 'خان ارنبة', 'khan arnabeh', 'khan arnaba'], lat: 33.1865, lng: 35.9028 },
  // Deir ez-Zor (دير الزور)
  { keywords: ['مطار دير الزور', 'deir ez-zor airport', 'deir ezzor airport'], lat: 35.2854, lng: 40.176 },
  { keywords: ['الميادين', 'mayadin', 'al-mayadin'], lat: 35.0183, lng: 40.4533 },
  { keywords: ['البوكمال', 'albu kamal', 'abu kamal', 'al-bukamal'], lat: 34.4522, lng: 40.9187 },
  // Raqqa (الرقة)
  { keywords: ['الطبقة', 'tabqa', 'al-tabqa', 'thawrah'], lat: 35.8367, lng: 38.5482 },
  // Al-Hasakah (الحسكة)
  { keywords: ['مطار القامشلي', 'qamishli airport', 'kamishly airport'], lat: 37.0206, lng: 41.1914 },
  { keywords: ['القامشلي', 'قامشلي', 'qamishli', 'qamishly', 'kamishly'], lat: 37.0522, lng: 41.2317 },
  { keywords: ['رأس العين', 'راس العين', 'ras al-ayn', 'ras al ain'], lat: 36.8503, lng: 40.0706 },
]

// Checked only when no specific neighborhood above matches, so "Damascus, Malki" resolves to
// Malki's coordinates rather than the generic city-center fallback just because "damascus" is
// a longer substring than "malki".
const GENERIC_FALLBACK_PLACES = [
  { keywords: ['دمشق', 'damascus'], lat: 33.5138, lng: 36.2765 },
  // All 14 governorate capitals (2026-10-15, Yallago gap-closure #1). Fallbacks only: a specific
  // neighborhood/airport match in KNOWN_PLACES above always wins over the bare city name.
  { keywords: ['ريف دمشق', 'rif dimashq', 'rural damascus'], lat: 33.5138, lng: 36.2765 },
  { keywords: ['حلب', 'aleppo', 'halab'], lat: 36.2021, lng: 37.1343 },
  { keywords: ['حمص', 'homs', 'hims'], lat: 34.7324, lng: 36.7137 },
  { keywords: ['حماة', 'حماه', 'hama', 'hamah'], lat: 35.1318, lng: 36.7578 },
  { keywords: ['اللاذقية', 'لاذقية', 'latakia', 'lattakia', 'ladhiqiyah'], lat: 35.5196, lng: 35.7915 },
  { keywords: ['طرطوس', 'tartus', 'tartous'], lat: 34.8886, lng: 35.8866 },
  { keywords: ['إدلب', 'ادلب', 'idlib', 'idleb'], lat: 35.9306, lng: 36.6339 },
  { keywords: ['درعا', 'daraa', 'deraa', 'dara'], lat: 32.6189, lng: 36.1021 },
  { keywords: ['السويداء', 'سويداء', 'sweida', 'suwayda', 'as-suwayda', 'swaida'], lat: 32.709, lng: 36.5694 },
  { keywords: ['القنيطرة', 'قنيطرة', 'quneitra', 'qunaitra', 'kuneitra'], lat: 33.1263, lng: 35.8245 },
  { keywords: ['دير الزور', 'ديرالزور', 'deir ez-zor', 'deir ezzor', 'deir al-zor', 'der ezzor'], lat: 35.3359, lng: 40.1408 },
  { keywords: ['الرقة', 'رقة', 'raqqa', 'rakka', 'ar-raqqah'], lat: 35.9594, lng: 39.0079 },
  { keywords: ['الحسكة', 'حسكة', 'hasakah', 'al-hasakah', 'hassakeh', 'hasaka'], lat: 36.5024, lng: 40.7477 },
]

// International destinations (2026-10-15, Yallago gap-closure #4a): cross-border trips to Lebanon
// and Jordan, matching Yallago's "International to Jordan and Lebanon" service. Resolution is by
// NAMED destination only — the Syria GPS-bounds guard on client coordinate overrides is untouched,
// so a spoofed out-of-country GPS point still falls back to text matching. Each match marks the
// quote internationalTrip and adds SR_INTERNATIONAL_SURCHARGE_USD (border crossing time/costs).
const INTERNATIONAL_PLACES = [
  { keywords: ['بيروت', 'beirut', 'beyrouth'], lat: 33.8938, lng: 35.5018 }, // Lebanon
  { keywords: ['مطار بيروت', 'beirut airport', 'rafic hariri'], lat: 33.8209, lng: 35.4884 },
  { keywords: ['طرابلس لبنان', 'tripoli lebanon'], lat: 34.4367, lng: 35.8497 },
  { keywords: ['عمان', 'عمّان', 'amman'], lat: 31.9539, lng: 35.9106 }, // Jordan
  { keywords: ['مطار الملكة علياء', 'amman airport', 'queen alia'], lat: 31.7226, lng: 35.9932 },
  { keywords: ['إربد', 'اربد', 'irbid'], lat: 32.5556, lng: 35.85 },
]

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

// Detailed resolution: domestic places first (a Syrian neighborhood always wins over an
// international city), then international destinations, then the generic city fallbacks.
// Returns { lat, lng, international } or null.
export function resolvePlaceDetailed(text) {
  const normalized = String(text || '').trim().toLowerCase()
  if (!normalized) return null

  const domestic = matchPlace(normalized, KNOWN_PLACES)
  if (domestic) return { lat: domestic.lat, lng: domestic.lng, international: false }
  const abroad = matchPlace(normalized, INTERNATIONAL_PLACES)
  if (abroad) return { lat: abroad.lat, lng: abroad.lng, international: true }
  const fallback = matchPlace(normalized, GENERIC_FALLBACK_PLACES)
  return fallback ? { lat: fallback.lat, lng: fallback.lng, international: false } : null
}

export function resolvePlaceText(text) {
  const best = resolvePlaceDetailed(text)
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

// SR SMART VARIABLE PRICING ENGINE (owner decision 2026-10-10, USD). Fares are priced in USD, not
// SYP: the pound is volatile (~13,000 old SYP/USD, Aug 2026) and the Syria profile advertises in USD,
// so a USD anchor keeps the real fare stable. Levels are calibrated to the LOCAL market (Enab Baladi
// 2025, ~$3 cross-town Economy), not tourist taxi aggregators.
//
// Final fare = (BASE + per-trip add-ons) x variable multipliers, rounded UP to a clean step:
//   BASE      = baseUsd + perKmUsd*km + perMinUsd*min (+ airport surcharge), floored at minFareUsd
//   add-ons   + stops fee + extra-bag fee + extra-rider fee            (fixed USD, per trip)
//   x (1 + fuel%)        fuel/gas cost pass-through
//   x traffic            live congestion (Google duration_in_traffic ratio) OR rush-hour proxy
//   x night              late-night / early-morning premium
//   x schedule           advance-booking (scheduled ride) premium
//   x demand             operator live knob (weather, holidays, high demand)
// then rounded UP to SR_FARE_ROUNDING_USD. Distance & traffic use Google Maps when GOOGLE_MAPS_API_KEY
// is set (see server/lib/traffic-distance.mjs); otherwise the local gazetteer distance + a rush-hour
// traffic proxy are used. Every factor is env-tunable with a safe default.
const CATEGORY_RATES = {
  'SR Bike':    { baseUsd: 0.8, perKmUsd: 0.11, perMinUsd: 0.015, minFareUsd: 3 },
  'SR Economy': { baseUsd: 1.2, perKmUsd: 0.18, perMinUsd: 0.02,  minFareUsd: 4 },
  'SR Comfort': { baseUsd: 1.5, perKmUsd: 0.22, perMinUsd: 0.028, minFareUsd: 5 },
  'SR SUV':     { baseUsd: 2.2, perKmUsd: 0.32, perMinUsd: 0.045, minFareUsd: 7 },
  'SR Van':     { baseUsd: 2.8, perKmUsd: 0.38, perMinUsd: 0.055, minFareUsd: 9 },
  // VIP (2026-10-15, Yallago gap-closure #2): premium sedan tier, priced above Van — newest cars
  // (max age 6y, server/lib/vehicle-category.mjs), business trips and occasions.
  'SR VIP':     { baseUsd: 3.5, perKmUsd: 0.5,  perMinUsd: 0.07,  minFareUsd: 12 },
}
const SR_FARE_CURRENCY = 'USD'

// Read a numeric env with a default and a safe clamp (out-of-range or non-numeric -> default).
function srEnvNum(name, def, min, max) {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw >= min && raw <= max ? raw : def
}

// Damascus local time is a fixed UTC+3 (Syria abolished daylight saving in 2022).
const SYRIA_UTC_OFFSET_HOURS = 3
function syriaLocalHour(date) {
  return (date.getUTCHours() + SYRIA_UTC_OFFSET_HOURS) % 24
}
// Rush-hour windows, used as the TRAFFIC proxy when no live Google traffic is available: 07:00-09:59
// and 16:00-19:59 local.
export function isPeakHour(date = new Date()) {
  const h = syriaLocalHour(date)
  return (h >= 7 && h < 10) || (h >= 16 && h < 20)
}
// Night / early-morning window: 22:00-05:59 local.
export function isNightHour(date = new Date()) {
  const h = syriaLocalHour(date)
  return h >= 22 || h < 6
}

// --- Variable multiplier knobs (env-tunable) ---
// TRAFFIC proxy multiplier when no live Google traffic (applied during rush hours). Also the default
// name kept for continuity. Env SR_PEAK_SURGE_MULTIPLIER (1..3), default 1.25.
const SR_TRAFFIC_PEAK_MULTIPLIER = srEnvNum('SR_PEAK_SURGE_MULTIPLIER', 1.25, 1, 3)
// Cap on the LIVE traffic multiplier (Google duration_in_traffic / free-flow duration). Env
// SR_TRAFFIC_MAX (1..4), default 2.0 -- a bad-traffic trip never more than doubles.
const SR_TRAFFIC_MAX = srEnvNum('SR_TRAFFIC_MAX', 2, 1, 4)
// Night / early-morning premium. Env SR_NIGHT_MULTIPLIER (1..3), default 1.15 (+15%).
const SR_NIGHT_MULTIPLIER = srEnvNum('SR_NIGHT_MULTIPLIER', 1.15, 1, 3)
// Scheduled (advance-booking) premium. Env SR_SCHEDULE_MULTIPLIER (1..3), default 1.10 (+10%).
const SR_SCHEDULE_MULTIPLIER = srEnvNum('SR_SCHEDULE_MULTIPLIER', 1.10, 1, 3)
// Fuel/gas cost pass-through %. Env SR_FUEL_SURCHARGE_PERCENT (0..100), default 0.
const SR_FUEL_SURCHARGE_PERCENT = srEnvNum('SR_FUEL_SURCHARGE_PERCENT', 0, 0, 100)
// Operator live demand knob. Env SR_DEMAND_SURGE_MULTIPLIER (1..5), default 1.
const SR_DEMAND_SURGE_MULTIPLIER = srEnvNum('SR_DEMAND_SURGE_MULTIPLIER', 1, 1, 5)

// --- Per-trip additive fees (fixed USD) ---
// Per intermediate stop. Env SR_STOP_FEE_USD (0..20), default 1.
const SR_STOP_FEE_USD = srEnvNum('SR_STOP_FEE_USD', 1, 0, 20)
// Bags: a free allowance, then a fee per extra bag. Env SR_FREE_BAGS (0..10, default 2),
// SR_BAG_FEE_USD (0..20, default 1).
const SR_FREE_BAGS = srEnvNum('SR_FREE_BAGS', 2, 0, 10)
const SR_BAG_FEE_USD = srEnvNum('SR_BAG_FEE_USD', 1, 0, 20)
// Riders: included up to a base count, then a fee per extra rider. Env SR_BASE_RIDERS (1..8,
// default 4), SR_EXTRA_RIDER_FEE_USD (0..20, default 1).
const SR_BASE_RIDERS = srEnvNum('SR_BASE_RIDERS', 4, 1, 8)
const SR_EXTRA_RIDER_FEE_USD = srEnvNum('SR_EXTRA_RIDER_FEE_USD', 1, 0, 20)

// Airport zone surcharge. Fixed USD add-on when pickup OR dropoff is any Syrian airport. Env
// SR_AIRPORT_SURCHARGE_USD (0..50), default 5. Extended 2026-10-15 (Yallago gap-closure #1) from
// Damascus-only to every airport in the gazetteer, with the same 3km zone radius each.
const SR_AIRPORT_SURCHARGE_USD = srEnvNum('SR_AIRPORT_SURCHARGE_USD', 5, 0, 50)
const SYRIAN_AIRPORT_COORDS = [
  { lat: 33.4114, lng: 36.5156 }, // Damascus International
  { lat: 36.1807, lng: 37.2244 }, // Aleppo International
  { lat: 35.4011, lng: 35.9487 }, // Basel al-Assad (Latakia)
  { lat: 35.2854, lng: 40.176 }, // Deir ez-Zor
  { lat: 37.0206, lng: 41.1914 }, // Qamishli
]
// Cross-border surcharge (gap-closure #4a): fixed USD add-on for a trip to a named international
// destination — border waiting time, tolls and return-empty risk. Env SR_INTERNATIONAL_SURCHARGE_USD
// (0..200), default 25.
const SR_INTERNATIONAL_SURCHARGE_USD = srEnvNum('SR_INTERNATIONAL_SURCHARGE_USD', 25, 0, 200)
const AIRPORT_RADIUS_KM = 3
function isAirportPoint(coords) {
  return Boolean(coords) && SYRIAN_AIRPORT_COORDS.some((airport) => haversineKm(coords, airport) <= AIRPORT_RADIUS_KM)
}

// Fares round UP to the nearest multiple of this so prices land on clean numbers (5/10/15/20). Env
// SR_FARE_ROUNDING_USD (1..50), default 5. Set 1 for fine per-dollar steps that show every factor.
const SR_FARE_ROUNDING_USD = srEnvNum('SR_FARE_ROUNDING_USD', 5, 1, 50)
// Average city speed to estimate trip minutes from distance when no live duration is available.
const SR_AVG_SPEED_KMH = srEnvNum('SR_AVG_SPEED_KMH', 28, 1, 200)
// Live-tracking surcharge (USD) for riders who opt out of low-data mode.
const LIVE_TRACKING_SURCHARGE_USD = 0.2

// SYBNB SR only operates in Syria. A client-supplied override (device GPS) landing wildly outside the
// country is almost certainly bad data (GPS glitch or manipulation), not a real pickup/dropoff -- fall
// back to gazetteer text-matching instead of trusting it and computing a wild fare.
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

// quoteSrRide is PURE and synchronous. Live Google distance/traffic (async) is resolved by the quote
// ROUTE and passed in via distanceKmOverride / estimatedMinutesOverride / trafficMultiplierOverride;
// with no key the engine falls back to gazetteer distance and the rush-hour traffic proxy.
// Multi-stop: `stops` is an ordered list of intermediate addresses; distance accumulates across legs
// (base fare + surcharges apply once for the whole trip), plus a fixed handling fee per stop.
export function quoteSrRide({
  pickup,
  dropoff,
  category,
  lowDataMode,
  pickupCoordsOverride,
  dropoffCoordsOverride,
  stops,
  stopCoordsOverrides,
  riderCount,
  bagCount,
  scheduled,
  distanceKmOverride,
  estimatedMinutesOverride,
  trafficMultiplierOverride,
  now,
}) {
  const rates = CATEGORY_RATES[category] || CATEGORY_RATES['SR Economy']
  // International (gap-closure #4a): a GPS override is always treated as domestic (the bounds guard
  // only admits in-Syria points); only a NAMED international destination marks the trip.
  const pickupResolved = resolvePlaceDetailed(pickup)
  const dropoffResolved = resolvePlaceDetailed(dropoff)
  const pickupCoords = isValidCoords(pickupCoordsOverride) ? pickupCoordsOverride : (pickupResolved && { lat: pickupResolved.lat, lng: pickupResolved.lng })
  const dropoffCoords = isValidCoords(dropoffCoordsOverride) ? dropoffCoordsOverride : (dropoffResolved && { lat: dropoffResolved.lat, lng: dropoffResolved.lng })
  const internationalTrip = Boolean(
    (!isValidCoords(pickupCoordsOverride) && pickupResolved?.international) ||
    (!isValidCoords(dropoffCoordsOverride) && dropoffResolved?.international)
  )
  const stopList = Array.isArray(stops) ? stops : []
  const stopCoords = stopList.map((stopText, index) => {
    const override = Array.isArray(stopCoordsOverrides) ? stopCoordsOverrides[index] : undefined
    return isValidCoords(override) ? override : resolvePlaceText(stopText)
  })

  // Distance: prefer a live road distance from Google (passed by the route); else sum gazetteer legs.
  let distanceKm = DEFAULT_DISTANCE_KM
  let estimated = true
  let distanceSource = 'estimate'
  if (Number.isFinite(distanceKmOverride) && distanceKmOverride > 0) {
    distanceKm = Math.max(1, distanceKmOverride)
    estimated = false
    distanceSource = 'google'
  } else {
    const routePoints = [pickupCoords, ...stopCoords, dropoffCoords]
    if (routePoints.every(Boolean)) {
      let total = 0
      for (let i = 0; i < routePoints.length - 1; i += 1) total += haversineKm(routePoints[i], routePoints[i + 1])
      distanceKm = Math.max(1, total)
      estimated = false
      distanceSource = 'gazetteer'
    }
  }

  // Trip minutes: prefer a live (traffic-aware) duration; else estimate from distance at city speed.
  const estimatedMinutes = Number.isFinite(estimatedMinutesOverride) && estimatedMinutesOverride > 0
    ? Math.round(estimatedMinutesOverride)
    : Math.max(1, Math.round((distanceKm / SR_AVG_SPEED_KMH) * 60))

  // BASE fare (USD), floored at the category minimum ("min ride").
  const airportTrip = isAirportPoint(pickupCoords) || isAirportPoint(dropoffCoords)
  const airportSurchargeUsd = airportTrip ? SR_AIRPORT_SURCHARGE_USD : 0
  const internationalSurchargeUsd = internationalTrip ? SR_INTERNATIONAL_SURCHARGE_USD : 0
  const zone = ringFeeUsd(pickupCoords, dropoffCoords)
  // Airport trip: fixed anchor by car quality (centre <-> airport) + the ring fee of the other end.
  let ringFeeApplied = zone.feeUsd
  let rawBaseUsd
  if (airportTrip) {
    const otherEnd = isAirportPoint(pickupCoords) ? dropoffCoords : pickupCoords
    const otherRing = ringOf(otherEnd)
    ringFeeApplied = otherRing ? (otherRing - 1) * SR_RING_FEE_USD : 0
    rawBaseUsd = airportBaseUsd(category) + ringFeeApplied + (lowDataMode ? 0 : LIVE_TRACKING_SURCHARGE_USD) + internationalSurchargeUsd
  } else {
    rawBaseUsd = rates.baseUsd
      + zone.feeUsd
      + rates.perKmUsd * distanceKm
      + rates.perMinUsd * estimatedMinutes
      + (lowDataMode ? 0 : LIVE_TRACKING_SURCHARGE_USD)
      + airportSurchargeUsd
      + internationalSurchargeUsd
  }
  const baseFareUsd = Math.max(rates.minFareUsd || 0, rawBaseUsd)

  // Per-trip additive fees: stops, extra bags, extra riders.
  const stopsCount = stopList.length
  const stopsFeeUsd = stopsCount * SR_STOP_FEE_USD
  const bags = Math.max(0, Math.floor(Number(bagCount) || 0))
  const bagsFeeUsd = Math.max(0, bags - SR_FREE_BAGS) * SR_BAG_FEE_USD
  const riders = Math.max(1, Math.floor(Number(riderCount) || 1))
  const extraRiders = Math.max(0, riders - SR_BASE_RIDERS)
  const ridersFeeUsd = extraRiders * SR_EXTRA_RIDER_FEE_USD
  const preFactorUsd = baseFareUsd + stopsFeeUsd + bagsFeeUsd + ridersFeeUsd

  // Variable multipliers.
  const nowDate = now instanceof Date ? now : new Date()
  const peak = isPeakHour(nowDate)
  const night = isNightHour(nowDate)
  let trafficMultiplier
  let trafficSource
  if (Number.isFinite(trafficMultiplierOverride) && trafficMultiplierOverride >= 1) {
    trafficMultiplier = Math.min(SR_TRAFFIC_MAX, trafficMultiplierOverride)
    trafficSource = 'google'
  } else {
    trafficMultiplier = peak ? SR_TRAFFIC_PEAK_MULTIPLIER : 1
    trafficSource = peak ? 'peak-proxy' : 'none'
  }
  const nightMultiplier = night ? SR_NIGHT_MULTIPLIER : 1
  const day = dayFactor(nowDate)
  const dateMultiplier = day.multiplier
  const scheduleMultiplier = scheduled ? SR_SCHEDULE_MULTIPLIER : 1
  const fuelMultiplier = 1 + SR_FUEL_SURCHARGE_PERCENT / 100
  const demandMultiplier = SR_DEMAND_SURGE_MULTIPLIER
  const combined = fuelMultiplier * trafficMultiplier * nightMultiplier * scheduleMultiplier * demandMultiplier * dateMultiplier
  const surgeMultiplier = Math.round(combined * 1000) / 1000
  const variedUsd = preFactorUsd * combined

  // Round the charged fare UP to the nearest step (never round a fare down).
  const fareMinor = Math.ceil(variedUsd / SR_FARE_ROUNDING_USD) * SR_FARE_ROUNDING_USD

  return {
    fareMinor,
    currency: SR_FARE_CURRENCY,
    distanceKm: Math.round(distanceKm * 10) / 10,
    estimatedMinutes,
    estimated,
    distanceSource,
    baseFareMinor: Math.ceil(baseFareUsd),
    ring: zone.ring,
    ringFee: ringFeeApplied,
    dayType: day.type,
    dateMultiplier,
    airportSurcharge: airportSurchargeUsd,
    airportTrip,
    internationalSurcharge: internationalSurchargeUsd,
    internationalTrip,
    stopsCount,
    stopsFee: stopsFeeUsd,
    bagCount: bags,
    bagsFee: bagsFeeUsd,
    riderCount: riders,
    ridersFee: ridersFeeUsd,
    fuelSurchargePercent: SR_FUEL_SURCHARGE_PERCENT,
    trafficMultiplier: Math.round(trafficMultiplier * 1000) / 1000,
    trafficSource,
    isPeak: peak,
    isNight: night,
    nightMultiplier,
    scheduled: Boolean(scheduled),
    scheduleMultiplier,
    demandMultiplier,
    surgeMultiplier,
    pickupCoords,
    dropoffCoords,
    stopCoords,
  }
}
