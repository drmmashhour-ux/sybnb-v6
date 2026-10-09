// Mirror of the server SR fare model (countries/syria/geo/geocoding.mjs: CATEGORY_RATES +
// LIVE_TRACKING_SURCHARGE_MINOR + DEFAULT_DISTANCE_KM). Used ONLY for the pre-quote fallback shown
// before /api/sr/quote responds, so the first number the rider sees equals the server's own
// estimate for an as-yet-unresolved address — never a stale flat rate several times the real fare.
// The server quote remains the source of truth once it returns; keep these constants in sync.
type Rate = { baseMinor: number; perKmMinor: number; perMinMinor: number; minFareMinor: number }
const CATEGORY_RATES: Record<string, Rate> = {
  'SR Bike': { baseMinor: 6000, perKmMinor: 1100, perMinMinor: 150, minFareMinor: 8000 },
  'SR Economy': { baseMinor: 12000, perKmMinor: 2200, perMinMinor: 300, minFareMinor: 15000 },
  'SR Comfort': { baseMinor: 16000, perKmMinor: 2800, perMinMinor: 400, minFareMinor: 22000 },
  'SR SUV': { baseMinor: 22000, perKmMinor: 3600, perMinMinor: 550, minFareMinor: 32000 },
  'SR Van': { baseMinor: 26000, perKmMinor: 4200, perMinMinor: 650, minFareMinor: 40000 },
}
const LIVE_TRACKING_SURCHARGE_MINOR = 2500
const DEFAULT_DISTANCE_KM = 5
const SR_AVG_SPEED_KMH = 28
const SR_PEAK_SURGE_MULTIPLIER = 1.25
const SYRIA_UTC_OFFSET_HOURS = 3

// Mirror of the server peak-hour surge (countries/syria/geo/geocoding.mjs isPeakHour): fixed UTC+3,
// peaks 07:00-09:59 and 16:00-19:59 local. Used only for the pre-quote estimate; the server re-quotes.
export function srIsPeakHour(date: Date = new Date()): boolean {
  const localHour = (date.getUTCHours() + SYRIA_UTC_OFFSET_HOURS) % 24
  return (localHour >= 7 && localHour < 10) || (localHour >= 16 && localHour < 20)
}

export function srFallbackFareMinor(category: string, lowDataMode: boolean): number {
  const rates = CATEGORY_RATES[category] || CATEGORY_RATES['SR Economy']
  const estMinutes = Math.max(1, Math.round((DEFAULT_DISTANCE_KM / SR_AVG_SPEED_KMH) * 60))
  const raw = rates.baseMinor + rates.perKmMinor * DEFAULT_DISTANCE_KM + rates.perMinMinor * estMinutes + (lowDataMode ? 0 : LIVE_TRACKING_SURCHARGE_MINOR)
  const floored = Math.max(rates.minFareMinor, raw)
  const surged = floored * (srIsPeakHour() ? SR_PEAK_SURGE_MULTIPLIER : 1)
  return Math.round(surged / 500) * 500
}
