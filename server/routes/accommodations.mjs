import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { summarizeOffers } from '../lib/offers.mjs'

// Lets a hotel-like host (Studio/Suite/Double-Queen room types under one physical property)
// share one location + one set of seller documents/photos across multiple STAYS Listing rows,
// instead of repeating the whole listing wizard per room type. Each child Listing keeps its own
// independent price, availability, and bookings — see prisma/schema.prisma's Accommodation model.
export async function handleAccommodations(req, res, url, context) {
  if (url.pathname === '/api/accommodations') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['HOST', 'SELLER'])
    const body = await readJson(req)

    if (!body.titleAr || String(body.titleAr).trim().length < 3) {
      const error = new Error('Accommodation title is required.')
      error.statusCode = 400
      error.code = 'ACCOMMODATION_TITLE_REQUIRED'
      error.expose = true
      throw error
    }
    if (!body.governorate || !body.city) {
      const error = new Error('governorate and city are required.')
      error.statusCode = 400
      error.code = 'ACCOMMODATION_LOCATION_REQUIRED'
      error.expose = true
      throw error
    }

    const accommodation = await db().accommodation.create({
      data: {
        ownerId: context.user.id,
        titleAr: String(body.titleAr).trim(),
        titleEn: body.titleEn || undefined,
        description: body.description || undefined,
        governorate: body.governorate,
        city: body.city,
        area: body.area || undefined,
        address: body.address || undefined,
        metadata: body.metadata || {},
      },
    })
    return json(res, 201, { ok: true, accommodation })
  }

  const roomTypeMatch = url.pathname.match(/^\/api\/accommodations\/([^/]+)\/room-types$/)
  if (roomTypeMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['HOST', 'SELLER'])
    const accommodationId = roomTypeMatch[1]
    const body = await readJson(req)

    const accommodation = await db().accommodation.findFirst({
      where: { id: accommodationId, ownerId: context.user.id },
    })
    if (!accommodation) {
      const error = new Error('Accommodation not found for this account.')
      error.statusCode = 404
      error.code = 'ACCOMMODATION_NOT_FOUND'
      error.expose = true
      throw error
    }

    if (!body.titleAr || String(body.titleAr).trim().length < 3) {
      const error = new Error('Room type title is required.')
      error.statusCode = 400
      error.code = 'LISTING_TITLE_REQUIRED'
      error.expose = true
      throw error
    }
    const priceMinor = Number(body.priceMinor || 0)
    if (!Number.isFinite(priceMinor) || priceMinor <= 0) {
      const error = new Error('Room type price must be greater than zero.')
      error.statusCode = 400
      error.code = 'LISTING_PRICE_INVALID'
      error.expose = true
      throw error
    }

    // The room type inherits the accommodation's location into its own metadata (not a relation)
    // so the existing search/filter system (server/routes/listings.mjs, which reads governorate/
    // city/area/propertyType/bedrooms/bathrooms/amenities from metadata) keeps working unchanged.
    const listing = await db().listing.create({
      data: {
        ownerId: context.user.id,
        accommodationId: accommodation.id,
        division: 'STAYS',
        titleAr: String(body.titleAr).trim(),
        titleEn: body.titleEn || undefined,
        description: body.description || undefined,
        priceMinor,
        currency: body.currency || 'SYP',
        instantBookEnabled: Boolean(body.instantBookEnabled),
        metadata: {
          ...(body.metadata || {}),
          governorate: accommodation.governorate,
          city: accommodation.city,
          area: accommodation.area,
        },
      },
    })
    return json(res, 201, { ok: true, listing })
  }

  const submitMatch = url.pathname.match(/^\/api\/accommodations\/([^/]+)\/submit$/)
  if (submitMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['HOST', 'SELLER'])
    const accommodationId = submitMatch[1]

    const accommodation = await db().accommodation.findFirst({
      where: { id: accommodationId, ownerId: context.user.id },
      include: { listings: true },
    })
    if (!accommodation) {
      const error = new Error('Accommodation not found for this account.')
      error.statusCode = 404
      error.code = 'ACCOMMODATION_NOT_FOUND'
      error.expose = true
      throw error
    }
    if (!accommodation.listings.length) {
      const error = new Error('Add at least one room type before submitting for review.')
      error.statusCode = 400
      error.code = 'ACCOMMODATION_NO_ROOM_TYPES'
      error.expose = true
      throw error
    }

    const [updatedAccommodation] = await db().$transaction([
      db().accommodation.update({
        where: { id: accommodationId },
        data: accommodation.status === 'DRAFT' || accommodation.status === 'REJECTED' ? { status: 'PENDING_REVIEW' } : {},
      }),
      db().listing.updateMany({
        where: { accommodationId, status: { in: ['DRAFT', 'REJECTED'] } },
        data: { status: 'PENDING_REVIEW' },
      }),
    ])

    return json(res, 200, { ok: true, accommodation: updatedAccommodation })
  }

  const detailMatch = url.pathname.match(/^\/api\/accommodations\/([^/]+)$/)
  if (detailMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    const accommodation = await db().accommodation.findUnique({
      where: { id: detailMatch[1] },
      include: {
        listings: { where: { status: 'APPROVED' }, include: { media: true } },
      },
    })
    if (!accommodation) {
      const error = new Error('Accommodation not found.')
      error.statusCode = 404
      error.code = 'ACCOMMODATION_NOT_FOUND'
      error.expose = true
      throw error
    }

    if (accommodation.listings.length) {
      const listingIds = accommodation.listings.map((listing) => listing.id)
      const ninetyDaysOut = new Date(Date.now() + 1000 * 60 * 60 * 24 * 90)
      const offerRows = await db().listingAvailability.findMany({
        where: { listingId: { in: listingIds }, priceOverrideMinor: { not: null }, date: { gte: new Date(), lte: ninetyDaysOut } },
        select: { listingId: true, priceOverrideMinor: true },
      })
      const offersByListing = new Map()
      for (const row of offerRows) {
        if (!offersByListing.has(row.listingId)) offersByListing.set(row.listingId, [])
        offersByListing.get(row.listingId).push(row)
      }
      let listingsWithOfferCount = 0
      accommodation.listings = accommodation.listings.map((listing) => {
        const rows = offersByListing.get(listing.id) || []
        const { offerNightsCount, cheapestOfferMinor } = summarizeOffers(rows, listing.priceMinor)
        const hasActiveOffer = offerNightsCount > 0
        if (hasActiveOffer) listingsWithOfferCount += 1
        return { ...listing, hasActiveOffer, offerNightsCount, cheapestOfferMinor }
      })
      accommodation.offerSummary = { listingsWithOfferCount, totalListingsCount: accommodation.listings.length }
    } else {
      accommodation.offerSummary = { listingsWithOfferCount: 0, totalListingsCount: 0 }
    }
    return json(res, 200, { ok: true, accommodation })
  }

  return false
}
