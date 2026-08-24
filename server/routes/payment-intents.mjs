import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { verifyWebhook, targetStatusFor, canTransition, paymentWebhookSecret } from '../lib/payment-webhook.mjs'
import {
  approvePaymentProof,
  expectedTotalMinor,
  firstAdminId,
  isProviderRefUniqueViolation,
  reverseBookingPlatformShare,
} from '../lib/finance-ledger.mjs'
import { log, errorSummary } from '../lib/logger.mjs'

// After this many failed apply attempts on the same event, stop retrying automatically and mark it
// DEAD_LETTERED — it needs a human via the admin replay endpoint instead of an unbounded retry loop.
// Mirrors the MAX_ATTEMPTS=5 precedent already used for OTP lockout (server/routes/otp.mjs).
const DEAD_LETTER_THRESHOLD = 5

function fail(statusCode, code, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  return error
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

// The single implementation of "apply this event's side effects" — called from BOTH the live
// webhook handler (fresh delivery or provider redelivery) and the admin replay endpoint, so there
// is never a second copy that can drift. Durably records every attempt (even failures) on the
// PaymentEvent row itself, separately from the risky booking/wallet transaction: if that
// transaction fails, Postgres rolls it back entirely, but the attempt/failure record here is a
// plain follow-up statement outside that transaction, so it survives regardless.
async function applyPaymentEvent({ eventId, intentId, type, obj }) {
  const bumped = await db().paymentEvent.update({
    where: { id: eventId },
    data: { attempts: { increment: 1 }, lastAttemptAt: new Date(), processingStatus: 'APPLYING' },
  })
  const target = targetStatusFor(type)
  try {
    const result = await db().$transaction(async (tx) => {
      const fresh = await tx.paymentIntent.findUnique({ where: { id: intentId } })
      if (!fresh) throw fail(404, 'PAYMENT_INTENT_NOT_FOUND', 'No matching payment intent.')

      if (!target || !canTransition(fresh.status, target)) {
        // Deterministic no-op: an illegal/out-of-order transition (e.g. a refund before success, or
        // a second terminal transition) will never succeed no matter how many times it's retried —
        // record it as IGNORED, not FAILED, so it never enters the dead-letter retry path.
        await tx.paymentEvent.update({ where: { id: eventId }, data: { processingStatus: 'IGNORED', appliedAt: new Date() } })
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
          await tx.paymentEvent.update({ where: { id: eventId }, data: { processingStatus: 'IGNORED', appliedAt: new Date() } })
          const current = await tx.paymentIntent.findUnique({ where: { id: intentId } })
          return { applied: false, status: current.status, illegal: true }
        }
        updated = { status: target }
      }
      await tx.paymentEvent.update({
        where: { id: eventId },
        data: { processingStatus: 'APPLIED', appliedAt: new Date(), lastError: null },
      })
      return { applied: true, status: updated.status }
    })
    return result
  } catch (err) {
    if (isProviderRefUniqueViolation(err)) {
      // A concurrent delivery (redelivery of this same event racing itself, or an admin replay
      // overlapping a live redelivery) already created+approved the PaymentProof for this exact
      // intent and committed first — this transaction's own attempt collided with that and rolled
      // back, but the underlying payment WAS genuinely applied, just by the sibling transaction.
      // Mark this delivery APPLIED too (a benign duplicate), not FAILED — otherwise a normal,
      // harmless race would dead-letter a payment that already settled correctly.
      const fresh = await db().paymentIntent.findUnique({ where: { id: intentId } })
      await db().paymentEvent.update({ where: { id: eventId }, data: { processingStatus: 'APPLIED', appliedAt: new Date(), lastError: null } })
      return { applied: false, status: fresh?.status, duplicate: true }
    }
    const dead = bumped.attempts >= DEAD_LETTER_THRESHOLD
    await db()
      .paymentEvent.update({
        where: { id: eventId },
        data: {
          processingStatus: dead ? 'DEAD_LETTERED' : 'FAILED',
          // Pre-sanitized at write time (never the raw error) — a DB column is a permanent record,
          // stronger guarantee needed than key-based log redaction alone.
          lastError: JSON.stringify(errorSummary(err)).slice(0, 2000),
          lastAttemptAt: new Date(),
        },
      })
      .catch((e2) => log.error('payment_event_failure_record_failed', { eventId, err: errorSummary(e2) }))
    log.error('payment_webhook_apply_failed', { eventId, intentId, type, attempts: bumped.attempts, dead, err: errorSummary(err) })
    // Never re-annotate err with a bare statusCode here — handleRouteError (responses.mjs) exposes
    // .message whenever .statusCode is set even without .expose. Re-throwing unannotated lets a
    // genuine infra failure fall through to the safe generic 500.
    throw err
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
    } else {
      amountMinor = Math.round(Number(body.amountMinor))
      currency = String(body.currency || '').toLowerCase()
      if (!Number.isFinite(amountMinor) || amountMinor <= 0) throw fail(400, 'PAYMENT_AMOUNT_INVALID', 'Amount must be greater than zero.')
      if (!/^[a-z]{3}$/.test(currency)) throw fail(400, 'PAYMENT_CURRENCY_INVALID', 'A 3-letter currency is required.')
    }

    const reference = `pi_${context.user.id.slice(0, 8)}_${Date.now()}_${Math.round(amountMinor)}`
    const intent = await db().paymentIntent.create({
      data: { userId: context.user.id, reference, amountMinor, currency, status: 'REQUIRES_PAYMENT', bookingId },
    })
    return json(res, 201, {
      ok: true,
      intent: { id: intent.id, reference: intent.reference, amountMinor: intent.amountMinor, currency: intent.currency, status: intent.status, bookingId: intent.bookingId },
    })
  }

  // Provider webhook — public, authenticated by the signature (NOT a session). Idempotent by event
  // id; a redelivery of an already-APPLIED/IGNORED event is a no-op, a redelivery of a
  // FAILED/RECEIVED event retries, and a DEAD_LETTERED event is logged and left for admin replay.
  if (url.pathname === '/api/payments/webhook') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requirePaymentIntentsEnabled()
    const raw = await readRawBody(req)
    const event = verifyWebhook(raw, req.headers['stripe-signature'], paymentWebhookSecret())
    const obj = event.data?.object || {}
    const target = targetStatusFor(event.type)
    if (!target) return json(res, 200, { ok: true, ignored: event.type }) // unhandled event types are acknowledged, not applied

    const intent = await db().paymentIntent.findUnique({ where: { reference: String(obj.reference || '') } })
    if (!intent) throw fail(404, 'PAYMENT_INTENT_NOT_FOUND', 'No matching payment intent.')

    // Authoritative amount/currency: a webhook claiming a different amount/currency than the
    // server-created intent is rejected — the provider event cannot redefine the price.
    if (obj.amount_minor != null && Math.round(Number(obj.amount_minor)) !== intent.amountMinor) {
      throw fail(400, 'PAYMENT_AMOUNT_MISMATCH', 'Event amount does not match the intent.')
    }
    if (obj.currency != null && String(obj.currency).toLowerCase() !== intent.currency) {
      throw fail(400, 'PAYMENT_CURRENCY_MISMATCH', 'Event currency does not match the intent.')
    }

    // Durable intake — its own statement, deliberately outside the risky apply transaction below,
    // so a delivery is recorded even if applying its side effects later fails and rolls back.
    // Postgres ON CONFLICT makes this atomic under concurrent redelivery.
    const eventRow = await db().paymentEvent.upsert({
      where: { providerEventId: event.id },
      create: {
        intentId: intent.id,
        providerEventId: event.id,
        type: event.type,
        amountMinor: obj.amount_minor ?? null,
        currency: obj.currency ?? null,
        providerObjectId: obj.id ?? null,
        processingStatus: 'RECEIVED',
      },
      update: {},
    })

    if (['APPLIED', 'IGNORED'].includes(eventRow.processingStatus)) {
      return json(res, 200, { ok: true, applied: false, duplicate: true, status: intent.status })
    }
    if (eventRow.processingStatus === 'DEAD_LETTERED') {
      // Don't auto-reprocess a known-broken event on provider redelivery — that needs a human via
      // the admin replay endpoint. Still acknowledge with 200 so the provider stops retrying.
      log.warn('payment_webhook_dead_lettered_redelivery', { eventId: event.id, intentId: intent.id, type: event.type })
      return json(res, 200, { ok: true, applied: false, deadLettered: true, status: intent.status })
    }

    const result = await applyPaymentEvent({ eventId: eventRow.id, intentId: intent.id, type: event.type, obj })
    return json(res, 200, { ok: true, ...result })
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

    const deadLetteredEvents = await db().paymentEvent.findMany({
      where: { processingStatus: { in: ['FAILED', 'DEAD_LETTERED'] } },
      include: { intent: true },
      orderBy: { lastAttemptAt: 'desc' },
      take: 25,
    })

    const candidateIntents = await db().paymentIntent.findMany({
      where: { status: { in: ['SUCCEEDED', 'REFUNDED'] } },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    })
    const contextByIntentId = await loadReconciliationContextBatch(candidateIntents)
    const drifted = []
    for (const intent of candidateIntents) {
      const driftReasons = computeDriftReasons(intent, contextByIntentId.get(intent.id))
      if (driftReasons.length) drifted.push({ intentId: intent.id, reference: intent.reference, status: intent.status, bookingId: intent.bookingId, driftReasons })
    }

    return json(res, 200, {
      ok: true,
      deadLettered: deadLetteredEvents.map((e) => ({
        eventId: e.id,
        intentId: e.intentId,
        reference: e.intent.reference,
        bookingId: e.intent.bookingId,
        type: e.type,
        attempts: e.attempts,
        lastAttemptAt: e.lastAttemptAt,
        lastError: e.lastError,
      })),
      drifted,
    })
  }

  // Admin replay of a FAILED/DEAD_LETTERED event. Trusts the already-persisted, already-verified
  // event snapshot rather than re-verifying a signature — authenticity was established once, at
  // first receipt; replay retries the platform's own previously-authenticated processing of data
  // already at rest, not new untrusted input. Reconstructs the minimal {id, amount, currency}
  // snapshot from the PaymentEvent row itself — no raw payload is ever stored to enable this.
  const replayMatch = url.pathname.match(/^\/api\/admin\/payment-events\/([^/]+)\/replay$/)
  if (replayMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['ADMIN'])
    requirePaymentIntentsEnabled()

    const eventRow = await db().paymentEvent.findUnique({ where: { id: replayMatch[1] } })
    if (!eventRow) throw fail(404, 'PAYMENT_EVENT_NOT_FOUND', 'Payment event not found.')
    if (!['FAILED', 'DEAD_LETTERED'].includes(eventRow.processingStatus)) {
      throw fail(409, 'PAYMENT_EVENT_NOT_REPLAYABLE', 'This event is not in a failed/dead-lettered state.')
    }

    const before = { processingStatus: eventRow.processingStatus, attempts: eventRow.attempts }
    let result
    let replayError
    try {
      result = await applyPaymentEvent({
        eventId: eventRow.id,
        intentId: eventRow.intentId,
        type: eventRow.type,
        obj: { id: eventRow.providerObjectId, amount_minor: eventRow.amountMinor, currency: eventRow.currency },
      })
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
        after: { processingStatus: after.processingStatus, attempts: after.attempts },
      },
    })
    if (replayError) throw replayError
    return json(res, 200, { ok: true, result })
  }

  return false
}
