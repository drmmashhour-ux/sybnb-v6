import { db } from './prisma.mjs'
import { getStayPricingConfig, priceStayNights } from './stay-pricing.mjs'

function toISODate(date) {
  return new Date(date).toISOString().slice(0, 10)
}

// Dates here are calendar dates with no meaningful time-of-day, but checkIn/checkOut arrive as
// UTC-midnight Date objects. Walking the range with local-timezone getters/setters can skip or
// duplicate a night depending on the server's timezone offset, so everything here stays in UTC.
function eachNight(checkIn, checkOut) {
  const nights = []
  let cursorMs = Date.UTC(new Date(checkIn).getUTCFullYear(), new Date(checkIn).getUTCMonth(), new Date(checkIn).getUTCDate())
  const endMs = Date.UTC(new Date(checkOut).getUTCFullYear(), new Date(checkOut).getUTCMonth(), new Date(checkOut).getUTCDate())
  while (cursorMs < endMs) {
    nights.push(toISODate(new Date(cursorMs)))
    cursorMs += 24 * 60 * 60 * 1000
  }
  return nights
}

// Computes what a stay actually costs, night by night: a host's per-date price override
// (weekend/high-season pricing) wins over the listing's base price for that specific night.
// Shared between the booking-quote endpoint and actual booking creation so a guest is never
// charged something different from what they were quoted.
// `client` lets a caller inside a transaction read with that transaction's connection. Booking
// creation holds a per-listing advisory lock on its transaction connection; reading the price
// overrides through a SECOND pooled connection meant that, with several guests racing for one
// listing, every pooled connection could be held by a transaction waiting for the lock while the
// lock holder waited for a free connection: requests failed after the pool timeout (P2024/P2028,
// HTTP 500) instead of the losers getting a clean 409. Measured: 7 of 10 racing requests got 500.
// Variable pricing (2026-10-22): night by night, a per-date calendar price wins; otherwise the
// host's weekend price on weekend nights, else the base price; then the admin's high-season uplift
// (unless the host opted out); then the host's weekly/monthly discount on the whole stay. See
// server/lib/stay-pricing.mjs. Returned totalMinor is the discounted stay amount every downstream
// figure (commission, guest totals, payment rails) is computed from.
export async function computeStayTotalMinor(listing, checkIn, checkOut, client = db()) {
  const nights = eachNight(checkIn, checkOut)
  if (!nights.length) {
    return { totalMinor: listing.priceMinor, subtotalMinor: listing.priceMinor, discountMinor: 0, discountPct: 0, discountKind: null, nights: 0, perNight: [] }
  }

  const overrides = await client.listingAvailability.findMany({
    where: {
      listingId: listing.id,
      date: { gte: new Date(checkIn), lt: new Date(checkOut) },
      priceOverrideMinor: { not: null },
    },
    select: { date: true, priceOverrideMinor: true },
  })
  const overrideByDate = new Map(overrides.map((row) => [toISODate(row.date), row.priceOverrideMinor]))
  const config = await getStayPricingConfig(client)
  const priced = priceStayNights({
    basePriceMinor: listing.priceMinor,
    nights,
    overrides: overrideByDate,
    hostPricing: listing.metadata?.pricing,
    config,
  })

  return { ...priced, nights: nights.length }
}
