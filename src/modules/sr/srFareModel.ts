// Mirror of the server SR fare model (countries/syria/geo/geocoding.mjs: CATEGORY_RATES +
// LIVE_TRACKING_SURCHARGE_MINOR + DEFAULT_DISTANCE_KM). Used ONLY for the pre-quote fallback shown
// before /api/sr/quote responds, so the first number the rider sees equals the server's own
// estimate for an as-yet-unresolved address — never a stale flat rate several times the real fare.
// The server quote remains the source of truth once it returns; keep these constants in sync.
type Rate = { baseMinor: number; perKmMinor: number; perMinMinor: number; minFareMinor: number }
const CATEGORY_RATES: Record<string, Rate> = {
  'SR Bike': { baseMinor: 4000, perKmMinor: 500, perMinMinor: 100, minFareMinor: 6000 },
  'SR Economy': { baseMinor: 8000, perKmMinor: 900, perMinMinor: 150, minFareMinor: 12000 },
  'SR Comfort': { baseMinor: 12000, perKmMinor: 1300, perMinMinor: 200, minFareMinor: 18000 },
  'SR SUV': { baseMinor: 18000, perKmMinor: 1800, perMinMinor: 300, minFareMinor: 28000 },
  'SR Van': { baseMinor: 20000, perKmMinor: 2000, perMinMinor: 350, minFareMinor: 32000 },
}
const LIVE_TRACKING_SURCHARGE_MINOR = 2500
const DEFAULT_DISTANCE_KM = 5
const SR_AVG_SPEED_KMH = 28

export function srFallbackFareMinor(category: string, lowDataMode: boolean): number {
  const rates = CATEGORY_RATES[category] || CATEGORY_RATES['SR Economy']
  const estMinutes = Math.max(1, Math.round((DEFAULT_DISTANCE_KM / SR_AVG_SPEED_KMH) * 60))
  const raw = rates.baseMinor + rates.perKmMinor * DEFAULT_DISTANCE_KM + rates.perMinMinor * estMinutes + (lowDataMode ? 0 : LIVE_TRACKING_SURCHARGE_MINOR)
  return Math.round(Math.max(rates.minFareMinor, raw) / 500) * 500
}
