import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { computeStayTotalMinor } from '../lib/pricing.mjs'
import { expireOldListings, listingExpiryDate } from '../lib/listing-lifecycle.mjs'

// STAYS/RENTALS/BUY are commission- or contact-based (no upfront platform fee, matching how
// Centris pays brokers on close rather than up front). CARS/MARKETPLACE/NEW_CONSTRUCTION are the
// paid-plan divisions gated behind an admin-approved SellerProfile.
const PAID_PLAN_DIVISIONS = new Set(['CARS', 'MARKETPLACE', 'NEW_CONSTRUCTION'])

export async function handleListings(req, res, url, context) {
  const quoteMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/quote$/)
  if (quoteMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    const checkIn = parseDateOnly(url.searchParams.get('checkIn'))
    const checkOut = parseDateOnly(url.searchParams.get('checkOut'))
    if (!checkIn || !checkOut || checkOut <= checkIn) {
      const error = new Error('checkIn and checkOut are required and checkOut must be after checkIn.')
      error.statusCode = 400
      error.code = 'QUOTE_DATES_INVALID'
      error.expose = true
      throw error
    }
    const listing = await db().listing.findFirst({ where: { id: quoteMatch[1], status: 'APPROVED' } })
    if (!listing) {
      const error = new Error('Listing not found.')
      error.statusCode = 404
      error.code = 'LISTING_NOT_FOUND'
      error.expose = true
      throw error
    }
    const quote = await computeStayTotalMinor(listing, checkIn, checkOut)
    return json(res, 200, {
      ok: true,
      totalMinor: quote.totalMinor,
      nights: quote.nights,
      perNight: quote.perNight,
      currency: listing.currency,
    })
  }

  if (url.pathname === '/api/listings') {
    if (req.method === 'GET') {
      await expireOldListings()
      const division = url.searchParams.get('division') || undefined
      const city = url.searchParams.get('city') || undefined

      // Attribute filters match against the listing's stored visual-filter selection
      // (metadata.visualFilters.<key>). These keys are shared across divisions — the Cars
      // browse uses carBrand/carBody/carFuel/carTransmission/condition — so this is one generic
      // filter, not a per-division search system. 'any'/empty means "no constraint".
      const attributeKeys = ['carBrand', 'carBody', 'carFuel', 'carTransmission', 'condition']
      const attributeConditions = []
      for (const key of attributeKeys) {
        const value = url.searchParams.get(key)
        if (value && value !== 'any') {
          attributeConditions.push({ metadata: { path: ['visualFilters', key], equals: value } })
        }
      }

      const priceMin = Number(url.searchParams.get('priceMin'))
      const priceMax = Number(url.searchParams.get('priceMax'))
      const priceFilter = {}
      if (Number.isFinite(priceMin) && priceMin > 0) priceFilter.gte = priceMin
      if (Number.isFinite(priceMax) && priceMax > 0) priceFilter.lte = priceMax

      const listings = await db().listing.findMany({
        where: {
          status: 'APPROVED',
          division,
          location: city ? { city } : undefined,
          priceMinor: Object.keys(priceFilter).length ? priceFilter : undefined,
          AND: attributeConditions.length ? attributeConditions : undefined,
        },
        include: { location: true, media: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
      return json(res, 200, { ok: true, listings })
    }

    if (req.method === 'POST') {
      requireAuth(context, ['SELLER', 'HOST'])
      const body = await readJson(req)
      const division = normalizeListingDivision(body.division || 'STAYS')

      let expiresAt
      if (PAID_PLAN_DIVISIONS.has(division)) {
        const sellerProfile = await db().sellerProfile.findUnique({ where: { userId: context.user.id } })
        if (!sellerProfile || sellerProfile.documentStatus !== 'APPROVED') {
          const error = new Error('A paid, admin-approved seller plan is required before publishing this listing.')
          error.statusCode = 403
          error.code = 'SELLER_PLAN_REQUIRED'
          error.expose = true
          throw error
        }
        expiresAt = listingExpiryDate(sellerProfile.planCode)
      }

      const priceMinor = Number(body.priceMinor || 0)
      if (!body.titleAr || String(body.titleAr).trim().length < 3) {
        const error = new Error('Listing title is required.')
        error.statusCode = 400
        error.code = 'LISTING_TITLE_REQUIRED'
        error.expose = true
        throw error
      }
      if (!Number.isFinite(priceMinor) || priceMinor <= 0) {
        const error = new Error('Listing price must be greater than zero.')
        error.statusCode = 400
        error.code = 'LISTING_PRICE_INVALID'
        error.expose = true
        throw error
      }
      const listing = await db().listing.create({
        data: {
          ownerId: context.user.id,
          division,
          titleAr: String(body.titleAr).trim(),
          titleEn: body.titleEn || undefined,
          description: body.description || undefined,
          priceMinor,
          currency: body.currency || 'SYP',
          instantBookEnabled: Boolean(body.instantBookEnabled),
          expiresAt,
          metadata: body.metadata || {},
        },
      })
      return json(res, 201, { ok: true, listing })
    }

    return methodNotAllowed(res, ['GET', 'POST'])
  }

  const detailMatch = url.pathname.match(/^\/api\/listings\/([^/]+)$/)
  if (detailMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    await expireOldListings({ id: detailMatch[1] })
    const listing = await db().listing.findFirst({
      where: { id: detailMatch[1], status: 'APPROVED' },
      include: {
        location: true,
        media: true,
        owner: {
          select: {
            id: true,
            displayName: true,
          },
        },
      },
    })
    if (!listing) {
      const error = new Error('Listing not found.')
      error.statusCode = 404
      error.code = 'LISTING_NOT_FOUND'
      error.expose = true
      throw error
    }
    return json(res, 200, { ok: true, listing })
  }

  const availabilityMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/availability$/)
  if (availabilityMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    const listingId = availabilityMatch[1]
    const from = parseDateOnly(url.searchParams.get('from')) || new Date()
    const toRaw = parseDateOnly(url.searchParams.get('to'))
    const to = toRaw || new Date(from.getTime() + 1000 * 60 * 60 * 24 * 90)

    const [blockedRows, priceRows, activeBookings] = await Promise.all([
      db().listingAvailability.findMany({
        where: { listingId, status: 'BLOCKED', date: { gte: from, lte: to } },
        select: { date: true },
        orderBy: { date: 'asc' },
      }),
      db().listingAvailability.findMany({
        where: { listingId, priceOverrideMinor: { not: null }, date: { gte: from, lte: to } },
        select: { date: true, priceOverrideMinor: true },
        orderBy: { date: 'asc' },
      }),
      db().booking.findMany({
        where: {
          listingId,
          status: { in: ['REQUESTED', 'PAYMENT_PENDING', 'CONFIRMED'] },
          checkIn: { not: null },
          checkOut: { not: null },
        },
        select: { checkIn: true, checkOut: true },
      }),
    ])

    const blockedDates = blockedRows.map((row) => isoDate(row.date))
    const priceOverrides = priceRows.map((row) => ({ date: isoDate(row.date), priceMinor: row.priceOverrideMinor }))
    const bookedRanges = activeBookings.map((booking) => ({
      checkIn: isoDate(booking.checkIn),
      checkOut: isoDate(booking.checkOut),
    }))

    return json(res, 200, { ok: true, blockedDates, priceOverrides, bookedRanges })
  }

  const reviewsMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/reviews$/)
  if (reviewsMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    const reviews = await db().listingReview.findMany({
      where: { listingId: reviewsMatch[1], hiddenAt: null },
      include: { guest: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    const count = reviews.length
    const average = count ? Math.round((reviews.reduce((sum, review) => sum + review.rating, 0) / count) * 10) / 10 : null
    return json(res, 200, { ok: true, reviews, average, count })
  }

  const mediaMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/media$/)
  if (mediaMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['SELLER', 'HOST'])
    const existing = await db().listing.findFirst({
      where: { id: mediaMatch[1], ownerId: context.user.id },
    })
    if (!existing) {
      const error = new Error('Listing not found for this account.')
      error.statusCode = 404
      error.code = 'LISTING_NOT_FOUND'
      error.expose = true
      throw error
    }
    // Media can only be attached while the listing is still being prepared. Once it is under
    // review or live, its media set is frozen (re-submitting a rejected listing reopens it).
    if (!['DRAFT', 'REJECTED'].includes(existing.status)) {
      const error = new Error('Media can only be added to draft or rejected listings.')
      error.statusCode = 400
      error.code = 'LISTING_MEDIA_LOCKED'
      error.expose = true
      throw error
    }

    const body = await readJson(req)
    const items = Array.isArray(body.media) ? body.media : body.url ? [body] : []
    if (items.length === 0) {
      const error = new Error('At least one media item is required.')
      error.statusCode = 400
      error.code = 'LISTING_MEDIA_REQUIRED'
      error.expose = true
      throw error
    }
    if (items.length > 20) {
      const error = new Error('A listing can carry at most 20 media items.')
      error.statusCode = 400
      error.code = 'LISTING_MEDIA_TOO_MANY'
      error.expose = true
      throw error
    }

    // Staging accepts URL references only (same shape as payment-proof asset URLs). Binary upload
    // and production object storage are intentionally out of scope — see production-hardening notes.
    const existingCount = await db().listingMedia.count({ where: { listingId: existing.id } })
    const rows = items.map((item, index) => {
      const mediaUrl = typeof item.url === 'string' ? item.url.trim() : ''
      if (!mediaUrl || mediaUrl.length > 2000) {
        const error = new Error('Each media item needs a valid url.')
        error.statusCode = 400
        error.code = 'LISTING_MEDIA_URL_INVALID'
        error.expose = true
        throw error
      }
      return {
        listingId: existing.id,
        url: mediaUrl,
        kind: typeof item.kind === 'string' && item.kind.trim() ? item.kind.trim() : 'image',
        sortOrder: Number.isFinite(item.sortOrder) ? Number(item.sortOrder) : existingCount + index,
      }
    })

    await db().listingMedia.createMany({ data: rows })
    const media = await db().listingMedia.findMany({
      where: { listingId: existing.id },
      orderBy: { sortOrder: 'asc' },
    })
    return json(res, 201, { ok: true, media })
  }

  const submitMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/submit$/)
  if (submitMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['SELLER', 'HOST'])
    const existing = await db().listing.findFirst({
      where: { id: submitMatch[1], ownerId: context.user.id },
    })
    if (!existing) {
      const error = new Error('Listing not found for this account.')
      error.statusCode = 404
      error.code = 'LISTING_NOT_FOUND'
      error.expose = true
      throw error
    }
    if (!['DRAFT', 'REJECTED'].includes(existing.status)) {
      const error = new Error('Only draft or rejected listings can be submitted for review.')
      error.statusCode = 400
      error.code = 'LISTING_NOT_SUBMITTABLE'
      error.expose = true
      throw error
    }
    const listing = await db().listing.update({
      where: { id: existing.id },
      data: { status: 'PENDING_REVIEW' },
    })
    return json(res, 200, { ok: true, listing })
  }

  return false
}

function parseDateOnly(value) {
  if (!value) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

function isoDate(value) {
  return new Date(value).toISOString().slice(0, 10)
}

function normalizeListingDivision(value) {
  const division = String(value || '').toUpperCase()
  if (['STAYS', 'RENTALS', 'BUY', 'CARS', 'MARKETPLACE', 'NEW_CONSTRUCTION'].includes(division)) {
    return division
  }

  const error = new Error('Listing division is not supported.')
  error.statusCode = 400
  error.code = 'LISTING_DIVISION_INVALID'
  error.expose = true
  throw error
}
