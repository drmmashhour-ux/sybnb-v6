import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { computeStayTotalMinor } from '../lib/pricing.mjs'
import { sypMinorToRoundedUsdMinor } from '../lib/currency.mjs'
import { expireOldListings, listingExpiryDate } from '../lib/listing-lifecycle.mjs'
import { isOfferPrice, summarizeOffers } from '../lib/offers.mjs'

// STAYS/RENTALS/BUY are commission- or contact-based (no upfront platform fee, matching how
// Centris pays brokers on close rather than up front). CARS/MARKETPLACE/NEW_CONSTRUCTION are the
// paid-plan divisions gated behind an admin-approved SellerProfile.
const PAID_PLAN_DIVISIONS = new Set(['CARS', 'MARKETPLACE', 'NEW_CONSTRUCTION'])

// Listing ids are UUID columns in Postgres — a non-UUID id (e.g. the frontend's
// 'fallback-*' sample-listing ids) makes Prisma throw P2023 instead of returning null,
// which would otherwise surface as an uncaught 500. Reject those up front as a clean 404.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function handleListings(req, res, url, context) {
  const idSegmentMatch = url.pathname.match(/^\/api\/listings\/([^/]+)(?:\/(?:quote|availability|reviews|submit))?$/)
  if (idSegmentMatch && !UUID_RE.test(idSegmentMatch[1])) {
    const error = new Error('Listing not found.')
    error.statusCode = 404
    error.code = 'LISTING_NOT_FOUND'
    error.expose = true
    throw error
  }

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
    // The listing's own price is SYP; a guest who chooses to pay in USD instead gets that SYP
    // total (and each night's own price) converted at the platform's fixed rate and rounded up to
    // the nearest $5 — same change-avoidance rule applied to SR fares and wallet gifts.
    const wantsUsd = url.searchParams.get('currency') === 'USD'
    const totalMinor = wantsUsd ? sypMinorToRoundedUsdMinor(quote.totalMinor) : quote.totalMinor
    const perNight = wantsUsd
      ? quote.perNight.map((night) => ({ ...night, priceMinor: sypMinorToRoundedUsdMinor(night.priceMinor) }))
      : quote.perNight
    return json(res, 200, {
      ok: true,
      totalMinor,
      nights: quote.nights,
      perNight,
      currency: wantsUsd ? 'USD' : listing.currency,
    })
  }

  if (url.pathname === '/api/listings') {
    if (req.method === 'GET') {
      await expireOldListings()
      const params = url.searchParams
      const division = params.get('division') || undefined
      // Listings created through the wizard never populate the `location` relation — governorate/
      // city/area/bedrooms/bathrooms/propertyType/amenities all live in `metadata` instead, so those
      // filters are applied in-memory below rather than as a Prisma `where` clause.
      const governorate = params.get('governorate') || undefined
      const city = params.get('city') || undefined
      const area = params.get('area') || undefined
      const propertyType = params.get('propertyType') || undefined
      const roomType = params.get('roomType') || undefined
      const bedType = params.get('bedType') || undefined
      const minPrice = parsePositiveInt(params.get('minPrice'))
      const maxPrice = parsePositiveInt(params.get('maxPrice'))
      const minBedrooms = parsePositiveInt(params.get('bedrooms'))
      const minBathrooms = parsePositiveInt(params.get('bathrooms'))
      const amenities = (params.get('amenities') || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
      const checkIn = parseDateOnly(params.get('checkIn'))
      const checkOut = parseDateOnly(params.get('checkOut'))
      const sort = params.get('sort') || undefined

      const priceMinor = {}
      if (minPrice !== undefined) priceMinor.gte = minPrice
      if (maxPrice !== undefined) priceMinor.lte = maxPrice

      const orderBy =
        sort === 'priceAsc' ? { priceMinor: 'asc' } : sort === 'priceDesc' ? { priceMinor: 'desc' } : { createdAt: 'desc' }

      const candidates = await db().listing.findMany({
        where: {
          status: 'APPROVED',
          division,
          ...(Object.keys(priceMinor).length ? { priceMinor } : {}),
        },
        include: { location: true, media: true },
        orderBy,
        take: 200,
      })

      let listings = candidates.filter((listing) => {
        const meta = listing.metadata || {}
        const visual = meta.visualFilters || {}
        if (governorate && meta.governorate !== governorate) return false
        if (city && meta.city !== city) return false
        if (area && meta.area !== area) return false
        // The wizard writes propertyType twice under two different vocabularies (a capitalized
        // English label from the basic step, and a lowercase id from the visual filter chips) —
        // match either, case-insensitively, against the search page's lowercase chip id.
        if (propertyType) {
          const metaTypes = [meta.propertyType, visual.propertyType].filter(Boolean).map((value) => String(value).toLowerCase())
          if (!metaTypes.includes(propertyType.toLowerCase())) return false
        }
        if (roomType && visual.roomType !== roomType) return false
        if (bedType && visual.bedType !== bedType) return false
        // Bedrooms/bathrooms steppers default to 1 on every search (not an explicit "must have"
        // gesture), so a listing that never declared these fields is treated as "unknown" and kept
        // rather than excluded — only a declared, too-low value filters it out.
        if (minBedrooms !== undefined && meta.bedrooms !== undefined && meta.bedrooms !== null) {
          if (!(Number(meta.bedrooms) >= minBedrooms)) return false
        }
        if (minBathrooms !== undefined && meta.bathrooms !== undefined && meta.bathrooms !== null) {
          if (!(Number(meta.bathrooms) >= minBathrooms)) return false
        }
        if (amenities.length) {
          const have = new Set(visual.amenities || [])
          if (!amenities.every((amenity) => have.has(amenity))) return false
        }
        return true
      })

      if (checkIn && checkOut && checkOut > checkIn && listings.length) {
        const ids = listings.map((listing) => listing.id)
        const [blockedRows, overlappingBookings] = await Promise.all([
          db().listingAvailability.findMany({
            where: { listingId: { in: ids }, status: 'BLOCKED', date: { gte: checkIn, lt: checkOut } },
            select: { listingId: true },
          }),
          db().booking.findMany({
            where: {
              listingId: { in: ids },
              status: { in: ['REQUESTED', 'PAYMENT_PENDING', 'CONFIRMED'] },
              checkIn: { lt: checkOut },
              checkOut: { gt: checkIn },
            },
            select: { listingId: true },
          }),
        ])
        const unavailable = new Set([
          ...blockedRows.map((row) => row.listingId),
          ...overlappingBookings.map((booking) => booking.listingId),
        ])
        listings = listings.filter((listing) => !unavailable.has(listing.id))
      }

      if (listings.length) {
        const ids = listings.map((listing) => listing.id)
        const ninetyDaysOut = new Date(Date.now() + 1000 * 60 * 60 * 24 * 90)
        const offerRows = await db().listingAvailability.findMany({
          where: { listingId: { in: ids }, priceOverrideMinor: { not: null }, date: { gte: new Date(), lte: ninetyDaysOut } },
          select: { listingId: true, priceOverrideMinor: true },
        })
        const offersByListing = new Map()
        for (const row of offerRows) {
          if (!offersByListing.has(row.listingId)) offersByListing.set(row.listingId, [])
          offersByListing.get(row.listingId).push(row)
        }
        listings = listings.map((listing) => ({
          ...listing,
          hasActiveOffer: (offersByListing.get(listing.id) || []).some((row) => isOfferPrice(row.priceOverrideMinor, listing.priceMinor)),
        }))
      }

      return json(res, 200, { ok: true, listings: listings.slice(0, 50) })
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
            idDocumentStatus: true,
          },
        },
        accommodation: {
          select: { id: true, titleAr: true, titleEn: true },
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

    const [listing, blockedRows, priceRows, activeBookings] = await Promise.all([
      db().listing.findFirst({ where: { id: listingId }, select: { priceMinor: true } }),
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
    const { offerNightsCount, cheapestOfferMinor } = listing
      ? summarizeOffers(priceRows, listing.priceMinor)
      : { offerNightsCount: 0, cheapestOfferMinor: null }

    return json(res, 200, { ok: true, blockedDates, priceOverrides, bookedRanges, offerNightsCount, cheapestOfferMinor })
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

function parsePositiveInt(value) {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
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
