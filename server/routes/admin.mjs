import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { approvePaymentProof, bookingFinanceSplit, createRefundRequest, executeManualRailRefund, finalizeCancellationLedgerEffects, markPayoutRequestPaid, recordWalletEntry, rejectPayoutRequest, reverseBookingPlatformShare, reverseRidePayment } from '../lib/finance-ledger.mjs'
import { appLink, formatMoney, notifyBooking, notifyUser } from '../lib/notifications.mjs'
import { completeExpiredBookings, isPayoutEligible, payoutEligibleAt, PAYOUT_HOLD_DAYS } from '../lib/booking-lifecycle.mjs'
import { expireStaleWalletGifts } from '../lib/gift-lifecycle.mjs'
import { deleteIdDocument, readIdDocument, saveIdDocument } from '../lib/id-document-storage.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { authorizePaymentOperation, policyEnvironment, activePolicyCountryKey } from '../lib/payment-policy.mjs'
import { idempotencyKey, hashPhone } from '../lib/security.mjs'
import { applyRoleChange, setAccountStatus, REVOCATION_REASONS } from '../lib/session-store.mjs'
import { runBoundedRevocation } from '../lib/revocation-contention.mjs'
// SEC-002R (finding N4): getAuthContext() runs ONCE, in server/index.mjs, before the route handler
// has even read the request body, and its result is trusted for the rest of the request. Every
// Class A (irreversible money-moving or privilege-changing) handler in this file re-asserts that
// authority against locked, authoritative DB rows inside the SAME transaction as its own
// state-changing write -- see server/lib/commit-authorization.mjs for the full reasoning.
import { reauthorizeAtCommit } from '../lib/commit-authorization.mjs'
// Owner decision 2026-10-09: AI pre-check shown to the reviewer + activation code at the END
// (issued automatically when an admin approves an unverified host's stay).
import { reviewListingNow, scheduleAiListingReview, serializeAiReview } from '../lib/ai-listing-review-runner.mjs'
// Advisory-only AI decision assistant for the review desk (disputes + manual payments). Reuses the
// same Anthropic plumbing / key gating as the listing review; never moves money or changes state.
import { runAdminAiAssist, ADMIN_ASSIST_KINDS } from '../lib/ai-admin-assist.mjs'
import { runLoyaltyManager } from '../lib/ai-loyalty-manager.mjs'
import { applyAiLoyaltyDecision, loyaltySummary, AI_BONUS_CAP_PER_REVIEW, AI_BONUS_CAP_PER_DAY } from '../lib/loyalty.mjs'
import { approvalActivationDecision, issueHostActivationCodeTx } from '../lib/host-activation-issue.mjs'
import { isRateLimited } from '../lib/rateLimit.mjs'

// Mirrors prisma/schema.prisma's RoleName enum. Validated here so an unknown role is a clean 400
// rather than a Prisma enum error surfacing as a 500.
const VALID_ROLES = new Set(['GUEST', 'HOST', 'SELLER', 'DRIVER', 'ADMIN', 'SUPPORT'])

export async function handleAdmin(req, res, url, context) {
  // ---------------------------------------------------------------------------
  // Customer / Host 360 overview (read-only). Surfaces a single account's full
  // footprint for the admin — profile, listings, bookings (as guest AND as host),
  // payment proofs, payout requests, wallet balance + ledger entries, gifts, and
  // the audit trail touching this account. Purely a read: it moves no money and
  // changes no state, so it only needs ADMIN/SUPPORT (same as users/lookup) and
  // records a lightweight lookup audit entry.
  const userOverviewMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/overview$/)
  if (userOverviewMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const targetUserId = userOverviewMatch[1]

    const found = await db().user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        displayName: true,
        email: true,
        status: true,
        locale: true,
        createdAt: true,
        hostVerifiedAt: true,
        idDocumentStatus: true,
        roles: { select: { role: true } },
      },
    })
    if (!found) {
      const error = new Error('No account found for this id.')
      error.statusCode = 404
      error.code = 'USER_NOT_FOUND'
      error.expose = true
      throw error
    }

    const listingTitleSelect = { titleAr: true, titleEn: true }
    const [listings, bookingsAsGuest, bookingsAsHost, payments, payouts, wallets, giftsSent, giftsReceived, auditEntries] = await Promise.all([
      db().listing.findMany({
        where: { ownerId: targetUserId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { id: true, titleAr: true, titleEn: true, division: true, status: true, priceMinor: true, currency: true, createdAt: true },
      }),
      db().booking.findMany({
        where: { guestId: targetUserId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { id: true, listingId: true, status: true, checkIn: true, checkOut: true, amountMinor: true, currency: true, createdAt: true, listing: { select: listingTitleSelect } },
      }),
      db().booking.findMany({
        where: { listing: { ownerId: targetUserId } },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { id: true, listingId: true, guestId: true, status: true, checkIn: true, checkOut: true, amountMinor: true, currency: true, createdAt: true, listing: { select: listingTitleSelect } },
      }),
      db().paymentProof.findMany({
        where: { userId: targetUserId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { id: true, bookingId: true, provider: true, status: true, amountMinor: true, currency: true, createdAt: true },
      }),
      db().payoutRequest.findMany({
        where: { hostId: targetUserId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { id: true, amountMinor: true, currency: true, status: true, createdAt: true, decidedAt: true },
      }),
      db().wallet.findMany({
        where: { userId: targetUserId },
        select: {
          id: true,
          currency: true,
          cachedBalanceMinor: true,
          entries: {
            orderBy: { createdAt: 'desc' },
            take: 100,
            select: { id: true, type: true, amountMinor: true, currency: true, referenceType: true, referenceId: true, note: true, createdAt: true },
          },
        },
      }),
      db().walletGift.findMany({
        where: { senderUserId: targetUserId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, amountMinor: true, currency: true, status: true, createdAt: true },
      }),
      db().walletGift.findMany({
        where: { recipientUserId: targetUserId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, amountMinor: true, currency: true, status: true, createdAt: true },
      }),
      db().adminAuditLog.findMany({
        where: { entityId: targetUserId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, action: true, entityType: true, entityId: true, createdAt: true },
      }),
    ])

    const lifetimeSpentMinor = payments.filter((p) => p.status === 'APPROVED').reduce((sum, p) => sum + p.amountMinor, 0)
    const lifetimePayoutMinor = payouts.filter((p) => p.status === 'PAID').reduce((sum, p) => sum + p.amountMinor, 0)
    const walletBalanceMinor = wallets.reduce((sum, w) => sum + w.cachedBalanceMinor, 0)

    await db().adminAuditLog.create({
      data: { actorUserId: context.user.id, action: 'ADMIN_USER_OVERVIEW', entityType: 'user', entityId: targetUserId, before: null, after: null },
    })

    return json(res, 200, {
      ok: true,
      user: { ...found, roles: found.roles.map((r) => r.role) },
      listings,
      bookingsAsGuest,
      bookingsAsHost,
      payments,
      payouts,
      wallets,
      giftsSent,
      giftsReceived,
      audit: auditEntries,
      totals: {
        lifetimeSpentMinor,
        lifetimePayoutMinor,
        walletBalanceMinor,
        listingsCount: listings.length,
        guestBookingsCount: bookingsAsGuest.length,
        hostBookingsCount: bookingsAsHost.length,
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Transactions & money-flow explorer (read-only). A platform-wide, filterable
  // browser over the wallet ledger — every CREDIT/DEBIT/HOLD/RELEASE/REFUND with
  // the account it belongs to and what it references. Pure read; no money moves.
  if (url.pathname === '/api/admin/ledger') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])

    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 200)
    const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0)
    const typeParam = String(url.searchParams.get('type') || '').toUpperCase()
    const refType = String(url.searchParams.get('referenceType') || '').trim()
    const q = String(url.searchParams.get('q') || '').trim()

    const VALID_ENTRY_TYPES = new Set(['CREDIT', 'DEBIT', 'HOLD', 'RELEASE', 'REFUND'])
    const where = {}
    if (typeParam && VALID_ENTRY_TYPES.has(typeParam)) where.type = typeParam
    if (refType) where.referenceType = refType
    if (q) {
      where.OR = [
        { referenceId: { contains: q } },
        { note: { contains: q, mode: 'insensitive' } },
        { wallet: { user: { email: { contains: q.toLowerCase() } } } },
        { wallet: { user: { displayName: { contains: q, mode: 'insensitive' } } } },
      ]
    }

    const [rows, grouped, total] = await Promise.all([
      db().walletEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit + 1,
        select: {
          id: true, type: true, amountMinor: true, currency: true, referenceType: true, referenceId: true, note: true, createdAt: true,
          wallet: { select: { user: { select: { id: true, displayName: true, email: true } } } },
        },
      }),
      db().walletEntry.groupBy({ by: ['type', 'currency'], where, _sum: { amountMinor: true } }),
      db().walletEntry.count({ where }),
    ])

    const hasMore = rows.length > limit
    const entries = (hasMore ? rows.slice(0, limit) : rows).map((r) => ({
      id: r.id,
      type: r.type,
      amountMinor: r.amountMinor,
      currency: r.currency,
      referenceType: r.referenceType,
      referenceId: r.referenceId,
      note: r.note,
      createdAt: r.createdAt,
      user: r.wallet?.user ? { id: r.wallet.user.id, displayName: r.wallet.user.displayName, email: r.wallet.user.email } : null,
    }))

    // Totals are grouped by currency: SYP and USD minor units must never be summed into one scalar
    // (SYP is 1:1 whole units, USD is a different currency entirely — no FX here). One summary row
    // per currency present in the filtered set.
    const currencies = [...new Set(grouped.map((g) => g.currency || 'SYP'))]
    const sumFor = (cur, type) =>
      grouped.find((g) => (g.currency || 'SYP') === cur && g.type === type)?._sum.amountMinor || 0
    const summaryFor = (cur) => {
      const creditMinor = sumFor(cur, 'CREDIT')
      const debitMinor = sumFor(cur, 'DEBIT')
      const releaseMinor = sumFor(cur, 'RELEASE')
      const refundMinor = sumFor(cur, 'REFUND')
      return {
        currency: cur,
        creditMinor,
        debitMinor,
        holdMinor: sumFor(cur, 'HOLD'),
        releaseMinor,
        refundMinor,
        // Money genuinely added to wallets (credits, releases and refunds all raise a balance) minus
        // money taken out — within a single currency.
        netMinor: creditMinor + releaseMinor + refundMinor - debitMinor,
      }
    }
    const summariesByCurrency = currencies.map(summaryFor)
    // Backward-compatible single `summary`: the dominant currency (or SYP when the set is empty), so
    // older consumers keep working while the per-currency breakdown is authoritative.
    const primaryCurrency = summariesByCurrency.length ? summariesByCurrency[0].currency : 'SYP'
    const primarySummary = summariesByCurrency.find((s) => s.currency === primaryCurrency) || summaryFor('SYP')

    return json(res, 200, {
      ok: true,
      entries,
      summary: { ...primarySummary, count: total },
      summariesByCurrency,
      page: { limit, offset, hasMore },
    })
  }

  // ---------------------------------------------------------------------------
  // AI decision assistant (advisory only). The admin asks for a recommendation on
  // a specific manual payment proof or a disputed booking; we gather the same facts
  // the admin is already looking at, ask Claude for a structured recommendation, and
  // return it. This NEVER moves money or changes any state — the real approve/reject/
  // hold still goes through the existing Class-A endpoints. With no ANTHROPIC_API_KEY
  // it returns { configured:false } and the UI shows nothing.
  if (url.pathname === '/api/admin/ai-assist') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])

    const body = await readJson(req)
    const kind = String(body.kind || '').toLowerCase()
    const entityId = String(body.entityId || '').trim()
    if (!ADMIN_ASSIST_KINDS.includes(kind) || !entityId) {
      const error = new Error('kind must be "payment" or "dispute" and entityId is required.')
      error.statusCode = 400
      error.code = 'AI_ASSIST_BAD_REQUEST'
      error.expose = true
      throw error
    }

    let facts
    if (kind === 'payment') {
      const payment = await db().paymentProof.findUnique({
        where: { id: entityId },
        select: {
          id: true, provider: true, status: true, amountMinor: true, currency: true,
          proofAssetUrl: true, providerRef: true, planCode: true, adminNote: true, createdAt: true, reviewedAt: true,
          booking: {
            select: {
              id: true, status: true, amountMinor: true, currency: true, checkIn: true, checkOut: true,
              listing: { select: { titleAr: true, titleEn: true, division: true, status: true } },
              guest: { select: { displayName: true } },
            },
          },
        },
      })
      if (!payment) {
        const error = new Error('Payment proof not found.')
        error.statusCode = 404
        error.code = 'PAYMENT_NOT_FOUND'
        error.expose = true
        throw error
      }
      facts = {
        payment: {
          provider: payment.provider,
          status: payment.status,
          amount: `${(payment.amountMinor / 100).toFixed(2)} ${payment.currency}`,
          hasProofDocument: Boolean(payment.proofAssetUrl),
          hasProviderReference: Boolean(payment.providerRef),
          planCode: payment.planCode || null,
          adminNote: payment.adminNote || null,
          submittedAt: payment.createdAt,
          alreadyReviewedAt: payment.reviewedAt || null,
        },
        booking: payment.booking
          ? {
              status: payment.booking.status,
              amount: `${(payment.booking.amountMinor / 100).toFixed(2)} ${payment.booking.currency}`,
              checkIn: payment.booking.checkIn,
              checkOut: payment.booking.checkOut,
              listingTitle: payment.booking.listing?.titleEn || payment.booking.listing?.titleAr || null,
              listingDivision: payment.booking.listing?.division || null,
              listingStatus: payment.booking.listing?.status || null,
              guest: payment.booking.guest?.displayName || null,
            }
          : null,
        // The payment amount is the full guest total (base rent + taxes + fees + any cancellation-
        // protection add-on), so it is NORMALLY HIGHER than the booking's base amount. Give the model
        // this context explicitly so a legitimate fee margin is not mistaken for a mismatch.
        amountNote: 'payment.amount is the full guest total (base rent + taxes + fees + add-ons); booking.amount is the base rent, so the payment is normally higher than the booking amount. Treat a payment above the booking base by a plausible fee margin as expected, NOT a discrepancy. Only a payment that is LOWER than the booking base, or far above it, is a real concern.',
        paymentMinusBookingBaseMinor: payment.booking ? payment.amountMinor - payment.booking.amountMinor : null,
      }
    } else {
      const booking = await db().booking.findUnique({
        where: { id: entityId },
        select: {
          id: true, status: true, amountMinor: true, currency: true, checkIn: true, checkOut: true,
          guestCheckedInAt: true, guestCheckedOutAt: true, createdAt: true,
          listing: { select: { titleAr: true, titleEn: true, division: true, status: true, owner: { select: { displayName: true } } } },
          guest: { select: { displayName: true } },
          payments: { select: { provider: true, status: true, amountMinor: true, currency: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 10 },
        },
      })
      if (!booking) {
        const error = new Error('Booking not found.')
        error.statusCode = 404
        error.code = 'BOOKING_NOT_FOUND'
        error.expose = true
        throw error
      }
      facts = {
        booking: {
          status: booking.status,
          amount: `${(booking.amountMinor / 100).toFixed(2)} ${booking.currency}`,
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
          guestCheckedInAt: booking.guestCheckedInAt,
          guestCheckedOutAt: booking.guestCheckedOutAt,
          createdAt: booking.createdAt,
          listingTitle: booking.listing?.titleEn || booking.listing?.titleAr || null,
          listingDivision: booking.listing?.division || null,
          host: booking.listing?.owner?.displayName || null,
          guest: booking.guest?.displayName || null,
        },
        payments: booking.payments.map((p) => ({
          provider: p.provider,
          status: p.status,
          amount: `${(p.amountMinor / 100).toFixed(2)} ${p.currency}`,
          submittedAt: p.createdAt,
        })),
      }
    }

    const result = await runAdminAiAssist({ kind, facts })

    // Persist the actual advice (not just that advice was requested) so a later decision can be
    // reconciled against what the AI recommended. Advisory only — this records, it never decides.
    const assistAudit = result?.recommendation
      ? { recommendation: result.recommendation.recommendation, confidence: result.recommendation.confidence, summary: result.recommendation.summary }
      : { configured: result?.configured ?? false, ok: result?.ok ?? null }
    await db().adminAuditLog.create({
      data: { actorUserId: context.user.id, action: 'ADMIN_AI_ASSIST', entityType: kind === 'payment' ? 'payment_proofs' : 'bookings', entityId, before: null, after: assistAudit },
    })

    return json(res, 200, { ok: true, ...result })
  }

  // AI loyalty manager — the AI runs the loyalty program for one member: it reviews their activity and
  // AUTONOMOUSLY grants a bonus (clamped to the deterministic per-review and per-day caps in
  // loyalty.mjs) and/or flags abuse. The conversion rate and caps are fixed in code, so the AI cannot
  // mint unlimited value. Every run is audited; an admin can later adjust via the ledger.
  if (url.pathname === '/api/admin/loyalty/ai-review') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const userId = String(body.userId || '').trim()
    if (!userId) {
      const error = new Error('userId is required.')
      error.statusCode = 400
      error.code = 'LOYALTY_AI_BAD_REQUEST'
      error.expose = true
      throw error
    }
    const member = await db().user.findUnique({
      where: { id: userId },
      select: { id: true, displayName: true, createdAt: true, hostVerifiedAt: true },
    })
    if (!member) {
      const error = new Error('Member not found.')
      error.statusCode = 404
      error.code = 'USER_NOT_FOUND'
      error.expose = true
      throw error
    }
    // Facts the AI reasons over — booking history + current loyalty standing. No invented data.
    const [bookingsAsGuest, grouped, completedAsHost, summaryBefore] = await Promise.all([
      db().booking.count({ where: { guestId: userId } }),
      db().booking.groupBy({ by: ['status'], where: { guestId: userId }, _count: { _all: true } }),
      db().booking.count({ where: { status: 'COMPLETED', listing: { ownerId: userId } } }),
      loyaltySummary(userId),
    ])
    const countFor = (s) => grouped.find((g) => g.status === s)?._count._all || 0
    const facts = {
      member: {
        displayName: member.displayName,
        memberSince: member.createdAt,
        isVerifiedHost: Boolean(member.hostVerifiedAt),
        tenureDays: Math.floor((Date.now() - new Date(member.createdAt).getTime()) / 86400000),
      },
      bookings: {
        totalAsGuest: bookingsAsGuest,
        completedAsGuest: countFor('COMPLETED'),
        cancelledAsGuest: countFor('CANCELLED'),
        disputedAsGuest: countFor('DISPUTED'),
        completedAsHost,
      },
      loyalty: { tier: summaryBefore.tier, pointsBalance: summaryBefore.pointsBalance, lifetimePoints: summaryBefore.lifetimePoints },
    }
    const caps = { perReview: AI_BONUS_CAP_PER_REVIEW, perDay: AI_BONUS_CAP_PER_DAY }
    const ai = await runLoyaltyManager({ facts, caps })
    if (!ai.configured) return json(res, 200, { ok: true, configured: false, model: ai.model })
    if (!ai.ok) return json(res, 200, { ok: true, configured: true, aiFailed: true, error: ai.error, model: ai.model })

    const applied = await db().$transaction((tx) => applyAiLoyaltyDecision(tx, { userId, decision: ai.decision }))
    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'ADMIN_AI_LOYALTY',
        entityType: 'loyalty_accounts',
        entityId: userId,
        before: null,
        after: { action: ai.decision.action, bonusAwarded: applied.awarded, flags: ai.decision.flags, summary: ai.decision.summary, confidence: ai.decision.confidence },
      },
    })
    const loyalty = await loyaltySummary(userId)
    return json(res, 200, { ok: true, configured: true, decision: ai.decision, applied, loyalty, model: ai.model })
  }

  const hideReviewMatch = url.pathname.match(/^\/api\/admin\/reviews\/([^/]+)\/hide$/)
  if (hideReviewMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])

    const existing = await db().listingReview.findUnique({ where: { id: hideReviewMatch[1] } })
    if (!existing) {
      const error = new Error('Review not found.')
      error.statusCode = 404
      error.code = 'REVIEW_NOT_FOUND'
      error.expose = true
      throw error
    }

    // SEC-002R round 2. Classified Class A on the fresh sweep. Hiding a review is a moderation
    // decision with a durable, publicly-visible effect (the review disappears from the listing page
    // and from the host's rating surface) and it stamps hiddenByAdminId -- attributing the act to an
    // account. There is no un-hide endpoint anywhere in this codebase, so from the API's own surface
    // this is one-way. Same transaction, same lock order, same helper as every other Class A site;
    // the audit row moves inside the transaction too, so a refused request leaves neither.
    const review = await db().$transaction(async (tx) => {
      await reauthorizeAtCommit(tx, context, {
        action: 'ADMIN_REVIEW_HIDDEN',
        requiredRoles: ['ADMIN', 'SUPPORT'],
      })
      const hidden = await tx.listingReview.update({
        where: { id: existing.id },
        data: { hiddenAt: new Date(), hiddenByAdminId: context.user.id },
      })
      await tx.adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: 'ADMIN_REVIEW_HIDDEN',
          entityType: 'listing_reviews',
          entityId: hidden.id,
          before: existing,
          after: hidden,
        },
      })
      return hidden
    })

    return json(res, 200, { ok: true, review })
  }

  if (url.pathname === '/api/admin/payouts') {
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    await completeExpiredBookings()

    if (req.method === 'GET') {
      const completedBookings = await db().booking.findMany({
        where: { status: 'COMPLETED' },
        include: {
          listing: { include: { owner: { select: { id: true, displayName: true } } } },
          payments: true,
        },
        orderBy: { checkOut: 'asc' },
        take: 100,
      })

      const releasedBookingIds = new Set(
        (
          await db().walletEntry.findMany({
            where: {
              referenceType: 'booking_payout',
              type: 'RELEASE',
              referenceId: { in: completedBookings.map((b) => b.id) },
            },
            select: { referenceId: true },
          })
        ).map((entry) => entry.referenceId),
      )

      const payouts = completedBookings
        .filter((booking) => !releasedBookingIds.has(booking.id))
        .map((booking) => {
          const approvedPayment = booking.payments.find((payment) => payment.status === 'APPROVED')
          const split = bookingFinanceSplit(booking, approvedPayment?.amountMinor || booking.amountMinor)
          return {
            bookingId: booking.id,
            listingTitle: booking.listing?.titleAr,
            hostId: booking.listing?.ownerId,
            hostName: booking.listing?.owner?.displayName,
            checkOut: booking.checkOut,
            eligibleAt: payoutEligibleAt(booking.checkOut),
            eligibleNow: isPayoutEligible(booking),
            hostPayoutMinor: split.hostGrossMinor,
            adminCommissionMinor: split.adminCommissionMinor,
            currency: booking.currency,
          }
        })

      return json(res, 200, { ok: true, payouts, holdDays: PAYOUT_HOLD_DAYS })
    }

    return methodNotAllowed(res, ['GET'])
  }

  // Decision 2 (2026-10-08): host withdrawal requests. Listing is read-only (ADMIN/SUPPORT); the
  // decision is ADMIN-only. 'paid' = the admin already paid the host OUTSIDE the platform; this posts
  // exactly one DEBIT of the request amount on the host's wallet (markPayoutRequestPaid). 'reject'
  // moves no money.
  if (url.pathname === '/api/admin/payout-requests') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const status = String(url.searchParams.get('status') || '').toUpperCase()
    if (status && !['REQUESTED', 'PAID', 'REJECTED'].includes(status)) {
      const error = new Error('status must be REQUESTED, PAID or REJECTED.')
      error.statusCode = 400
      error.code = 'INVALID_STATUS_FILTER'
      error.expose = true
      throw error
    }
    const rows = await db().payoutRequest.findMany({
      where: status ? { status } : {},
      include: { host: { select: { id: true, displayName: true, email: true } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    })
    return json(res, 200, {
      ok: true,
      requests: rows.map((row) => ({
        id: row.id,
        amountMinor: row.amountMinor,
        currency: row.currency,
        status: row.status,
        method: row.method,
        ...(row.reference ? { reference: row.reference } : {}),
        ...(row.note ? { note: row.note } : {}),
        createdAt: row.createdAt,
        ...(row.decidedAt ? { decidedAt: row.decidedAt } : {}),
        host: row.host,
      })),
    })
  }

  const payoutRequestMatch = url.pathname.match(/^\/api\/admin\/payout-requests\/([^/]+)$/)
  if (payoutRequestMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const action = String(body.action || '').toLowerCase()
    const reference = typeof body.reference === 'string' ? body.reference.trim() : ''
    const note = typeof body.note === 'string' ? body.note.trim() : ''
    if (!['paid', 'reject'].includes(action)) {
      const error = new Error("action must be 'paid' or 'reject'.")
      error.statusCode = 400
      error.code = 'INVALID_PAYOUT_ACTION'
      error.expose = true
      throw error
    }
    if (action === 'paid' && (!reference || reference.length > 200)) {
      const error = new Error('reference (the external payment reference, at most 200 characters) is required to mark a payout paid.')
      error.statusCode = 400
      error.code = 'PAYOUT_REFERENCE_REQUIRED'
      error.expose = true
      throw error
    }
    if (action === 'reject' && (!note || note.length > 2000)) {
      const error = new Error('note (the rejection reason, at most 2000 characters) is required to reject a payout.')
      error.statusCode = 400
      error.code = 'PAYOUT_NOTE_REQUIRED'
      error.expose = true
      throw error
    }
    const requestId = payoutRequestMatch[1]
    const existing = await db().payoutRequest.findUnique({ where: { id: requestId } })
    if (!existing) {
      const error = new Error('Payout request not found.')
      error.statusCode = 404
      error.code = 'PAYOUT_REQUEST_NOT_FOUND'
      error.expose = true
      throw error
    }
    // An admin who is also this host must not pay themselves out.
    assertNotInterestedParty([existing.hostId], context.user.id)

    // Paying a host is the same operation class as releasing a booking payout to them
    // (payout_release, ADMIN-only, manual/internal-ledger provider): one DEBIT on the host's wallet
    // recording money the platform sent outside itself. Gated on the 'paid' action only.
    // OPERATOR NOTE: a withdrawal is not tied to one booking, so it is authorized under the
    // division-neutral 'PLATFORM' division -- PAYMENT_POLICY_ELIGIBLE_DIVISIONS must include PLATFORM
    // (e.g. STAYS,PLATFORM) or every mark-paid is refused with PAYMENT_POLICY_DENIED
    // (COUNTRY_DIVISION_NOT_ELIGIBLE). Also needs PAYMENT_RAIL_MANUAL_PROOF_ENABLED=true and
    // PAYMENT_OPERATION_MANUAL_PROOF_PAYOUT_RELEASE_ENABLED=true.
    if (action === 'paid') {
      authorizePaymentOperation({
        operation: 'payout_release',
        rail: 'manual_proof',
        provider: 'manual',
        division: 'PLATFORM',
        country: activePolicyCountryKey(),
        environment: policyEnvironment(),
        actor: { roles: context.roles },
      })
    }

    const request = await db().$transaction(async (tx) => {
      const fresh = await tx.payoutRequest.findUnique({ where: { id: requestId }, select: { hostId: true } })
      await reauthorizeAtCommit(tx, context, {
        action: action === 'paid' ? 'ADMIN_PAYOUT_REQUEST_PAID' : 'ADMIN_PAYOUT_REQUEST_REJECTED',
        requiredRoles: ['ADMIN'],
        interestedPartyIds: [fresh?.hostId],
      })
      const decided = action === 'paid'
        ? await markPayoutRequestPaid(tx, { requestId, actorUserId: context.user.id, reference, note })
        : await rejectPayoutRequest(tx, { requestId, actorUserId: context.user.id, note })
      await tx.adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: action === 'paid' ? 'ADMIN_PAYOUT_REQUEST_PAID' : 'ADMIN_PAYOUT_REQUEST_REJECTED',
          entityType: 'payout_requests',
          entityId: requestId,
          before: { ...existing, method: maskMethod(existing.method) },
          after: { ...decided, method: maskMethod(decided.method) },
        },
      })
      return decided
    })

    notifyUser(action === 'paid' ? 'host_payout_paid' : 'host_payout_rejected', request.hostId, {
      amount: formatMoney(request.amountMinor, request.currency),
      reference: request.reference || '',
      note: request.note || '',
    }, `payout:${request.id}:${request.status}`)

    return json(res, 200, {
      ok: true,
      request: {
        id: request.id,
        amountMinor: request.amountMinor,
        currency: request.currency,
        status: request.status,
        method: request.method,
        ...(request.reference ? { reference: request.reference } : {}),
        ...(request.note ? { note: request.note } : {}),
        createdAt: request.createdAt,
        ...(request.decidedAt ? { decidedAt: request.decidedAt } : {}),
        walletEntryId: request.walletEntryId || undefined,
      },
    })
  }

  // Refund queue for the admin UI (execute + finalize live on the routes below).
  if (url.pathname === '/api/admin/refunds') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const status = String(url.searchParams.get('status') || '').toUpperCase()
    if (status && !['REQUESTED', 'IN_PROGRESS', 'ACTION_REQUIRED', 'SUCCEEDED', 'ACCOUNTING_ACCEPTED', 'CANCELLED'].includes(status)) {
      const error = new Error('Unknown refund status filter.')
      error.statusCode = 400
      error.code = 'INVALID_STATUS_FILTER'
      error.expose = true
      throw error
    }
    const rows = await db().refund.findMany({
      where: status ? { status } : {},
      include: { paymentProof: { select: { provider: true, payer: { select: { id: true, displayName: true, email: true } } } } },
      orderBy: { requestedAt: 'desc' },
      take: 200,
    })
    return json(res, 200, {
      ok: true,
      refunds: rows.map((row) => ({
        id: row.id,
        bookingId: row.bookingId,
        amountMinor: row.amountMinor,
        currency: row.currency,
        status: row.status,
        reasonCode: row.reasonCode,
        rail: row.rail,
        migratedFromLegacy: row.migratedFromLegacy,
        createdAt: row.requestedAt,
        guest: row.paymentProof?.payer || null,
      })),
    })
  }

  const payoutReleaseMatch = url.pathname.match(/^\/api\/admin\/payouts\/([^/]+)\/release$/)
  if (payoutReleaseMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])

    const booking = await db().booking.findUnique({
      where: { id: payoutReleaseMatch[1] },
      include: { listing: true, payments: true },
    })

    if (!booking) {
      const error = new Error('Booking not found.')
      error.statusCode = 404
      error.code = 'BOOKING_NOT_FOUND'
      error.expose = true
      throw error
    }
    // An admin who also holds the HOST role for this listing must not release their own payout.
    assertNotInterestedParty([booking.listing.ownerId], context.user.id)

    // Paying the host out is its own operation (payout_release), distinct from capturing or
    // refunding the guest's payment — no third-party disbursement processor is called anywhere in
    // this codebase, so it's classified under the same 'manual'/internal-ledger provider as the
    // other admin-driven wallet operations.
    authorizePaymentOperation({
      operation: 'payout_release',
      rail: 'manual_proof',
      provider: 'manual',
      division: booking.listing.division,
      country: activePolicyCountryKey(),
      environment: policyEnvironment(),
      actor: { roles: context.roles },
    })

    if (!isPayoutEligible(booking)) {
      const error = new Error(
        `Payout is not eligible for release yet. It must be COMPLETED and past the ${PAYOUT_HOLD_DAYS}-day hold, with no open dispute.`,
      )
      error.statusCode = 400
      error.code = 'PAYOUT_NOT_ELIGIBLE'
      error.expose = true
      throw error
    }

    const approvedPayment = booking.payments.find((payment) => payment.status === 'APPROVED')
    const split = bookingFinanceSplit(booking, approvedPayment?.amountMinor || booking.amountMinor)

    const entry = await db().$transaction(async (tx) => {
      // Re-check eligibility inside the transaction against a fresh read: the outer check above ran
      // before this transaction opened, so a dispute filed in that window (or any other status
      // change) would otherwise still get released. This closes that race with no added cost — the
      // idempotencyKey on recordWalletEntry already prevents an actual double-release.
      const freshBooking = await tx.booking.findUnique({
        where: { id: booking.id },
        // SEC-002R: the listing is included so the self-dealing re-check below runs against the
        // ownerId as it stands INSIDE this transaction, not the copy read before the body was
        // parsed -- a genuine commit-boundary comparison rather than a replay of the admission one.
        include: { listing: { select: { ownerId: true } } },
      })
      if (!freshBooking || !isPayoutEligible(freshBooking)) {
        const error = new Error(
          `Payout is not eligible for release yet. It must be COMPLETED and past the ${PAYOUT_HOLD_DAYS}-day hold, with no open dispute.`,
        )
        error.statusCode = 400
        error.code = 'PAYOUT_NOT_ELIGIBLE'
        error.expose = true
        throw error
      }

      // SEC-002R Class A. Last statement before real money moves: proves the acting admin's session
      // is still live, their account still ACTIVE, their epoch still current and their ADMIN role
      // still held, holding the locks that make a concurrent revocation impossible until this
      // transaction commits. A failure throws, and Postgres rolls back the RELEASE below with it.
      await reauthorizeAtCommit(tx, context, {
        action: 'ADMIN_PAYOUT_RELEASED',
        requiredRoles: ['ADMIN'],
        interestedPartyIds: [freshBooking.listing?.ownerId],
      })

      const released = await recordWalletEntry(tx, {
        userId: booking.listing.ownerId,
        type: 'RELEASE',
        amountMinor: split.hostGrossMinor,
        currency: booking.currency,
        referenceType: 'booking_payout',
        referenceId: booking.id,
        keyParts: ['booking-host-release', booking.id, approvedPayment?.id],
        note: `Host payout released by admin after the ${PAYOUT_HOLD_DAYS}-day hold following stay completion.`,
      })

      await tx.adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: 'ADMIN_PAYOUT_RELEASED',
          entityType: 'bookings',
          entityId: booking.id,
          before: booking,
          after: { walletEntry: released },
        },
      })

      return released
    })

    return json(res, 200, { ok: true, walletEntry: entry })
  }

  // Item 2 Phase 2b round 3: finalizes the commission-reversal + cancellation-fee wallet entries a
  // guest/host cancellation used to post inline, atomically, as part of their own action.
  // createRefundRequest() (still triggered directly by the booking's own guest/host at cancel time)
  // moves zero money; THIS is where the real wallet money movement actually happens now, and it
  // stays ADMIN-only end to end -- see finalizeCancellationLedgerEffects() in finance-ledger.mjs
  // and the policy-split comment at the top of bookings.mjs's/host.mjs's cancel handlers.
  const finalizeCancellationMatch = url.pathname.match(/^\/api\/admin\/bookings\/([^/]+)\/finalize-cancellation$/)
  if (finalizeCancellationMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])

    const bookingId = finalizeCancellationMatch[1]
    const existing = await db().booking.findUnique({
      where: { id: bookingId },
      include: { listing: true, payments: true },
    })
    if (!existing) {
      const error = new Error('Booking not found.')
      error.statusCode = 404
      error.code = 'BOOKING_NOT_FOUND'
      error.expose = true
      throw error
    }
    if (existing.status !== 'CANCELLED') {
      const error = new Error('Only a cancelled booking can have its cancellation finalized.')
      error.statusCode = 400
      error.code = 'BOOKING_NOT_CANCELLED'
      error.expose = true
      throw error
    }
    // The cancel handlers mark the payment proof REFUNDED (not delete it), so this is the durable
    // signal a real approved-then-reversed payment actually exists here to finalize against --
    // structurally impossible for a booking that was cancelled with no approved payment at all
    // (nothing to reverse, no fee to charge), matching the same guard the cancel handlers apply to
    // createRefundRequest() itself.
    // Review fix (LOW): cancellations recorded since 2026-10-08 name the exact proof they reversed
    // (metadata.cancellation.approvedProofId) -- settle against that one, never an arbitrary
    // REFUNDED proof. Legacy rows without it keep the original lookup.
    const recordedProofId = existing.metadata?.cancellation?.approvedProofId
    const approvedPayment = recordedProofId
      ? existing.payments.find((payment) => payment.id === recordedProofId && payment.status === 'REFUNDED')
      : existing.payments.find((payment) => payment.status === 'REFUNDED')
    if (!approvedPayment) {
      const error = new Error('This booking has no reversed payment to finalize (it was cancelled with no approved payment).')
      error.statusCode = 409
      error.code = 'NOTHING_TO_FINALIZE'
      error.expose = true
      throw error
    }
    // Finalizing moves real fee/commission money involving both the guest and the host of this
    // booking -- an admin who is either must not be the one finalizing it.
    assertNotInterestedParty([existing.guestId, existing.listing.ownerId], context.user.id)

    // Who initiated the cancellation determines who owes the cancellation fee -- derived from the
    // durable audit trail the cancel handlers already write, never from caller input.
    const cancellationAuditEntry = await db().adminAuditLog.findFirst({
      where: { entityType: 'bookings', entityId: bookingId, action: { in: ['BOOKING_GUEST_CANCELLED', 'HOST_CANCELLED'] } },
      orderBy: { createdAt: 'desc' },
    })
    if (!cancellationAuditEntry) {
      const error = new Error('No recorded cancellation source (guest or host) was found for this booking.')
      error.statusCode = 409
      error.code = 'CANCELLATION_SOURCE_UNKNOWN'
      error.expose = true
      throw error
    }
    const cancelledBy = cancellationAuditEntry.action === 'BOOKING_GUEST_CANCELLED' ? 'GUEST' : 'HOST'

    authorizePaymentOperation({
      operation: 'refund',
      rail: 'manual_proof',
      provider: 'manual',
      division: existing.listing.division,
      country: activePolicyCountryKey(),
      environment: policyEnvironment(),
      actor: { roles: context.roles },
    })

    // A genuinely concurrent second finalize call for the same booking can lose a race inside
    // recordWalletEntry's idempotency-by-key check (see WALLET_ENTRY_RACE_LOST in
    // finance-ledger.mjs) -- by the time that happens, the winning transaction has already
    // committed every entry this call would have posted. One retry re-enters
    // finalizeCancellationLedgerEffects with everything now genuinely idempotent (every
    // recordWalletEntry call finds its existing entry via the normal findUnique path, not a race),
    // so the loser still gets a correct, non-error 200 rather than a raw 500 -- exactly like any
    // other idempotent re-call of this endpoint.
    //
    // An independent revenue audit found a real ordering hazard: for a GUEST cancellation without
    // purchased protection, this reverses commission AND debits the guest's own SYBNB wallet for
    // the cancellation fee -- but a manual-proof guest's wallet is never funded until their refund
    // is actually executed (PATCH /api/admin/refunds/:id/execute credits it). Calling this before
    // that happens fails safe today (recordWalletEntry's balance guard refuses to overdraw, the
    // transaction rolls back cleanly, nothing corrupts) but with a generic, confusing
    // WALLET_INSUFFICIENT_FUNDS -- neither route is wired to any frontend yet, so this has never
    // actually been hit by a real workflow, but it's a real footgun for whoever eventually builds
    // one. Translated into a clear, actionable error naming the exact required order instead of
    // silently re-architecting the money movement (Uber's own model nets the fee into one refund
    // settlement instead of two separately-ordered operations -- a deeper fix worth doing when this
    // is actually wired up and exercised for real, not guessed at now).
    //
    // SEC-002R Class A: this transaction posts the commission reversal and the cancellation-fee
    // wallet entries -- real, irreversible money movement. The re-authorization runs as the first
    // statement inside it, before finalizeCancellationLedgerEffects() writes anything, and the two
    // interested-party ids are re-read here rather than reused from the admission-time `existing`.
    const finalizeInTransaction = async (tx) => {
      const fresh = await tx.booking.findUnique({
        where: { id: bookingId },
        select: { guestId: true, listing: { select: { ownerId: true } } },
      })
      await reauthorizeAtCommit(tx, context, {
        action: 'BOOKING_CANCELLATION_FINALIZED',
        requiredRoles: ['ADMIN'],
        interestedPartyIds: [fresh?.guestId, fresh?.listing?.ownerId],
      })
      return finalizeCancellationLedgerEffects(tx, { booking: existing, approvedPayment, cancelledBy })
    }

    let result
    try {
      result = await db().$transaction(finalizeInTransaction)
    } catch (err) {
      if (err.code === 'WALLET_INSUFFICIENT_FUNDS' && existing.metadata?.cancellation?.policyVersion) {
        // Rule-based cancellations (decision 3) never debit the guest, so the short wallet is the
        // commission recipient's, or the host's (clawback of an already-released payout / host fee).
        const error = new Error('A wallet this cancellation must debit (commission account or host) does not hold enough balance. Resolve the balance, then finalize again.')
        error.statusCode = 409
        error.code = 'FINALIZE_INSUFFICIENT_FUNDS'
        error.expose = true
        throw error
      }
      if (err.code === 'WALLET_INSUFFICIENT_FUNDS') {
        const error = new Error(
          "This guest's cancellation fee can't be charged yet because their refund hasn't been executed " +
            '(their SYBNB wallet has no funds until PATCH /api/admin/refunds/:id/execute runs). Execute the ' +
            'refund first, then finalize this cancellation.',
        )
        error.statusCode = 409
        error.code = 'REFUND_MUST_EXECUTE_FIRST'
        error.expose = true
        throw error
      }
      if (err.code !== 'WALLET_ENTRY_RACE_LOST') throw err
      // The retry re-enters the SAME wrapper, so the second attempt re-authorizes from scratch in
      // its own transaction -- authority revoked between the two attempts is caught by the retry.
      result = await db().$transaction(finalizeInTransaction)
    }

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'BOOKING_CANCELLATION_FINALIZED',
        entityType: 'bookings',
        entityId: bookingId,
        before: existing,
        after: { cancelledBy, ...result },
      },
    })

    return json(res, 200, { ok: true, cancelledBy, ...result })
  }

  // Item 2 Phase 2b round 3 (guest-refund gap closure): executes a real, non-legacy refund request
  // by crediting the original payer's wallet -- see executeManualRailRefund() in finance-ledger.mjs
  // for the full reasoning (internal wallet credit, not an external provider call; no real provider
  // is connected or approved anywhere in this codebase). Stays under the existing 'refund'
  // operation, ADMIN-only, unchanged -- this is exactly the real wallet-money-movement half of the
  // round-3 actor-policy split, same as finalize-cancellation above.
  const executeRefundMatch = url.pathname.match(/^\/api\/admin\/refunds\/([^/]+)\/execute$/)
  if (executeRefundMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])

    const refundId = executeRefundMatch[1]
    const refund = await db().refund.findUnique({
      where: { id: refundId },
      include: { paymentProof: { include: { booking: { include: { listing: true } } } } },
    })
    if (!refund) {
      const error = new Error('Refund not found.')
      error.statusCode = 404
      error.code = 'REFUND_NOT_FOUND'
      error.expose = true
      throw error
    }
    const division = refund.paymentProof?.booking?.listing?.division || 'PLATFORM'
    // executeManualRailRefund credits refund.paymentProof.userId's wallet -- the original payer,
    // not necessarily refund.requestedByUserId (which can be an admin who filed the refund on the
    // payer's behalf, e.g. after rejecting a booking). The wallet that gets credited is the real
    // interested party here.
    assertNotInterestedParty([refund.paymentProof.userId], context.user.id)

    authorizePaymentOperation({
      operation: 'refund',
      rail: 'manual_proof',
      provider: 'manual',
      division,
      country: activePolicyCountryKey(),
      environment: policyEnvironment(),
      actor: { roles: context.roles },
    })

    // SEC-002R Class A: executeManualRailRefund() credits the original payer's wallet. Re-authorize
    // inside the same transaction, before that credit, against a fresh read of who the payer is.
    const result = await db().$transaction(async (tx) => {
      const freshPayerId = (
        await tx.refund.findUnique({
          where: { id: refundId },
          select: { paymentProof: { select: { userId: true } } },
        })
      )?.paymentProof?.userId
      await reauthorizeAtCommit(tx, context, {
        action: 'ADMIN_REFUND_EXECUTED',
        requiredRoles: ['ADMIN'],
        interestedPartyIds: [freshPayerId],
      })
      return executeManualRailRefund(tx, { refundId, actorUserId: context.user.id })
    })

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'ADMIN_REFUND_EXECUTED',
        entityType: 'refunds',
        entityId: refundId,
        before: refund,
        after: result,
      },
    })

    return json(res, 200, { ok: true, ...result })
  }

  const legacyRefundAcceptMatch = url.pathname.match(/^\/api\/admin\/refunds\/([^/]+)\/legacy-accept$/)
  if (legacyRefundAcceptMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])

    const refundId = legacyRefundAcceptMatch[1]
    const body = await readJson(req)
    const reason = typeof body.reason === 'string' ? body.reason.trim().replace(/\s+/g, ' ') : ''
    if (!reason || reason.length > 2000) {
      const error = new Error('reason must be a non-empty string of at most 2000 characters.')
      error.statusCode = 400
      error.code = 'INVALID_ACCEPTANCE_REASON'
      error.expose = true
      throw error
    }

    const refund = await db().refund.findUnique({
      where: { id: refundId },
      include: { paymentProof: { include: { booking: { include: { listing: true } } } } },
    })
    if (!refund) {
      const error = new Error('Refund not found.')
      error.statusCode = 404
      error.code = 'REFUND_NOT_FOUND'
      error.expose = true
      throw error
    }

    // Item 2 Phase 2b round 1, mandatory boundary: this operation exists ONLY for migrated legacy
    // refunds -- it must never become a route to fast-track a real, non-legacy ACTION_REQUIRED
    // refund. Step 2's LEGACY_PENDING_CONFIRMATION requirement below already makes that
    // structurally impossible (that status is CHECK-constrained to migratedFromLegacy=true rows
    // only), but this explicit, early check gives a clear, honest error instead of a confusing
    // "no eligible attempt found" for an obviously-wrong request.
    if (!refund.migratedFromLegacy) {
      const error = new Error('legacy_refund_accept only applies to refunds migrated from legacy data.')
      error.statusCode = 400
      error.code = 'REFUND_NOT_LEGACY'
      error.expose = true
      throw error
    }
    // Same interested party as execute-refund above -- the original payer this refund resolves in
    // favor of, whether or not this specific path moves a wallet balance directly.
    assertNotInterestedParty([refund.paymentProof.userId], context.user.id)

    const division = refund.paymentProof?.booking?.listing?.division || 'PLATFORM'

    authorizePaymentOperation({
      operation: 'legacy_refund_accept',
      rail: 'manual_proof',
      provider: 'manual',
      division,
      country: activePolicyCountryKey(),
      environment: policyEnvironment(),
      actor: { roles: context.roles },
    })

    const acceptedAt = new Date()

    const result = await db().$transaction(async (tx) => {
      // SEC-002R Class A, Step 0: re-authorize before the refund is claimed, so a revoked admin
      // cannot even take the claim (which would strand the refund in IN_PROGRESS if it were taken
      // and then rolled back later) let alone commit the ACCOUNTING_ACCEPTED finalization below.
      const freshPayerId = (
        await tx.refund.findUnique({
          where: { id: refundId },
          select: { paymentProof: { select: { userId: true } } },
        })
      )?.paymentProof?.userId
      await reauthorizeAtCommit(tx, context, {
        action: 'ADMIN_LEGACY_REFUND_ACCEPTED',
        requiredRoles: ['ADMIN'],
        interestedPartyIds: [freshPayerId],
      })

      // Step 1: claim -- the PRIMARY refund-level serializer. Guarded on the exact precondition a
      // legacy ACTION_REQUIRED refund is created with (see scripts/migrate-legacy-refunds-2a.mjs);
      // 0 rows means already claimed, already resolved, or genuinely not eligible.
      const claimed = await tx.refund.updateMany({
        where: { id: refundId, status: 'ACTION_REQUIRED', reservationHeld: true },
        data: { status: 'IN_PROGRESS' },
      })
      if (claimed.count !== 1) {
        const error = new Error('Refund is not currently claimable (already in progress, already resolved, or not reservation-held).')
        error.statusCode = 409
        error.code = 'REFUND_NOT_CLAIMABLE'
        error.expose = true
        throw error
      }
      const claimedRefund = await tx.refund.findUniqueOrThrow({ where: { id: refundId } })

      // Step 2: derive the original attempt from claimedRefund.id, never from a caller-supplied id
      // (closes the substitution risk an earlier design revision was rejected for). Matches ONLY
      // LEGACY_PENDING_CONFIRMATION -- deliberately excludes LEGACY_UNVERIFIED, which is the
      // explicit owner decision (Finding 8) that zero-evidence legacy rows get no automated
      // acceptance path at all in this phase.
      const candidates = await tx.refundAttempt.findMany({
        where: { refundId: claimedRefund.id, status: 'LEGACY_PENDING_CONFIRMATION', supersededByAttemptId: null },
      })
      if (candidates.length !== 1) {
        const error = new Error(
          `Expected exactly one LEGACY_PENDING_CONFIRMATION attempt to accept for this refund; found ${candidates.length}. ` +
          'LEGACY_UNVERIFIED refunds have no automated acceptance path and are not eligible here.',
        )
        error.statusCode = 409
        error.code = 'NO_ACCEPTABLE_LEGACY_ATTEMPT'
        error.expose = true
        throw error
      }
      const original = candidates[0]

      // Step 3: insert the new LEGACY_ACCOUNTING_ACCEPTED attempt. The evidence digest binds the
      // refund, the original attempt/evidence being accepted, the amount/currency, the actor, the
      // acceptance timestamp, and the normalized reason -- reusing the same sha256-of-joined-parts
      // primitive every idempotency key in this codebase already uses, not a new mechanism.
      const evidenceDigest = idempotencyKey([
        'legacy_refund_accept',
        claimedRefund.id,
        original.id,
        original.legacyPaymentEventId,
        String(claimedRefund.amountMinor),
        claimedRefund.currency,
        context.user.id,
        acceptedAt.toISOString(),
        reason,
      ])
      const newAttempt = await tx.refundAttempt.create({
        data: {
          refundId: claimedRefund.id,
          status: 'LEGACY_ACCOUNTING_ACCEPTED',
          migratedFromLegacy: true,
          completedAt: acceptedAt,
          legacyPaymentEventId: original.legacyPaymentEventId,
          legacyAcceptedByUserId: context.user.id,
          legacyAcceptedAt: acceptedAt,
          legacyAcceptanceReason: reason,
          legacyAcceptanceEvidenceDigest: evidenceDigest,
        },
      })

      // Step 4: mark the original attempt superseded -- an independent, attempt-scoped
      // defense-in-depth guard (the primary invariant is the refund_attempt_supersession_once
      // trigger, which holds regardless of caller).
      const superseded = await tx.refundAttempt.updateMany({
        where: { id: original.id, supersededByAttemptId: null },
        data: { supersededByAttemptId: newAttempt.id },
      })
      if (superseded.count !== 1) {
        const error = new Error('Could not mark the original attempt as superseded.')
        error.statusCode = 409
        error.code = 'SUPERSESSION_FAILED'
        error.expose = true
        throw error
      }

      // Step 5: transfer reserved -> accepted on the payment proof. The guard requires the EXACT
      // expected reserved amount for this migrated refund, not merely "at least this much" --
      // round-2 corrective fix, independent review finding: refunds_one_active_per_payment_proof
      // (Phase 2a) guarantees at most one active refund per proof, so once Step 1 has claimed THIS
      // refund, reservedRefundMinor must equal exactly claimedRefund.amountMinor. A `gte` guard
      // would let this transaction silently succeed even if the proof happened to carry MORE
      // reserved capacity than this specific refund accounts for -- masking a genuine data
      // inconsistency (e.g. a phantom leftover reservation from elsewhere) as a normal transfer
      // instead of surfacing it as the anomaly it actually is. Must affect EXACTLY one row; anything
      // else rolls back Steps 1-4 too. Uses ONLY claimedRefund's own fields, never a caller-supplied
      // proof id or amount.
      const transferred = await tx.paymentProof.updateMany({
        where: { id: claimedRefund.paymentProofId, reservedRefundMinor: claimedRefund.amountMinor },
        data: {
          reservedRefundMinor: { decrement: claimedRefund.amountMinor },
          acceptedRefundMinor: { increment: claimedRefund.amountMinor },
        },
      })
      if (transferred.count !== 1) {
        const error = new Error('Anomaly: payment proof counter transfer did not affect exactly one row.')
        error.statusCode = 500
        error.code = 'COUNTER_TRANSFER_ANOMALY'
        throw error
      }

      // Step 6: finalize. Same exactly-one-row discipline as Step 5. succeededAt is deliberately
      // NEVER set here -- ACCOUNTING_ACCEPTED is a materially different epistemic claim (an
      // owner's acceptance of incomplete evidence) from genuine provider/ledger-confirmed SUCCEEDED,
      // and must never become indistinguishable from it anywhere downstream.
      const finalized = await tx.refund.updateMany({
        where: { id: claimedRefund.id, status: 'IN_PROGRESS', reservationHeld: true },
        data: { status: 'ACCOUNTING_ACCEPTED', reservationHeld: false },
      })
      if (finalized.count !== 1) {
        const error = new Error('Anomaly: refund finalize did not affect exactly one row.')
        error.statusCode = 500
        error.code = 'REFUND_FINALIZE_ANOMALY'
        throw error
      }

      const auditLog = await tx.adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: 'ADMIN_LEGACY_REFUND_ACCEPTED',
          entityType: 'refunds',
          entityId: claimedRefund.id,
          before: { refund: claimedRefund, originalAttemptId: original.id },
          after: { refundStatus: 'ACCOUNTING_ACCEPTED', newAttemptId: newAttempt.id, evidenceDigest },
        },
      })

      return { refundId: claimedRefund.id, newAttemptId: newAttempt.id, auditLogId: auditLog.id }
    })

    const refreshed = await db().refund.findUnique({ where: { id: result.refundId }, include: { attempts: true } })
    return json(res, 200, { ok: true, refund: refreshed })
  }

  // 2026-10-09: live-rides view. Operators previously had no way to see open/active rides (only
  // aggregate status counts in platform-metrics), so they couldn't watch the service or find a ride
  // to dispatch without direct DB access. Lists the operationally-interesting rides, newest first.
  if (url.pathname === '/api/admin/sr/rides') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const statusParam = url.searchParams.get('status')
    const ACTIVE_STATUSES = ['REQUESTED', 'MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS']
    const where = statusParam
      ? { status: statusParam }
      : { status: { in: ACTIVE_STATUSES } }
    const rides = await db().rideRequest.findMany({
      where,
      select: {
        id: true, status: true, fareMinor: true, currency: true, cancellationFeeMinor: true,
        riderId: true, driverId: true, accessibilityRequired: true, scheduledFor: true,
        requestedAt: true, updatedAt: true,
      },
      orderBy: { requestedAt: 'desc' },
      take: 200,
    })
    return json(res, 200, { ok: true, rides, count: rides.length })
  }

  // 2026-10-09: reverse an approved ride payment (correction/refund). Rides have no HOLD/dispute
  // window like bookings, so there was previously NO way to undo a wrongly-approved, duplicated, or
  // fraudulent ride fare. This DEBITs the actual recipients of the credits that approval created --
  // the driver's fare/cancellation-fee and the platform's commission -- via reverseRidePayment,
  // under a commit-boundary re-authorization. Idempotent: a second call is a no-op.
  const rideReverseMatch = url.pathname.match(/^\/api\/admin\/sr\/rides\/([^/]+)\/reverse-payment$/)
  if (rideReverseMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const reason = body.reason ? String(body.reason).slice(0, 500) : 'Ride payment reversed by admin.'

    const ride = await db().rideRequest.findUnique({ where: { id: rideReverseMatch[1] }, select: { id: true } })
    if (!ride) {
      const error = new Error('Ride not found.')
      error.statusCode = 404
      error.code = 'RIDE_NOT_FOUND'
      error.expose = true
      throw error
    }

    authorizePaymentOperation({
      operation: 'refund',
      rail: 'manual_proof',
      provider: 'manual',
      division: 'SR',
      country: activePolicyCountryKey(),
      environment: policyEnvironment(),
      actor: { roles: context.roles },
    })

    const result = await db().$transaction(async (tx) => {
      await reauthorizeAtCommit(tx, context, { action: 'ADMIN_RIDE_PAYMENT_REVERSED', requiredRoles: ['ADMIN'] })
      const reversal = await reverseRidePayment(tx, { rideId: ride.id, reason })
      await tx.adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: 'ADMIN_RIDE_PAYMENT_REVERSED',
          entityType: 'ride_requests',
          entityId: ride.id,
          before: null,
          after: reversal,
        },
      })
      return reversal
    })

    return json(res, 200, { ok: true, reversal: result })
  }

  if (url.pathname === '/api/admin/review-queue') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    await completeExpiredBookings()
    await expireStaleWalletGifts()
    // Scale-readiness audit: 4 of these 5 queues had a `take` cap with no `orderBy` at all --
    // Postgres gives no guarantee which rows come back once a queue's real backlog exceeds 25, so
    // admins could see an arbitrary, shuffling subset on every refresh, with some pending items
    // never surfacing at all while others repeat. Oldest-first (FIFO) is the correct ordering for
    // a moderation/review queue -- it's what keeps a real backlog from leaving any one item
    // waiting indefinitely. idDocuments orders by the real submission timestamp
    // (idDocumentSubmittedAt), not createdAt (account-creation date, unrelated to when the ID was
    // actually submitted for review).
    //
    // Follow-up: a moderation queue is different from public search -- items leave it permanently
    // once an admin acts, so a temporarily-oversized backlog self-heals as it's processed, rather
    // than permanently burying real inventory the way the uncapped public search did. Raised the
    // cap 25->100 (a real reduction in the invisible-backlog window, not a full pagination UI,
    // which isn't justified for a queue that drains under normal admin use) and added an honest
    // total count alongside each list so a genuine surge is visible rather than silently capped
    // with no signal -- the same reasoning already applied to the fake-trust-signal fixes elsewhere
    // in this codebase, just for "how big is the real backlog" instead of "is this badge real".
    const REVIEW_QUEUE_LIMIT = 100
    const listingsWhere = { status: 'PENDING_REVIEW' }
    const paymentsWhere = { status: 'PENDING_ADMIN_REVIEW' }
    const giftsWhere = { status: { in: ['CLAIM_PENDING', 'LOCKED'] } }
    const bookingsWhere = { status: { in: ['REQUESTED', 'DISPUTED'] } }
    const idDocumentsWhere = { idDocumentStatus: 'PENDING_REVIEW' }
    const [listings, payments, gifts, bookings, idDocuments, listingsTotal, paymentsTotal, giftsTotal, bookingsTotal, idDocumentsTotal] = await Promise.all([
      db().listing.findMany({
        where: listingsWhere,
        // Admin satisfaction audit finding: the review card showed only a title/division/status --
        // no price, host, or image, so an admin had to open "Details" for every single item just to
        // make an approve/reject call. Price is already a scalar on Listing; owner/media are
        // relations that need an explicit include to come back at all.
        include: {
          // idDocumentStatus (2026-10-09): the reviewer approves the host's ID from this same card
          // before the listing (approval is refused with OWNER_ID_NOT_APPROVED otherwise).
          owner: { select: { id: true, displayName: true, idDocumentStatus: true, idDocumentMimeType: true, idDocumentSubmittedAt: true } },
          media: { orderBy: { sortOrder: 'asc' }, take: 1 },
          // AI pre-check (2026-10-09), shown next to each pending listing. Advisory only.
          aiReview: true,
        },
        orderBy: { createdAt: 'asc' },
        take: REVIEW_QUEUE_LIMIT,
      }),
      db().paymentProof.findMany({
        where: paymentsWhere,
        include: {
          booking: {
            include: {
              listing: {
                include: {
                  // idDocumentStatus feeds the admin payout screen's host-verification label --
                  // it was previously hardcoded "Verified host" for every host regardless of real
                  // status (found by an independent re-audit).
                  owner: { select: { id: true, displayName: true, email: true, idDocumentStatus: true } },
                },
              },
            },
          },
          payer: { select: { id: true, displayName: true, email: true } },
          // 2026-10-09: ride fare proofs previously showed only payer + amount, with no indication
          // of WHICH ride/driver they settled -- so an admin reconciling a ride payment had no
          // context. Include the ride so the queue row is self-explanatory.
          ride: { select: { id: true, status: true, fareMinor: true, currency: true, driverId: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: REVIEW_QUEUE_LIMIT,
      }),
      db().walletGift.findMany({ where: giftsWhere, orderBy: { createdAt: 'asc' }, take: REVIEW_QUEUE_LIMIT }),
      db().booking.findMany({
        where: bookingsWhere,
        include: { listing: true },
        orderBy: { createdAt: 'desc' },
        take: REVIEW_QUEUE_LIMIT,
      }),
      db().user.findMany({
        where: idDocumentsWhere,
        select: { id: true, displayName: true, email: true, idDocumentMimeType: true, idDocumentSubmittedAt: true },
        orderBy: { idDocumentSubmittedAt: 'asc' },
        take: REVIEW_QUEUE_LIMIT,
      }),
      db().listing.count({ where: listingsWhere }),
      db().paymentProof.count({ where: paymentsWhere }),
      db().walletGift.count({ where: giftsWhere }),
      db().booking.count({ where: bookingsWhere }),
      db().user.count({ where: idDocumentsWhere }),
    ])

    // Resolve each advertising payment's bound campaign for display -- campaignListingId is a
    // plain string (not a Prisma relation, matching this codebase's other soft cross-references),
    // so it's enriched here rather than via `include`. Admin previously had no way to tell which
    // campaign a payment proof was for except guessing from amount/uploader.
    const campaignListingIds = payments.map((p) => p.campaignListingId).filter(Boolean)
    const campaignListings = campaignListingIds.length
      ? await db().listing.findMany({
          where: { id: { in: campaignListingIds } },
          select: { id: true, titleAr: true, titleEn: true, status: true, metadata: true },
        })
      : []
    const campaignListingById = new Map(campaignListings.map((l) => [l.id, l]))
    const paymentsWithCampaign = payments.map((p) => ({
      ...p,
      campaignListing: p.campaignListingId ? campaignListingById.get(p.campaignListingId) || null : null,
    }))

    const listingsWithAi = listings.map(({ aiReview, ...listing }) => ({ ...listing, aiReview: serializeAiReview(aiReview) }))

    return json(res, 200, {
      ok: true,
      queue: { listings: listingsWithAi, payments: paymentsWithCampaign, gifts, bookings, idDocuments },
      // Additive, not yet declared on the frontend's PlatformReviewQueue type -- safe for existing
      // callers (extra JSON fields are simply ignored) and ready for the frontend to surface once
      // that type is free to edit.
      queueTotals: { listings: listingsTotal, payments: paymentsTotal, gifts: giftsTotal, bookings: bookingsTotal, idDocuments: idDocumentsTotal },
    })
  }

  const idDocumentFileMatch = url.pathname.match(/^\/api\/admin\/id-document\/([^/]+)\/file$/)
  if (idDocumentFileMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])

    const targetUser = await db().user.findUnique({
      where: { id: idDocumentFileMatch[1] },
      select: { idDocumentRef: true, idDocumentMimeType: true },
    })
    if (!targetUser?.idDocumentRef) {
      const error = new Error('No ID document has been submitted by this user.')
      error.statusCode = 404
      error.code = 'ID_DOCUMENT_NOT_FOUND'
      error.expose = true
      throw error
    }

    const buffer = await readIdDocument(targetUser.idDocumentRef)

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'ADMIN_ID_DOCUMENT_VIEWED',
        entityType: 'user_id_document',
        entityId: idDocumentFileMatch[1],
        before: null,
        after: null,
      },
    })

    res.writeHead(200, {
      'content-type': targetUser.idDocumentMimeType || 'application/octet-stream',
      'cache-control': 'private, no-store',
    })
    res.end(buffer)
    return true
  }

  // Supports the WhatsApp/email ID-submission channel: a guest who doesn't want to upload
  // through the website sends their ID to SYBNB's WhatsApp/email directly, and an admin attaches
  // it to the right account here after finding it by the email the guest signed up with.
  if (url.pathname === '/api/admin/users/lookup') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])

    // Generic lookup: a single `q` can be an email, a phone, or a display name. `email` is kept as a
    // legacy alias. Many Syrian accounts are phone/OTP-only with NO email, so email-only search left
    // them unfindable — name and phone search reach them. Order: exact email, then exact phone (by
    // the same keyed hash used at registration), then a case-insensitive display-name match.
    const raw = String(url.searchParams.get('q') || url.searchParams.get('email') || '').trim()
    if (!raw) {
      const error = new Error('Enter an email, phone, or name to look up a customer.')
      error.statusCode = 400
      error.code = 'USER_LOOKUP_QUERY_REQUIRED'
      error.expose = true
      throw error
    }

    let foundUser = null
    if (raw.includes('@')) {
      foundUser = await db().user.findUnique({ where: { email: raw.toLowerCase() }, select: ID_DOCUMENT_SAFE_SELECT })
    }
    if (!foundUser && /[0-9]/.test(raw) && /^[+0-9()\s-]+$/.test(raw)) {
      foundUser = await db().user.findFirst({ where: { phoneHash: hashPhone(raw) }, select: ID_DOCUMENT_SAFE_SELECT })
    }
    if (!foundUser) {
      foundUser = await db().user.findFirst({
        where: { displayName: { contains: raw, mode: 'insensitive' } },
        orderBy: { createdAt: 'desc' },
        select: ID_DOCUMENT_SAFE_SELECT,
      })
    }
    if (!foundUser) {
      const error = new Error('No account found for that email, phone, or name.')
      error.statusCode = 404
      error.code = 'USER_NOT_FOUND'
      error.expose = true
      throw error
    }

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'ADMIN_USER_LOOKUP',
        entityType: 'user',
        entityId: foundUser.id,
        before: null,
        after: null,
      },
    })

    return json(res, 200, { ok: true, user: foundUser })
  }

  // SEC-002 — account status as a real security control.
  //
  // AccountStatus.SUSPENDED / DELETED have existed in the schema since the beginning with no
  // handler anywhere that could set them, so the platform's own published security rule ("Suspended
  // or deleted accounts cannot log in or use previously issued sessions") described a state the
  // product had no way to reach. These two endpoints are the enforcement hooks for that rule and
  // nothing more -- they are not an admin user-management feature, and deliberately expose only the
  // status and role transitions the revocation model has to be driven by.
  const userStatusMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/status$/)
  if (userStatusMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    // ADMIN only. SUPPORT can read the review queue but must not be able to disable accounts.
    requireAuth(context, ['ADMIN'])

    const targetUserId = userStatusMatch[1]
    const body = await readJson(req)
    const status = String(body.status || '').toUpperCase()
    if (!['ACTIVE', 'SUSPENDED', 'DELETED'].includes(status)) {
      const error = new Error('status must be ACTIVE, SUSPENDED, or DELETED.')
      error.statusCode = 400
      error.code = 'INVALID_ACCOUNT_STATUS'
      error.expose = true
      throw error
    }
    // Same self-dealing principle as the 9 review paths closed in 115aa09, plus a plain lockout
    // guard: an admin suspending or deleting themselves would revoke their own credentials mid-call
    // and could leave the platform with no reachable administrator.
    assertNotInterestedParty([targetUserId], context.user.id)

    const reason = status === 'SUSPENDED'
      ? REVOCATION_REASONS.ACCOUNT_SUSPENDED
      : status === 'DELETED'
        ? REVOCATION_REASONS.ACCOUNT_DELETED
        : REVOCATION_REASONS.ACCOUNT_REINSTATED

    // setAccountStatus writes the status and revokes the account's live credentials in ONE
    // transaction. Reinstating (-> ACTIVE) revokes too: the documented policy is that a revoked
    // session never comes back, so lifting a suspension requires a fresh login rather than
    // resurrecting the token the suspension was meant to kill.
    //
    // SEC-002R Class A: suspending, deleting or reinstating an account is a privilege mutation and
    // is the exact operation finding N4 was demonstrated on -- a slow PATCH here committed a real
    // suspension after the acting admin's own session had already been revoked mid-request.
    // setAccountStatus() now accepts the caller's transaction, so the re-authorization and the
    // status write are one atomic unit with no window between them.
    //
    // SEC-F1: the transaction RUNNER changed (db().$transaction -> runBoundedRevocation); the
    // contents did not. The commit-boundary re-authorization is still the first thing that happens
    // inside the transaction, still holds the acting admin's session/account locks through to
    // commit, and still rolls the status write back if it throws -- the SEC-002R protection is
    // byte-for-byte the same. What the runner adds is a Postgres-side lock_timeout so that blocking
    // on the TARGET's rows (held by the target's own in-flight Class A transaction, for up to the
    // 60s round-5 payment bound) can no longer hang this request and then fail as an ambiguous 500
    // having suspended nobody. A reauthorization refusal is not a contention error, so it still
    // propagates on the first attempt with its own SEC-002R code, unretried.
    const { before, after } = await runBoundedRevocation(async (tx) => {
      await reauthorizeAtCommit(tx, context, {
        action: 'ADMIN_ACCOUNT_STATUS_CHANGED',
        requiredRoles: ['ADMIN'],
        interestedPartyIds: [targetUserId],
      })
      return setAccountStatus(targetUserId, status, reason, { tx })
    }, { action: 'ADMIN_ACCOUNT_STATUS_CHANGED' })

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'ADMIN_ACCOUNT_STATUS_CHANGED',
        entityType: 'user',
        entityId: targetUserId,
        before,
        after,
      },
    })

    return json(res, 200, { ok: true, user: after, sessionsRevoked: true })
  }

  const userRolesMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/roles$/)
  if (userRolesMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])

    const targetUserId = userRolesMatch[1]
    const body = await readJson(req)
    const add = Array.isArray(body.add) ? body.add.map((role) => String(role).toUpperCase()) : []
    const remove = Array.isArray(body.remove) ? body.remove.map((role) => String(role).toUpperCase()) : []
    const invalid = [...add, ...remove].filter((role) => !VALID_ROLES.has(role))
    if (invalid.length) {
      const error = new Error(`Unknown role(s): ${invalid.join(', ')}.`)
      error.statusCode = 400
      error.code = 'INVALID_ROLE'
      error.expose = true
      throw error
    }
    if (!add.length && !remove.length) {
      const error = new Error('Provide at least one role to add or remove.')
      error.statusCode = 400
      error.code = 'ROLE_CHANGE_EMPTY'
      error.expose = true
      throw error
    }
    // An admin must not be able to grant themselves a role (self-dealing) or strip their own ADMIN
    // (lockout) -- both go through a second administrator, matching the 115aa09 two-party pattern.
    assertNotInterestedParty([targetUserId], context.user.id)

    const target = await db().user.findUnique({ where: { id: targetUserId }, select: { id: true } })
    if (!target) {
      const error = new Error('Account not found.')
      error.statusCode = 404
      error.code = 'USER_NOT_FOUND'
      error.expose = true
      throw error
    }

    // Role changes revoke every session for the account. Removal MUST be immediate (that is the
    // security requirement); grants revoke too so a token's authority can never silently grow
    // under a session opened before the account was trusted with the role.
    // SEC-002R Class A: granting or stripping a role is the other privilege mutation N4 applies to.
    // Same shape as the status handler above -- one transaction covering both the acting admin's
    // commit-boundary re-authorization and the role write it authorizes.
    // SEC-F1: same runner swap, same reasoning, as the status handler above. Contents unchanged.
    const { before, after } = await runBoundedRevocation(async (tx) => {
      await reauthorizeAtCommit(tx, context, {
        action: 'ADMIN_USER_ROLES_CHANGED',
        requiredRoles: ['ADMIN'],
        interestedPartyIds: [targetUserId],
      })
      return applyRoleChange(targetUserId, { add, remove }, REVOCATION_REASONS.ROLE_CHANGED, { tx })
    }, { action: 'ADMIN_USER_ROLES_CHANGED' })

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'ADMIN_USER_ROLES_CHANGED',
        entityType: 'user',
        entityId: targetUserId,
        before: { roles: before },
        after: { roles: after },
      },
    })

    return json(res, 200, { ok: true, userId: targetUserId, roles: after, sessionsRevoked: true })
  }

  const idDocumentAdminUploadMatch = url.pathname.match(/^\/api\/admin\/id-document\/([^/]+)\/upload$/)
  if (idDocumentAdminUploadMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])

    const body = await readJson(req)
    const fileBase64 = typeof body.fileBase64 === 'string' ? body.fileBase64 : ''
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType : ''
    if (!fileBase64 || !mimeType) {
      const error = new Error('An ID document file is required.')
      error.statusCode = 400
      error.code = 'ID_DOCUMENT_REQUIRED'
      error.expose = true
      throw error
    }

    const targetUserId = idDocumentAdminUploadMatch[1]
    const previous = await db().user.findUnique({ where: { id: targetUserId }, select: { idDocumentRef: true } })
    if (!previous) {
      const error = new Error('Customer not found.')
      error.statusCode = 404
      error.code = 'USER_NOT_FOUND'
      error.expose = true
      throw error
    }

    // SEC-002R round 2, finding G1. Independent adversarial testing reproduced this live: a revoked
    // admin's write here committed 265ms after the same token was proven dead by a 401 on a fresh
    // request. The handler was four independent, untransacted operations -- a blob write, a
    // db().user.update() rewriting ANOTHER user's KYC state, an IRREVERSIBLE deletion of that user's
    // previous identity document, and a bare audit-log insert -- with no re-authorization anywhere.
    //
    // The filesystem/object side cannot join a Postgres transaction, so the ordering below is what
    // carries the guarantee instead:
    //
    //   1. Write the NEW blob first. It is inert until a row points at it, and orphaning one costs
    //      storage, not correctness.
    //   2. Do EVERY durable DB effect -- the target's KYC state and the audit row -- inside ONE
    //      transaction, with reauthorizeAtCommit() as its first statement under held
    //      user_sessions/users locks. A revoked actor gets no user row change and no audit row.
    //   3. Delete the PREVIOUS document only AFTER that transaction has genuinely committed. This is
    //      the ordering the owner specifically called for: authority is proven before the destructive
    //      delete, so a refused request can never destroy a real user's prior KYC evidence. The
    //      previous ref is re-read INSIDE the transaction too, so a concurrent upload's document is
    //      never the one deleted.
    //   4. If the transaction is refused or fails, delete the NEW blob written in step 1, so a
    //      refused request leaves nothing behind at all.
    const storageKey = await saveIdDocument(fileBase64, mimeType)
    let updated
    let supersededRef = null
    try {
      ;({ updated, supersededRef } = await db().$transaction(async (tx) => {
        const current = await tx.user.findUnique({ where: { id: targetUserId }, select: { idDocumentRef: true } })
        if (!current) {
          const error = new Error('Customer not found.')
          error.statusCode = 404
          error.code = 'USER_NOT_FOUND'
          error.expose = true
          throw error
        }
        // This route admits ADMIN or SUPPORT, so the commit-boundary role predicate must admit the
        // same pair -- narrowing it to ADMIN here would silently break SUPPORT's real workflow, and
        // widening the route is a separate policy decision, not this fix's to make.
        await reauthorizeAtCommit(tx, context, {
          action: 'ID_DOCUMENT_UPLOADED_BY_ADMIN',
          requiredRoles: ['ADMIN', 'SUPPORT'],
        })
        const row = await tx.user.update({
          where: { id: targetUserId },
          data: {
            idDocumentRef: storageKey,
            idDocumentMimeType: mimeType,
            idDocumentSubmittedAt: new Date(),
            idDocumentStatus: 'PENDING_REVIEW',
            idDocumentReviewedById: null,
            idDocumentReviewedAt: null,
          },
          select: ID_DOCUMENT_SAFE_SELECT,
        })
        await tx.adminAuditLog.create({
          data: {
            actorUserId: context.user.id,
            action: 'ID_DOCUMENT_UPLOADED_BY_ADMIN',
            entityType: 'iddocuments',
            entityId: targetUserId,
            before: {},
            after: row,
          },
        })
        return { updated: row, supersededRef: current.idDocumentRef }
      }))
    } catch (err) {
      // Nothing in the DB references the blob written above; a refused or failed request must not
      // leave it lying in the KYC bucket.
      await deleteIdDocument(storageKey).catch(() => {})
      throw err
    }

    if (supersededRef && supersededRef !== storageKey) {
      await deleteIdDocument(supersededRef)
    }

    return json(res, 200, { ok: true, user: updated })
  }

  if (url.pathname === '/api/admin/audit-log') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const limit = Math.min(Number(url.searchParams.get('limit') || 50), 100)
    const entityType = url.searchParams.get('entityType')
    const action = url.searchParams.get('action')
    const auditLog = await db().adminAuditLog.findMany({
      where: {
        ...(entityType ? { entityType } : {}),
        ...(action ? { action } : {}),
      },
      include: {
        actor: {
          select: {
            id: true,
            displayName: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    return json(res, 200, { ok: true, auditLog })
  }

  if (url.pathname === '/api/admin/platform-metrics') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const [
      usersByRole,
      listingsByDivision,
      listingsByStatus,
      bookingsByStatus,
      ridesByStatus,
      paymentsByStatus,
      giftsByStatus,
      wallets,
      approvedPaymentVolume,
      platformRevenue,
    ] = await Promise.all([
      db().userRole.groupBy({ by: ['role'], _count: { _all: true } }),
      db().listing.groupBy({ by: ['division'], _count: { _all: true }, orderBy: { division: 'asc' } }),
      db().listing.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
      db().booking.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
      db().rideRequest.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
      db().paymentProof.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
      db().walletGift.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
      db().wallet.aggregate({ _count: { _all: true }, _sum: { cachedBalanceMinor: true } }),
      db().paymentProof.aggregate({
        where: { status: 'APPROVED' },
        _count: { _all: true },
        _sum: { amountMinor: true },
      }),
      // 2026-10-09: actual platform revenue, broken out by stream + currency. Previously the only
      // money metric was gross approved-payment volume (what customers paid, most of which is passed
      // through to hosts/drivers). This sums the CREDITs that are genuinely SYBNB's: ride commission,
      // booking commission, protection fees, and seller/dealer plan fees -- the house's real income.
      db().walletEntry.groupBy({
        by: ['referenceType', 'currency'],
        where: {
          type: 'CREDIT',
          referenceType: { in: ['ride_commission', 'booking_admin_share', 'booking_protection_fee', 'seller_plan_fee'] },
        },
        _sum: { amountMinor: true },
      }),
    ])

    // Reversed platform revenue (every revenue stream's reversal), grouped by stream + currency so
    // BOTH the by-stream and by-currency figures below are shown net of corrections (not gross).
    const platformRevenueReversed = await db().walletEntry.groupBy({
      by: ['referenceType', 'currency'],
      where: {
        type: 'DEBIT',
        referenceType: { in: ['ride_commission_reversal', 'booking_admin_share_reversal', 'booking_protection_fee_reversal', 'seller_plan_fee_reversal'] },
      },
      _sum: { amountMinor: true },
    })

    // Net the gross CREDITs by (stream,currency) against matching reversals (reversal referenceType
    // is the stream's name + '_reversal'), so a corrected payment is not counted as revenue retained.
    const reversedByStreamCurrency = new Map()
    for (const r of platformRevenueReversed) {
      const stream = r.referenceType.replace(/_reversal$/, '')
      reversedByStreamCurrency.set(`${stream}|${r.currency}`, r._sum.amountMinor || 0)
    }
    const platformRevenueByStream = platformRevenue.map((r) => ({
      stream: r.referenceType,
      currency: r.currency,
      amountMinor: (r._sum.amountMinor || 0) - (reversedByStreamCurrency.get(`${r.referenceType}|${r.currency}`) || 0),
    }))
    const platformRevenueByCurrency = platformRevenueByStream.reduce((acc, r) => {
      acc[r.currency] = (acc[r.currency] || 0) + r.amountMinor
      return acc
    }, {})

    return json(res, 200, {
      ok: true,
      metrics: {
        usersByRole: toCountMap(usersByRole, 'role'),
        listingsByDivision: toCountMap(listingsByDivision, 'division'),
        listingsByStatus: toCountMap(listingsByStatus, 'status'),
        bookingsByStatus: toCountMap(bookingsByStatus, 'status'),
        ridesByStatus: toCountMap(ridesByStatus, 'status'),
        paymentsByStatus: toCountMap(paymentsByStatus, 'status'),
        giftsByStatus: toCountMap(giftsByStatus, 'status'),
        walletCount: wallets._count._all,
        walletBalanceMinor: wallets._sum.cachedBalanceMinor || 0,
        approvedPaymentCount: approvedPaymentVolume._count._all,
        approvedPaymentVolumeMinor: approvedPaymentVolume._sum.amountMinor || 0,
        // Real platform income (the house's cut), by stream and by currency, net of reversals.
        platformRevenueByStream,
        platformRevenueByCurrency,
      },
    })
  }

  // Re-run the AI pre-check of one listing (2026-10-09). Advisory only: it never changes the
  // listing's status. Runs in the background; the review queue shows PENDING until it lands.
  const aiReviewMatch = url.pathname.match(/^\/api\/admin\/listings\/([^/]+)\/ai-review$/)
  if (aiReviewMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['ADMIN'])
    const listingId = aiReviewMatch[1]
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(listingId)) {
      const error = new Error('Listing not found.')
      error.statusCode = 404
      error.code = 'LISTING_NOT_FOUND'
      error.expose = true
      throw error
    }
    const listing = await db().listing.findUnique({ where: { id: listingId }, select: { id: true } })
    if (!listing) {
      const error = new Error('Listing not found.')
      error.statusCode = 404
      error.code = 'LISTING_NOT_FOUND'
      error.expose = true
      throw error
    }
    // Each run is a paid API call: cap re-runs per admin.
    if (await isRateLimited(`ai-review-rerun:${context.user.id}`, 60 * 60_000, Number(process.env.AI_REVIEW_RERUN_RATE_MAX || 30))) {
      const error = new Error('Too many AI re-runs. Wait a while and try again.')
      error.statusCode = 429
      error.code = 'RATE_LIMITED'
      error.expose = true
      throw error
    }
    await db().adminAuditLog.create({
      data: { actorUserId: context.user.id, action: 'LISTING_AI_REVIEW_RERUN_REQUESTED', entityType: 'listings', entityId: listingId, after: {} },
    })
    const wait = url.searchParams.get('wait') === '1'
    if (wait) {
      // Synchronous variant (scripts/tests): waits for the result, bounded by the 45s API timeout.
      await reviewListingNow(listingId, { actorUserId: context.user.id, trigger: 'ADMIN_RERUN' })
      const row = await db().listingAiReview.findUnique({ where: { listingId } })
      return json(res, 200, { ok: true, aiReview: serializeAiReview(row) })
    }
    scheduleAiListingReview(listingId, { actorUserId: context.user.id, trigger: 'ADMIN_RERUN' })
    return json(res, 202, { ok: true, aiReview: { status: 'PENDING', model: null, at: new Date().toISOString() } })
  }

  const reviewMatch = url.pathname.match(/^\/api\/admin\/review-queue\/([^/]+)\/([^/]+)$/)
  if (reviewMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const [entityType, entityId] = reviewMatch.slice(1)
    const decision = normalizeDecision(body.decision || body.action)

    // Money-moving entity types only — listing/iddocument decisions never touch payment/wallet
    // state and are deliberately not gated by a payment policy (see payment-policy-routes.mjs).
    // An APPROVED booking decision is a pure status confirm (no wallet effect — see
    // updateReviewEntity's booking branch, only reachable for decision !== 'APPROVED'), so it's
    // intentionally excluded here rather than mislabeled as a refund.
    const normalizedEntityType = String(entityType).toLowerCase()
    let moneyMovingOperation
    if (normalizedEntityType === 'payment' || normalizedEntityType === 'payments') {
      moneyMovingOperation = decision === 'APPROVED' ? 'capture' : 'refund'
    } else if ((normalizedEntityType === 'booking' || normalizedEntityType === 'bookings') && decision !== 'APPROVED') {
      moneyMovingOperation = 'refund'
    }
    if (moneyMovingOperation) {
      authorizePaymentOperation({
        operation: moneyMovingOperation,
        rail: 'manual_proof',
        provider: 'manual',
        division: 'PLATFORM',
        country: activePolicyCountryKey(),
        environment: policyEnvironment(),
        actor: { roles: context.roles },
      })
    }

    const result = await db().$transaction(async (tx) => {
      const before = await findReviewEntity(tx, entityType, entityId)
      // SEC-002R Class A. This one dispatcher is the commit boundary for six distinct irreversible
      // decisions: payment approval (wallet HOLD + platform CREDIT + protection fee + the SELLER
      // role grant + driver fare credit, via approvePaymentProof), payment rejection, wallet-gift
      // approval/blocking (sender refund), booking confirmation/rejection (refund request +
      // reverseBookingPlatformShare), KYC/ID-document approval (which is what unlocks publishing),
      // and listing/advertising-campaign approval. All of them write inside THIS transaction, so
      // one re-authorization here covers every branch and no future 7th branch can be added past
      // it. Self-dealing is deliberately NOT passed here: updateReviewEntity() already re-reads the
      // entity inside this same transaction and calls assertNoSelfReview() on that fresh row, which
      // is itself a commit-boundary check -- duplicating it against a staler copy would be weaker,
      // not stronger.
      await reauthorizeAtCommit(tx, context, {
        action: `REVIEW_${decision}`,
        requiredRoles: ['ADMIN'],
      })
      const after = await updateReviewEntity(tx, entityType, entityId, decision, context.user.id, body)
      const auditLog = await tx.adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: `REVIEW_${decision}`,
          entityType,
          entityId,
          before: before || {},
          after: after || {},
        },
      })
      // Owner decision 2026-10-09 -- the activation code comes at the END: approving a stay whose
      // owner is not yet host-verified issues the code here, in the SAME transaction as the
      // approval (same helper, hashing, expiry, retirement and audit as the manual admin route).
      // The plaintext only leaves through the host's email below; never in this response.
      let activation = null
      if (reviewModel(entityType) === 'listing' && decision === 'APPROVED' && after) {
        activation = await issueActivationCodeOnApproval(tx, after, context.user.id)
      }
      return { entity: after, auditLog, activation }
    })
    // Decision 8: a verified booking payment tells the guest and asks the host to accept (or tells
    // the host about a confirmed Instant Book booking). Fire-and-forget, after commit.
    if (moneyMovingOperation === 'capture' && result.entity?.bookingId) {
      notifyBooking('guest_payment_confirmed', result.entity.bookingId, { amount: formatMoney(result.entity.amountMinor, result.entity.currency) })
      notifyBooking('host_new_paid_request', result.entity.bookingId)
    }
    // Activation code email: fire-and-forget, only after the approval committed.
    const { activation, ...rest } = result
    let activationCode
    if (activation) {
      const emailQueued = Boolean(activation.issued && activation.ownerEmail)
      if (emailQueued) {
        notifyUser(
          'host_listing_approved_code',
          activation.ownerId,
          {
            code: activation.code,
            expiresAt: activation.expiresAt.toISOString().slice(0, 10),
            listingTitle: result.entity?.titleAr || result.entity?.titleEn || '',
            url: appLink('/#/host'),
          },
          `host-activation:${activation.codeId}`,
        )
      }
      activationCode = activation.issued
        ? { issued: true, codeId: activation.codeId, expiresAt: activation.expiresAt, emailQueued }
        : { issued: false, reason: activation.reason }
    }
    return json(res, 200, { ok: true, ...rest, ...(activationCode ? { activationCode } : {}) })
  }

  return false
}

// Runs inside the review transaction (see the caller). Returns null when not applicable, or
// { issued:false, reason } / { issued:true, code, codeId, expiresAt, ownerId, ownerEmail }.
async function issueActivationCodeOnApproval(tx, listing, actorUserId) {
  const owner = await tx.user.findUnique({
    where: { id: listing.ownerId },
    select: { id: true, email: true, status: true, hostVerifiedAt: true },
  })
  const latestCode = owner
    ? await tx.hostActivationCode.findFirst({
        where: { hostId: owner.id, usedAt: null },
        orderBy: { issuedAt: 'desc' },
        select: { expiresAt: true, attempts: true, usedAt: true },
      })
    : null
  const now = new Date()
  const decision = approvalActivationDecision({ listing, owner, latestCode, now })
  if (!decision.issue) return { issued: false, reason: decision.reason }
  const { code, row } = await issueHostActivationCodeTx(tx, {
    hostId: owner.id,
    issuedById: actorUserId,
    now,
    auditAfter: { trigger: 'LISTING_APPROVED', listingId: listing.id, emailRequested: Boolean(owner.email) },
  })
  return { issued: true, code, codeId: row.id, expiresAt: row.expiresAt, ownerId: owner.id, ownerEmail: owner.email || null }
}

// What the host sees when a listing is sent back for fixes: the admin's note plus the AI's
// issuesForHost (unless the admin turned them off, or supplied an edited list as `hostIssues`).
function hostFeedbackSnapshot({ body, note, aiRow, actorUserId }) {
  const explicit = Array.isArray(body?.hostIssues)
    ? body.hostIssues.map((i) => (typeof i === 'string' ? i.trim().slice(0, 400) : '')).filter(Boolean).slice(0, 15)
    : null
  const aiIssues = aiRow?.status === 'DONE' && Array.isArray(aiRow.result?.issuesForHost) ? aiRow.result.issuesForHost : []
  const issues = explicit ?? (body?.includeAiIssues === false ? [] : aiIssues)
  return {
    note: note ? String(note).trim().slice(0, 2000) : null,
    issues,
    at: new Date().toISOString(),
    byId: actorUserId,
  }
}

function toCountMap(rows, key) {
  return rows.reduce((acc, row) => {
    acc[row[key]] = row._count._all
    return acc
  }, {})
}

function normalizeDecision(value) {
  const decision = String(value || 'APPROVE').toUpperCase()
  if (decision === 'APPROVE' || decision === 'APPROVED') return 'APPROVED'
  if (decision === 'REJECT' || decision === 'REJECTED') return 'REJECTED'

  const error = new Error('decision must be APPROVE or REJECT.')
  error.statusCode = 400
  error.code = 'INVALID_REVIEW_DECISION'
  error.expose = true
  throw error
}

const ID_DOCUMENT_SAFE_SELECT = {
  id: true,
  displayName: true,
  email: true,
  idDocumentRef: true,
  idDocumentMimeType: true,
  idDocumentSubmittedAt: true,
  idDocumentStatus: true,
  idDocumentReviewedById: true,
  idDocumentReviewedAt: true,
}

function reviewModel(entityType) {
  const normalized = String(entityType || '').toLowerCase()
  if (normalized === 'listing' || normalized === 'listings') return 'listing'
  if (normalized === 'payment' || normalized === 'payments') return 'paymentProof'
  if (normalized === 'gift' || normalized === 'gifts') return 'walletGift'
  if (normalized === 'booking' || normalized === 'bookings') return 'booking'
  if (normalized === 'iddocument' || normalized === 'iddocuments') return 'user'

  const error = new Error('Unsupported review entity type.')
  error.statusCode = 400
  error.code = 'UNSUPPORTED_REVIEW_ENTITY'
  error.expose = true
  throw error
}

async function findReviewEntity(tx, entityType, entityId) {
  const model = reviewModel(entityType)
  // The 'user' model backs ID-document review — never return the full row (password hash, phone
  // hash) into an audit log or API response; only the fields relevant to document review.
  if (model === 'user') {
    return tx.user.findUnique({ where: { id: entityId }, select: ID_DOCUMENT_SAFE_SELECT })
  }
  return tx[model].findUnique({ where: { id: entityId } })
}

// Centralized "who has a material interest in this entity" resolver. A real audit found the
// self-review guard only covered 'listing' and 'paymentProof' -- 'walletGift', 'user' (KYC), and
// 'booking' had no check at all, and each was independently exploitable live (an admin self-
// approved their own ID document, self-approved their own wallet gift above the anti-fraud review
// threshold, and self-confirmed their own booking including its refund/reversal logic). A 6th
// review type added later would silently reintroduce this exact gap if the check stayed three
// separate inline `if`s instead of one resolver every branch is required to call. Applies
// uniformly to BOTH decisions (APPROVED and REJECTED) -- the conflict of interest in ruling on
// your own submission doesn't depend on which way you rule.
function interestedPartyIds(model, entity) {
  if (model === 'listing') return [entity.ownerId] // listing owner
  if (model === 'paymentProof') return [entity.userId] // payment submitter
  if (model === 'walletGift') return [entity.senderUserId, entity.recipientUserId].filter(Boolean) // sender (refunded if blocked) + recipient (financial beneficiary if approved)
  if (model === 'user') return [entity.id] // the KYC subject IS the reviewed entity
  if (model === 'booking') return [entity.guestId, entity.listing?.ownerId].filter(Boolean) // booking guest (requester) + listing owner (host, financially affected by confirm/cancel)
  throw new Error(`interestedPartyIds: unhandled review model '${model}'`)
}

// Lower-level primitive the review-queue models above build on -- also used directly by the 4
// ADMIN-only money-moving endpoints below (payout release, finalize-cancellation, refund execute,
// legacy-refund-accept) that sit OUTSIDE the review-queue dispatcher entirely and had NO
// self-dealing check of any kind before this fix. Same underlying risk (an admin who also holds
// a HOST/SELLER/GUEST role directing money to themselves), different code shape, one shared
// assertion so it can't drift into 4 separately-written (and separately-forgettable) checks.
// Audit rows never carry a full wallet/account number -- last 4 characters only.
function maskMethod(method) {
  if (!method || typeof method !== 'object') return method
  const masked = { ...method }
  for (const field of ['shamCashNumber', 'accountNumber']) {
    if (masked[field]) masked[field] = `****${String(masked[field]).slice(-4)}`
  }
  return masked
}

function assertNotInterestedParty(interestedIds, actorUserId) {
  if (interestedIds.includes(actorUserId)) throw selfReviewError()
}

function assertNoSelfReview(model, entity, actorUserId) {
  assertNotInterestedParty(interestedPartyIds(model, entity), actorUserId)
}

async function updateReviewEntity(tx, entityType, entityId, decision, actorUserId, body) {
  const model = reviewModel(entityType)
  const note = body.adminNote || body.note || undefined

  if (model === 'listing') {
    const existing = await tx.listing.findUnique({ where: { id: entityId } })
    if (!existing || existing.status !== 'PENDING_REVIEW') throw reviewStateError('LISTING_NOT_REVIEWABLE')
    assertNoSelfReview('listing', existing, actorUserId)
    // Owner decision 2026-10-09: the host submits listing + ID together (submit only needs the ID
    // UPLOADED); the admin must approve the host's ID before approving the listing, so a listing
    // never goes live (and no activation code is issued) for an unverified owner. Rejecting /
    // sending back for fixes is always allowed.
    if (decision === 'APPROVED') {
      const owner = await tx.user.findUnique({ where: { id: existing.ownerId }, select: { idDocumentStatus: true } })
      if (owner?.idDocumentStatus !== 'APPROVED') {
        const error = new Error("Approve the host's ID first.")
        error.statusCode = 409
        error.code = 'OWNER_ID_NOT_APPROVED'
        error.expose = true
        error.details = { ownerId: existing.ownerId, idDocumentStatus: owner?.idDocumentStatus || null }
        throw error
      }
    }
    // Re-check status in the WHERE clause so two concurrent decisions on the same listing can't
    // both apply (same TOCTOU class as the payment-proof and SR-ride races fixed earlier).
    const updated = await tx.listing.updateMany({
      where: { id: entityId, status: 'PENDING_REVIEW' },
      data: { status: decision === 'APPROVED' ? 'APPROVED' : 'REJECTED' },
    })
    if (updated.count === 0) throw reviewStateError('LISTING_NOT_REVIEWABLE')
    // A rejected advertising campaign never ran -- release its bound payment (rather than leaving
    // it permanently consumed by a dead campaign) so the same, still-valid payment can back a
    // retry. An APPROVED campaign needs no action here: the binding set at creation time simply
    // stays, which is what makes it genuinely consumed going forward.
    if (decision === 'REJECTED' && existing.metadata?.advertising === true) {
      await tx.paymentProof.updateMany({
        where: { campaignListingId: entityId },
        data: { campaignListingId: null },
      })
    }
    // "Send back for fixes" (2026-10-09) is this REJECTED decision: the host can edit and resubmit
    // a REJECTED listing. Snapshot what they must fix so their dashboard can show it.
    if (decision === 'REJECTED') {
      const aiRow = await tx.listingAiReview.findUnique({ where: { listingId: entityId } })
      const hostFeedback = hostFeedbackSnapshot({ body, note, aiRow, actorUserId })
      await tx.listingAiReview.upsert({
        where: { listingId: entityId },
        create: { listingId: entityId, status: 'SKIPPED', error: 'NOT_RUN', hostFeedback },
        update: { hostFeedback },
      })
    }
    return tx.listing.findUnique({ where: { id: entityId } })
  }

  if (model === 'paymentProof') {
    const existing = await tx.paymentProof.findUnique({
      where: { id: entityId },
      include: {
        booking: {
          include: {
            listing: true,
          },
        },
      },
    })
    if (!existing || existing.status !== 'PENDING_ADMIN_REVIEW') throw reviewStateError('PAYMENT_NOT_REVIEWABLE')
    assertNoSelfReview('paymentProof', existing, actorUserId)
    const shamCashReconciliation = decision === 'APPROVED' && isShamCashProvider(existing.provider)
      ? requireShamCashReconciliation(existing, body)
      : null
    const adminNote = [
      note,
      shamCashReconciliation
        ? `Sham Cash reconciled server-side: expected=${shamCashReconciliation.expectedMinor}, account=${shamCashReconciliation.accountMinor}, difference=${shamCashReconciliation.differenceMinor}, source=${shamCashReconciliation.source}.`
        : '',
    ].filter(Boolean).join('\n') || undefined

    if (decision === 'APPROVED') {
      return approvePaymentProof(tx, { proofId: entityId, actorUserId, note: adminNote })
    }

    const rejectResult = await tx.paymentProof.updateMany({
      where: { id: entityId, status: 'PENDING_ADMIN_REVIEW' },
      data: {
        status: 'REJECTED',
        reviewedById: actorUserId,
        reviewedAt: new Date(),
        adminNote,
      },
    })
    if (rejectResult.count === 0) throw reviewStateError('PAYMENT_REVIEW_CONFLICT')
    const rejected = await tx.paymentProof.findUnique({ where: { id: entityId } })

    if (!existing.bookingId && existing.provider === 'seller_plan') {
      await tx.sellerProfile.update({
        where: { userId: existing.userId },
        data: { documentStatus: 'REJECTED' },
      })
    }

    return rejected
  }

  if (model === 'walletGift') {
    const existing = await tx.walletGift.findUnique({ where: { id: entityId } })
    if (!existing || !['CLAIM_PENDING', 'LOCKED'].includes(existing.status)) throw reviewStateError('GIFT_NOT_REVIEWABLE')
    assertNoSelfReview('walletGift', existing, actorUserId)
    const updated = await tx.walletGift.updateMany({
      where: { id: entityId, status: existing.status },
      data: { status: decision === 'APPROVED' ? 'SENT' : 'ADMIN_BLOCKED' },
    })
    if (updated.count === 0) throw reviewStateError('GIFT_NOT_REVIEWABLE')
    // The sender was debited atomically when the gift was created (server/routes/wallet.mjs). A
    // blocked gift must never just vanish that money — refund the sender in the same transaction as
    // the block decision, exactly like a rejected payment proof triggers a refund elsewhere.
    if (decision !== 'APPROVED') {
      await recordWalletEntry(tx, {
        userId: existing.senderUserId,
        type: 'REFUND',
        amountMinor: existing.amountMinor,
        currency: existing.currency,
        referenceType: 'wallet_gift_blocked',
        referenceId: existing.id,
        keyParts: ['wallet-gift-blocked-refund', existing.id],
        note: 'Wallet gift blocked by admin review; sender refunded.',
      })
    }
    return tx.walletGift.findUnique({ where: { id: entityId } })
  }

  if (model === 'user') {
    const existing = await tx.user.findUnique({ where: { id: entityId }, select: { id: true, idDocumentStatus: true } })
    if (!existing || existing.idDocumentStatus !== 'PENDING_REVIEW') throw reviewStateError('ID_DOCUMENT_NOT_REVIEWABLE')
    assertNoSelfReview('user', existing, actorUserId)
    const updated = await tx.user.updateMany({
      where: { id: entityId, idDocumentStatus: 'PENDING_REVIEW' },
      data: {
        idDocumentStatus: decision === 'APPROVED' ? 'APPROVED' : 'REJECTED',
        idDocumentReviewedById: actorUserId,
        idDocumentReviewedAt: new Date(),
      },
    })
    if (updated.count === 0) throw reviewStateError('ID_DOCUMENT_NOT_REVIEWABLE')
    return tx.user.findUnique({ where: { id: entityId }, select: ID_DOCUMENT_SAFE_SELECT })
  }

  const existing = await tx.booking.findUnique({
    where: { id: entityId },
    include: { payments: true, listing: true },
  })
  if (!existing || !['REQUESTED', 'DISPUTED'].includes(existing.status)) throw reviewStateError('BOOKING_NOT_REVIEWABLE')
  assertNoSelfReview('booking', existing, actorUserId)
  const updatedBooking = await tx.booking.updateMany({
    where: { id: entityId, status: existing.status },
    data: { status: decision === 'APPROVED' ? 'CONFIRMED' : 'CANCELLED' },
  })
  if (updatedBooking.count === 0) throw reviewStateError('BOOKING_NOT_REVIEWABLE')

  // Rejecting a REQUESTED booking or ruling against the host in a DISPUTED one both cancel a
  // booking that already has an approved payment (the HOLD/admin-share CREDIT were created back
  // when the payment proof was approved, well before this decision). Without reversing them here,
  // the guest's money and the admin's commission are stranded forever with no other code path that
  // ever cleans them up — this mirrors the guest/host-initiated cancellation reversal in
  // bookings.mjs and host.mjs, but with a full refund (no cancellation fee) since the guest didn't
  // choose to cancel.
  if (decision !== 'APPROVED') {
    const approvedPayment = existing.payments.find((payment) => payment.status === 'APPROVED')
    if (approvedPayment) {
      // Card-network payments (Stripe Checkout, the electronic PaymentIntent rail) never had their
      // money enter the platform's own wallet ledger — it went to the card network directly. This
      // app has no real provider-side refund call anywhere, so crediting the guest's wallet here
      // would represent money the platform doesn't actually hold for this payment, unlike a manual
      // proof (local wallet / Sham Cash / bank transfer) where the guest's money genuinely is the
      // platform's liability to return. Mirrors the same principle applyPaymentIntentRefund already
      // establishes for the provider-confirmed refund path — a card payment needs a REAL refund
      // issued through the provider directly, not a wallet credit standing in for one.
      const isCardPayment = ['stripe', 'payment_intent'].includes(approvedPayment.provider)

      await tx.paymentProof.updateMany({
        where: {
          bookingId: existing.id,
          status: { in: ['PENDING_PROOF', 'PENDING_ADMIN_REVIEW', 'APPROVED'] },
        },
        data: {
          status: 'REFUNDED',
          adminNote: isCardPayment
            ? 'Admin rejected/ruled against this booking. Card payment — issue the real refund through the payment provider directly; no wallet credit was recorded.'
            : 'Auto-refunded after admin rejected/ruled against this booking.',
          reviewedById: actorUserId,
          reviewedAt: new Date(),
        },
      })

      if (!isCardPayment) {
        // Item 2 Phase 2b round 2: creates a Refund + initial RefundAttempt instead of an immediate
        // wallet credit -- owner-confirmed replacement; fulfillment deferred to a later phase.
        // reasonCode distinguishes an admin rejecting a still-REQUESTED booking from a ruling
        // against the host in an already-DISPUTED one -- existing.status is the ORIGINAL status,
        // captured before this transaction's own booking.updateMany above.
        await createRefundRequest(tx, {
          paymentProofId: approvedPayment.id,
          bookingId: existing.id,
          requestedByUserId: actorUserId,
          amountMinor: approvedPayment.amountMinor,
          currency: existing.currency,
          reason: 'Guest refund after admin rejected/ruled against this booking.',
          reasonCode: existing.status === 'DISPUTED' ? 'DISPUTE_RULING' : 'ADMIN_REJECTED_BOOKING',
        })
      }

      // Reverses the platform's own position (admin-share CREDIT, and a host payout clawback if
      // it was already RELEASED) — shared with the PaymentIntent refund webhook path so both
      // reversal routes stay in lockstep instead of two independent implementations drifting.
      await reverseBookingPlatformShare(tx, {
        booking: existing,
        approvedPayment,
        keyPrefix: 'booking-admin-reject',
        adminShareReversalNote: 'Admin/SYBNB share reversed because the admin rejected/ruled against this booking.',
        payoutClawbackNote: 'Host payout clawed back after admin rejected/ruled against this booking post-release.',
      })
    }
  }

  return tx.booking.findUnique({ where: { id: entityId } })
}

function reviewStateError(code) {
  const error = new Error('Entity is not in a reviewable state.')
  error.statusCode = 400
  error.code = code
  error.expose = true
  return error
}

function selfReviewError() {
  const error = new Error('An admin cannot approve or reject their own submission.')
  error.statusCode = 403
  error.code = 'SELF_REVIEW_FORBIDDEN'
  error.expose = true
  return error
}

function isShamCashProvider(provider) {
  const value = String(provider || '').toUpperCase()
  return value.includes('SHAM') || value.includes('LOCAL_WALLET') || value.includes('SYRIAN_LOCAL_WALLET')
}

function minorValue(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number) : null
}

function requireShamCashReconciliation(paymentProof, body) {
  const packet = body.shamCashReconciliation || body.shamCash || {}
  const accountMinor = minorValue(packet.accountMinor ?? body.shamCashAccountMinor)
  const expectedMinor = minorValue(packet.expectedMinor ?? body.shamCashExpectedMinor)
  const differenceMinor = minorValue(packet.differenceMinor ?? body.shamCashDifferenceMinor)
  const source = String(packet.source || body.shamCashSource || 'admin-ui')

  if (accountMinor == null || expectedMinor == null || differenceMinor == null) {
    throwShamCashError(
      'SHAM_CASH_RECONCILIATION_REQUIRED',
      'Sham Cash reconciliation is required before approving this payment.',
      409,
    )
  }

  const computedDifference = accountMinor - expectedMinor
  if (computedDifference !== differenceMinor || differenceMinor !== 0 || expectedMinor < Math.round(paymentProof.amountMinor || 0)) {
    throwShamCashError(
      'SHAM_CASH_RECONCILIATION_MISMATCH',
      'Sham Cash account balance does not match the expected SYBNB payment amount.',
      409,
    )
  }

  return { accountMinor, expectedMinor, differenceMinor, source }
}

function throwShamCashError(code, message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  throw error
}
