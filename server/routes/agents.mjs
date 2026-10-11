// Verified agent / agency / developer directory (2026-10-11). Centris-parity "Find a broker".
// Public, read-only. An "agent" is a SellerProfile with a professional sellerType whose documents
// are APPROVED (verified). Contact details are never exposed here — buyers reach them through a
// listing's existing contact flow.
import { db } from '../lib/prisma.mjs'
import { json } from '../lib/responses.mjs'

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
    media: l.media,
    location: l.location
      ? { country: l.location.country, governorate: l.location.governorate, city: l.location.city, area: l.location.area }
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
      const counts = await db().listing.groupBy({ by: ['ownerId'], where: { ownerId: { in: ownerIds }, status: 'APPROVED' }, _count: { _all: true } })
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
      where: { ownerId: userId, status: 'APPROVED' },
      include: { media: { orderBy: { sortOrder: 'asc' }, take: 1 }, location: true },
      orderBy: { approvedAt: 'desc' },
      take: 60,
    })
    return json(res, 200, { ok: true, agent: toPublicAgent(sp, listings.length), listings: listings.map(toPublicListing) })
  }

  return false
}
