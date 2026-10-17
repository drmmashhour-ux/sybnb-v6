// "Price confirmed by owner N days ago." Only for divisions whose price drifts (property sale/rent,
// new projects, vehicles). Listings created before this feature have no stamp: they fall back to the
// date they were listed, and are worded as "listed", never as "confirmed".
export const PRICE_STALE_DAYS = 14
const VOLATILE = new Set(['BUY', 'RENTALS', 'CARS', 'NEW_CONSTRUCTION'])

export type PriceFreshness = { applies: boolean; confirmed: boolean; days: number; stale: boolean }

export function priceFreshness(listing: { division?: string; createdAt?: string | null; metadata?: Record<string, unknown> | null }, now = Date.now()): PriceFreshness {
  if (!listing.division || !VOLATILE.has(listing.division)) return { applies: false, confirmed: false, days: 0, stale: false }
  const stamp = listing.metadata?.priceConfirmedAt
  const confirmedAt = typeof stamp === 'string' ? Date.parse(stamp) : NaN
  const fallback = listing.createdAt ? Date.parse(listing.createdAt) : NaN
  const base = Number.isFinite(confirmedAt) ? confirmedAt : fallback
  if (!Number.isFinite(base)) return { applies: false, confirmed: false, days: 0, stale: false }
  const days = Math.max(0, Math.floor((now - base) / 86_400_000))
  return { applies: true, confirmed: Number.isFinite(confirmedAt), days, stale: days >= PRICE_STALE_DAYS }
}
