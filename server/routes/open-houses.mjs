// Open houses (migration 064, 2026-10-11). Centris-parity: a seller publishes a viewing window on a
// property; buyers see upcoming open houses on the listing and in a browse feed. Distinct from the
// 1:1 VisitRequest (schedule-a-visit) — an open house is a group/public viewing slot.
import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { publicListingVisibilityWhere } from '../lib/host-verification.mjs'

function toPublicOpenHouse(o) {
  return {
    id: o.id,
    listingId: o.listingId,
    startsAt: o.startsAt,
    endsAt: o.endsAt,
    note: o.note || null,
    status: o.status,
    listing: o.listing
      ? {
          id: o.listing.id,
          titleAr: o.listing.titleAr,
          titleEn: o.listing.titleEn,
          division: o.listing.division,
          priceMinor: o.listing.priceMinor,
          currency: o.listing.currency,
          media: o.listing.media,
          location: o.listing.location
            ? { city: o.listing.location.city, area: o.listing.location.area, governorate: o.listing.location.governorate }
            : null,
        }
      : undefined,
  }
}

function badRequest(message, code) {
  const error = new Error(message)
  error.statusCode = 400
  error.code = code
  error.expose = true
  return error
}

export async function handleOpenHouses(req, res, url, context) {
  const path = url.pathname

  // GET /api/open-houses/upcoming — browse feed of upcoming open houses across approved listings
  if (path === '/api/open-houses/upcoming' && req.method === 'GET') {
    const now = new Date()
    const division = url.searchParams.get('division') || undefined
    const rows = await db().openHouse.findMany({
      where: {
        status: 'SCHEDULED',
        endsAt: { gte: now },
        listing: { status: 'APPROVED', ...(division ? { division } : {}), ...publicListingVisibilityWhere(division || undefined) },
      },
      include: {
        listing: { include: { media: { orderBy: { sortOrder: 'asc' }, take: 1 }, location: true } },
      },
      orderBy: { startsAt: 'asc' },
      take: 60,
    })
    return json(res, 200, { ok: true, openHouses: rows.map(toPublicOpenHouse) })
  }

  // /api/listings/:id/open-houses — list (GET, public upcoming) or create (POST, owner)
  const listingMatch = path.match(/^\/api\/listings\/([^/]+)\/open-houses$/)
  if (listingMatch) {
    const listingId = listingMatch[1]
    if (req.method === 'GET') {
      const now = new Date()
      const rows = await db().openHouse.findMany({
        where: { listingId, status: 'SCHEDULED', endsAt: { gte: now }, listing: { status: 'APPROVED', ...publicListingVisibilityWhere() } },
        orderBy: { startsAt: 'asc' },
        take: 30,
      })
      return json(res, 200, { ok: true, openHouses: rows.map(toPublicOpenHouse) })
    }
    if (req.method === 'POST') {
      requireAuth(context, ['SELLER', 'HOST'])
      const listing = await db().listing.findFirst({ where: { id: listingId }, select: { id: true, ownerId: true } })
      if (!listing || listing.ownerId !== context.user.id) {
        const error = new Error('Listing not found for this account.')
        error.statusCode = 404; error.code = 'LISTING_NOT_FOUND'; error.expose = true
        throw error
      }
      const body = await readJson(req)
      const startsAt = new Date(body.startsAt)
      const endsAt = new Date(body.endsAt)
      if (isNaN(startsAt.getTime()) || isNaN(endsAt.getTime())) throw badRequest('startsAt and endsAt must be valid dates.', 'OPEN_HOUSE_DATES_INVALID')
      if (endsAt <= startsAt) throw badRequest('endsAt must be after startsAt.', 'OPEN_HOUSE_RANGE_INVALID')
      if (endsAt <= new Date()) throw badRequest('Open house must be in the future.', 'OPEN_HOUSE_IN_PAST')
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) || null : null
      const created = await db().openHouse.create({ data: { listingId, startsAt, endsAt, note } })
      return json(res, 201, { ok: true, openHouse: toPublicOpenHouse(created) })
    }
    return methodNotAllowed(res, ['GET', 'POST'])
  }

  // DELETE /api/open-houses/:id — owner cancels
  const byId = path.match(/^\/api\/open-houses\/([^/]+)$/)
  if (byId && path !== '/api/open-houses/upcoming') {
    if (req.method !== 'DELETE') return methodNotAllowed(res, ['DELETE'])
    requireAuth(context, ['SELLER', 'HOST'])
    const oh = await db().openHouse.findFirst({ where: { id: byId[1] }, include: { listing: { select: { ownerId: true } } } })
    if (!oh || oh.listing?.ownerId !== context.user.id) {
      const error = new Error('Open house not found for this account.')
      error.statusCode = 404; error.code = 'OPEN_HOUSE_NOT_FOUND'; error.expose = true
      throw error
    }
    await db().openHouse.update({ where: { id: oh.id }, data: { status: 'CANCELLED' } })
    return json(res, 200, { ok: true })
  }

  return false
}
