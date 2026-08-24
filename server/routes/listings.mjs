import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { computeStayTotalMinor } from '../lib/pricing.mjs'
import { expireOldListings, listingExpiryDate } from '../lib/listing-lifecycle.mjs'
import { resolveListingCityName } from '../lib/listing-location.mjs'
import { isCurrencyAllowed } from '../lib/country.mjs'

// STAYS/RENTALS/BUY are commission- or contact-based (no upfront platform fee, matching how
// Centris pays brokers on close rather than up front). CARS/MARKETPLACE/NEW_CONSTRUCTION are the
// paid-plan divisions gated behind an admin-approved SellerProfile.
const PAID_PLAN_DIVISIONS = new Set(['CARS', 'MARKETPLACE', 'NEW_CONSTRUCTION'])

// Project a listing to the fields safe for public/unauthenticated consumers: strip street-level
// address (addressLine/street) and internal metadata markers (e.g. inventory_source). Only fields
// the customer UI actually renders are returned.
function toPublicListing(l) {
  if (!l) return l
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
    owner: l.owner ? { id: l.owner.id, displayName: l.owner.displayName } : undefined,
  }
}

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
      // Single-select attribute filters (Cars: carBrand/…; Buy/Rentals: propertyType).
      const attributeKeys = ['carBrand', 'carBody', 'carFuel', 'carTransmission', 'condition', 'propertyType']
      const attributeConditions = []
      for (const key of attributeKeys) {
        const value = url.searchParams.get(key)
        if (value && value !== 'any') {
          attributeConditions.push({ metadata: { path: ['visualFilters', key], equals: value } })
        }
      }

      // Numeric "at least N" property filters — the seller stores these as plain numbers under
      // metadata.bedrooms / metadata.bathrooms (not visualFilters), so filter that path directly.
      const bedroomsMin = Number(url.searchParams.get('bedroomsMin'))
      if (Number.isFinite(bedroomsMin) && bedroomsMin > 0) {
        attributeConditions.push({ metadata: { path: ['bedrooms'], gte: bedroomsMin } })
      }
      const bathroomsMin = Number(url.searchParams.get('bathroomsMin'))
      if (Number.isFinite(bathroomsMin) && bathroomsMin > 0) {
        attributeConditions.push({ metadata: { path: ['bathrooms'], gte: bathroomsMin } })
      }

      // priceMinor is an int4 column; validate range so an out-of-range value fails closed with a
      // clear 400 instead of surfacing a Postgres integer-overflow 500.
      const INT4_MAX = 2147483647
      const parsePriceParam = (name) => {
        const raw = url.searchParams.get(name)
        if (raw == null || raw === '') return undefined
        const n = Number(raw)
        if (!Number.isFinite(n) || n < 0 || n > INT4_MAX) {
          const error = new Error(`Invalid ${name}: expected a number between 0 and ${INT4_MAX}.`)
          error.statusCode = 400
          error.code = 'INVALID_PRICE_FILTER'
          error.expose = true
          throw error
        }
        return n
      }
      const priceMin = parsePriceParam('priceMin')
      const priceMax = parsePriceParam('priceMax')
      const priceFilter = {}
      if (priceMin !== undefined && priceMin > 0) priceFilter.gte = priceMin
      if (priceMax !== undefined && priceMax > 0) priceFilter.lte = priceMax

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
      return json(res, 200, { ok: true, listings: listings.map(toPublicListing) })
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
      // Persist a Location relation so the listing is discoverable by the city browse filter and
      // renders with a real location. The wizard sends a governorate slug (damascus/aleppo/…); map
      // it to the English city name that browse filters match (location.city). Without this, host-
      // created listings are location-less and un-findable by city.
      let locationId
      const govSource = body.governorate || body.metadata?.governorate || ''
      const areaSource = body.area || body.metadata?.area
      const cityName = resolveListingCityName(govSource)
      if (cityName) {
        const location = await db().location.create({
          data: {
            country: 'SY',
            governorate: cityName,
            city: cityName,
            area: areaSource ? String(areaSource) : undefined,
          },
        })
        locationId = location.id
      }

      const currency = body.currency ? String(body.currency).toUpperCase() : 'SYP'
      if (!isCurrencyAllowed(currency)) {
        const error = new Error(`Currency '${currency}' is not supported for this country.`)
        error.statusCode = 400
        error.code = 'LISTING_CURRENCY_NOT_ALLOWED'
        error.expose = true
        throw error
      }

      const listing = await db().listing.create({
        data: {
          ownerId: context.user.id,
          locationId,
          division,
          titleAr: String(body.titleAr).trim(),
          titleEn: body.titleEn || undefined,
          description: body.description || undefined,
          priceMinor,
          currency,
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
    return json(res, 200, { ok: true, listing: toPublicListing(listing) })
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
    // Publish gate for EVERY division: the lister must (1) have a verified (admin-approved) ID and
    // (2) have signed the platform listing agreement before a listing can go to review.
    const publisher = await db().user.findUnique({
      where: { id: context.user.id },
      select: { idDocumentStatus: true },
    })
    if (publisher?.idDocumentStatus !== 'APPROVED') {
      const error = new Error('Verify your identity (upload your ID and get it approved) before publishing a listing.')
      error.statusCode = 403
      error.code = 'ID_VERIFICATION_REQUIRED'
      error.expose = true
      throw error
    }
    const listingAgreement = await db().legalConsent.findFirst({
      where: { userId: context.user.id, documentKey: 'listing-agreement' },
    })
    if (!listingAgreement) {
      const error = new Error('Accept the platform listing agreement before publishing a listing.')
      error.statusCode = 403
      error.code = 'LISTING_AGREEMENT_REQUIRED'
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
