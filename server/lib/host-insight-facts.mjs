import { db } from './prisma.mjs'

const MIN_OPEN_NIGHTS_FOR_INSIGHT = 7

function isoDate(date) {
  return date.toISOString().slice(0, 10)
}

function datesInRange(from, to) {
  const dates = []
  let day = new Date(from)
  while (day < to) {
    dates.push(isoDate(day))
    day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)
  }
  return dates
}

// Pure Prisma + JS, zero external calls — the AI's job (server/lib/ai-insights.mjs) is only to
// phrase these already-computed real facts naturally, never to invent numbers itself.
export async function computePricingGapFacts(hostId, { lookaheadDays = 30 } = {}) {
  const from = new Date()
  const to = new Date(from.getTime() + 1000 * 60 * 60 * 24 * lookaheadDays)

  const listings = await db().listing.findMany({
    where: { ownerId: hostId, division: 'STAYS', status: 'APPROVED' },
    select: { id: true, titleAr: true, priceMinor: true, currency: true },
  })
  if (!listings.length) return []

  const listingIds = listings.map((listing) => listing.id)
  const [blockedRows, overrideRows, activeBookings] = await Promise.all([
    db().listingAvailability.findMany({
      where: { listingId: { in: listingIds }, status: 'BLOCKED', date: { gte: from, lt: to } },
      select: { listingId: true, date: true },
    }),
    db().listingAvailability.findMany({
      where: { listingId: { in: listingIds }, priceOverrideMinor: { not: null }, date: { gte: from, lt: to } },
      select: { listingId: true, date: true },
    }),
    db().booking.findMany({
      where: {
        listingId: { in: listingIds },
        status: { in: ['REQUESTED', 'PAYMENT_PENDING', 'CONFIRMED'] },
        checkIn: { lt: to },
        checkOut: { gt: from },
      },
      select: { listingId: true, checkIn: true, checkOut: true },
    }),
  ])

  const unavailableByListing = new Map()
  const addUnavailable = (listingId, date) => {
    if (!unavailableByListing.has(listingId)) unavailableByListing.set(listingId, new Set())
    unavailableByListing.get(listingId).add(date)
  }
  for (const row of blockedRows) addUnavailable(row.listingId, isoDate(row.date))
  for (const row of overrideRows) addUnavailable(row.listingId, isoDate(row.date))
  for (const booking of activeBookings) {
    for (const date of datesInRange(booking.checkIn, booking.checkOut)) {
      addUnavailable(booking.listingId, date)
    }
  }

  const allDates = datesInRange(from, to)
  const facts = []
  for (const listing of listings) {
    const unavailable = unavailableByListing.get(listing.id) || new Set()
    const openNights = allDates.filter((date) => !unavailable.has(date))
    if (openNights.length < MIN_OPEN_NIGHTS_FOR_INSIGHT) continue
    facts.push({
      listingId: listing.id,
      titleAr: listing.titleAr,
      priceMinor: listing.priceMinor,
      currency: listing.currency,
      openNightsCount: openNights.length,
      openNightsSample: openNights.slice(0, 5),
    })
  }
  return facts
}
