// Mirror of the server SR fare model (countries/syria/geo/geocoding.mjs). Used ONLY for the pre-quote
// fallback shown before /api/sr/quote responds, so the first number the rider sees is the server's own
// ballpark for an as-yet-unresolved address, in USD -- never a stale value. The server quote remains
// the source of truth once it returns. Fuel%, demand and the airport surcharge are operator/route
// factors the client can't know pre-quote, so the fallback mirrors only the base fare and the
// automatic peak-hour multiplier (which depends only on the clock). Keep these constants in sync.
type Rate = { baseUsd: number; perKmUsd: number; perMinUsd: number; minFareUsd: number }
const CATEGORY_RATES: Record<string, Rate> = {
  'SR Bike': { baseUsd: 0.8, perKmUsd: 0.11, perMinUsd: 0.015, minFareUsd: 3 },
  'SR Economy': { baseUsd: 1.2, perKmUsd: 0.18, perMinUsd: 0.02, minFareUsd: 4 },
  'SR Comfort': { baseUsd: 1.5, perKmUsd: 0.22, perMinUsd: 0.028, minFareUsd: 5 },
  'SR SUV': { baseUsd: 2.2, perKmUsd: 0.32, perMinUsd: 0.045, minFareUsd: 7 },
  'SR Van': { baseUsd: 2.8, perKmUsd: 0.38, perMinUsd: 0.055, minFareUsd: 9 },
  'SR VIP': { baseUsd: 3.5, perKmUsd: 0.5, perMinUsd: 0.07, minFareUsd: 12 },
}
const LIVE_TRACKING_SURCHARGE_USD = 0.2
const DEFAULT_DISTANCE_KM = 5
const SR_AVG_SPEED_KMH = 28
const SR_PEAK_SURGE_MULTIPLIER = 1.25
const SR_FARE_ROUNDING_USD = 5 // mirror of server default; fares round up to the nearest $5
const SR_NIGHT_MULTIPLIER = 1.15 // mirror of server default (22:00-05:59 local)
const SYRIA_UTC_OFFSET_HOURS = 3

// Mirror of the server peak-hour window (fixed UTC+3; peaks 07:00-09:59 and 16:00-19:59 local).
export function srIsPeakHour(date: Date = new Date()): boolean {
  const localHour = (date.getUTCHours() + SYRIA_UTC_OFFSET_HOURS) % 24
  return (localHour >= 7 && localHour < 10) || (localHour >= 16 && localHour < 20)
}

export function srIsNightHour(date: Date = new Date()): boolean {
  const localHour = (date.getUTCHours() + SYRIA_UTC_OFFSET_HOURS) % 24
  return localHour >= 22 || localHour < 6
}

// Live rates from the server (/api/sr/rates), so the first estimate follows what the admin set. Until they arrive
// (or if the request fails) the constants above are used.
type LiveRates = { rates: Record<string, Rate>; minChargeUsd: number; roundingUsd: number; liveTrackingUsd: number; safetyFeePerTripUsd: number; peak: number; night: number; avgSpeedKmh: number }
let live: LiveRates | null = null
export async function loadSrRates(apiBase: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiBase}/api/sr/rates`)
    if (!res.ok) return false
    const j = await res.json()
    if (!j?.ok || !j.rates) return false
    live = j as LiveRates
    return true
  } catch { return false }
}

export function srFallbackFareMinor(category: string, lowDataMode: boolean): number {
  const L = live
  const rates = (L ? L.rates : CATEGORY_RATES)[category] || (L ? L.rates : CATEGORY_RATES)['SR Economy']
  const speed = L?.avgSpeedKmh ?? SR_AVG_SPEED_KMH
  const estMinutes = Math.max(1, Math.round((DEFAULT_DISTANCE_KM / speed) * 60))
  const base = rates.baseUsd + rates.perKmUsd * DEFAULT_DISTANCE_KM + rates.perMinUsd * estMinutes + (L ? L.safetyFeePerTripUsd : 0) + (lowDataMode ? 0 : (L?.liveTrackingUsd ?? LIVE_TRACKING_SURCHARGE_USD))
  const floored = Math.max(rates.minFareUsd, L?.minChargeUsd ?? 0, base)
  const varied = floored * (srIsPeakHour() ? (L?.peak ?? SR_PEAK_SURGE_MULTIPLIER) : 1) * (srIsNightHour() ? (L?.night ?? SR_NIGHT_MULTIPLIER) : 1)
  const step = L?.roundingUsd ?? SR_FARE_ROUNDING_USD
  return Math.max(Math.ceil(L?.minChargeUsd ?? 0), Math.ceil(varied / step) * step)
}
