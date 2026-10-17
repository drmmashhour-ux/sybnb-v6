import { db } from '../lib/prisma.mjs'
import { json, methodNotAllowed } from '../lib/responses.mjs'
import { dateBlockingBookingWhere } from '../lib/booking-policy.mjs'
import { publicListingVisibilityWhere } from '../lib/host-verification.mjs'
import { bookingPolicySettings } from '../lib/country.mjs'
import { planSplitStays, nightsBetween } from '../lib/split-stay.mjs'

// GET /api/split-stay?city=Hama&checkIn=2026-12-01&checkOut=2026-12-09
// Read-only suggestion. When no single stay in the city is free for the whole range, returns pairs of
// stays that together cover it (A then B, back to back). Nothing is reserved here: the guest books
// each leg through the normal booking flow, so every existing availability, price and payment rule
// still applies to each leg.
const MAX_NIGHTS = 60
const MAX_CANDIDATES = 80

function fail(message, code = 'SPLIT_STAY_INVALID') {
  const error = new Error(message)
  error.statusCode = 400
  error.code = code
  error.expose = true
  return error
}

function dateParam(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) ? value : null
}

export async function handleSplitStay(req, res, url) {
  if (url.pathname !== '/api/split-stay') return false
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])

  const city = String(url.searchParams.get('city') || '').trim().slice(0, 80)
  const checkIn = dateParam(url.searchParams.get('checkIn'))
  const checkOut = dateParam(url.searchParams.get('checkOut'))
  if (!city) throw fail('city is required.')
  if (!checkIn || !checkOut || checkOut <= checkIn) throw fail('checkIn and checkOut are required and checkOut must be after checkIn.')
  const nights = nightsBetween(checkIn, checkOut)
  if (nights.length > MAX_NIGHTS) throw fail(`Split stays support up to ${MAX_NIGHTS} nights.`)

  const candidates = await db().listing.findMany({
    where: {
      status: 'APPROVED',
      division: 'STAYS',
      location: { city: { equals: city, mode: 'insensitive' } },
      ...publicListingVisibilityWhere('STAYS'),
    },
    select: { id: true, titleAr: true, titleEn: true, priceMinor: true, currency: true, metadata: true, location: { select: { city: true, area: true } } },
    orderBy: { createdAt: 'desc' },
    take: MAX_CANDIDATES,
  })
  // Demo/sample stays are not bookable; never suggest them.
  const listings = candidates.filter((l) => !(l.metadata && l.metadata.demo))
  const ids = listings.map((l) => l.id)
  if (!ids.length) return json(res, 200, { ok: true, singles: [], pairs: [], checkIn, checkOut, nights: nights.length })

  const from = new Date(`${checkIn}T00:00:00.000Z`)
  const to = new Date(`${checkOut}T00:00:00.000Z`)
  const [blocked, bookings] = await Promise.all([
    db().listingAvailability.findMany({
      where: { listingId: { in: ids }, status: 'BLOCKED', date: { gte: from, lt: to } },
      select: { listingId: true, date: true },
    }),
    db().booking.findMany({
      where: {
        listingId: { in: ids },
        checkIn: { lt: to },
        checkOut: { gt: from },
        ...dateBlockingBookingWhere(new Date(), bookingPolicySettings()),
      },
      select: { listingId: true, checkIn: true, checkOut: true },
    }),
  ])

  const free = new Map(ids.map((id) => [id, new Set(nights)]))
  for (const row of blocked) free.get(row.listingId)?.delete(row.date.toISOString().slice(0, 10))
  for (const b of bookings) {
    const set = free.get(b.listingId)
    if (!set) continue
    for (const night of nights) {
      const t = Date.parse(`${night}T00:00:00.000Z`)
      if (t >= b.checkIn.getTime() && t < b.checkOut.getTime()) set.delete(night)
    }
  }

  const plan = planSplitStays(nights, listings.map((l) => ({ id: l.id, priceMinor: l.priceMinor })), free)
  const byId = new Map(listings.map((l) => [l.id, l]))
  const brief = (id) => {
    const l = byId.get(id)
    return { id: l.id, titleAr: l.titleAr, titleEn: l.titleEn, priceMinor: l.priceMinor, currency: l.currency, city: l.location?.city || null, area: l.location?.area || null }
  }
  const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10)

  return json(res, 200, {
    ok: true,
    checkIn,
    checkOut,
    nights: nights.length,
    // A whole-range match exists: no split needed.
    singles: plan.singles.slice(0, 10).map(brief),
    pairs: plan.pairs.map((p) => {
      const splitDate = addDays(checkIn, p.firstNights)
      return {
        first: { ...brief(p.firstId), checkIn, checkOut: splitDate, nights: p.firstNights },
        second: { ...brief(p.secondId), checkIn: splitDate, checkOut, nights: p.secondNights },
        estimateMinor: p.estimateMinor,
        estimateNote: 'Nightly-rate estimate only; each part is quoted and booked separately.',
      }
    }),
  })
}
