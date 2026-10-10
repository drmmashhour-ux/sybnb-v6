import { createHash } from 'node:crypto'
import Stripe from 'stripe'
import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { expectedTotalMinor, isProviderRefUniqueViolation, sypPerUsd } from '../lib/finance-ledger.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { putObject, signObjectUrl } from '../lib/storage.mjs'
import { authorizePaymentOperation, policyEnvironment, activePolicyCountryKey } from '../lib/payment-policy.mjs'
import { bookingPolicySettings, defaultCurrency, isCurrencyAllowed } from '../lib/country.mjs'
import { checkoutSessionExpiresAtSeconds } from '../lib/booking-policy.mjs'
import { log } from '../lib/logger.mjs'
import { expireUnpaidBookings } from '../lib/booking-lifecycle.mjs'
import { formatMoney, notifyAdmin } from '../lib/notifications.mjs'
import { confirmStripeCheckoutSessionForActor, applyStripeCheckoutEvent } from '../lib/stripe-checkout-apply.mjs'
import { applyPaymentEvent, intakeEvent, webhookAcknowledgeStatus } from '../lib/payment-event-pipeline.mjs'

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null

function requireStripe() {
  // Explicit kill switch: refuse to transact with a LIVE key unless payments are deliberately enabled.
  // 'Off' must be intentional, not merely an unset env var. Test keys stay usable for sandbox/e2e.
  if (process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') && process.env.PAYMENTS_ENABLED !== 'true') {
    const error = new Error('Live payments are not enabled on this server.')
    error.statusCode = 503
    error.code = 'PAYMENTS_DISABLED'
    error.expose = true
    throw error
  }
  if (!stripe) {
    const error = new Error('Stripe is not configured on this server yet.')
    error.statusCode = 503
    error.code = 'STRIPE_NOT_CONFIGURED'
    error.expose = true
    throw error
  }
  return stripe
}

// Translate a DB unique-constraint violation on (provider, provider_ref) into the governed
// duplicate error. This is what closes the TOCTOU race: even if two concurrent submissions both
// pass the app-level pre-check, only one insert can win — the other raises P2002 here.
function paymentReferenceDuplicate() {
  const error = new Error('This transaction reference was already submitted.')
  error.statusCode = 409
  error.code = 'PAYMENT_REFERENCE_DUPLICATE'
  error.expose = true
  return error
}

// expectedTotalMinor and firstAdminId now live in finance-ledger.mjs (shared with the PaymentIntent
// webhook path) so both payment rails derive the guest total and the auto-approval actor from one
// place instead of two copies that can drift.

// A real end-to-end audit found /api/payments/seller-plan-proof (below) had NO server-side price
// check for the advertising plan -- only `amountMinor > 0`, meaning a client could submit any
// positive amount (e.g. 1) for a $49 ad plan and it would be accepted, with the only backstop
// being a human admin manually eyeballing the claimed amount before approving. This catalog is the
// real fix, scoped to the two real advertising plan codes (SellerAdvertisingPaymentPage.tsx):
// known codes must match their real price exactly. Deliberately NOT extended to the generic
// 'plus'/'premium' codes other seller roles also send -- those are used with inconsistent
// historical test amounts across multiple divisions/fixtures with no single real catalog price
// behind them yet; unifying that is separate, larger work than this advertising-specific fix.
// Unknown/uncataloged plan codes fall through unchecked, same fail-open-for-unknown/
// fail-closed-for-known posture as the rest of this file's validation.
const PLAN_PRICE_CATALOG = {
  'advertising-plus': { amountMinor: 1900, currency: 'USD' },
  'advertising-premium': { amountMinor: 4900, currency: 'USD' },
  // Dealer-tier seller plans (CARS / MARKETPLACE / NEW_CONSTRUCTION publishing entitlement).
  // The production seller flow (src/modules/seller/SellerAccountPage.tsx) submits these at a fixed
  // price in USD -- plus $19, premium $49 -- so the server now validates the submitted amount
  // against that real price instead of trusting the client and leaving it for an admin to eyeball.
  // Same fail-closed-for-known posture as the advertising codes above.
  'plus': { amountMinor: 1900, currency: 'USD' },
  'premium': { amountMinor: 4900, currency: 'USD' },
}

// An independent revenue audit found both no-booking/no-ride payment-proof paths below accepted a
// raw client-supplied `currency` string with no validation at all -- proven live: a seller-plan
// proof submitted with currency:"ZZZFAKECOIN" was admin-approvable without incident, creating a
// real Wallet row denominated in a currency nothing else in the platform recognizes (invisible to
// any real SYP/USD reporting), directly contradicting finance-ledger.mjs's own documented
// invariant that every wallet here is SYP-denominated. Fails closed like every other client-input
// validation in this file: an explicit currency must be one the active country actually allows;
// omitting it falls back to the country's real default, same as before.
function resolveClientCurrency(rawCurrency, fallback) {
  if (!rawCurrency) return fallback
  const currency = String(rawCurrency).trim().toUpperCase()
  if (!isCurrencyAllowed(currency)) {
    const error = new Error(`Unsupported currency: ${currency}.`)
    error.statusCode = 400
    error.code = 'PAYMENT_CURRENCY_NOT_ALLOWED'
    error.expose = true
    throw error
  }
  return currency
}

// Some upload flows (seller-plan documents, advertising payment files) genuinely upload several
// real files. Only trust entries that are real object-storage references this server issued
// (payment-proof://...) — never an arbitrary client-supplied string — and cap the count so a
// malformed client can't stuff an unbounded array into the row.
function normalizeProofAssetUrls(body) {
  const raw = Array.isArray(body.proofAssetUrls) ? body.proofAssetUrls : []
  const urls = raw
    .filter((url) => typeof url === 'string' && url.startsWith('payment-proof://'))
    .slice(0, 20)
  if (urls.length) return urls
  return typeof body.proofAssetUrl === 'string' && body.proofAssetUrl.startsWith('payment-proof://')
    ? [body.proofAssetUrl]
    : []
}

// SYP is not a Stripe-supported settlement currency, so test-mode charges run in STRIPE_CURRENCY
// (USD by default) using a configurable placeholder rate. Swap SYP_PER_USD for a live FX feed
// before this ever handles real money.
function stripeChargeAmount(totalMinor) {
  const currency = (process.env.STRIPE_CURRENCY || 'usd').toLowerCase()
  if (currency === 'syp') return { currency, unitAmount: Math.max(100, Math.round(totalMinor)) }
  // Fail closed on real money: a LIVE key must not silently charge real cards using the placeholder
  // FX rate. Test keys keep working against the placeholder for sandbox/e2e.
  if (process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') && !process.env.SYP_PER_USD) {
    const error = new Error('A live FX rate (SYP_PER_USD) is required before charging real cards.')
    error.statusCode = 503
    error.code = 'FX_RATE_NOT_CONFIGURED'
    error.expose = true
    throw error
  }
  const unitAmount = Math.max(50, Math.round((totalMinor / sypPerUsd()) * 100))
  return { currency, unitAmount }
}

export async function handlePayments(req, res, url, context) {
  // Real payment-proof file upload. Previously every payment-proof flow (booking local-wallet,
  // seller-plan, advertising) only ever captured the selected file's NAME on the client and sent a
  // fabricated `session://...` string as proofAssetUrl — no bytes were ever stored, so the manual
  // admin-review safety net that gates real money release had nothing real to review. The
  // 'payment-proof' storage bucket + policy already existed (private, jpeg/png/pdf, 8MB) but was
  // never wired to an HTTP route. This stores the real bytes and returns a stable reference; admin
  // resolves it to a short-lived signed URL on demand via the endpoint below.
  if (url.pathname === '/api/payments/proof-upload') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)
    const body = await readJson(req)
    const stored = await putObject('payment-proof', { base64: body.fileBase64, contentType: body.contentType })
    return json(res, 201, { ok: true, proofAssetUrl: `payment-proof://${stored.key}` })
  }

  // Admin/support resolve a stored proof reference to a short-lived signed URL to actually view it.
  const proofViewMatch = url.pathname.match(/^\/api\/admin\/payment-proof\/([^/]+)\/url$/)
  if (proofViewMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    authorizePaymentOperation({
      operation: 'reconciliation_read',
      rail: 'manual_proof',
      provider: 'manual',
      division: 'PLATFORM',
      country: activePolicyCountryKey(),
      environment: policyEnvironment(),
      actor: { roles: context.roles },
    })
    const url_ = signObjectUrl('payment-proof', proofViewMatch[1], 300)

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'ADMIN_PAYMENT_PROOF_VIEWED',
        entityType: 'payment_proof_file',
        entityId: proofViewMatch[1],
        before: null,
        after: null,
      },
    })

    return json(res, 200, { ok: true, url: url_ })
  }

  if (url.pathname === '/api/payments/stripe/create-checkout-session') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['GUEST'])
    requireStripe()

    const body = await readJson(req)
    const bookingId = String(body.bookingId || '')
    const origin = String(body.origin || '').replace(/\/$/, '')
    if (!bookingId || !origin) {
      const error = new Error('bookingId and origin are required.')
      error.statusCode = 400
      error.code = 'STRIPE_SESSION_INPUT_INVALID'
      error.expose = true
      throw error
    }

    // Decision 6: a request past its unpaid window must not be paid by card either -- expire it
    // first so the PAYMENT_PENDING check below refuses it.
    await expireUnpaidBookings({ id: bookingId, guestId: context.user.id })
    const booking = await db().booking.findFirst({
      where: { id: bookingId, guestId: context.user.id },
      include: { listing: true },
    })
    if (!booking) {
      const error = new Error('This booking is not available for payment.')
      error.statusCode = 403
      error.code = 'PAYMENT_BOOKING_FORBIDDEN'
      error.expose = true
      throw error
    }
    if (booking.status !== 'PAYMENT_PENDING') {
      const error = new Error('This booking is not awaiting payment.')
      error.statusCode = 409
      error.code = 'BOOKING_NOT_PAYABLE'
      error.expose = true
      throw error
    }

    authorizePaymentOperation({
      operation: 'create',
      rail: 'stripe_checkout',
      provider: 'stripe',
      division: booking.listing.division,
      country: activePolicyCountryKey(),
      environment: policyEnvironment(),
      actor: { roles: context.roles },
    })

    // Review fix (MEDIUM): the Checkout session must die no later than the booking's own unpaid
    // deadline (Stripe: between 30 min and 24 h ahead), so a guest cannot pay after the dates were
    // released. Too little time left -> not payable.
    const sessionExpiresAt = checkoutSessionExpiresAtSeconds(booking, { policy: bookingPolicySettings() })
    if (!sessionExpiresAt) {
      const error = new Error('The payment window for this booking is about to close. Please make a new booking request.')
      error.statusCode = 409
      error.code = 'BOOKING_NOT_PAYABLE'
      error.expose = true
      throw error
    }

    const totalMinor = expectedTotalMinor(booking)
    const { currency, unitAmount } = stripeChargeAmount(totalMinor)
    const listingTitle = booking.listing?.titleEn || booking.listing?.titleAr || 'SYBNB stay'

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      expires_at: sessionExpiresAt,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency,
            unit_amount: unitAmount,
            product_data: { name: listingTitle },
          },
          quantity: 1,
        },
      ],
      metadata: {
        bookingId: booking.id,
        guestId: context.user.id,
        sypTotalMinor: String(totalMinor),
      },
      success_url: `${origin}/?session_id={CHECKOUT_SESSION_ID}#/booking/${booking.id}`,
      cancel_url: `${origin}/#/booking/${booking.id}`,
    })

    return json(res, 201, { ok: true, url: session.url, sessionId: session.id })
  }

  if (url.pathname === '/api/payments/stripe/confirm') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['GUEST'])
    requireStripe()

    const body = await readJson(req)
    const sessionId = String(body.sessionId || '')
    if (!sessionId) {
      const error = new Error('sessionId is required.')
      error.statusCode = 400
      error.code = 'STRIPE_CONFIRM_INPUT_INVALID'
      error.expose = true
      throw error
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId)
    if (session.metadata?.guestId !== context.user.id) {
      const error = new Error('This payment session does not belong to this account.')
      error.statusCode = 403
      error.code = 'STRIPE_SESSION_FORBIDDEN'
      error.expose = true
      throw error
    }
    if (session.payment_status !== 'paid') {
      const error = new Error('This card payment has not been captured yet.')
      error.statusCode = 409
      error.code = 'STRIPE_PAYMENT_NOT_CAPTURED'
      error.expose = true
      throw error
    }

    authorizePaymentOperation({
      operation: 'capture',
      rail: 'stripe_checkout',
      provider: 'stripe',
      division: 'PLATFORM',
      country: activePolicyCountryKey(),
      environment: policyEnvironment(),
      actor: { roles: context.roles },
    })

    // SEC-002R round 2, GAP-1. This call creates a PaymentProof and auto-approves it (host HOLD +
    // platform CREDIT + protection fee + booking confirmation) -- Class A, irreversible money
    // movement. Round 1 called finalizeStripeSession(session) with NO options at all, so this rail
    // had no commit-boundary re-authorization whatsoever; independent review found it, and the fact
    // that 'stripe' is absent from APPROVED_PROVIDER_CONFIGS was explicitly rejected as a fix (a
    // configuration flag is not an authorization boundary, and this route is one config change away
    // from live). confirmStripeCheckoutSessionForActor() runs reauthorizeAtCommit() INSIDE
    // finalizeStripeSession's own transaction, before the first effect-producing statement.
    const proof = await confirmStripeCheckoutSessionForActor({ session, context })
    if (proof && proof.status === 'REFUNDED' && proof.bookingId === session.metadata?.bookingId && proof.providerRef === session.id) {
      // The charge landed after the booking stopped awaiting payment: it was recorded and a refund
      // opened (recordCardPaymentForClosedBooking) instead of being applied to the booking.
      const error = new Error('This booking was no longer awaiting payment. Your card payment was recorded and will be refunded.')
      error.statusCode = 409
      error.code = 'BOOKING_NOT_PAYABLE'
      error.expose = true
      throw error
    }
    if (!proof) {
      const error = new Error('Could not confirm this payment against the booking.')
      error.statusCode = 409
      error.code = 'STRIPE_CONFIRM_FAILED'
      error.expose = true
      throw error
    }

    return json(res, 200, { ok: true, proof })
  }

  if (url.pathname === '/api/payments/stripe/webhook') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireStripe()
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      const error = new Error('STRIPE_WEBHOOK_SECRET is not configured.')
      error.statusCode = 503
      error.code = 'STRIPE_WEBHOOK_NOT_CONFIGURED'
      error.expose = true
      throw error
    }

    const chunks = []
    let totalBytes = 0
    for await (const chunk of req) {
      totalBytes += chunk.length
      if (totalBytes > 1_000_000) {
        const error = new Error('Webhook body too large.')
        error.statusCode = 413
        error.code = 'PAYLOAD_TOO_LARGE'
        error.expose = true
        throw error
      }
      chunks.push(chunk)
    }
    const rawBody = Buffer.concat(chunks)

    let event
    try {
      event = stripe.webhooks.constructEvent(rawBody, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)
    } catch {
      // Invalid signature: never persisted, by construction -- nothing below this line executes.
      const error = new Error('Invalid Stripe webhook signature.')
      error.statusCode = 400
      error.code = 'STRIPE_WEBHOOK_INVALID_SIGNATURE'
      error.expose = true
      throw error
    }

    // webhook_intake is deliberately division-blind, same as the payment_intent rail's own intake
    // seam (server/routes/payment-intents.mjs) -- an authenticated event must be durably storable
    // even when the rest of the policy would deny (country rollout off, the rail flag off, an
    // emergency stop). See payment-policy.mjs's INTAKE_EXEMPT_OPERATIONS / RECOGNIZED_WEBHOOK_PROVIDERS.
    authorizePaymentOperation({
      operation: 'webhook_intake',
      rail: 'stripe_checkout',
      provider: 'stripe',
      division: 'PLATFORM',
      country: activePolicyCountryKey(),
      environment: policyEnvironment(),
    })

    const payloadDigest = createHash('sha256').update(rawBody).digest('hex')
    const obj = event.data?.object || {}
    // The RAW, unvalidated local reference -- may be an empty string for an event type this rail
    // doesn't otherwise track (its shape isn't a Checkout Session at all). Stored unconditionally
    // below, before any interpretation, so an unresolvable/malformed/irrelevant event still leaves a
    // durable, authenticated trace.
    const providerReference = String(obj.metadata?.bookingId || '')

    // Durable intake -- this rail's own PaymentEvent row (previously nonexistent entirely; this
    // table could not hold a stripe_checkout event at all before migration 016). Race-safe under
    // concurrent redelivery via the canonical (provider, providerEndpointKey, environment,
    // providerEventId) unique constraint, mirroring payment-intents.mjs exactly.
    const { eventRow: intaken, conflict } = await intakeEvent({
      rail: 'stripe_checkout',
      provider: 'stripe',
      providerEndpointKey: 'stripe-checkout',
      environment: policyEnvironment(),
      subjectType: 'BOOKING',
      providerReference,
      providerEventId: event.id,
      type: event.type,
      amountMinor: obj.metadata?.sypTotalMinor ? Number(obj.metadata.sypTotalMinor) : null,
      currency: obj.currency ?? null,
      providerObjectId: obj.id ?? null,
      // The real, authenticated payment_status -- durably stored so admin replay can reconstruct this
      // session accurately later without guessing (migration 022; see that field's own schema comment).
      paymentStatus: obj.payment_status ?? null,
      payloadDigest,
      processingStatus: 'RECEIVED',
    })
    if (conflict) {
      log.warn('payment_webhook_identity_conflict', { eventId: event.id, rail: 'stripe_checkout' })
      return json(res, 200, { ok: true, conflict: true, received: true })
    }
    let eventRow = intaken

    if (['APPLIED', 'IGNORED'].includes(eventRow.processingStatus)) {
      return json(res, 200, { ok: true, applied: false, duplicate: true, received: true })
    }
    if (eventRow.processingStatus === 'DEAD_LETTERED') {
      // Don't auto-reprocess a known-broken event on provider redelivery -- needs a human via the
      // admin replay endpoint (payment-intents.mjs, generalized to accept either rail). Still
      // acknowledge with 200 so Stripe stops retrying.
      log.warn('payment_webhook_dead_lettered_redelivery', { eventId: event.id, rail: 'stripe_checkout' })
      return json(res, 200, { ok: true, applied: false, deadLettered: true, received: true })
    }

    // Interpretation, entirely AFTER durable persistence.
    if (event.type !== 'checkout.session.completed') {
      // Unrecognized/unhandled event type -- durably recorded above, now marked as a deterministic
      // no-op rather than silently unpersisted (the defect an independent review found: this rail
      // previously returned before ever reaching the durable insert for exactly this case).
      eventRow = await db().paymentEvent.update({ where: { id: eventRow.id }, data: { processingStatus: 'IGNORED' } })
      return json(res, 200, { ok: true, ignored: event.type })
    }

    const session = obj
    // Resolve via the DURABLY STORED reference, not a fresh payload read, so a later redelivery or
    // reconciliation pass always resolves consistently against what was actually authenticated.
    const bookingId = eventRow.providerReference || null
    const bookingRecord = bookingId
      ? await db().booking.findUnique({ where: { id: bookingId }, select: { id: true, listing: { select: { division: true } } } })
      : null
    if (!bookingRecord) {
      await db().paymentEvent.update({ where: { id: eventRow.id }, data: { processingStatus: 'QUARANTINED', lastError: bookingId ? 'BOOKING_NOT_FOUND' : 'BOOKING_REFERENCE_MISSING' } })
      return json(res, 200, { ok: true, quarantined: true, received: true })
    }
    if (eventRow.bookingId !== bookingRecord.id) {
      eventRow = await db().paymentEvent.update({
        where: { id: eventRow.id },
        data: { bookingId: bookingRecord.id, originalBookingId: bookingRecord.id },
      })
    }
    const division = bookingRecord.listing?.division || 'PLATFORM'

    try {
      authorizePaymentOperation({
        operation: 'webhook_apply',
        rail: 'stripe_checkout',
        provider: 'stripe',
        division,
        country: activePolicyCountryKey(),
        environment: policyEnvironment(),
      })
    } catch (denied) {
      if (denied?.code !== 'PAYMENT_POLICY_DENIED') throw denied
      // Durably received, application paused. Zero attempts consumed -- an intentional policy pause,
      // not a processing failure. A later redelivery or an explicit reconciliation pass applies it
      // once policy allows.
      log.warn('payment_webhook_apply_denied', { rail: 'stripe_checkout', eventId: event.id, reason: denied.reason })
      await db().paymentEvent.update({ where: { id: eventRow.id }, data: { processingStatus: 'POLICY_DEFERRED' } })
      return json(res, 200, { ok: true, applied: false, policyDeferred: true, received: true })
    }

    const result = await applyPaymentEvent({
      eventId: eventRow.id,
      rail: 'stripe_checkout',
      apply: (claimToken) => applyStripeCheckoutEvent({ eventId: eventRow.id, session, claimToken }),
    })
    return json(res, webhookAcknowledgeStatus(result), { ok: true, received: true, ...result })
  }

  if (url.pathname === '/api/payments/stripe/status') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    return json(res, 200, {
      ok: true,
      configured: Boolean(stripe),
      currency: (process.env.STRIPE_CURRENCY || 'usd').toLowerCase(),
    })
  }

  if (url.pathname === '/api/payments/seller-plan-proof') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)

    const body = await readJson(req)
    const planCode = body.planCode ? String(body.planCode).trim() : undefined
    const amountMinor = Number(body.amountMinor || 0)
    // platform-sale is the only plan with no upfront fee — SYBNB manages the sale and takes a
    // commission on close instead, so a review request can carry a zero amount for that plan only.
    const isZeroFeePlan = planCode === 'platform-sale'
    if (!Number.isFinite(amountMinor) || amountMinor < 0 || (amountMinor === 0 && !isZeroFeePlan)) {
      const error = new Error('Plan payment amount must be greater than zero.')
      error.statusCode = 400
      error.code = 'PAYMENT_AMOUNT_INVALID'
      error.expose = true
      throw error
    }

    const catalogEntry = planCode ? PLAN_PRICE_CATALOG[planCode] : undefined
    if (catalogEntry) {
      const submittedCurrency = resolveClientCurrency(body.currency, 'USD')
      if (amountMinor !== catalogEntry.amountMinor || submittedCurrency !== catalogEntry.currency) {
        const error = new Error(`Plan '${planCode}' costs ${catalogEntry.amountMinor} ${catalogEntry.currency}; submitted amount does not match.`)
        error.statusCode = 400
        error.code = 'PAYMENT_AMOUNT_MISMATCH'
        error.expose = true
        throw error
      }
    }

    const providerRef = body.providerRef ? String(body.providerRef).trim() : ''
    if (!providerRef) {
      const error = new Error('Transaction reference is required.')
      error.statusCode = 400
      error.code = 'PAYMENT_REFERENCE_REQUIRED'
      error.expose = true
      throw error
    }

    const duplicate = await db().paymentProof.findFirst({
      where: { provider: 'seller_plan', providerRef },
    })
    if (duplicate) {
      const error = new Error('This transaction reference was already submitted.')
      error.statusCode = 409
      error.code = 'PAYMENT_REFERENCE_DUPLICATE'
      error.expose = true
      throw error
    }

    authorizePaymentOperation({
      operation: 'create',
      rail: 'manual_proof',
      provider: 'manual',
      division: 'PLATFORM',
      country: activePolicyCountryKey(),
      environment: policyEnvironment(),
      actor: { roles: context.roles },
    })

    const legalName = body.legalName ? String(body.legalName).trim() : context.user.displayName
    const sellerType = body.sellerType ? String(body.sellerType).trim() : 'owner'

    const proofAssetUrls = normalizeProofAssetUrls(body)
    let proof
    try {
      const [created] = await db().$transaction([
        db().paymentProof.create({
          data: {
            userId: context.user.id,
            provider: 'seller_plan',
            status: 'PENDING_ADMIN_REVIEW',
            amountMinor,
            currency: resolveClientCurrency(body.currency, 'USD'),
            proofAssetUrl: proofAssetUrls[0] || undefined,
            proofAssetUrls,
            providerRef,
            // Durable per-payment record of which plan THIS submission was for -- SellerProfile's
            // own planCode gets overwritten by every new submission, so it can't answer "what was
            // this specific already-reviewed payment for" after the fact.
            planCode,
          },
        }),
        db().sellerProfile.upsert({
          where: { userId: context.user.id },
          create: { userId: context.user.id, legalName, sellerType, planCode, documentStatus: 'PENDING_REVIEW' },
          update: { legalName, sellerType, planCode, documentStatus: 'PENDING_REVIEW' },
        }),
      ])
      proof = created
    } catch (err) {
      if (isProviderRefUniqueViolation(err)) throw paymentReferenceDuplicate()
      throw err
    }

    return json(res, 201, { ok: true, proof })
  }

  if (url.pathname === '/api/payments/local-wallet-proof') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])

    requireAuth(context)
    const body = await readJson(req)
    const booking = body.bookingId
      ? await db().booking.findFirst({
          where: {
            id: body.bookingId,
            guestId: context.user.id,
          },
          include: { listing: true },
        })
      : null

    if (body.bookingId && !booking) {
      const error = new Error('This booking is not available for payment proof upload.')
      error.statusCode = 403
      error.code = 'PAYMENT_BOOKING_FORBIDDEN'
      error.expose = true
      throw error
    }

    // Decision 6 (2026-10-08): a cancelled booking (incl. an unpaid request that expired after the
    // payment window and released its dates) can no longer be paid for -- approving such a proof
    // would resurrect a booking over dates another guest may now hold. A stale request the sweep
    // has not reached yet is expired right here, then refused the same way.
    if (booking && booking.status === 'PAYMENT_PENDING') {
      await expireUnpaidBookings({ id: booking.id })
      const fresh = await db().booking.findUnique({ where: { id: booking.id }, select: { status: true } })
      if (fresh) booking.status = fresh.status
    }
    if (booking && booking.status === 'CANCELLED') {
      const error = new Error('This booking was cancelled (or its payment window expired) and can no longer be paid.')
      error.statusCode = 409
      error.code = 'BOOKING_NOT_PAYABLE'
      error.expose = true
      throw error
    }

    // SR Ride vs. Uber gap-closure: a ride's fare, mirroring the booking case exactly -- only a
    // COMPLETED ride has a final, real fare (mid-ride the distance/time isn't settled yet, matching
    // Uber's own post-trip charge model), and only that ride's own rider may submit proof for it.
    // A CANCELLED ride is also payable, but only when the cancel handler actually assessed a fee
    // (cancellationFeeMinor set) -- a free cancellation (no driver committed yet) has nothing to pay.
    const ride = body.rideId
      ? await db().rideRequest.findFirst({
          where: {
            id: body.rideId,
            riderId: context.user.id,
            OR: [
              { status: 'COMPLETED' },
              { status: 'CANCELLED', cancellationFeeMinor: { not: null } },
            ],
          },
        })
      : null

    if (body.rideId && !ride) {
      const error = new Error('This ride is not available for payment proof upload.')
      error.statusCode = 403
      error.code = 'PAYMENT_RIDE_FORBIDDEN'
      error.expose = true
      throw error
    }

    // Prepaid rides (2026-10-09) were already paid from the rider's wallet at request time and
    // settle automatically on completion — a post-ride proof would double-charge, so it's refused.
    if (ride && ride.metadata && ride.metadata.prepaid) {
      const error = new Error('This ride was prepaid from your wallet; no payment proof is needed.')
      error.statusCode = 409
      error.code = 'RIDE_ALREADY_PREPAID'
      error.expose = true
      throw error
    }

    // When a booking is linked, the real amount due is the full guest total — rent plus cleaning
    // fee, tax, extra fees, and the cancellation-protection add-on if purchased (expectedTotalMinor,
    // the same function the Stripe path uses so both rails charge the identical figure the guest was
    // shown) — never a client-supplied figure (only a floor check existed before, with no ceiling,
    // so a guest could claim an arbitrarily inflated amount) and never bare booking.amountMinor
    // (which is rent only — using it here silently dropped the cleaning/tax/protection portion of
    // every local-wallet payment from the ledger). A linked ride is the same discipline: its own
    // locked fareMinor, never client input. Client input is only used for the no-booking-no-ride case
    // (e.g. a standalone seller-plan/advertising payment), which has no independent amount to check.
    const amountMinor = booking
      ? expectedTotalMinor(booking)
      : ride
        ? (ride.status === 'CANCELLED' ? ride.cancellationFeeMinor : ride.fareMinor) || 0
        : Number(body.amountMinor || 0)
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      const error = new Error('Payment proof amount must be greater than zero.')
      error.statusCode = 400
      error.code = 'PAYMENT_AMOUNT_INVALID'
      error.expose = true
      throw error
    }

    authorizePaymentOperation({
      operation: 'create',
      rail: 'manual_proof',
      provider: 'manual',
      division: booking?.listing?.division || (ride ? 'SR' : 'PLATFORM'),
      country: activePolicyCountryKey(),
      environment: policyEnvironment(),
      actor: { roles: context.roles },
    })

    // #191 (2026-10-10): CASH / paid-to-driver has NO wallet transaction reference. Only a RIDE may be
    // settled in cash (a booking or standalone proof still requires a wallet reference). A cash proof
    // records that the rider paid the driver directly; an operator approves it in the normal review
    // queue, and settlement (finance-ledger.mjs approvePaymentProof cash branch) books ONLY the
    // platform's commission as the driver's debt — the driver is never credited the fare, because they
    // already hold it as physical cash. The operator-approval step is the check that protects a driver
    // from a rider who falsely marks a ride cash-paid.
    const isCashRide = Boolean(ride) && String(body.method || body.paymentMethod || '').trim().toLowerCase() === 'cash'
    const providerRef = body.providerRef ? String(body.providerRef).trim() : ''
    if (!isCashRide && !providerRef) {
      const error = new Error('Syrian wallet transaction reference is required.')
      error.statusCode = 400
      error.code = 'PAYMENT_REFERENCE_REQUIRED'
      error.expose = true
      throw error
    }

    if (!isCashRide) {
      const duplicate = await db().paymentProof.findFirst({
        where: {
          provider: 'syrian_local_wallet',
          providerRef,
        },
      })

      if (duplicate) {
        const error = new Error('This wallet transaction reference was already submitted.')
        error.statusCode = 409
        error.code = 'PAYMENT_REFERENCE_DUPLICATE'
        error.expose = true
        throw error
      }
    }

    if (ride) {
      // A REJECTED proof must not block resubmission -- only a still-live one (awaiting review, or
      // already approved) does. Mirrors the intent of the providerRef uniqueness check above, scoped
      // to this ride instead of a global reference string.
      const existingRideProof = await db().paymentProof.findFirst({
        where: { rideId: ride.id, status: { in: ['PENDING_ADMIN_REVIEW', 'APPROVED'] } },
      })
      if (existingRideProof) {
        const error = new Error('Payment proof was already submitted for this ride.')
        error.statusCode = 409
        error.code = 'PAYMENT_RIDE_ALREADY_SUBMITTED'
        error.expose = true
        throw error
      }
    }

    const walletProofAssetUrls = normalizeProofAssetUrls(body)
    let proof
    try {
      proof = await db().paymentProof.create({
        data: {
          bookingId: booking?.id || undefined,
          rideId: ride?.id || undefined,
          userId: context.user.id,
          provider: isCashRide ? 'cash' : 'syrian_local_wallet',
          status: 'PENDING_ADMIN_REVIEW',
          amountMinor,
          currency: booking?.currency || ride?.currency || resolveClientCurrency(body.currency, defaultCurrency()),
          proofAssetUrl: walletProofAssetUrls[0] || undefined,
          proofAssetUrls: walletProofAssetUrls,
          providerRef: isCashRide ? undefined : providerRef,
        },
      })
    } catch (err) {
      if (isProviderRefUniqueViolation(err)) throw paymentReferenceDuplicate()
      throw err
    }

    if (proof.bookingId) {
      notifyAdmin('admin_payment_proof', { amount: formatMoney(proof.amountMinor, proof.currency), bookingId: proof.bookingId }, `admin_payment_proof:${proof.id}`)
    } else if (proof.rideId) {
      // Fix 2026-10-09: ride fare proofs used to land silently in the review queue (only bookings
      // notified an admin), so on a manual-approval rail a ride could sit unpaid with no signal.
      notifyAdmin('admin_payment_proof', { amount: formatMoney(proof.amountMinor, proof.currency), rideId: proof.rideId }, `admin_payment_proof:${proof.id}`)
    }

    return json(res, 201, { ok: true, proof })
  }

  const paymentMatch = url.pathname.match(/^\/api\/payments\/([^/]+)$/)
  if (paymentMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)
    authorizePaymentOperation({
      operation: 'reconciliation_read',
      rail: 'manual_proof',
      provider: 'manual',
      division: 'PLATFORM',
      country: activePolicyCountryKey(),
      environment: policyEnvironment(),
      actor: { roles: context.roles },
    })
    const proof = await db().paymentProof.findUnique({
      where: { id: paymentMatch[1] },
      include: {
        booking: {
          include: {
            guest: {
              select: {
                id: true,
                displayName: true,
                email: true,
              },
            },
            listing: {
              include: {
                owner: {
                  select: {
                    id: true,
                    displayName: true,
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!proof) {
      const error = new Error('Payment proof not found.')
      error.statusCode = 404
      error.code = 'PAYMENT_NOT_FOUND'
      error.expose = true
      throw error
    }

    const ownerId = proof.booking?.listing?.ownerId
    const guestId = proof.booking?.guestId
    const isAllowed =
      context.roles.includes('ADMIN') ||
      context.roles.includes('SUPPORT') ||
      proof.userId === context.user.id ||
      guestId === context.user.id ||
      ownerId === context.user.id

    if (!isAllowed) {
      const error = new Error('This payment proof is not available for this account.')
      error.statusCode = 403
      error.code = 'PAYMENT_FORBIDDEN'
      error.expose = true
      throw error
    }

    return json(res, 200, { ok: true, proof })
  }

  return false
}
