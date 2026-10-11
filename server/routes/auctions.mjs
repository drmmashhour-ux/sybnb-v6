// Cars marketplace + auction engine (2026-10-10).
//
// A hybrid sale model layered on the polymorphic `listings` table. A CARS listing is EITHER
// fixed-price (no Auction row -> the existing browse + contact/buy path) OR an auction (one Auction
// row). Auctions come in two deposit modes:
//   - NONE     (free bid): the highest bid at close wins; SYBNB notifies both parties and they settle
//              offline (Sham Cash / cash / bank), exactly like the current contact model.
//   - REQUIRED (serious buyers): a bidder must have a saved card on file to bid; at close the winner
//              is charged the deposit off-session. Losers are never charged.
//
// Safety / correctness posture:
//   - Bidding runs inside a DB transaction with an optimistic `version` guard, so two bids racing for
//     the same auction can never both believe they are the high bid.
//   - Anti-snipe: a bid inside the final `antiSnipeSeconds` pushes `endsAt` out by that window, so an
//     auction can't be stolen in the last second.
//   - Closing is idempotent and reachable two ways: lazily on any read of an ended auction, and from
//     the server's internal tick via closeDueAuctions(). Either path finalizes exactly once.
//   - The deposit charge is OUTSIDE the DB transaction and fails OPEN: a decline leaves the auction
//     settled with a winner and a note that the deposit is unpaid (parties fall back to offline),
//     never a half-committed state.
import Stripe from 'stripe'
import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, readJson } from '../lib/responses.mjs'
import { log } from '../lib/logger.mjs'
import { notifyAdmin, notifyUserMulti } from '../lib/notifications.mjs'
import { sendPushNotification } from '../lib/push-notifications.mjs'

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null

// Mirrors ride-auto-charge: never move real money on a live key unless payments are explicitly on.
function depositChargeable() {
  if (!stripe) return false
  if (process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') && process.env.PAYMENTS_ENABLED !== 'true') return false
  return true
}

const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const DEFAULT_MIN_INCREMENT_MINOR = 50 // $50 (whole USD units; money model is whole units, not cents)
const DEFAULT_DEPOSIT_RATE = 0.05
const MIN_DEPOSIT_MINOR = 50 // $50 floor (whole USD units)

function badRequest(message, code = 'BAD_REQUEST', statusCode = 400) {
  const err = new Error(message)
  err.statusCode = statusCode
  err.code = code
  err.expose = true
  return err
}

function isAdmin(context) {
  return Array.isArray(context?.roles) && context.roles.includes('ADMIN')
}

function minNextBidMinor(a) {
  if (a.currentBidMinor && a.currentBidMinor > 0) return a.currentBidMinor + a.minIncrementMinor
  return a.startMinor
}

// Public shape. Reserve PRICE is only revealed to the seller/admin (hidden reserves are standard);
// everyone sees whether the reserve has been MET.
function toPublicAuction(a, { viewerId, admin } = {}) {
  const now = Date.now()
  const ended = a.status === 'ENDED' || a.status === 'SETTLED' || a.status === 'CANCELLED'
  const isSeller = viewerId && viewerId === a.sellerId
  const revealReserve = admin || isSeller
  return {
    id: a.id,
    listingId: a.listingId,
    sellerId: a.sellerId,
    status: a.status,
    currency: a.currency,
    startMinor: a.startMinor,
    reserveMinor: revealReserve ? (a.reserveMinor ?? null) : undefined,
    hasReserve: a.reserveMinor != null,
    reserveMet: a.reserveMet,
    minIncrementMinor: a.minIncrementMinor,
    minNextBidMinor: minNextBidMinor(a),
    depositMode: a.depositMode,
    depositMinor: a.depositMinor ?? null,
    antiSnipeSeconds: a.antiSnipeSeconds,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    currentBidMinor: a.currentBidMinor ?? null,
    bidCount: a.bidCount,
    winnerId: ended ? (a.winnerId ?? null) : undefined,
    winningBidMinor: ended ? (a.winningBidMinor ?? null) : undefined,
    viewerIsSeller: Boolean(isSeller),
    viewerIsHighBidder: Boolean(viewerId && a.currentBidId && a._highBidderId && viewerId === a._highBidderId),
    viewerWon: Boolean(ended && viewerId && a.winnerId && viewerId === a.winnerId),
    timeLeftMs: ended ? 0 : Math.max(0, new Date(a.endsAt).getTime() - now),
    settledAt: a.settledAt ?? null,
  }
}

// Keep a compact auction summary on the listing's metadata so browse cards can show "Auction /
// current bid / time left" without an extra query per card.
async function stampListingAuction(client, a) {
  try {
    const listing = await client.listing.findUnique({ where: { id: a.listingId }, select: { metadata: true } })
    const metadata = { ...(listing?.metadata || {}) }
    metadata.auction = {
      isAuction: true,
      status: a.status,
      currency: a.currency,
      startMinor: a.startMinor,
      currentBidMinor: a.currentBidMinor ?? null,
      bidCount: a.bidCount,
      endsAt: a.endsAt,
      depositMode: a.depositMode,
      reserveMet: a.reserveMet,
    }
    await client.listing.update({ where: { id: a.listingId }, data: { metadata, expiresAt: a.endsAt } })
  } catch (err) {
    log.warn('auction_stamp_failed', { auctionId: a.id, message: err?.message })
  }
}

async function loadHighBidder(a) {
  if (!a.currentBidId) return a
  const bid = await db().bid.findUnique({ where: { id: a.currentBidId }, select: { bidderId: true } })
  return { ...a, _highBidderId: bid?.bidderId || null }
}

// --- Finalization -----------------------------------------------------------------------------

async function chargeWinnerDeposit(auction, winnerId) {
  if (auction.depositMode !== 'REQUIRED' || !auction.depositMinor || auction.depositMinor <= 0) {
    return { attempted: false, reason: 'no_deposit' }
  }
  if (!depositChargeable()) return { attempted: false, reason: 'stripe_unavailable' }
  const winner = await db().user.findUnique({ where: { id: winnerId }, select: { stripeCustomerId: true, defaultCardPmId: true } })
  if (!winner?.stripeCustomerId || !winner?.defaultCardPmId) return { attempted: false, reason: 'no_saved_card' }
  // Auction amounts are stored in WHOLE currency units (like listing.priceMinor: 500 == $500), but
  // Stripe charges in the smallest unit (cents for USD). Deposit-required auctions are constrained to
  // USD at creation, so the conversion is a clean x100.
  const currency = (auction.currency || 'USD').toLowerCase()
  const amount = currency === 'usd'
    ? Math.max(50, Math.round(auction.depositMinor * 100))
    : Math.max(50, Math.round(auction.depositMinor))
  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount,
        currency,
        customer: winner.stripeCustomerId,
        payment_method: winner.defaultCardPmId,
        off_session: true,
        confirm: true,
        metadata: { auctionId: auction.id, listingId: auction.listingId, userId: winnerId, kind: 'car_auction_deposit' },
      },
      { idempotencyKey: `auction-deposit-${auction.id}` },
    )
    if (intent.status === 'succeeded') return { attempted: true, charged: true, intentId: intent.id }
    return { attempted: true, charged: false, status: intent.status }
  } catch (err) {
    log.warn('auction_deposit_charge_failed', { auctionId: auction.id, code: err?.code, declineCode: err?.decline_code })
    return { attempted: true, charged: false, code: err?.code || 'charge_failed' }
  }
}

// Finalize ONE auction, idempotently. Returns the finalized auction row (with _highBidderId).
export async function finalizeAuction(auctionId) {
  const result = await db().$transaction(async (tx) => {
    const a = await tx.auction.findUnique({ where: { id: auctionId } })
    if (!a) return null
    if (a.status === 'SETTLED' || a.status === 'CANCELLED') return a // already closed
    if (a.status === 'LIVE' && new Date(a.endsAt).getTime() > Date.now()) return a // not due yet

    const topBid = await tx.bid.findFirst({
      where: { auctionId: a.id, status: { in: ['ACTIVE', 'OUTBID', 'WON'] } },
      orderBy: [{ amountMinor: 'desc' }, { createdAt: 'asc' }],
    })

    const reserveMet = topBid ? (a.reserveMinor == null || topBid.amountMinor >= a.reserveMinor) : false
    const hasWinner = Boolean(topBid && reserveMet)

    // Mark bids: winner WON, everyone else LOST.
    if (topBid) {
      await tx.bid.updateMany({ where: { auctionId: a.id, id: { not: topBid.id } }, data: { status: 'LOST' } })
      await tx.bid.update({ where: { id: topBid.id }, data: { status: hasWinner ? 'WON' : 'LOST' } })
    }

    const updated = await tx.auction.update({
      where: { id: a.id },
      data: {
        status: 'SETTLED',
        settledAt: new Date(),
        reserveMet,
        winnerId: hasWinner ? topBid.bidderId : null,
        winningBidMinor: hasWinner ? topBid.amountMinor : null,
        currentBidMinor: topBid ? topBid.amountMinor : a.currentBidMinor,
        currentBidId: topBid ? topBid.id : a.currentBidId,
        version: { increment: 1 },
      },
    })
    return { ...updated, _highBidderId: topBid?.bidderId || null, _topBidId: topBid?.id || null }
  })

  if (!result) return null
  await stampListingAuction(db(), result)

  // Deposit charge + notifications happen AFTER the tx commits (no Stripe call inside a DB tx).
  if (result.status === 'SETTLED') {
    if (result.winnerId) {
      const charge = await chargeWinnerDeposit(result, result.winnerId)
      if (charge.attempted && charge.charged && result._topBidId) {
        await db().bid.update({ where: { id: result._topBidId }, data: { depositProofId: charge.intentId } }).catch(() => {})
      }
      const listing = await db().listing.findUnique({ where: { id: result.listingId }, select: { titleEn: true, titleAr: true, ownerId: true } })
      const carName = listing?.titleEn || listing?.titleAr || 'your car'
      notifyUserMulti('auction_won', result.winnerId, { carName, url: `/#/listing/${result.listingId}` }, `auction-won-${result.id}`)
      notifyUserMulti('auction_sold', result.sellerId, { carName, url: `/#/listing/${result.listingId}` }, `auction-sold-${result.id}`)
      notifyAdmin('car_auction_settled', { auctionId: result.id, listingId: result.listingId, winnerId: result.winnerId, winningBidMinor: result.winningBidMinor, depositCharged: Boolean(charge.charged) }, `auction-settled-${result.id}`)
    } else {
      notifyAdmin('car_auction_closed_no_sale', { auctionId: result.id, listingId: result.listingId, reserveMet: result.reserveMet }, `auction-nosale-${result.id}`)
    }
  }
  return result
}

// Called from the server internal tick: finalize every LIVE auction whose clock has run out.
export async function closeDueAuctions() {
  let closed = 0
  try {
    const due = await db().auction.findMany({
      where: { status: 'LIVE', endsAt: { lte: new Date() } },
      select: { id: true },
      take: 50,
    })
    for (const row of due) {
      const r = await finalizeAuction(row.id).catch((err) => {
        log.warn('auction_finalize_failed', { auctionId: row.id, message: err?.message })
        return null
      })
      if (r && r.status === 'SETTLED') closed += 1
    }
  } catch (err) {
    log.warn('auction_sweep_failed', { message: err?.message })
  }
  return { closed }
}

// Lazily finalize on read if the clock has run out, so a buyer who opens an ended auction always
// sees the settled result even before the tick runs.
async function maybeFinalizeOnRead(a) {
  if (a.status === 'LIVE' && new Date(a.endsAt).getTime() <= Date.now()) {
    const r = await finalizeAuction(a.id)
    return r || a
  }
  return a
}

// --- Route handler ----------------------------------------------------------------------------

export async function handleAuctions(req, res, url, context) {
  const path = url.pathname
  if (!path.startsWith('/api/auctions')) return false

  // POST /api/auctions  -- create an auction for a CARS listing (seller or admin)
  if (path === '/api/auctions' && req.method === 'POST') {
    requireAuth(context)
    const body = await readJson(req)
    const listingId = String(body.listingId || '').trim()
    if (!listingId) throw badRequest('listingId is required.', 'LISTING_REQUIRED')
    const listing = await db().listing.findUnique({ where: { id: listingId }, select: { id: true, ownerId: true, division: true, currency: true } })
    if (!listing) throw badRequest('Listing not found.', 'LISTING_NOT_FOUND', 404)
    if (listing.division !== 'CARS') throw badRequest('Auctions are only available for car listings.', 'AUCTION_DIVISION')
    if (listing.ownerId !== context.user.id && !isAdmin(context)) throw badRequest('Only the listing owner can start its auction.', 'FORBIDDEN', 403)
    const existing = await db().auction.findUnique({ where: { listingId } })
    if (existing) throw badRequest('This listing already has an auction.', 'AUCTION_EXISTS', 409)

    const currency = (typeof body.currency === 'string' && body.currency.trim()) ? body.currency.trim().toUpperCase() : 'USD'
    const startMinor = Math.round(Number(body.startMinor))
    if (!Number.isFinite(startMinor) || startMinor <= 0) throw badRequest('A valid starting price is required.', 'START_PRICE')
    let reserveMinor = body.reserveMinor == null ? null : Math.round(Number(body.reserveMinor))
    if (reserveMinor != null && (!Number.isFinite(reserveMinor) || reserveMinor < startMinor)) {
      throw badRequest('Reserve price must be at least the starting price.', 'RESERVE_PRICE')
    }
    let minIncrementMinor = body.minIncrementMinor == null ? DEFAULT_MIN_INCREMENT_MINOR : Math.round(Number(body.minIncrementMinor))
    if (!Number.isFinite(minIncrementMinor) || minIncrementMinor <= 0) minIncrementMinor = DEFAULT_MIN_INCREMENT_MINOR

    const depositMode = body.depositMode === 'REQUIRED' ? 'REQUIRED' : 'NONE'
    // Deposit holds settle on the USD Stripe account, so a deposit-required auction must be USD.
    if (depositMode === 'REQUIRED' && currency !== 'USD') {
      throw badRequest('Deposit-required auctions must be priced in USD.', 'DEPOSIT_CURRENCY')
    }
    let depositMinor = null
    if (depositMode === 'REQUIRED') {
      depositMinor = body.depositMinor == null
        ? Math.max(MIN_DEPOSIT_MINOR, Math.round(startMinor * DEFAULT_DEPOSIT_RATE))
        : Math.round(Number(body.depositMinor))
      if (!Number.isFinite(depositMinor) || depositMinor <= 0) depositMinor = Math.max(MIN_DEPOSIT_MINOR, Math.round(startMinor * DEFAULT_DEPOSIT_RATE))
    }

    let antiSnipeSeconds = body.antiSnipeSeconds == null ? 120 : Math.round(Number(body.antiSnipeSeconds))
    if (!Number.isFinite(antiSnipeSeconds) || antiSnipeSeconds < 0) antiSnipeSeconds = 120
    if (antiSnipeSeconds > 600) antiSnipeSeconds = 600

    let endsAtMs
    if (body.endsAt) {
      endsAtMs = new Date(body.endsAt).getTime()
    } else {
      const hours = Number(body.durationHours)
      const h = Number.isFinite(hours) && hours > 0 ? hours : 168 // default 7 days
      endsAtMs = Date.now() + h * 60 * 60 * 1000
    }
    if (!Number.isFinite(endsAtMs) || endsAtMs <= Date.now() + 60 * 1000) throw badRequest('Auction end time must be in the future.', 'END_TIME')
    if (endsAtMs > Date.now() + MAX_DURATION_MS) throw badRequest('Auction cannot run longer than 30 days.', 'END_TIME_MAX')

    const created = await db().auction.create({
      data: {
        listingId,
        sellerId: listing.ownerId,
        currency,
        startMinor,
        reserveMinor,
        minIncrementMinor,
        depositMode,
        depositMinor,
        antiSnipeSeconds,
        startsAt: new Date(),
        endsAt: new Date(endsAtMs),
        status: 'LIVE',
      },
    })
    await stampListingAuction(db(), created)
    return json(res, 201, { ok: true, auction: toPublicAuction(created, { viewerId: context.user.id, admin: isAdmin(context) }) })
  }

  // GET /api/auctions/by-listing/:listingId
  const byListing = path.match(/^\/api\/auctions\/by-listing\/([^/]+)$/)
  if (byListing && req.method === 'GET') {
    const listingId = decodeURIComponent(byListing[1])
    let a = await db().auction.findUnique({ where: { listingId } })
    if (!a) return json(res, 200, { ok: true, auction: null })
    a = await maybeFinalizeOnRead(a)
    a = await loadHighBidder(a)
    return json(res, 200, { ok: true, auction: toPublicAuction(a, { viewerId: context?.user?.id, admin: isAdmin(context) }) })
  }

  // GET /api/auctions/:id/bids  -- public history (masked names)
  const bidsList = path.match(/^\/api\/auctions\/([^/]+)\/bids$/)
  if (bidsList && req.method === 'GET') {
    const auctionId = decodeURIComponent(bidsList[1])
    const bids = await db().bid.findMany({
      where: { auctionId },
      orderBy: [{ amountMinor: 'desc' }, { createdAt: 'asc' }],
      take: 50,
      include: { bidder: { select: { id: true, displayName: true } } },
    })
    const viewerId = context?.user?.id
    const items = bids.map((b) => ({
      id: b.id,
      amountMinor: b.amountMinor,
      currency: b.currency,
      status: b.status,
      createdAt: b.createdAt,
      bidderMasked: maskName(b.bidder?.displayName),
      isYou: Boolean(viewerId && b.bidderId === viewerId),
    }))
    return json(res, 200, { ok: true, bids: items })
  }

  // POST /api/auctions/:id/bids  -- place a bid
  const placeBid = path.match(/^\/api\/auctions\/([^/]+)\/bids$/)
  if (placeBid && req.method === 'POST') {
    requireAuth(context)
    const auctionId = decodeURIComponent(placeBid[1])
    const body = await readJson(req)
    const amountMinor = Math.round(Number(body.amountMinor))
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) throw badRequest('A valid bid amount is required.', 'BID_AMOUNT')
    const maxProxyMinor = body.maxProxyMinor == null ? null : Math.round(Number(body.maxProxyMinor))

    // Lazy-finalize first so a bid on a just-ended auction is cleanly rejected.
    const pre = await db().auction.findUnique({ where: { id: auctionId } })
    if (!pre) throw badRequest('Auction not found.', 'AUCTION_NOT_FOUND', 404)
    const liveCheck = await maybeFinalizeOnRead(pre)
    if (liveCheck.status !== 'LIVE') throw badRequest('This auction is not accepting bids.', 'AUCTION_CLOSED', 409)
    if (liveCheck.sellerId === context.user.id) throw badRequest('You cannot bid on your own auction.', 'OWN_AUCTION')

    if (liveCheck.depositMode === 'REQUIRED') {
      const me = await db().user.findUnique({ where: { id: context.user.id }, select: { stripeCustomerId: true, defaultCardPmId: true } })
      if (!me?.stripeCustomerId || !me?.defaultCardPmId) {
        throw badRequest('This auction requires a saved card to bid. Add a card first.', 'AUCTION_CARD_REQUIRED', 402)
      }
    }

    // Optimistic-concurrency bid placement: re-read inside the tx, guard the auction update on the
    // version we read, retry a few times if another bid won the race.
    let finalAuction = null
    for (let attempt = 0; attempt < 4 && !finalAuction; attempt += 1) {
      finalAuction = await db().$transaction(async (tx) => {
        const a = await tx.auction.findUnique({ where: { id: auctionId } })
        if (!a || a.status !== 'LIVE') throw badRequest('This auction is not accepting bids.', 'AUCTION_CLOSED', 409)
        if (new Date(a.endsAt).getTime() <= Date.now()) throw badRequest('This auction has ended.', 'AUCTION_ENDED', 409)
        const minNext = minNextBidMinor(a)
        if (amountMinor < minNext) {
          throw badRequest(`Your bid must be at least ${minNext} (minor units).`, 'BID_TOO_LOW')
        }
        const prevHighBidId = a.currentBidId

        const bid = await tx.bid.create({
          data: {
            auctionId: a.id,
            bidderId: context.user.id,
            amountMinor,
            currency: a.currency,
            status: 'ACTIVE',
            maxProxyMinor: maxProxyMinor && maxProxyMinor > amountMinor ? maxProxyMinor : null,
          },
        })

        // Anti-snipe: extend the clock if this bid lands inside the final window.
        let newEndsAt = a.endsAt
        const msLeft = new Date(a.endsAt).getTime() - Date.now()
        if (a.antiSnipeSeconds > 0 && msLeft < a.antiSnipeSeconds * 1000) {
          newEndsAt = new Date(Date.now() + a.antiSnipeSeconds * 1000)
        }

        // Guard on version: only apply if the auction hasn't changed since we read it.
        const upd = await tx.auction.updateMany({
          where: { id: a.id, version: a.version },
          data: {
            currentBidMinor: amountMinor,
            currentBidId: bid.id,
            bidCount: { increment: 1 },
            reserveMet: a.reserveMinor == null ? true : amountMinor >= a.reserveMinor,
            endsAt: newEndsAt,
            version: { increment: 1 },
          },
        })
        if (upd.count !== 1) {
          // Lost the race -- abort this attempt (bid row rolls back) and retry.
          throw badRequest('__RETRY__', 'RETRY', 409)
        }
        if (prevHighBidId) {
          await tx.bid.update({ where: { id: prevHighBidId }, data: { status: 'OUTBID' } }).catch(() => {})
        }
        const fresh = await tx.auction.findUnique({ where: { id: a.id } })
        return { ...fresh, _highBidderId: context.user.id, _newBidId: bid.id, _prevHighBidId: prevHighBidId }
      }).catch((err) => {
        if (err?.code === 'RETRY') return null
        throw err
      })
    }
    if (!finalAuction) throw badRequest('Too many bids at once, please try again.', 'BID_CONTENTION', 409)

    await stampListingAuction(db(), finalAuction)
    // Notify the outbid previous high bidder.
    if (finalAuction._prevHighBidId) {
      const prev = await db().bid.findUnique({ where: { id: finalAuction._prevHighBidId }, select: { bidderId: true } })
      if (prev?.bidderId && prev.bidderId !== context.user.id) {
        notifyUserMulti('auction_outbid', prev.bidderId, { url: `/#/listing/${finalAuction.listingId}` }, `auction-outbid-${finalAuction.id}-${prev.bidderId}`)
      }
    }
    return json(res, 201, { ok: true, auction: toPublicAuction(finalAuction, { viewerId: context.user.id, admin: isAdmin(context) }) })
  }

  // POST /api/auctions/:id/finalize  -- admin/seller force-close
  const finalize = path.match(/^\/api\/auctions\/([^/]+)\/finalize$/)
  if (finalize && req.method === 'POST') {
    requireAuth(context)
    const auctionId = decodeURIComponent(finalize[1])
    const a = await db().auction.findUnique({ where: { id: auctionId }, select: { sellerId: true } })
    if (!a) throw badRequest('Auction not found.', 'AUCTION_NOT_FOUND', 404)
    if (a.sellerId !== context.user.id && !isAdmin(context)) throw badRequest('Only the seller or an admin can close this auction.', 'FORBIDDEN', 403)
    const r = await finalizeAuction(auctionId)
    const withBidder = await loadHighBidder(r)
    return json(res, 200, { ok: true, auction: toPublicAuction(withBidder, { viewerId: context.user.id, admin: isAdmin(context) }) })
  }

  // POST /api/auctions/:id/cancel  -- seller (only if no bids) or admin
  const cancel = path.match(/^\/api\/auctions\/([^/]+)\/cancel$/)
  if (cancel && req.method === 'POST') {
    requireAuth(context)
    const auctionId = decodeURIComponent(cancel[1])
    const a = await db().auction.findUnique({ where: { id: auctionId } })
    if (!a) throw badRequest('Auction not found.', 'AUCTION_NOT_FOUND', 404)
    if (a.sellerId !== context.user.id && !isAdmin(context)) throw badRequest('Only the seller or an admin can cancel this auction.', 'FORBIDDEN', 403)
    if (a.bidCount > 0 && !isAdmin(context)) throw badRequest('This auction already has bids and cannot be cancelled by the seller.', 'AUCTION_HAS_BIDS', 409)
    const updated = await db().$transaction(async (tx) => {
      await tx.bid.updateMany({ where: { auctionId }, data: { status: 'LOST' } })
      return tx.auction.update({ where: { id: auctionId }, data: { status: 'CANCELLED', settledAt: new Date(), version: { increment: 1 } } })
    })
    await stampListingAuction(db(), updated)
    return json(res, 200, { ok: true, auction: toPublicAuction(updated, { viewerId: context.user.id, admin: isAdmin(context) }) })
  }

  // GET /api/auctions/:id
  const byId = path.match(/^\/api\/auctions\/([^/]+)$/)
  if (byId && req.method === 'GET') {
    const auctionId = decodeURIComponent(byId[1])
    let a = await db().auction.findUnique({ where: { id: auctionId } })
    if (!a) return json(res, 200, { ok: true, auction: null })
    a = await maybeFinalizeOnRead(a)
    a = await loadHighBidder(a)
    return json(res, 200, { ok: true, auction: toPublicAuction(a, { viewerId: context?.user?.id, admin: isAdmin(context) }) })
  }

  return false
}

function maskName(name) {
  if (!name || typeof name !== 'string') return 'Bidder'
  const trimmed = name.trim()
  if (!trimmed) return 'Bidder'
  const parts = trimmed.split(/\s+/)
  const first = parts[0]
  const initial = parts.length > 1 ? parts[parts.length - 1][0] : ''
  const head = first.length <= 2 ? first : first.slice(0, 2) + '•'.repeat(Math.min(3, first.length - 2))
  return initial ? `${head} ${initial}.` : head
}
