// Mirror of the server SR fare model (countries/syria/geo/geocoding.mjs: CATEGORY_RATES +
// LIVE_TRACKING_SURCHARGE_MINOR + DEFAULT_DISTANCE_KM). Used ONLY for the pre-quote fallback shown
// before /api/sr/quote responds, so the first number the rider sees equals the server's own
// estimate for an as-yet-unresolved address — never a stale flat rate several times the real fare.
// The server quote remains the source of truth once it returns; keep these constants in sync.
const CATEGORY_RATES: Record<string, { baseMinor: number; perKmMinor: number }> = {
  'SR Economy': { baseMinor: 8000, perKmMinor: 900 },
  'SR Comfort': { baseMinor: 12000, perKmMinor: 1300 },
  'SR SUV': { baseMinor: 18000, perKmMinor: 1800 },
}
const LIVE_TRACKING_SURCHARGE_MINOR = 2500
const DEFAULT_DISTANCE_KM = 5

export function srFallbackFareMinor(category: string, lowDataMode: boolean): number {
  const rates = CATEGORY_RATES[category] || CATEGORY_RATES['SR Economy']
  const raw = rates.baseMinor + rates.perKmMinor * DEFAULT_DISTANCE_KM + (lowDataMode ? 0 : LIVE_TRACKING_SURCHARGE_MINOR)
  return Math.round(raw / 500) * 500
}
