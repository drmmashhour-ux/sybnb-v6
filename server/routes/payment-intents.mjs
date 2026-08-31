import { randomUUID, createHash } from 'node:crypto'
import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { reauthorizeAtCommit } from '../lib/commit-authorization.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { verifyWebhook, targetStatusFor, canTransition, paymentWebhookSecret } from '../lib/payment-webhook.mjs'
import {
  approvePaymentProof,
  expectedTotalMinor,
  firstAdminId,
  reverseBookingPlatformShare,
} from '../lib/finance-ledger.mjs'
import { log } from '../lib/logger.mjs'
import { authorizePaymentOperation, policyEnvironment, activePolicyCountryKey } from '../lib/payment-policy.mjs'
import { applyPaymentEvent as applyPaymentEventPipeline, intakeEvent, verifyAndLockClaim, webhookAcknowledgeStatus } from '../lib/payment-event-pipeline.mjs'
import { applyStripeCheckoutEvent } from '../lib/stripe-checkout-apply.mjs'
import { withTx } from '../lib/tx-scope.mjs'

function fail(statusCode, code, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  return error
}

// Backstop for the "no second active intent per booking" guard: the app-level pre-check in the
// creation route is a TOCTOU fast-path (good UX, not a real guarantee), so a double-click or retry
// racing past it would otherwise create two simultaneously-active intents for one booking — and,
// under sufficiently overlapping concurrent success processing, both could apply and produce
// duplicated wallet HOLD/admin-share CREDIT entries (see migration 015's comment for the full
// mechanism). The partial unique index it creates is the real guarantee; this recognizes a
// violation of it the same way isProviderRefUniqueViolation recognizes the PaymentProof race.
function isActiveBookingIntentViolation(err) {
  const target = err?.meta?.target
  return err?.code === 'P2002' && (target === 'payment_intents_one_active_per_booking' ||
    (Array.isArray(target) && target.includes('booking_id')) || String(target || '').includes('booking_id'))
}

async function readRawBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > 1_000_000) throw fail(413, 'PAYLOAD_TOO_LARGE', 'Webhook body too large.')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

// Explicit kill switch, same shape as payments.mjs's requireStripe(): default OFF unconditionally
// (unlike requireStripe, this system never calls a real Stripe key, so there's no test-key
// exemption to make) — production stays on PAYMENT_INTENTS_ENABLED unset, so this entire subsystem
// (intent creation, webhook processing, admin replay) is unreachable there regardless of anything
// else in this file.
function requirePaymentIntentsEnabled() {
  if (process.env.PAYMENT_INTENTS_ENABLED !== 'true') {
    const error = new Error('Electronic payment intents are not enabled on this server.')
    error.statusCode = 503
    error.code = 'PAYMENT_INTENTS_DISABLED'
    error.expose = true
    throw error
  }
}

// Applies a SUCCEEDED transition's real-world effect: mirrors payments.mjs's finalizeStripeSession
// almost exactly, keyed by intent.reference instead of a Stripe session id, so both rails create a
// PaymentProof and confirm the booking/wallet the exact same way via approvePaymentProof.
async function applyPaymentIntentSuccess(tx, { intent, obj }) {
  const providerRef = obj?.id || intent.providerRef
  const existingProof = await tx.paymentProof.findFirst({
    where: { provider: 'payment_intent', providerRef: intent.reference },
  })

  if (!existingProof) {
    const booking = await tx.booking.findUnique({ where: { id: intent.bookingId } })
    if (booking && booking.status === 'PAYMENT_PENDING') {
      const created = await tx.paymentProof.create({
        data: {
          bookingId: booking.id,
          userId: booking.guestId,
          provider: 'payment_intent',
          status: 'PENDING_ADMIN_REVIEW',
          amountMinor: intent.amountMinor,
          // PaymentIntent.currency is stored lowercase (this route's own convention); PaymentProof /
          // Wallet currency is uppercase ('SYP'/'USD') throughout the rest of the ledger.
          currency: intent.currency.toUpperCase(),
          providerRef: intent.reference,
          proofAssetUrl: obj?.id ? `payment-intent://provider_refs/${obj.id}` : undefined,
        },
      })
      await approvePaymentProof(tx, {
        proofId: created.id,
        actorUserId: await firstAdminId(tx),
        note: 'Auto-approved: verified payment-intent webhook confirmed funds captured.',
      })
    }
    // else: funds were genuinely captured on this intent, but there's no booking left to apply them
    // to (e.g. a second intent for the same booking lost the race to a first one that already
    // finalized it). Still SUCCEEDED — surfaces via reconciliation as "no linked PaymentProof" for
    // an operator to follow up (manual refund via the provider).
  }

  return tx.paymentIntent.update({ where: { id: intent.id }, data: { status: 'SUCCEEDED', providerRef } })
}

// Applies a REFUNDED transition. Deliberately does NOT credit the guest's SYBNB wallet: a
// charge.refunded event means the card network already returned the funds directly to the guest —
// crediting the wallet too would create money from nothing. Only SYBNB's own internal position is
// reversed (admin-share CREDIT taken at approval time, and a host payout clawback if it was already
// released), via the same helper the admin dispute-rejection path uses.
async function applyPaymentIntentRefund(tx, { intent }) {
  const proof = await tx.paymentProof.findFirst({
    where: { provider: 'payment_intent', providerRef: intent.reference },
  })
  if (!proof || proof.status !== 'APPROVED') {
    return tx.paymentIntent.update({ where: { id: intent.id }, data: { status: 'REFUNDED' } })
  }
  const booking = await tx.booking.findUnique({ where: { id: proof.bookingId }, include: { listing: true } })
  await reverseBookingPlatformShare(tx, {
    booking,
    approvedPayment: proof,
    keyPrefix: 'payment-intent-refund',
    adminShareReversalNote: 'Admin/SYBNB share reversed: provider reported this card payment refunded.',
    payoutClawbackNote: 'Host payout clawed back: provider reported this card payment refunded after release.',
  })
  await tx.paymentProof.update({
    where: { id: proof.id },
    data: { status: 'REFUNDED', adminNote: 'Auto-refunded: provider webhook reported charge.refunded.' },
  })
  return tx.paymentIntent.update({ where: { id: intent.id }, data: { status: 'REFUNDED' } })
}

// This rail's own "apply this event's side effects" business logic — called from BOTH the live
// webhook handler (fresh delivery or provider redelivery) and the admin replay endpoint, so there
// is never a second copy that can drift. Wrapped by the shared payment-event-pipeline.mjs, which
// owns the attempts/dead-letter/duplicate-collision bookkeeping common to every rail (see that
// module's own comment for why the outer wrapper doesn't own this function's transaction boundary).
// This function stays responsible for marking eventId APPLIED/IGNORED itself, atomically with its
// own booking/wallet transaction.
//
// verifyAndLockClaim() is called FIRST, before any business-effect write (round 7) -- independent
// review found that round 6's token-bound writes only protected the FINAL bookkeeping update, while
// the actual financial effect (applyPaymentIntentSuccess/Refund, or the intent-status claim below) ran
// BEFORE that check and could still commit even after ownership had already moved on to a newer
// claimant; only the stale worker's own bookkeeping write silently no-op'd afterward. Calling
// verifyAndLockClaim() first, inside this SAME transaction, makes that impossible: if a newer claimant
// already owns this event, verifyAndLockClaim() throws immediately, before applyPaymentIntentSuccess/
// Refund or the intent-status claim ever runs, and Postgres rolls back the whole transaction -- there
// is no window in which a stale worker can execute, let alone commit, a real effect.
// SEC-002R: `beforeEffects`, when supplied, runs inside THIS transaction immediately after
// verifyAndLockClaim() and before any effect-producing write, exactly like the `verifyOwnership`
// hook finalizeStripeSession() already offers the other rail. The ONLY caller that supplies it is
// the admin replay route, which uses it to re-authorize the acting admin at the commit boundary;
// the webhook path never supplies it, because a provider delivery has no session behind it at all.
// SEC-002R round 5: `withTx` instead of `db().$transaction` directly. When this rail is invoked from
// the merged claim+effects pipeline (both production call sites), it now runs INSIDE the pipeline's
// single transaction as a SAVEPOINT-delimited subtransaction, so the claim and these effects commit
// atomically together; opening a second transaction here would take a second connection and block
// forever on the event-row lock the pipeline's transaction is holding. When invoked standalone (the
// direct-call regression suites), withTx opens a real transaction exactly as before. Either way this
// function still receives a `tx`, still gets all-or-nothing rollback on a throw, and its own logic is
// completely unchanged.
async function applyPaymentIntentEvent({ eventId, intentId, type, obj, claimToken, beforeEffects }) {
  const target = targetStatusFor(type)
  return withTx(async (tx) => {
    await verifyAndLockClaim(tx, { eventId, claimToken })
    if (beforeEffects) await beforeEffects(tx)

    const fresh = await tx.paymentIntent.findUnique({ where: { id: intentId } })
    if (!fresh) throw fail(404, 'PAYMENT_INTENT_NOT_FOUND', 'No matching payment intent.')

    if (!target || !canTransition(fresh.status, target)) {
      // Deterministic no-op: an illegal/out-of-order transition (e.g. a refund before success, or
      // a second terminal transition) will never succeed no matter how many times it's retried —
      // record it as IGNORED, not FAILED, so it never enters the dead-letter retry path.
      await tx.paymentEvent.updateMany({ where: { id: eventId, claimToken }, data: { processingStatus: 'IGNORED', appliedAt: new Date(), claimToken: null, claimExpiresAt: null } })
      return { applied: false, status: fresh.status, illegal: true }
    }

    let updated
    if (target === 'SUCCEEDED' && fresh.bookingId) {
      updated = await applyPaymentIntentSuccess(tx, { intent: fresh, obj })
    } else if (target === 'REFUNDED' && fresh.bookingId) {
      updated = await applyPaymentIntentRefund(tx, { intent: fresh })
    } else {
      // Claim on the status we actually read, not a blind write: two concurrent deliveries for
      // this intent (e.g. 'processing' racing 'succeeded') can both read the same starting status
      // and both pass canTransition against it. A plain `update` would let whichever commits last
      // silently overwrite the other's (possibly more-advanced) status. This mirrors the claim
      // pattern approvePaymentProof already uses for exactly this class of race.
      const claimed = await tx.paymentIntent.updateMany({
        where: { id: intentId, status: fresh.status },
        data: { status: target, providerRef: obj?.id || fresh.providerRef },
      })
      if (claimed.count === 0) {
        // Another delivery already advanced this intent's status between our read and this write —
        // it moved on without us. Nothing to retry: record as a no-op, not a failure.
        await tx.paymentEvent.updateMany({ where: { id: eventId, claimToken }, data: { processingStatus: 'IGNORED', appliedAt: new Date(), claimToken: null, claimExpiresAt: null } })
        const current = await tx.paymentIntent.findUnique({ where: { id: intentId } })
        return { applied: false, status: current.status, illegal: true }
      }
      updated = { status: target }
    }
    // Bound to claimToken, same as every other write in this transaction -- with verifyAndLockClaim()
    // already having proven (and, via its own UPDATE's row lock, held for this transaction's entire
    // duration -- no other transaction can touch this row until this one commits or rolls back)
    // ownership at the very start, this can only ever fail if something is deeply wrong; still guarded
    // rather than a bare `update`, for the same reason every other write here is.
    await tx.paymentEvent.updateMany({
      where: { id: eventId, claimToken },
      data: { processingStatus: 'APPLIED', appliedAt: new Date(), lastError: null, claimToken: null, claimExpiresAt: null },
    })
    return { applied: true, status: updated.status }
  })
}

// SEC-002R round 2 (A8): `authorizeClaim` is threaded through to the pipeline so the CLAIM itself
// (attempts increment + APPLYING) is gated on the acting actor's live authority, not just the
// effects. Supplied only by the admin replay route; the live webhook path passes neither hook.
async function applyPaymentEvent({ eventId, intentId, type, obj, beforeEffects, authorizeClaim }) {
  return applyPaymentEventPipeline({
    eventId,
    rail: 'payment_intent',
    authorizeClaim,
    apply: (claimToken) => applyPaymentIntentEvent({ eventId, intentId, type, obj, claimToken, beforeEffects }),
  })
}

// Exported for direct testing of the claim-locking transaction boundary (payment-event-claim-recovery
// e2e tests call this directly, mirroring the established pattern for applyStripeCheckoutEvent) --
// never imported by any other route; production code always goes through applyPaymentEvent above.
export { applyPaymentIntentEvent }

// Resolves the division a policy check should evaluate for an intent that's already known (i.e.
// past the intake seam) — 'PLATFORM' for a standalone, non-booking-linked intent, otherwise the
// linked booking's listing division.
async function eventDivision(intent) {
  if (!intent.bookingId) return 'PLATFORM'
  const booking = await db().booking.findUnique({ where: { id: intent.bookingId }, select: { listing: { select: { division: true } } } })
  return booking?.listing?.division || 'PLATFORM'
}

// Keyset cursor for the reconciliation scan (updatedAt+id, since updatedAt alone isn't unique
// enough to guarantee a stable order across pages). Malformed/missing input fails open to "start
// from the top" -- safe for a read-only report, never a data-loss risk.
function encodeReconciliationCursor(intent) {
  return Buffer.from(JSON.stringify({ updatedAt: intent.updatedAt.toISOString(), id: intent.id }), 'utf8').toString('base64url')
}
function decodeReconciliationCursor(raw) {
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'))
    const updatedAt = new Date(parsed.updatedAt)
    if (!parsed.id || Number.isNaN(updatedAt.getTime())) return null
    return { updatedAt, id: parsed.id }
  } catch {
    return null
  }
}

function computeDriftReasons(intent, { proof, walletEntries, latestEvent }) {
  const reasons = []
  if (intent.status === 'SUCCEEDED' && intent.bookingId && !proof) reasons.push('SUCCEEDED_WITHOUT_PAYMENT_PROOF')
  if (intent.status === 'SUCCEEDED' && proof?.status === 'APPROVED') {
    const hasHold = walletEntries.some((e) => e.referenceType === 'booking_payout' && ['HOLD', 'RELEASE'].includes(e.type))
    if (!hasHold) reasons.push('SUCCEEDED_WITHOUT_WALLET_HOLD')
  }
  if (intent.status === 'REFUNDED' && intent.bookingId) {
    const hasReversal = walletEntries.some((e) => e.referenceType === 'booking_admin_share_reversal')
    if (!hasReversal) reasons.push('REFUNDED_WITHOUT_REVERSAL')
  }
  if (latestEvent && !['APPLIED', 'IGNORED'].includes(latestEvent.processingStatus)) reasons.push('LATEST_EVENT_NOT_APPLIED')
  return reasons
}

const RECONCILIATION_WALLET_REFERENCE_TYPES = [
  'booking_payout',
  'booking_admin_share',
  'booking_protection_fee',
  'booking_payout_clawback',
  'booking_admin_share_reversal',
]

async function loadReconciliationContext(intent) {
  const [proof, walletEntries, latestEvent] = await Promise.all([
    intent.bookingId ? db().paymentProof.findFirst({ where: { provider: 'payment_intent', providerRef: intent.reference } }) : null,
    intent.bookingId
      ? db().walletEntry.findMany({
          where: { referenceId: intent.bookingId, referenceType: { in: RECONCILIATION_WALLET_REFERENCE_TYPES } },
          orderBy: { createdAt: 'asc' },
        })
      : [],
    db().paymentEvent.findFirst({ where: { intentId: intent.id }, orderBy: { receivedAt: 'desc' } }),
  ])
  return { proof, walletEntries, latestEvent }
}

// Batched variant for scanning many intents at once (the admin-wide reconciliation listing) — 3
// queries total instead of up to 3 per intent, avoiding an N+1 that would otherwise issue ~600
// sequential round-trips for 200 candidate intents.
async function loadReconciliationContextBatch(intents) {
  const bookingIntents = intents.filter((intent) => intent.bookingId)
  const references = bookingIntents.map((intent) => intent.reference)
  const bookingIds = bookingIntents.map((intent) => intent.bookingId)
  const intentIds = intents.map((intent) => intent.id)

  const [proofs, walletEntries, events] = await Promise.all([
    references.length ? db().paymentProof.findMany({ where: { provider: 'payment_intent', providerRef: { in: references } } }) : [],
    bookingIds.length
      ? db().walletEntry.findMany({
          where: { referenceId: { in: bookingIds }, referenceType: { in: RECONCILIATION_WALLET_REFERENCE_TYPES } },
          orderBy: { createdAt: 'asc' },
        })
      : [],
    intentIds.length ? db().paymentEvent.findMany({ where: { intentId: { in: intentIds } }, orderBy: { receivedAt: 'desc' } }) : [],
  ])

  const proofByRef = new Map(proofs.map((proof) => [proof.providerRef, proof]))
  const walletEntriesByBooking = new Map()
  for (const entry of walletEntries) {
    const list = walletEntriesByBooking.get(entry.referenceId) || []
    list.push(entry)
    walletEntriesByBooking.set(entry.referenceId, list)
  }
  const latestEventByIntent = new Map()
  for (const event of events) {
    // events are ordered desc by receivedAt, so the first one seen per intentId is the latest.
    if (!latestEventByIntent.has(event.intentId)) latestEventByIntent.set(event.intentId, event)
  }

  return new Map(
    intents.map((intent) => [
      intent.id,
      {
        proof: proofByRef.get(intent.reference) || null,
        walletEntries: walletEntriesByBooking.get(intent.bookingId) || [],
        latestEvent: latestEventByIntent.get(intent.id) || null,
      },
    ]),
  )
}

export async function handlePaymentIntents(req, res, url, context) {
  // Server creates the intent with an AUTHORITATIVE amount + currency. The client cannot declare
  // success; status only advances via a verified webhook.
  if (url.pathname === '/api/payments/intents') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requirePaymentIntentsEnabled()
    requireAuth(context)
    const body = await readJson(req)

    let amountMinor
    let currency
    let bookingId
    let division

    if (body.bookingId) {
      // Booking-linked: the guest total is server-derived (expectedTotalMinor, the same function
      // the Stripe/local-wallet rails use), never trusted from the client — and the booking must
      // genuinely belong to this guest and be awaiting payment.
      const booking = await db().booking.findFirst({
        where: { id: body.bookingId, guestId: context.user.id },
        include: { listing: true },
      })
      if (!booking) throw fail(403, 'PAYMENT_INTENT_BOOKING_FORBIDDEN', 'This booking is not available for payment.')
      if (booking.status !== 'PAYMENT_PENDING') throw fail(409, 'PAYMENT_INTENT_BOOKING_NOT_PAYABLE', 'This booking is not awaiting payment.')
      const active = await db().paymentIntent.findFirst({
        where: { bookingId: booking.id, status: { in: ['REQUIRES_PAYMENT', 'PROCESSING'] } },
      })
      if (active) throw fail(409, 'PAYMENT_INTENT_ALREADY_ACTIVE_FOR_BOOKING', 'A payment for this booking is already in progress.')
      amountMinor = expectedTotalMinor(booking)
      currency = String(booking.currency).toLowerCase()
      bookingId = booking.id
      division = booking.listing.division
    } else {
      amountMinor = Math.round(Number(body.amountMinor))
      currency = String(body.currency || '').toLowerCase()
      if (!Number.isFinite(amountMinor) || amountMinor <= 0) throw fail(400, 'PAYMENT_AMOUNT_INVALID', 'Amount must be greater than zero.')
      if (!/^[a-z]{3}$/.test(currency)) throw fail(400, 'PAYMENT_CURRENCY_INVALID', 'A 3-letter currency is required.')
      division = 'PLATFORM'
    }

    authorizePaymentOperation({
      operation: 'create',
      rail: 'payment_intent',
      provider: 'sandbox',
      division,
      country: activePolicyCountryKey(),
      environment: policyEnvironment(),
      actor: { roles: context.roles },
    })

    // A UUID, not a timestamp+amount composite: two concurrent requests from the same user for the
    // same booking (identical amountMinor) can land in the same millisecond under real concurrency
    // (proven empirically — 8 concurrent creates for one booking collided on this field before this
    // fix), which a Date.now()-based reference can't distinguish. Real randomness makes collision
    // astronomically unlikely rather than requiring a catch-and-retry for a race that's cheap to
    // eliminate outright.
    const reference = `pi_${context.user.id.slice(0, 8)}_${randomUUID()}`
    let intent
    try {
      intent = await db().paymentIntent.create({
        data: { userId: context.user.id, reference, amountMinor, currency, status: 'REQUIRES_PAYMENT', bookingId },
      })
    } catch (err) {
      // The app-level `active` check above is a TOCTOU fast-path, not a guarantee — this partial
      // unique index (migration 015) is the real one. A double-click/retry racing past the
      // pre-check lands here instead of silently creating a second simultaneously-active intent.
      if (isActiveBookingIntentViolation(err)) {
        throw fail(409, 'PAYMENT_INTENT_ALREADY_ACTIVE_FOR_BOOKING', 'A payment for this booking is already in progress.')
      }
      throw err
    }
    return json(res, 201, {
      ok: true,
      intent: { id: intent.id, reference: intent.reference, amountMinor: intent.amountMinor, currency: intent.currency, status: intent.status, bookingId: intent.bookingId },
    })
  }

  // Provider webhook — public, authenticated by the signature (NOT a session). Idempotent by
  // canonical identity; a redelivery of an already-APPLIED/IGNORED event is a no-op, a redelivery of
  // a FAILED/RECEIVED/QUARANTINED/POLICY_DEFERRED event retries, and a DEAD_LETTERED event is logged
  // and left for admin replay.
  //
  // Durable-intake ordering, precisely (independent review found the previous version violated this
  // in four ways -- see the corrective commit message): verify signature -> compute payload digest
  // -> authorize webhook_intake -> durably persist/dedupe the RAW authenticated event (before ANY
  // local interpretation) -> THEN interpret event type, resolve the local intent, validate
  // amount/currency -> THEN authorize webhook_apply -> THEN apply. Every one of those interpretation
  // steps can now fail WITHOUT losing the durable record: an unsupported type is marked IGNORED, an
  // unresolvable/conflicting reference or amount/currency mismatch is marked QUARANTINED, a
  // policy-denied apply is marked POLICY_DEFERRED -- never a pre-persistence throw.
  //
  // requirePaymentIntentsEnabled() is NOT called anywhere in this handler -- with the flag off,
  // intake must still succeed, and webhook_apply is already correctly gated by the policy's own
  // gate 5 (isRailEnabled('payment_intent') reads this exact flag) inside the try block below, which
  // — unlike a separate outer call — degrades gracefully to POLICY_DEFERRED instead of a raw 503.
  if (url.pathname === '/api/payments/webhook') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    const raw = await readRawBody(req)
    const event = verifyWebhook(raw, req.headers['stripe-signature'], paymentWebhookSecret())
    const payloadDigest = createHash('sha256').update(raw).digest('hex')

    // webhook_intake is deliberately division-blind: it runs before we've even looked up which
    // intent (and therefore which booking/division) this event is for. An authenticated event must
    // still be durably storable and dedupable even when the rest of the policy would deny — see the
    // design doc's "separate webhook intake from webhook effects" correction.
    authorizePaymentOperation({
      operation: 'webhook_intake',
      rail: 'payment_intent',
      provider: 'sandbox',
      division: 'PLATFORM',
      country: activePolicyCountryKey(),
      environment: policyEnvironment(),
    })

    const obj = event.data?.object || {}
    // The RAW, unvalidated local reference -- stored unconditionally below, before any lookup is
    // attempted, so an unresolvable/malformed reference still leaves a durable trace.
    const providerReference = String(obj.reference || '')

    const { eventRow: intaken, conflict } = await intakeEvent({
      rail: 'payment_intent',
      provider: 'sandbox',
      providerEndpointKey: 'sandbox-test-account',
      environment: policyEnvironment(),
      subjectType: 'PAYMENT_INTENT',
      providerReference,
      providerEventId: event.id,
      type: event.type,
      amountMinor: obj.amount_minor ?? null,
      currency: obj.currency ?? null,
      providerObjectId: obj.id ?? null,
      payloadDigest,
      processingStatus: 'RECEIVED',
    })
    if (conflict) {
      log.warn('payment_webhook_identity_conflict', { eventId: event.id, rail: 'payment_intent' })
      return json(res, 200, { ok: true, conflict: true })
    }
    let eventRow = intaken

    if (['APPLIED', 'IGNORED'].includes(eventRow.processingStatus)) {
      return json(res, 200, { ok: true, applied: false, duplicate: true })
    }
    if (eventRow.processingStatus === 'DEAD_LETTERED') {
      // Don't auto-reprocess a known-broken event on provider redelivery — that needs a human via
      // the admin replay endpoint. Still acknowledge with 200 so the provider stops retrying.
      log.warn('payment_webhook_dead_lettered_redelivery', { eventId: event.id, type: event.type })
      return json(res, 200, { ok: true, applied: false, deadLettered: true })
    }

    // Interpretation, entirely AFTER durable persistence.
    const target = targetStatusFor(event.type)
    if (!target) {
      eventRow = await db().paymentEvent.update({ where: { id: eventRow.id }, data: { processingStatus: 'IGNORED' } })
      return json(res, 200, { ok: true, ignored: event.type })
    }

    const intent = await db().paymentIntent.findUnique({ where: { reference: providerReference } })
    if (!intent) {
      await db().paymentEvent.update({ where: { id: eventRow.id }, data: { processingStatus: 'QUARANTINED', lastError: 'PAYMENT_INTENT_NOT_FOUND' } })
      return json(res, 200, { ok: true, quarantined: true })
    }
    if (eventRow.intentId !== intent.id) {
      // Attach the live FK + permanent snapshot now that resolution has succeeded -- may not have
      // been known at intake time (e.g. a fresh event whose reference just now resolved).
      eventRow = await db().paymentEvent.update({
        where: { id: eventRow.id },
        data: { intentId: intent.id, originalIntentId: intent.id, originalBookingId: intent.bookingId ?? null },
      })
    }

    // Authoritative amount/currency: a webhook claiming a different amount/currency than the
    // server-created intent is quarantined, not applied — the provider event cannot redefine the
    // price, but the authenticated event itself stays durably on record either way.
    if (obj.amount_minor != null && Math.round(Number(obj.amount_minor)) !== intent.amountMinor) {
      await db().paymentEvent.update({ where: { id: eventRow.id }, data: { processingStatus: 'QUARANTINED', lastError: 'PAYMENT_AMOUNT_MISMATCH' } })
      return json(res, 200, { ok: true, quarantined: true })
    }
    if (obj.currency != null && String(obj.currency).toLowerCase() !== intent.currency) {
      await db().paymentEvent.update({ where: { id: eventRow.id }, data: { processingStatus: 'QUARANTINED', lastError: 'PAYMENT_CURRENCY_MISMATCH' } })
      return json(res, 200, { ok: true, quarantined: true })
    }

    // No separate requirePaymentIntentsEnabled() call here (deliberately) -- an earlier version of
    // this fix added one as "defense in depth", matching the admin replay endpoint's own pattern for
    // this flag, but that was a real bug in a different shape: thrown OUTSIDE this try block, it
    // propagated as a raw uncaught 503, bypassing the graceful POLICY_DEFERRED path entirely (caught
    // empirically via tests/e2e/payment-webhook-default-deny.e2e.mjs). Unlike admin replay (an
    // explicit admin action with no "public webhook must degrade gracefully" concern), this route's
    // whole point is that a policy-denied apply still returns 200 and durably preserves the event.
    // authorizePaymentOperation's own gate 5 (isRailEnabled('payment_intent') reads this exact same
    // PAYMENT_INTENTS_ENABLED flag) already gates webhook_apply correctly, inside the try below.
    try {
      authorizePaymentOperation({
        operation: 'webhook_apply',
        rail: 'payment_intent',
        provider: 'sandbox',
        division: await eventDivision(intent),
        country: activePolicyCountryKey(),
        environment: policyEnvironment(),
      })
    } catch (denied) {
      // Durably received, application paused. Zero attempts consumed — this is an intentional
      // policy pause, not a processing failure, so it must not count toward DEAD_LETTER_THRESHOLD.
      // A later redelivery or an explicit reconciliation pass applies it once policy allows.
      log.warn('payment_webhook_apply_denied', { eventId: event.id, intentId: intent.id, reason: denied.reason })
      await db().paymentEvent.update({ where: { id: eventRow.id }, data: { processingStatus: 'POLICY_DEFERRED' } })
      return json(res, 200, { ok: true, applied: false, policyDeferred: true, status: intent.status })
    }

    const result = await applyPaymentEvent({ eventId: eventRow.id, intentId: intent.id, type: event.type, obj })
    return json(res, webhookAcknowledgeStatus(result), { ok: true, ...result })
  }

  // Intent status + auditable event history (owner or admin). Includes a reconciliation view
  // covering the linked booking/payment-proof/wallet state, not just the intent's own status.
  const detail = url.pathname.match(/^\/api\/payments\/intents\/([^/]+)$/)
  if (detail) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)
    const intent = await db().paymentIntent.findUnique({ where: { id: detail[1] }, include: { events: { orderBy: { receivedAt: 'asc' } } } })
    if (!intent) throw fail(404, 'PAYMENT_INTENT_NOT_FOUND', 'Payment intent not found.')
    if (intent.userId !== context.user.id && !context.roles.includes('ADMIN') && !context.roles.includes('SUPPORT')) {
      throw fail(403, 'PAYMENT_INTENT_FORBIDDEN', 'This payment intent is not available for this account.')
    }

    authorizePaymentOperation({
      operation: 'reconciliation_read',
      rail: 'payment_intent',
      provider: 'sandbox',
      division: 'PLATFORM',
      country: activePolicyCountryKey(),
      environment: policyEnvironment(),
      actor: { roles: context.roles },
    })

    const [booking, ctx] = await Promise.all([
      intent.bookingId ? db().booking.findUnique({ where: { id: intent.bookingId }, select: { id: true, status: true } }) : null,
      loadReconciliationContext(intent),
    ])
    const driftReasons = computeDriftReasons(intent, ctx)

    return json(res, 200, {
      ok: true,
      intent,
      booking,
      proof: ctx.proof,
      walletEntries: ctx.walletEntries,
      reconciliation: { reconciled: driftReasons.length === 0, driftReasons },
    })
  }

  // Admin-wide dead-letter queue + drift report: everything a human needs to find and fix a stuck
  // or diverged intent without hunting through individual intent detail pages. Read-only, so it
  // stays available for ops visibility even while PAYMENT_INTENTS_ENABLED is off.
  if (url.pathname === '/api/admin/payment-intents/reconciliation') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    authorizePaymentOperation({
      operation: 'reconciliation_read',
      rail: 'payment_intent',
      provider: 'sandbox',
      division: 'PLATFORM',
      country: activePolicyCountryKey(),
      environment: policyEnvironment(),
      actor: { roles: context.roles },
    })

    // Scoped to this rail only — this is the payment_intent-rail reconciliation view specifically
    // (see its own policy declaration above). stripe_checkout-rail dead-lettered events are equally
    // durable and equally replayable via the same admin replay endpoint by id, but are not yet
    // surfaced in an admin-facing listing of their own — a disclosed, real gap, not silently assumed
    // covered by this query (which would otherwise crash on e.intent being null for that rail).
    //
    // Also surfaces events stuck at APPLYING past their claim expiry (round 7) -- the monitoring
    // surface for the recovery capability applyPaymentEvent()'s claim expiry / the admin replay
    // endpoint's expired-claim eligibility (both in payment-event-pipeline.mjs) provide: this table
    // has no background alerting of any kind, so an admin finding a stuck claim here (instead of
    // discovering it by accident) IS the monitoring for this condition.
    const deadLetteredEvents = await db().paymentEvent.findMany({
      where: {
        rail: 'payment_intent',
        OR: [
          { processingStatus: { in: ['FAILED', 'DEAD_LETTERED'] } },
          { processingStatus: 'APPLYING', claimExpiresAt: { lt: new Date() } },
        ],
      },
      include: { intent: true },
      // Explicit nulls:'last' -- Postgres's own default for DESC is NULLS FIRST, which would let rows
      // with no lastAttemptAt at all (e.g. a stuck-APPLYING row surfaced above whose very first claim
      // attempt hasn't been recorded there yet) silently crowd out genuinely-recent events out of the
      // `take: 25` window. Found as a real, reproducing failure while extending this query.
      orderBy: { lastAttemptAt: { sort: 'desc', nulls: 'last' } },
      take: 25,
    })

    // Scale-readiness audit: this scanned a fixed "most recently updated 200" window with no way
    // to see or reach anything older -- confirmed against the real DB that the eligible population
    // (SUCCEEDED/REFUNDED intents) already sits at ~3,850 rows today, meaning ~95% of real
    // transaction history was silently never re-checked for drift by this view, not a future
    // concern. Real keyset pagination (updatedAt+id, the same tiebreaker shape every other
    // cursor in this codebase uses) now lets a caller walk the ENTIRE population exhaustively
    // across repeated calls, while the no-cursor default call stays cheap (one page, most-recent
    // first, same behavior as before for a normal dashboard load).
    const reconciliationCursor = decodeReconciliationCursor(url.searchParams.get('cursor'))
    const candidateIntents = await db().paymentIntent.findMany({
      where: {
        status: { in: ['SUCCEEDED', 'REFUNDED'] },
        ...(reconciliationCursor
          ? { OR: [
              { updatedAt: { lt: reconciliationCursor.updatedAt } },
              { updatedAt: reconciliationCursor.updatedAt, id: { lt: reconciliationCursor.id } },
            ] }
          : {}),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 201,
    })
    const hasMore = candidateIntents.length > 200
    const pageIntents = hasMore ? candidateIntents.slice(0, 200) : candidateIntents
    const lastIntent = pageIntents[pageIntents.length - 1]
    const nextCursor = hasMore && lastIntent ? encodeReconciliationCursor(lastIntent) : null

    const [contextByIntentId, totalCandidates] = await Promise.all([
      loadReconciliationContextBatch(pageIntents),
      db().paymentIntent.count({ where: { status: { in: ['SUCCEEDED', 'REFUNDED'] } } }),
    ])
    const drifted = []
    for (const intent of pageIntents) {
      const driftReasons = computeDriftReasons(intent, contextByIntentId.get(intent.id))
      if (driftReasons.length) drifted.push({ intentId: intent.id, reference: intent.reference, status: intent.status, bookingId: intent.bookingId, driftReasons })
    }

    return json(res, 200, {
      ok: true,
      // totalCandidates is the full eligible population; this call scanned pageIntents.length of
      // it (200, or fewer on the final page) starting from `cursor` -- an honest signal of scan
      // completeness instead of silently only ever checking the newest slice.
      totalCandidates,
      scannedCount: pageIntents.length,
      nextCursor,
      deadLettered: deadLetteredEvents.map((e) => ({
        eventId: e.id,
        intentId: e.intentId,
        // The linked intent may since have been deleted (ON DELETE SET NULL, migration 017 --
        // deliberately preserves this row rather than cascading it away). e.intent is then null;
        // fall back to the event's own permanent, never-cleared snapshot so a genuinely-orphaned
        // dead-lettered event still shows up here instead of crashing this whole view.
        orphaned: !e.intent,
        reference: e.intent?.reference ?? null,
        bookingId: e.intent?.bookingId ?? e.originalBookingId ?? null,
        originalIntentId: e.originalIntentId,
        type: e.type,
        attempts: e.attempts,
        lastAttemptAt: e.lastAttemptAt,
        lastError: e.lastError,
        processingStatus: e.processingStatus,
        // true for a row surfaced here because of an expired claim (a crashed/killed/disconnected
        // worker), not a genuine FAILED/DEAD_LETTERED outcome -- distinguishes the two causes an
        // admin needs to react to differently.
        stuckClaim: e.processingStatus === 'APPLYING',
        claimExpiresAt: e.claimExpiresAt,
      })),
      drifted,
    })
  }

  // Admin replay of a FAILED/DEAD_LETTERED event — shared across BOTH webhook rails (the durable
  // inbox itself is shared, see migration 016; this is the "one replay pipeline" that goes with it).
  // Trusts the already-persisted, already-verified event snapshot rather than re-verifying a
  // signature — authenticity was established once, at first receipt; replay retries the platform's
  // own previously-authenticated processing of data already at rest, not new untrusted input.
  // Reconstructs a minimal snapshot from the PaymentEvent row itself — no raw payload is ever stored
  // to enable this.
  const replayMatch = url.pathname.match(/^\/api\/admin\/payment-events\/([^/]+)\/replay$/)
  if (replayMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['ADMIN'])

    const eventRow = await db().paymentEvent.findUnique({
      where: { id: replayMatch[1] },
      include: { intent: true, booking: { include: { listing: true } } },
    })
    if (!eventRow) throw fail(404, 'PAYMENT_EVENT_NOT_FOUND', 'Payment event not found.')
    // payment_intent rail keeps its own explicit kill switch as an outer, redundant guard (defense
    // in depth, matching every other route on this rail) — stripe_checkout rail has no equivalent
    // switch of its own; authorizePaymentOperation below is its sole, sufficient gate (and today
    // denies it unconditionally, since 'stripe' has no approved provider configuration yet).
    if (eventRow.rail === 'payment_intent') requirePaymentIntentsEnabled()
    // Also replayable, BOTH rails (round 7 -- round 6 scoped this to payment_intent only): a row stuck
    // at APPLYING whose claim has expired -- a crashed, killed, or disconnected worker that claimed
    // this event and never finished leaves it here forever otherwise, since APPLYING is not itself in
    // applyPaymentEvent()'s CLAIMABLE_STATUSES. This is the human-triggered recovery path for exactly
    // that scenario: applyPaymentEvent()'s own claim query (in payment-event-pipeline.mjs)
    // independently re-checks the expiry and will safely reclaim it -- this check only decides
    // whether the route is willing to ATTEMPT a replay, not whether the claim itself succeeds.
    //
    // Also replayable (round 8): POLICY_DEFERRED, both rails -- independent review found this state
    // had NO recovery path at all (excluded from CLAIMABLE_STATUSES, and admin replay never accepted
    // it), so an authenticated payment received while the rail was disabled could stay permanently
    // unprocessed even after the rail was re-enabled, unless a provider happened to redeliver again
    // (live redelivery is the OTHER, non-admin recovery path -- see CLAIMABLE_STATUSES's own comment).
    // No reconstruction-safety caveat applies here the way it did for the expired-APPLYING case:
    // reaching POLICY_DEFERRED means interpretation already completed cleanly and durably (including
    // stripe_checkout's own stored payment_status) -- no apply attempt, and therefore no possible
    // mid-effect crash, ever happened for this row. The 'replay' operation's own policy gate below
    // (authorizePaymentOperation, a SEPARATE operation type from webhook_apply, with its own
    // independently-configurable enablement) still governs whether THIS admin action is itself
    // authorized -- this only decides whether the row is in a state worth attempting.
    //
    // stripe_checkout rail's admin-replay reconstruction is now safe regardless of when a crash
    // happened too, since migration 022 durably stores the raw, authenticated payment_status at
    // intake time -- closing the exact gap round 6 disclosed (the reconstruction previously had
    // nothing but a guess of 'paid' to fall back on for a row that might have crashed before paid-ness
    // was ever established).
    const hasExpiredClaim = eventRow.processingStatus === 'APPLYING' && eventRow.claimExpiresAt && eventRow.claimExpiresAt < new Date()
    if (!['FAILED', 'DEAD_LETTERED', 'POLICY_DEFERRED'].includes(eventRow.processingStatus) && !hasExpiredClaim) {
      throw fail(409, 'PAYMENT_EVENT_NOT_REPLAYABLE', 'This event is not in a failed/dead-lettered/policy-deferred state, and is not a stuck claim past its expiry.')
    }
    // Defense in depth for the reconstruction below: a stripe_checkout row from before migration 022
    // existed has no durably-stored payment_status. FAILED/DEAD_LETTERED rows from that era are still
    // safe to reconstruct as 'paid' (the same reasoning round 6 relied on: the only path to those
    // statuses is a thrown exception during apply(), which only ever runs past finalizeStripeSession's
    // own early "not paid" return) -- but an APPLYING-past-expiry row with no stored payment_status
    // must never be guessed at; refuse cleanly rather than risk confirming a booking that was never
    // actually paid.
    if (eventRow.rail === 'stripe_checkout' && eventRow.paymentStatus == null && !['FAILED', 'DEAD_LETTERED'].includes(eventRow.processingStatus)) {
      throw fail(409, 'PAYMENT_EVENT_REPLAY_STATUS_UNKNOWN', 'This event predates durable payment_status tracking and cannot be safely replayed automatically.')
    }

    // Orphan guard: the parent this event referenced may have since been deleted (ON DELETE SET
    // NULL, migration 017 — deliberately preserves the event row itself, unlike the CASCADE this
    // replaced). There is nothing legitimate to apply effects to any more — refuse cleanly rather
    // than let eventDivision(null)/a null-id lookup crash with a raw, unaudited exception. The event
    // row's own history (attempts/lastError/processingStatus) and its permanent originalIntentId/
    // originalBookingId snapshot remain fully intact and queryable regardless of this refusal.
    const orphaned = (eventRow.rail === 'payment_intent' && !eventRow.intentId) ||
      (eventRow.rail === 'stripe_checkout' && !eventRow.bookingId)
    if (orphaned) {
      const orphanError = fail(
        409,
        'PAYMENT_EVENT_ORPHANED',
        `The ${eventRow.rail === 'payment_intent' ? 'payment intent' : 'booking'} this event referenced no longer exists; this event cannot be replayed.`,
      )
      await db().adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: 'ADMIN_PAYMENT_EVENT_REPLAYED',
          entityType: 'payment_event',
          entityId: eventRow.id,
          before: { processingStatus: eventRow.processingStatus, attempts: eventRow.attempts },
          after: { processingStatus: eventRow.processingStatus, attempts: eventRow.attempts, refused: 'PAYMENT_EVENT_ORPHANED' },
        },
      })
      throw orphanError
    }

    const division = eventRow.rail === 'payment_intent'
      ? await eventDivision(eventRow.intent)
      : eventRow.booking?.listing?.division || 'PLATFORM'
    const provider = eventRow.rail === 'payment_intent' ? 'sandbox' : 'stripe'

    authorizePaymentOperation({
      operation: 'replay',
      rail: eventRow.rail,
      provider,
      division,
      country: activePolicyCountryKey(),
      environment: policyEnvironment(),
      actor: { roles: context.roles },
    })

    const before = { processingStatus: eventRow.processingStatus, attempts: eventRow.attempts }
    // SEC-002R Class A (finding N4): replay re-runs a real financial application -- PaymentProof
    // approval, wallet HOLD/CREDIT entries, booking confirmation. Authority for this request was
    // established once, in server/index.mjs, before the body was read. This hook re-establishes it
    // inside the rail's OWN apply transaction, immediately after verifyAndLockClaim() and before
    // any effect-producing write, so a revoked admin's replay rolls back with nothing committed.
    // No self-dealing ids are passed: the effects are fully determined by the stored,
    // provider-authenticated event, and the admin supplies no beneficiary of their own choosing.
    const reauthorizeReplay = (tx) => reauthorizeAtCommit(tx, context, {
      action: 'ADMIN_PAYMENT_EVENT_REPLAYED',
      requiredRoles: ['ADMIN'],
    })
    let result
    let replayError
    try {
      if (eventRow.rail === 'payment_intent') {
        result = await applyPaymentEvent({
          eventId: eventRow.id,
          intentId: eventRow.intentId,
          type: eventRow.type,
          obj: { id: eventRow.providerObjectId, amount_minor: eventRow.amountMinor, currency: eventRow.currency },
          beforeEffects: reauthorizeReplay,
          authorizeClaim: reauthorizeReplay,
        })
      } else {
        // payment_status comes from the durably-stored, authenticated value (migration 022) --
        // falling back to 'paid' ONLY for a pre-migration-022 FAILED/DEAD_LETTERED row (the guard
        // above already refused any other case with no stored value): a row only ever reaches
        // FAILED/DEAD_LETTERED via a thrown exception during apply -- the deterministic "session not
        // paid / booking not payable" no-op path marks IGNORED instead (see applyStripeCheckoutEvent),
        // never throws -- so a replayable FAILED/DEAD_LETTERED stripe_checkout row is provably one
        // whose original delivery had payment_status: 'paid', even without the column.
        const paymentStatus = eventRow.paymentStatus ?? 'paid'
        result = await applyPaymentEventPipeline({
          eventId: eventRow.id,
          rail: 'stripe_checkout',
          // SEC-002R round 2 (A8): gate the claim/attempts bookkeeping itself, not only the effects.
          authorizeClaim: reauthorizeReplay,
          apply: (claimToken) => applyStripeCheckoutEvent({
            eventId: eventRow.id,
            session: {
              id: eventRow.providerObjectId,
              payment_status: paymentStatus,
              currency: eventRow.currency,
              metadata: { bookingId: eventRow.bookingId, sypTotalMinor: eventRow.amountMinor },
            },
            claimToken,
            beforeEffects: reauthorizeReplay,
          }),
        })
      }
    } catch (err) {
      replayError = err
    }
    const after = await db().paymentEvent.findUnique({ where: { id: eventRow.id } })
    // Audit-log both success and failure — a failed replay attempt is itself worth a durable record.
    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'ADMIN_PAYMENT_EVENT_REPLAYED',
        entityType: 'payment_event',
        entityId: eventRow.id,
        before,
        after: {
          processingStatus: after.processingStatus,
          attempts: after.attempts,
          // SEC-002R round 2: name the refusal explicitly. With A8's claim gating, a replay refused
          // at the commit boundary leaves processingStatus and attempts EXACTLY as it found them --
          // which is the point, but it also makes the before/after pair alone indistinguishable from
          // "nothing happened". The refusal code is what makes this row readable as a real, refused
          // attempt by a revoked actor rather than a no-op.
          ...(replayError ? { refused: replayError.code || 'REPLAY_FAILED' } : {}),
        },
      },
    })
    if (replayError) throw replayError
    return json(res, 200, { ok: true, result })
  }

  return false
}
