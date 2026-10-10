// Centris-parity Phase 1 (2026-10-10): favourites (saved listings) + saved searches.
// All endpoints are user-scoped and require a session. Saved searches additionally power the
// new-listing alert sweep (server/lib/saved-search-alerts.mjs).
import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, readJson } from '../lib/responses.mjs'

const DIVISIONS = new Set(['STAYS', 'RENTALS', 'BUY', 'CARS', 'MARKETPLACE', 'NEW_CONSTRUCTION'])

function badRequest(message, code = 'BAD_REQUEST', statusCode = 400) {
  const err = new Error(message)
  err.statusCode = statusCode
  err.code = code
  err.expose = true
  return err
}

// Minimal public listing shape for favourites (mirrors listings.mjs toPublicListing's safe subset).
function toPublicListing(l) {
  if (!l) return null
  const metadata = { ...(l.metadata || {}) }
  delete metadata.inventory_source
  return {
    id: l.id,
    ownerId: l.ownerId,
    division: l.division,
    titleAr: l.titleAr,
    titleEn: l.titleEn,
    description: l.description,
    status: l.status,
    priceMinor: l.priceMinor,
    currency: l.currency,
    instantBookEnabled: l.instantBookEnabled,
    expiresAt: l.expiresAt,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
    metadata,
    media: l.media,
    location: l.location
      ? { country: l.location.country, governorate: l.location.governorate, city: l.location.city, area: l.location.area }
      : null,
  }
}

function sanitizeFilters(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const allowed = ['city', 'priceMin', 'priceMax', 'bedroomsMin', 'bathroomsMin',
    'carBrand', 'carBody', 'carFuel', 'carTransmission', 'condition', 'propertyType', 'marketCategory',
    'amenities', 'views', 'access', 'sort', 'priceBand']
  const out = {}
  for (const k of allowed) {
    if (raw[k] === undefined || raw[k] === null || raw[k] === '' || raw[k] === 'any') continue
    const v = raw[k]
    if (Array.isArray(v)) out[k] = v.slice(0, 20).map((x) => String(x).slice(0, 64))
    else if (typeof v === 'number') out[k] = v
    else out[k] = String(v).slice(0, 120)
  }
  return out
}

export async function handleEngagement(req, res, url, context) {
  const path = url.pathname

  // ---- Favourites ----
  if (path === '/api/favourites') {
    if (req.method === 'GET') {
      requireAuth(context)
      const rows = await db().favourite.findMany({
        where: { userId: context.user.id },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { listing: { include: { media: { orderBy: { sortOrder: 'asc' }, take: 1 }, location: true } } },
      })
      return json(res, 200, { ok: true, favourites: rows.map((r) => ({ id: r.id, listingId: r.listingId, createdAt: r.createdAt, listing: toPublicListing(r.listing) })) })
    }
    if (req.method === 'POST') {
      requireAuth(context)
      const body = await readJson(req)
      const listingId = String(body.listingId || '').trim()
      if (!listingId) throw badRequest('listingId is required.', 'LISTING_REQUIRED')
      const listing = await db().listing.findUnique({ where: { id: listingId }, select: { id: true } })
      if (!listing) throw badRequest('Listing not found.', 'LISTING_NOT_FOUND', 404)
      const fav = await db().favourite.upsert({
        where: { userId_listingId: { userId: context.user.id, listingId } },
        create: { userId: context.user.id, listingId },
        update: {},
      })
      return json(res, 201, { ok: true, favourite: { id: fav.id, listingId } })
    }
  }

  const favDel = path.match(/^\/api\/favourites\/([^/]+)$/)
  if (favDel && req.method === 'DELETE') {
    requireAuth(context)
    const listingId = decodeURIComponent(favDel[1])
    await db().favourite.deleteMany({ where: { userId: context.user.id, listingId } })
    return json(res, 200, { ok: true })
  }

  // ---- Saved searches ----
  if (path === '/api/saved-searches') {
    if (req.method === 'GET') {
      requireAuth(context)
      const rows = await db().savedSearch.findMany({ where: { userId: context.user.id }, orderBy: { createdAt: 'desc' }, take: 100 })
      return json(res, 200, { ok: true, savedSearches: rows.map((s) => ({ id: s.id, label: s.label, division: s.division, filters: s.filters, notifyOnNew: s.notifyOnNew, createdAt: s.createdAt })) })
    }
    if (req.method === 'POST') {
      requireAuth(context)
      const body = await readJson(req)
      const division = String(body.division || '').trim().toUpperCase()
      if (!DIVISIONS.has(division)) throw badRequest('A valid division is required.', 'DIVISION_REQUIRED')
      const filters = sanitizeFilters(body.filters)
      const label = body.label ? String(body.label).slice(0, 80) : null
      const notifyOnNew = body.notifyOnNew === false ? false : true
      // Cap saved searches per user to keep the alert sweep bounded.
      const count = await db().savedSearch.count({ where: { userId: context.user.id } })
      if (count >= 50) throw badRequest('You have reached the maximum number of saved searches (50).', 'SAVED_SEARCH_LIMIT', 409)
      const created = await db().savedSearch.create({
        data: { userId: context.user.id, division, filters, label, notifyOnNew, lastCheckedAt: new Date() },
      })
      return json(res, 201, { ok: true, savedSearch: { id: created.id, label: created.label, division: created.division, filters: created.filters, notifyOnNew: created.notifyOnNew, createdAt: created.createdAt } })
    }
  }

  const ssMatch = path.match(/^\/api\/saved-searches\/([^/]+)$/)
  if (ssMatch) {
    const id = decodeURIComponent(ssMatch[1])
    if (req.method === 'DELETE') {
      requireAuth(context)
      await db().savedSearch.deleteMany({ where: { id, userId: context.user.id } })
      return json(res, 200, { ok: true })
    }
    if (req.method === 'PATCH') {
      requireAuth(context)
      const body = await readJson(req)
      const data = {}
      if (typeof body.notifyOnNew === 'boolean') data.notifyOnNew = body.notifyOnNew
      if (body.label !== undefined) data.label = body.label ? String(body.label).slice(0, 80) : null
      if (!Object.keys(data).length) throw badRequest('Nothing to update.', 'NO_UPDATE')
      const r = await db().savedSearch.updateMany({ where: { id, userId: context.user.id }, data })
      if (r.count === 0) throw badRequest('Saved search not found.', 'NOT_FOUND', 404)
      return json(res, 200, { ok: true })
    }
  }

  return false
}
