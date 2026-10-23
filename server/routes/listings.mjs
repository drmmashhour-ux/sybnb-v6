import { assertListingPrice, assertListingText, clampPlaceText } from '../lib/listing-input.mjs'
import { publicListingMedia } from '../lib/listing-media-url.mjs'
import { gridFilterCondition } from '../lib/grid-filter.mjs'
import { db } from '../lib/prisma.mjs'
import { dateBlockingBookingWhere } from '../lib/booking-policy.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { publicDisplayName } from '../lib/public-name.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { computeStayTotalMinor } from '../lib/pricing.mjs'
import { expireOldListings, expireOldListingsThrottled, listingExpiryDate, PLAN_DURATION_DAYS } from '../lib/listing-lifecycle.mjs'
import { normalizeBrowseCity, resolveListingCityName } from '../lib/listing-location.mjs'
import { bookingPolicySettings, defaultCurrency, isCurrencyAllowed, payoutMethodConfig } from '../lib/country.mjs'
// Host verification (2026-10-08): stays of an owner without users.host_verified_at are not public.
import { isListingPubliclyVisible, publicListingVisibilityWhere } from '../lib/host-verification.mjs'
// Owner decision 2026-10-09: automatic AI pre-check for the admin reviewer (advisory only).
import { scheduleAiListingReview } from '../lib/ai-listing-review-runner.mjs'

// Mirrors the ListingDivision enum in prisma/schema.prisma.
const LISTING_DIVISIONS = ['STAYS', 'RENTALS', 'BUY', 'CARS', 'MARKETPLACE', 'NEW_CONSTRUCTION']

// STAYS/RENTALS/BUY are commission- or contact-based (no upfront platform fee, matching how
// Centris pays brokers on close rather than up front). CARS/MARKETPLACE/NEW_CONSTRUCTION are the
// paid-plan divisions gated behind an admin-approved SellerProfile.
const PAID_PLAN_DIVISIONS = new Set(['CARS', 'MARKETPLACE', 'NEW_CONSTRUCTION'])

// 'sort' options a caller may request. 'newest' (the default/original behavior) orders by
// createdAt; 'priceLow'/'priceHigh' order by priceMinor. Kept as an explicit allowlist (not just
// "any column name") so a request can never sort on an arbitrary field.
const SORT_CONFIGS = {
  newest: { field: 'createdAt', direction: 'desc' },
  priceLow: { field: 'priceMinor', direction: 'asc' },
  priceHigh: { field: 'priceMinor', direction: 'desc' },
}
function resolveSort(raw) {
  return SORT_CONFIGS[raw] ? raw : 'newest'
}

// Keyset cursor for GET /api/listings pagination: encodes the last row's (sortValue, id) for
// whichever sort produced it -- the exact pair the query is ordered and compared on -- so a page
// boundary survives concurrent inserts (unlike an offset, which drifts: a new row landing above
// page 1 reshuffles what "page 2" means). Self-contained (no DB lookup needed to resume), safe if
// that row is later deleted, and bound to its own sort: a cursor from one sort is rejected (not
// silently reinterpreted) if a later call passes a different `sort` -- the field/direction it
// encodes wouldn't mean the same thing under a different ordering.
function encodeListingCursor(sort, position) {
  const value = position.value instanceof Date ? position.value.toISOString() : position.value
  return Buffer.from(JSON.stringify({ sort, value, id: position.id }), 'utf8').toString('base64url')
}
function decodeListingCursor(raw, sort) {
  if (!raw) return null
  let parsed
  try {
    parsed = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (parsed.sort !== sort || !parsed.id) return null
  const field = SORT_CONFIGS[sort].field
  if (field === 'createdAt') {
    const value = new Date(parsed.value)
    if (Number.isNaN(value.getTime())) return null
    return { value, id: parsed.id }
  }
  const value = Number(parsed.value)
  if (!Number.isFinite(value)) return null
  return { value, id: parsed.id }
}

// priceBand -> a real priceMin/priceMax range, computed from this division's OWN current price
// distribution rather than a fixed guessed number -- STAYS/RENTALS/BUY/CARS/MARKETPLACE/
// NEW_CONSTRUCTION have wildly different real price scales (a nightly SYP rate vs. a car vs. a
// building), so no single hardcoded cutoff means the same thing across all of them, and a
// hand-picked one would need constant manual upkeep as real inventory changes. Cached per-division
// for a few minutes -- price distribution shifts slowly, and this runs on every search request.
const PRICE_BAND_CACHE_TTL_MS = 5 * 60 * 1000
const priceBandCache = new Map()
async function priceBandBoundaries(division) {
  const cached = priceBandCache.get(division)
  if (cached && Date.now() - cached.computedAt < PRICE_BAND_CACHE_TTL_MS) return cached
  const rows = await db().$queryRaw`
    SELECT
      percentile_cont(0.33) WITHIN GROUP (ORDER BY price_minor) AS low,
      percentile_cont(0.66) WITHIN GROUP (ORDER BY price_minor) AS high
    FROM listings WHERE division = ${division}::listing_division AND status = 'APPROVED'
  `
  const boundaries = {
    low: Math.round(Number(rows[0]?.low)) || 0,
    high: Math.round(Number(rows[0]?.high)) || 0,
    computedAt: Date.now(),
  }
  priceBandCache.set(division, boundaries)
  return boundaries
}
function priceBandRange(band, boundaries) {
  if (band === 'low') return { lte: boundaries.low }
  if (band === 'mid') return { gte: boundaries.low, lte: boundaries.high }
  if (band === 'high') return { gte: boundaries.high }
  return null
}

// Multi-select attribute filters (amenities/views/access): the seller's selection is stored as a
// JSON string array at metadata.visualFilters.<key> (SellerListingWizard.tsx). "Match" means the
// listing's array contains EVERY value the guest selected, not just one -- so one array_contains
// check per selected value, ANDed together, is the correct predicate for narrowing search
// (confirmed live against real data before writing this: array_contains does a single-value
// containment check, composes correctly under AND, and simply doesn't match rows that lack the
// key at all -- never errors).
const ARRAY_ATTRIBUTE_KEYS = ['amenities', 'views', 'access']

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
    media: publicListingMedia(l.media),
    location: l.location
      ? { country: l.location.country, governorate: l.location.governorate, city: l.location.city, area: l.location.area, lat: l.location.lat ?? null, lng: l.location.lng ?? null }
      : null,
    owner: l.owner ? { id: l.owner.id, displayName: publicDisplayName(l.owner.displayName) } : undefined,
  }
}

export async function handleListings(req, res, url, context) {
  if (url.pathname === '/api/advertising/active') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    // Public, unauthenticated read of real, admin-approved ad campaigns for display -- the
    // counterpart to the exclusion above (which keeps ads out of ordinary product search).
    // Filtered in JS for the same NULL-trap reason documented on that exclusion: a Prisma `where`
    // JSON-path equality check on metadata.advertising can't be combined with `division` safely.
    const now = new Date()
    const batch = await db().listing.findMany({
      where: { status: 'APPROVED', division: 'MARKETPLACE' },
      include: { media: true },
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
    })
    const ads = batch
      .filter((l) => l.metadata?.advertising === true && (!l.expiresAt || l.expiresAt > now))
      .sort((a, b) => {
        const tierRank = (l) => (l.metadata?.adPlan === 'premium' ? 0 : 1)
        return tierRank(a) - tierRank(b) || b.createdAt - a.createdAt
      })
      .slice(0, 6)
      .map((l) => ({
        id: l.id,
        titleAr: l.titleAr,
        titleEn: l.titleEn,
        plan: l.metadata?.adPlan === 'premium' ? 'premium' : 'plus',
        media: publicListingMedia(l.media.map((m) => ({ url: m.url, kind: m.kind }))),
      }))
    return json(res, 200, { ok: true, ads })
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
    const found = await db().listing.findFirst({
      where: { id: quoteMatch[1], status: 'APPROVED' },
      include: { owner: { select: { hostVerifiedAt: true } } },
    })
    // An unverified host's stay is not public: same 404 as a listing that does not exist.
    const listing = isListingPubliclyVisible(found, found?.owner) ? found : null
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
      subtotalMinor: quote.subtotalMinor,
      discountMinor: quote.discountMinor,
      discountPct: quote.discountPct,
      discountKind: quote.discountKind,
      currency: listing.currency,
    })
  }

  if (url.pathname === '/api/listings') {
    if (req.method === 'GET') {
      // Expiry sweep, at most once a minute per process (scale, 2026-10-22): it used to run an
      // UPDATE over every approved listing on EVERY search. Correctness no longer depends on the
      // sweep: the search below also excludes rows whose expiresAt has passed.
      void expireOldListingsThrottled()
      const division = url.searchParams.get('division') || undefined
      // An unknown division used to reach Prisma as an invalid enum value and surface as a 500.
      if (division && !LISTING_DIVISIONS.includes(division)) {
        const error = new Error(`Invalid division: expected one of ${LISTING_DIVISIONS.join(', ')}.`)
        error.statusCode = 400
        error.code = 'INVALID_DIVISION'
        error.expose = true
        throw error
      }
      // Accept English, slug, Arabic or French city labels; match case-insensitively.
      const city = normalizeBrowseCity(url.searchParams.get('city'))

      // Attribute filters match against the listing's stored visual-filter selection
      // (metadata.visualFilters.<key>). These keys are shared across divisions — the Cars
      // browse uses carBrand/carBody/carFuel/carTransmission/condition — so this is one generic
      // filter, not a per-division search system. 'any'/empty means "no constraint".
      // Single-select attribute filters (Cars: carBrand/…; Buy/Rentals: propertyType).
      const attributeKeys = ['carBrand', 'carBody', 'carFuel', 'carTransmission', 'condition', 'propertyType', 'marketCategory', 'powerSource', 'waterSystem', 'connectivity']
      const attributeConditions = []
      for (const key of attributeKeys) {
        const value = url.searchParams.get(key)
        const condition = gridFilterCondition(key, value)
        if (condition) attributeConditions.push(condition)
      }
      // Multi-select attribute filters (amenities/views/access) — comma-separated ids, e.g.
      // ?amenities=wifi,parking. A listing must have ALL selected values, not just one.
      for (const key of ARRAY_ATTRIBUTE_KEYS) {
        const raw = url.searchParams.get(key)
        const values = raw ? raw.split(',').map((v) => v.trim()).filter(Boolean) : []
        for (const value of values) {
          attributeConditions.push({ metadata: { path: ['visualFilters', key], array_contains: [value] } })
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

      // priceBand is a discrete "Budget/Mid range/Premium" choice, translated to a real
      // priceMin/priceMax range computed from this division's own data (see priceBandBoundaries
      // above). Intersected with any explicit priceMin/priceMax also present, not overridden by
      // it — both narrow the result set together, same as any other two independent filters would.
      const priceBandParam = url.searchParams.get('priceBand')
      if (division && priceBandParam && priceBandParam !== 'any') {
        const boundaries = await priceBandBoundaries(division)
        const range = priceBandRange(priceBandParam, boundaries)
        if (range) {
          if (range.gte !== undefined) priceFilter.gte = Math.max(priceFilter.gte ?? 0, range.gte)
          if (range.lte !== undefined) priceFilter.lte = priceFilter.lte !== undefined ? Math.min(priceFilter.lte, range.lte) : range.lte
        }
      }

      const sort = resolveSort(url.searchParams.get('sort'))
      const sortConfig = SORT_CONFIGS[sort]

      const rawCursorParam = url.searchParams.get('cursor')
      const cursor = decodeListingCursor(rawCursorParam, sort)
      if (rawCursorParam && !cursor) {
        const error = new Error('Invalid or sort-mismatched cursor.')
        error.statusCode = 400
        error.code = 'INVALID_CURSOR'
        error.expose = true
        throw error
      }

      // A real bug caught by an independent re-audit: the advertising submission flow
      // (SellerListingWizard.tsx) writes an ad purchase as a real listing row tagged
      // metadata.advertising=true (currently always division='MARKETPLACE') so it can reuse the
      // existing listing-review/admin-approval pipeline -- but that meant an approved ad was
      // indistinguishable from a genuine product in real buyer-facing search results (confirmed
      // live: 62 approved ad rows appearing as real marketplace items). Ads are never meant to be
      // browsable inventory, so they're excluded below regardless of division. This can't be
      // expressed as a Prisma `where` JSON-path condition: `NOT: { metadata: { path: [...],
      // equals: true } }` hits SQL's NULL-trap (`NOT (NULL = true)` is NULL, not TRUE) and would
      // wrongly exclude every listing that has never touched the advertising flow at all --
      // confirmed live (a first attempt silently zeroed out all 424 real MARKETPLACE listings).
      // Filtering in JS is still the correct, simple fix -- but it now runs inside a keyset-paged
      // scan loop (below) instead of a single fixed-take fetch, so ad-heavy stretches of the feed
      // can no longer cap results early or hide real inventory that never gets touched by a page.
      const PAGE_SIZE = 50
      const SCAN_BATCH_SIZE = 250
      const MAX_SCAN_BATCHES = 4 // safety cap: at most 1,000 rows scanned per request
      // With attribute filters the candidates are checked in a second, id-bounded query (see the
      // loop), so more candidates may be walked; still a fixed cap: at most 2,000 per request.
      const MAX_FILTERED_SCAN_BATCHES = 8
      const FIRST_BATCH_SIZE = 100

      // A real scale-readiness audit found this endpoint's *entire* result set was a single fixed
      // `take: 250` with no pagination anywhere -- confirmed the server never read a cursor/page
      // param and neither frontend caller ever sent one, so once any division+city passed ~250
      // approved listings, older inventory became permanently unreachable through search/browse.
      // This loop replaces that fixed take with real keyset pagination: it walks batches ordered
      // by the active sort's (field, id), advancing `scanCursor` through every row (ad or not) so
      // a page boundary is always the true position in the dataset, then returns once PAGE_SIZE
      // real (non-ad) listings are collected or the dataset is exhausted.
      const cmp = sortConfig.direction === 'desc' ? 'lt' : 'gt'
      let scanCursor = cursor
      const listings = []
      let hasMore = false
      // Host verification: stays whose owner is not verified never appear. Checked per row in the
      // scan loop below with isListingPubliclyVisible() (same rule as the detail page), NOT as a
      // join filter in SQL: with ~1M users and few verified hosts, Postgres estimated almost no rows
      // would survive that join and switched from walking the (division, status, created_at) index
      // to reading, joining and sorting EVERY approved listing -- 76 ms instead of 2.5 ms at 20k
      // listings, growing linearly (measured, scale work 2026-10-22). The owner's verification
      // timestamp is loaded with the batch (one extra IN-list query), never exposed.
      //
      // Attribute filters (bedrooms, amenities, property type...) live in the metadata JSON. Put in
      // the same WHERE as the ordered scan, Postgres cannot estimate how many rows they keep, guesses
      // "almost none", and again reads + sorts every listing in the city (60-120 ms at 20k listings,
      // growing with the catalogue; measured 2026-10-22). So the scan walks candidates in sort order
      // using only indexable conditions, and the JSON filters are applied by Postgres to just that
      // batch of ids. Same rows, same order, same Prisma filter semantics; bounded cost per request.
      const now = new Date()
      const filtered = attributeConditions.length > 0
      const batchLimit = filtered ? MAX_FILTERED_SCAN_BATCHES : MAX_SCAN_BATCHES
      for (let batchNum = 0; batchNum < batchLimit; batchNum++) {
        // first batch sized for a typical page (most rows qualify), later ones larger
        const batchTake = batchNum === 0 && !filtered ? FIRST_BATCH_SIZE : SCAN_BATCH_SIZE
        const andConditions = []
        andConditions.push({ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] })
        if (scanCursor) {
          andConditions.push({
            OR: [
              { [sortConfig.field]: { [cmp]: scanCursor.value } },
              { [sortConfig.field]: scanCursor.value, id: { [cmp]: scanCursor.id } },
            ],
          })
        }
        const batch = await db().listing.findMany({
          where: {
            status: 'APPROVED',
            division,
            location: city ? { city: { equals: city, mode: 'insensitive' } } : undefined,
            priceMinor: Object.keys(priceFilter).length ? priceFilter : undefined,
            AND: andConditions.length ? andConditions : undefined,
          },
          // The scan reads only what it needs to decide (sort key, flags, visibility); full rows,
          // locations and photos are loaded afterwards for the (at most 50) rows actually returned.
          select: { id: true, [sortConfig.field]: true, status: true, division: true, metadata: true, owner: { select: { hostVerifiedAt: true } } },
          orderBy: [{ [sortConfig.field]: sortConfig.direction }, { id: sortConfig.direction }],
          take: batchTake,
        })
        if (batch.length === 0) {
          hasMore = false
          break
        }
        let matching = null
        if (filtered) {
          const hits = await db().listing.findMany({
            where: { id: { in: batch.map((l) => l.id) }, AND: attributeConditions },
            select: { id: true },
          })
          matching = new Set(hits.map((h) => h.id))
        }

        let hitPageSize = false
        for (const listing of batch) {
          if ((!matching || matching.has(listing.id)) && listing.metadata?.advertising !== true && listing.metadata?.sold !== true && isListingPubliclyVisible(listing, listing.owner)) {
            listings.push(listing.id)
          }
          scanCursor = { value: listing[sortConfig.field], id: listing.id }
          if (listings.length >= PAGE_SIZE) {
            hitPageSize = true
            break
          }
        }
        if (hitPageSize) {
          hasMore = true
          break
        }
        if (batch.length < batchTake) {
          // Fewer rows than requested came back: the dataset is exhausted, not just this batch.
          hasMore = false
          break
        }
        // Batch was full and PAGE_SIZE isn't reached yet -- keep scanning from scanCursor. If this
        // was the last allowed batch, the loop exits here with hasMore left true (set below).
        hasMore = true
      }

      const nextCursor = hasMore && scanCursor ? encodeListingCursor(sort, scanCursor) : null
      const rows = listings.length
        ? await db().listing.findMany({
          where: { id: { in: listings }, status: 'APPROVED' },
          include: { location: true, media: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] } },
        })
        : []
      const byId = new Map(rows.map((r) => [r.id, r]))
      const page = listings.map((id) => byId.get(id)).filter(Boolean)
      return json(res, 200, { ok: true, listings: page.map(toPublicListing), nextCursor })
    }

    if (req.method === 'POST') {
      requireAuth(context, ['SELLER', 'HOST'])
      const body = await readJson(req)
      const division = normalizeListingDivision(body.division || 'STAYS')

      let expiresAt
      let boundAdvertisingProofId
      let listingMetadata = body.metadata || {}
      // A listing tagged metadata.advertising:true is ALWAYS an advertising campaign, regardless of
      // which division was submitted. A real audit found the old gate -- checked only when
      // `PAID_PLAN_DIVISIONS.has(division)` was ALSO true -- let a client skip payment entirely by
      // submitting division:'STAYS' (or RENTALS/BUY) with metadata.advertising:true: that
      // combination hit neither this branch nor the dealer branch below, so nothing checked
      // payment at all. Live-proven: a free, permanent (expiresAt:null), admin-approvable
      // "advertising"-tagged listing, $0 paid. Advertising must go through the advertising
      // entitlement path no matter what division is claimed; any other division fails closed.
      const claimsAdvertising = listingMetadata.advertising === true
      if (claimsAdvertising) {
        if (division !== 'MARKETPLACE') {
          const error = new Error("Advertising campaigns must be division 'MARKETPLACE'.")
          error.statusCode = 400
          error.code = 'ADVERTISING_DIVISION_INVALID'
          error.expose = true
          throw error
        }
        // Owner-approved business rule: one approved, unused advertising payment = exactly one
        // campaign -- NOT the "pay once, list unlimited inventory" model CARS/MARKETPLACE/
        // NEW_CONSTRUCTION dealers get in the branch below (intentionally untouched; that model is
        // correct there). Checks for a specific unconsumed payment, never the coarse
        // sellerProfile.documentStatus flag -- see the dealer branch's comment for why that flag is
        // no longer trusted as an authorization source at all.
        const availableProof = await db().paymentProof.findFirst({
          where: {
            userId: context.user.id,
            provider: 'seller_plan',
            status: 'APPROVED',
            campaignListingId: null,
            planCode: { in: ['advertising-plus', 'advertising-premium'] },
          },
          orderBy: { createdAt: 'asc' },
        })
        if (!availableProof) {
          const error = new Error('An approved, unused advertising payment is required before creating a campaign. A second campaign or a renewal after expiry needs a new payment.')
          error.statusCode = 403
          error.code = 'ADVERTISING_PAYMENT_REQUIRED'
          error.expose = true
          throw error
        }
        boundAdvertisingProofId = availableProof.id
        // The campaign's real tier is DERIVED from the entitlement actually being spent, never
        // trusted from the client -- a real audit found a genuine $19 advertising-plus payment
        // could get bound to a listing whose client-submitted metadata.adPlan claimed 'premium',
        // displaying (and sorting ahead of real premium campaigns) as premium for free. Whatever
        // the client sent is overwritten here with the tier the approved payment actually paid for.
        listingMetadata = { ...listingMetadata, adPlan: availableProof.planCode === 'advertising-premium' ? 'premium' : 'plus' }
        // The advertiser's own chosen duration (SellerListingWizard.tsx's AD_DURATIONS, 7/30/90
        // days) -- honor it instead of the generic per-tier default. Capped at the wizard's own
        // max option so a direct API call can't request an arbitrarily long-lived ad.
        const requestedAdDays = Number(body.metadata?.adDurationDays)
        expiresAt =
          Number.isInteger(requestedAdDays) && requestedAdDays > 0 && requestedAdDays <= 90
            ? new Date(Date.now() + requestedAdDays * 24 * 60 * 60 * 1000)
            : listingExpiryDate(availableProof.planCode)
      } else if (PAID_PLAN_DIVISIONS.has(division)) {
        // A real audit found this used to check only sellerProfile.documentStatus === 'APPROVED' --
        // a single flag shared across every plan a user has ever had reviewed, set true by ANY
        // approved seller_plan proof (including an advertising one) and never re-checked against
        // what was actually paid for. Live-proven exploit: one $19 advertising-plus payment
        // permanently unlocked unlimited free real CARS/NEW_CONSTRUCTION inventory, because this
        // flag doesn't know or care which plan set it. documentStatus stays as a display-only
        // signal (still read by the account page's "payment confirmed" UI) but is no longer
        // trusted for authorization -- this looks for a real, dealer-tier-specific APPROVED
        // payment instead. An advertising payment (planCode advertising-plus/-premium) can never
        // satisfy this, by construction.
        // Revenue-integrity fix (2026-10-09): a dealer plan is a TIME-BOUNDED subscription, not a
        // one-time unlock. Previously this accepted ANY approved plus/premium payment the account
        // had ever made, with no time bound -- so a single $19/$49 payment let a dealer publish
        // unlimited listings forever, with no renewal. Now the entitlement is only valid inside its
        // own plan window (PLAN_DURATION_DAYS: plus 30d / premium 60d) measured from the payment's
        // approval time (reviewedAt, falling back to createdAt). Once every approved payment has
        // aged past its window the dealer must renew before publishing again -- the same expiry
        // the published listing itself already carries via listingExpiryDate().
        const now = Date.now()
        const dealerCandidates = await db().paymentProof.findMany({
          where: {
            userId: context.user.id,
            provider: 'seller_plan',
            status: 'APPROVED',
            planCode: { in: ['plus', 'premium'] },
          },
          orderBy: { createdAt: 'desc' },
          select: { planCode: true, reviewedAt: true, createdAt: true },
          take: 20,
        })
        const dealerEntitlement = dealerCandidates.find((proof) => {
          const start = proof.reviewedAt || proof.createdAt
          const days = PLAN_DURATION_DAYS[proof.planCode] ?? PLAN_DURATION_DAYS.plus
          return new Date(start).getTime() + days * 24 * 60 * 60 * 1000 > now
        })
        if (!dealerEntitlement) {
          const error = new Error('A current, admin-approved seller plan is required before publishing this listing. Your plan may have expired — please renew it.')
          error.statusCode = 403
          error.code = 'SELLER_PLAN_REQUIRED'
          error.expose = true
          throw error
        }
        expiresAt = listingExpiryDate(dealerEntitlement.planCode)
      }

      const priceMinor = Number(body.priceMinor || 0)
      if (!body.titleAr || String(body.titleAr).trim().length < 3) {
        const error = new Error('Listing title is required.')
        error.statusCode = 400
        error.code = 'LISTING_TITLE_REQUIRED'
        error.expose = true
        throw error
      }
      assertListingPrice(priceMinor)
      assertListingText(body)
      // Persist a Location relation so the listing is discoverable by the city browse filter and
      // renders with a real location. The wizard sends a governorate slug (damascus/aleppo/…); map
      // it to the English city name that browse filters match (location.city). Without this, host-
      // created listings are location-less and un-findable by city.
      let locationId
      const govSource = body.governorate || body.metadata?.governorate || ''
      const areaSource = body.area || body.metadata?.area
      const cityName = clampPlaceText(resolveListingCityName(govSource))
      if (cityName) {
        const latRaw = Number(body.lat ?? body.metadata?.lat)
        const lngRaw = Number(body.lng ?? body.metadata?.lng)
        const location = await db().location.create({
          data: {
            country: 'SY',
            governorate: cityName,
            city: cityName,
            area: clampPlaceText(areaSource),
            lat: Number.isFinite(latRaw) && latRaw !== 0 ? latRaw : undefined,
            lng: Number.isFinite(lngRaw) && lngRaw !== 0 ? lngRaw : undefined,
          },
        })
        locationId = location.id
      }

      const currency = body.currency ? String(body.currency).toUpperCase() : defaultCurrency()
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
          // priceConfirmedAt is server-controlled: set now, never taken from the client.
          metadata: { ...listingMetadata, priceConfirmedAt: new Date().toISOString() },
        },
      })

      if (boundAdvertisingProofId) {
        // Atomic claim -- only succeeds if nothing else bound this same payment in between the
        // availability check above and here. Deterministic campaign association (the payment
        // record carries campaignListingId directly, not inferred from amount/uploader).
        const claim = await db().paymentProof.updateMany({
          where: { id: boundAdvertisingProofId, campaignListingId: null },
          data: { campaignListingId: listing.id },
        })
        if (claim.count === 0) {
          await db().listing.delete({ where: { id: listing.id } })
          const error = new Error('This advertising payment was just used for another campaign. Submit a new payment.')
          error.statusCode = 409
          error.code = 'ADVERTISING_PAYMENT_ALREADY_CONSUMED'
          error.expose = true
          throw error
        }
      }

      return json(res, 201, { ok: true, listing })
    }

    return methodNotAllowed(res, ['GET', 'POST'])
  }

  // Mark as sold / back on sale (2026-10-17). For items that are sold once (cars, marketplace, property
  // for sale): the ad stays reachable by its link with a "Sold" badge (so saved/shared links do not
  // 404) but disappears from browse. Not for stays, which are rented repeatedly.
  const soldMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/sold$/)
  if (soldMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['SELLER', 'HOST'])
    const body = await readJson(req)
    const existing = await db().listing.findFirst({ where: { id: soldMatch[1], ownerId: context.user.id } })
    const fail = (statusCode, code, message) => {
      const error = new Error(message)
      error.statusCode = statusCode
      error.code = code
      error.expose = true
      throw error
    }
    if (!existing) fail(404, 'LISTING_NOT_FOUND', 'Listing not found for this account.')
    if (existing.division === 'STAYS') fail(400, 'LISTING_NOT_SELLABLE', 'Stays cannot be marked as sold. Pause the listing instead.')
    if (existing.status !== 'APPROVED') fail(409, 'LISTING_NOT_LIVE', 'Only a live listing can be marked as sold.')
    const sold = body.sold !== false
    const metadata = { ...(existing.metadata && typeof existing.metadata === 'object' ? existing.metadata : {}) }
    if (sold) {
      metadata.sold = true
      metadata.soldAt = new Date().toISOString()
    } else {
      delete metadata.sold
      delete metadata.soldAt
    }
    const listing = await db().listing.update({ where: { id: existing.id }, data: { metadata } })
    await db().adminAuditLog.create({
      data: { actorUserId: context.user.id, action: sold ? 'LISTING_MARKED_SOLD' : 'LISTING_UNMARKED_SOLD', entityType: 'listings', entityId: listing.id, before: existing, after: listing },
    })
    return json(res, 200, { ok: true, listing })
  }

  const detailMatch = url.pathname.match(/^\/api\/listings\/([^/]+)$/)
  if (detailMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    await expireOldListings({ id: detailMatch[1] })
    const found = await db().listing.findFirst({
      where: { id: detailMatch[1] },
      include: {
        location: true,
        media: true,
        owner: {
          select: {
            id: true,
            displayName: true,
            hostVerifiedAt: true,
          },
        },
      },
    })
    // Host verification: an unverified owner's stay is a plain 404 publicly. toPublicListing()
    // exposes only the owner's id + displayName, never hostVerifiedAt.
    if (found && isListingPubliclyVisible(found, found.owner)) {
      return json(res, 200, { ok: true, listing: toPublicListing(found) })
    }
    // Owner preview (2026-10-22): the owner (or staff) can open their own stay before it is live --
    // in review, rejected, or approved but waiting for the activation code -- to check how guests
    // will see it. Marked preview so the page shows a banner; booking stays closed (the quote and
    // booking routes still require a publicly visible listing).
    const privileged = Boolean(found && context?.user && (found.ownerId === context.user.id || context.roles?.includes('ADMIN') || context.roles?.includes('SUPPORT')))
    if (privileged) {
      return json(res, 200, {
        ok: true,
        listing: { ...toPublicListing(found), preview: true, previewReason: found.status !== 'APPROVED' ? found.status : 'HOST_NOT_ACTIVATED' },
      })
    }
    const listing = null
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
    // Host verification: the calendar of a stay that is not public (not APPROVED, or its owner is
    // not verified) is only readable by its owner and staff -- everyone else gets the same 404 as
    // GET /api/listings/:id. Previously this endpoint answered for any id at all.
    const target = await db().listing.findFirst({
      where: { id: listingId },
      select: { id: true, ownerId: true, status: true, division: true, owner: { select: { hostVerifiedAt: true } } },
    }).catch(() => null)
    const privileged = Boolean(target && context?.user && (target.ownerId === context.user.id || context.roles?.includes('ADMIN') || context.roles?.includes('SUPPORT')))
    if (!target || (!privileged && !isListingPubliclyVisible(target, target.owner))) {
      const error = new Error('Listing not found.')
      error.statusCode = 404
      error.code = 'LISTING_NOT_FOUND'
      error.expose = true
      throw error
    }
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
          checkIn: { not: null },
          // only stays that are not over yet: past bookings can never block a date the calendar
          // shows, and returning all of them made this response grow forever with a listing's history
          checkOut: { not: null, gt: from },
          // Decision 6 (2026-10-08): stale unpaid requests past their payment window (no live
          // proof) no longer show as booked, matching the booking-creation overlap check.
          ...dateBlockingBookingWhere(new Date(), bookingPolicySettings()),
        },
        select: { checkIn: true, checkOut: true, status: true },
      }),
    ])

    const blockedDates = blockedRows.map((row) => isoDate(row.date))
    const priceOverrides = priceRows.map((row) => ({ date: isoDate(row.date), priceMinor: row.priceOverrideMinor }))
    const bookedRanges = activeBookings.map((booking) => ({
      checkIn: isoDate(booking.checkIn),
      checkOut: isoDate(booking.checkOut),
      // The owner/staff calendar tells paid reservations apart from requests still awaiting payment.
      ...(privileged ? { paid: booking.status !== 'PAYMENT_PENDING' } : {}),
    }))

    return json(res, 200, { ok: true, blockedDates, priceOverrides, bookedRanges })
  }

  const reviewsMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/reviews$/)
  if (reviewsMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    const rl = await db().listing.findUnique({ where: { id: reviewsMatch[1] }, select: { status: true, division: true, owner: { select: { hostVerifiedAt: true } } } })
    if (!rl || !isListingPubliclyVisible(rl, rl.owner)) return json(res, 200, { ok: true, reviews: [], average: null, count: 0 })
    const reviews = await db().listingReview.findMany({
      where: { listingId: reviewsMatch[1], hiddenAt: null },
      include: { guest: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    const count = reviews.length
    const average = count ? Math.round((reviews.reduce((sum, review) => sum + review.rating, 0) / count) * 10) / 10 : null
    const publicReviews = reviews.map((review) => ({ ...review, guest: review.guest ? { ...review.guest, displayName: publicDisplayName(review.guest.displayName) } : review.guest }))
    return json(res, 200, { ok: true, reviews: publicReviews, average, count })
  }

  // Comparable / similar listings (migration 064). Centris "similar properties nearby": same
  // division, same city when known, asking price within +/-35%, excluding the listing itself.
  const comparablesMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/comparables$/)
  if (comparablesMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    const base = await db().listing.findFirst({
      where: { id: comparablesMatch[1], status: 'APPROVED' },
      include: { location: true, owner: { select: { hostVerifiedAt: true } } },
    })
    if (!base || !isListingPubliclyVisible(base, base.owner)) return json(res, 200, { ok: true, listings: [] })
    const lo = Math.round(base.priceMinor * 0.65)
    const hi = Math.round(base.priceMinor * 1.35)
    const city = base.location?.city
    const where = {
      status: 'APPROVED',
      division: base.division,
      id: { not: base.id },
      priceMinor: { gte: lo, lte: hi },
      ...publicListingVisibilityWhere(base.division),
      ...(city ? { location: { city: { equals: city, mode: 'insensitive' } } } : {}),
    }
    let rows = await db().listing.findMany({
      where,
      include: { location: true, media: { orderBy: { sortOrder: 'asc' }, take: 1 } },
      take: 12,
    })
    // If a city filter leaves too few, widen to division-only within the price band.
    if (rows.length < 3 && city) {
      rows = await db().listing.findMany({
        where: { status: 'APPROVED', division: base.division, id: { not: base.id }, priceMinor: { gte: lo, lte: hi }, ...publicListingVisibilityWhere(base.division) },
        include: { location: true, media: { orderBy: { sortOrder: 'asc' }, take: 1 } },
        take: 12,
      })
    }
    rows.sort((a, b) => Math.abs(a.priceMinor - base.priceMinor) - Math.abs(b.priceMinor - base.priceMinor))
    return json(res, 200, { ok: true, listings: rows.slice(0, 6).map(toPublicListing) })
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
    // Publish gate for EVERY division (owner decision 2026-10-09: submit everything first, checks at
    // the end): the lister must (1) have UPLOADED an ID (PENDING_REVIEW or APPROVED -- the admin
    // approves the ID before approving the listing) and (2) have signed the listing agreement.
    const publisher = await db().user.findUnique({
      where: { id: context.user.id },
      select: { idDocumentStatus: true },
    })
    if (!['PENDING_REVIEW', 'APPROVED'].includes(publisher?.idDocumentStatus)) {
      const error = new Error(
        publisher?.idDocumentStatus === 'REJECTED'
          ? 'Your ID was rejected — upload a new, clear photo.'
          : 'Upload a photo of your ID before sending the listing for review.',
      )
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
    // Stays (owner decision 2026-10-22): the host must tell us where to send their money (Sham Cash
    // or bank, from the active country's payout methods) before the listing goes to review, so a
    // first booking never waits on missing payout details.
    if (existing.division === 'STAYS' && existing.metadata?.advertising !== true) {
      const payoutMethod = await db().hostPayoutMethod.findUnique({ where: { userId: context.user.id }, select: { type: true } })
      if (!payoutMethod || !payoutMethodConfig()[payoutMethod.type]) {
        const error = new Error('Add how you want to be paid (Sham Cash or bank account) before sending your stay for review.')
        error.statusCode = 403
        error.code = 'PAYOUT_METHOD_REQUIRED'
        error.expose = true
        throw error
      }
    }
    const listing = await db().listing.update({
      where: { id: existing.id },
      data: { status: 'PENDING_REVIEW' },
    })
    // AI pre-check (2026-10-09): fire-and-forget AFTER this response; it never blocks or fails the
    // submission and never decides -- the admin does. Advertising campaigns (banners) are skipped.
    if (listing.metadata?.advertising !== true) {
      scheduleAiListingReview(listing.id, { actorUserId: context.user.id, trigger: 'SUBMIT' })
    }
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
