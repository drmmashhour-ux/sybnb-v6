// SR smart-pricing helpers: Damascus ring zones + day/date factor. Pure, no I/O.
// Every number is env-tunable (safe defaults) so the owner can retune without a code change.
const num = (name, def, min, max) => {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw >= min && raw <= max ? raw : def
}

// Ring centre: Umayyad Square, central Damascus.
export const DAMASCUS_CENTER = { lat: 33.5138, lng: 36.2765 }
export const SR_RING_COUNT = Math.round(num('SR_RING_COUNT', 10, 1, 30))
export const SR_RING_WIDTH_KM = num('SR_RING_WIDTH_KM', 3, 0.5, 20)
// Surcharge added per ring index (ring 1 = centre, adds 0; ring N adds (N-1) x this), USD.
export const SR_RING_FEE_USD = num('SR_RING_FEE_USD', 0.4, 0, 10)

function distKm(a, b) {
  const r = (d) => (d * Math.PI) / 180
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

// Ring 1..SR_RING_COUNT (outside the last ring stays at the last ring); null without coordinates.
export function ringOf(coords) {
  if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return null
  const ring = Math.floor(distKm(coords, DAMASCUS_CENTER) / SR_RING_WIDTH_KM) + 1
  return Math.min(SR_RING_COUNT, Math.max(1, ring))
}

// A trip is priced by its OUTER ring (pickup or drop-off, whichever is farther out).
export function ringFeeUsd(pickupCoords, dropoffCoords) {
  const rings = [ringOf(pickupCoords), ringOf(dropoffCoords)].filter(Boolean)
  const ring = rings.length ? Math.max(...rings) : null
  return { ring, feeUsd: ring ? (ring - 1) * SR_RING_FEE_USD : 0 }
}

// Day / date factor in Syria local time (UTC+3). Holidays beat the weekend factor (no stacking).
// Defaults: fixed-date public holidays; movable ones (Eid, Ramadan) come from env
// SR_HOLIDAYS="2027-03-10,2027-03-11,2027-05-17" (YYYY-MM-DD, local date).
const WEEKEND_MULT = num('SR_WEEKEND_MULTIPLIER', 1.08, 1, 3) // Friday + Saturday
const HOLIDAY_MULT = num('SR_HOLIDAY_MULTIPLIER', 1.2, 1, 3)
const FIXED_HOLIDAYS = ['01-01', '03-08', '04-17', '05-01', '05-06', '12-25']
function localDate(date) {
  return new Date(date.getTime() + 3 * 3600 * 1000)
}
export function dayFactor(date = new Date()) {
  const local = localDate(date)
  const iso = local.toISOString().slice(0, 10)
  const extra = String(process.env.SR_HOLIDAYS || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (FIXED_HOLIDAYS.includes(iso.slice(5)) || extra.includes(iso)) return { type: 'holiday', multiplier: HOLIDAY_MULT }
  const dow = local.getUTCDay() // 5 = Friday, 6 = Saturday
  if (dow === 5 || dow === 6) return { type: 'weekend', multiplier: WEEKEND_MULT }
  return { type: 'weekday', multiplier: 1 }
}

// Airport anchor: centre of Damascus <-> Damascus airport = SR_AIRPORT_BASE_USD (default $20) for
// Economy; the other categories scale by car quality. The ring fee of the NON-airport end is added on
// top, so an address outside the centre costs more than the $20 anchor. Env SR_AIRPORT_BASE_USD.
export const SR_AIRPORT_BASE_USD = num('SR_AIRPORT_BASE_USD', 20, 1, 500)
const QUALITY = { 'SR Bike': 0.7, 'SR Economy': 1, 'SR Comfort': 1.25, 'SR SUV': 1.5, 'SR Van': 1.8, 'SR VIP': 2.4 }
export const airportBaseUsd = (category) => SR_AIRPORT_BASE_USD * (QUALITY[category] ?? 1)
