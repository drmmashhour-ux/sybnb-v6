// Verified agent / agency / developer directory (2026-10-11). Centris-parity "Find a broker".
// Public, read-only. An "agent" is a SellerProfile with a professional sellerType whose documents
// are APPROVED (verified). Contact details are never exposed here — buyers reach them through a
// listing's existing contact flow.
import { publicListingMedia } from '../lib/listing-media-url.mjs'
import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { publicListingVisibilityWhere } from '../lib/host-verification.mjs'

const PRO_TYPES = ['broker', 'agency', 'developer']

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
    metadata,
    media: publicListingMedia(l.media),
    location: l.location
      ? { country: l.location.country, governorate: l.location.governorate, city: l.location.city, area: l.location.area, lat: l.location.lat ?? null, lng: l.location.lng ?? null }
      : null,
  }
}

function toPublicAgent(sp, listingCount) {
  return {
    id: sp.user.id,
    displayName: sp.user.displayName,
    legalName: sp.legalName,
    sellerType: sp.sellerType,
    city: sp.user.hostProfile?.city || null,
    about: sp.user.hostProfile?.about || null,
    languages: sp.user.hostProfile?.languages || [],
    listingCount: listingCount ?? 0,
    verified: true,
  }
}


async function agentRating(userId) {
  const agg = await db().agentReview.aggregate({ where: { agentId: userId }, _avg: { rating: true }, _count: { _all: true } })
  const count = agg._count._all || 0
  return { average: count ? Math.round((agg._avg.rating || 0) * 10) / 10 : null, count }
}

export async function handleAgents(req, res, url, context) {
  const path = url.pathname
  if (!path.startsWith('/api/agents')) return false

  // GET /api/agents — directory
  if (path === '/api/agents' && req.method === 'GET') {
    const sellers = await db().sellerProfile.findMany({
      where: { sellerType: { in: PRO_TYPES }, documentStatus: 'APPROVED' },
      include: { user: { select: { id: true, displayName: true, hostProfile: { select: { city: true, about: true, languages: true } } } } },
      take: 200,
    })
    const ownerIds = sellers.map((s) => s.user.id)
    let countMap = new Map()
    if (ownerIds.length) {
      const counts = await db().listing.groupBy({ by: ['ownerId'], where: { ownerId: { in: ownerIds }, status: 'APPROVED', ...publicListingVisibilityWhere() }, _count: { _all: true } })
      countMap = new Map(counts.map((c) => [c.ownerId, c._count._all]))
    }
    const agents = sellers
      .map((sp) => toPublicAgent(sp, countMap.get(sp.user.id) || 0))
      // Show agents with at least one live listing first, then the rest; both alphabetical-ish by name.
      .sort((a, b) => (b.listingCount - a.listingCount) || a.displayName.localeCompare(b.displayName))
    return json(res, 200, { ok: true, agents })
  }

  // GET /api/agents/:id — one agent profile + their active listings
  const byId = path.match(/^\/api\/agents\/([^/]+)$/)
  if (byId && req.method === 'GET') {
    const userId = decodeURIComponent(byId[1])
    const sp = await db().sellerProfile.findFirst({
      where: { userId, sellerType: { in: PRO_TYPES }, documentStatus: 'APPROVED' },
      include: { user: { select: { id: true, displayName: true, hostProfile: { select: { city: true, about: true, languages: true } } } } },
    })
    if (!sp) return json(res, 200, { ok: true, agent: null, listings: [] })
    const listings = await db().listing.findMany({
      // Host-visibility parity: a gated-division (STAYS) listing from a non-verified owner stays hidden
      // on the public agent profile too, matching comparables/reviews/market/search.
      where: { ownerId: userId, status: 'APPROVED', ...publicListingVisibilityWhere() },
      include: { media: { orderBy: { sortOrder: 'asc' }, take: 1 }, location: true },
      orderBy: { approvedAt: 'desc' },
      take: 60,
    })
    const rating = await agentRating(userId)
    return json(res, 200, { ok: true, agent: { ...toPublicAgent(sp, listings.length), rating }, listings: listings.map(toPublicListing) })
  }

  // /api/agents/:id/reviews — list (GET) or create/update (POST, one per author per agent)
  const reviewsMatch = path.match(/^\/api\/agents\/([^/]+)\/reviews$/)
  if (reviewsMatch) {
    const agentId = decodeURIComponent(reviewsMatch[1])
    if (req.method === 'GET') {
      const reviews = await db().agentReview.findMany({
        where: { agentId },
        include: { author: { select: { id: true, displayName: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      })
      const rating = await agentRating(agentId)
      return json(res, 200, { ok: true, reviews, ...rating })
    }
    if (req.method === 'POST') {
      requireAuth(context, ['GUEST'])
      if (agentId === context.user.id) {
        const error = new Error('You cannot review your own profile.')
        error.statusCode = 400; error.code = 'AGENT_REVIEW_SELF'; error.expose = true
        throw error
      }
      // The target must be a verified professional.
      const sp = await db().sellerProfile.findFirst({ where: { userId: agentId, sellerType: { in: PRO_TYPES }, documentStatus: 'APPROVED' }, select: { id: true } })
      if (!sp) {
        const error = new Error('Agent not found.')
        error.statusCode = 404; error.code = 'AGENT_NOT_FOUND'; error.expose = true
        throw error
      }
      const body = await readJson(req)
      const rating = Number(body.rating)
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        const error = new Error('rating must be an integer from 1 to 5.')
        error.statusCode = 400; error.code = 'AGENT_REVIEW_RATING_INVALID'; error.expose = true
        throw error
      }
      const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 1500) || null : null
      const review = await db().agentReview.upsert({
        where: { agentId_authorId: { agentId, authorId: context.user.id } },
        update: { rating, comment },
        create: { agentId, authorId: context.user.id, rating, comment },
        include: { author: { select: { id: true, displayName: true } } },
      })
      return json(res, 201, { ok: true, review })
    }
    return methodNotAllowed(res, ['GET', 'POST'])
  }

  return false
}
