import Stripe from 'stripe'
import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { approvePaymentProof, CANCELLATION_PROTECTION_RATE, STR_CLEANING_RATE, STR_TAX_RATE } from '../lib/finance-ledger.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { putObject, signObjectUrl } from '../lib/storage.mjs'

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
function isProviderRefUniqueViolation(err) {
  const target = err?.meta?.target
  return err?.code === 'P2002' && (target === 'payment_proofs_provider_provider_ref_key' ||
    (Array.isArray(target) && target.includes('provider_ref')) || String(target || '').includes('provider_ref'))
}

function metadataNumber(metadata, key) {
  const value = metadata?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

// Mirrors src/modules/bookings/guestFeeSummary.ts so the Stripe charge matches what the guest saw.
function expectedTotalMinor(booking) {
  const stayAmountMinor = Math.max(0, Math.round(booking.amountMinor || 0))
  const listingMetadata = booking.listing?.metadata || {}
  const bookingMetadata = booking.metadata || {}
  const isShortStay = !booking.listing || booking.listing.division === 'STAYS'

  const cleaningFeeMinor = metadataNumber(listingMetadata, 'cleaningFeeMinor') || (isShortStay ? Math.round(stayAmountMinor * STR_CLEANING_RATE) : 0)
  const taxesMinor = metadataNumber(listingMetadata, 'taxesMinor') || (isShortStay ? Math.round(stayAmountMinor * STR_TAX_RATE) : 0)
  const extraFeesMinor = metadataNumber(listingMetadata, 'extraFeesMinor')
  const cancellationProtectionPurchased = bookingMetadata.cancellationProtectionPurchased === true
  const cancellationProtectionFeeMinor = cancellationProtectionPurchased
    ? metadataNumber(bookingMetadata, 'cancellationProtectionFeeMinor') || Math.round(stayAmountMinor * CANCELLATION_PROTECTION_RATE)
    : 0

  return stayAmountMinor + cleaningFeeMinor + taxesMinor + extraFeesMinor + cancellationProtectionFeeMinor
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
  const sypPerUsd = Number(process.env.SYP_PER_USD || 15000)
  const unitAmount = Math.max(50, Math.round((totalMinor / sypPerUsd) * 100))
  return { currency, unitAmount }
}

async function firstAdminId(tx) {
  const admin = await tx.userRole.findFirst({ where: { role: 'ADMIN' }, select: { userId: true } })
  return admin?.userId
}

async function finalizeStripeSession(session) {
  const bookingId = session.metadata?.bookingId
  if (!bookingId || session.payment_status !== 'paid') return null

  try {
   return await db().$transaction(async (tx) => {
    const existingProof = await tx.paymentProof.findFirst({
      where: { provider: 'stripe', providerRef: session.id },
    })
    if (existingProof) return existingProof

    const booking = await tx.booking.findUnique({ where: { id: bookingId } })
    if (!booking || booking.status !== 'PAYMENT_PENDING') return null

    const created = await tx.paymentProof.create({
      data: {
        bookingId: booking.id,
        userId: booking.guestId,
        provider: 'stripe',
        status: 'PENDING_ADMIN_REVIEW',
        amountMinor: Number(session.metadata?.sypTotalMinor || booking.amountMinor),
        currency: booking.currency,
        providerRef: session.id,
        proofAssetUrl: session.payment_intent ? `stripe://payment_intents/${session.payment_intent}` : undefined,
      },
    })

    return approvePaymentProof(tx, {
      proofId: created.id,
      actorUserId: await firstAdminId(tx),
      note: 'Auto-approved: Stripe confirmed the card charge was captured.',
    })
   })
  } catch (err) {
    // Concurrent webhook delivery may have finalized first — the unique constraint rejects the
    // second insert; return the already-created proof so finalization stays idempotent.
    if (isProviderRefUniqueViolation(err)) {
      return db().paymentProof.findFirst({ where: { provider: 'stripe', providerRef: session.id } })
    }
    throw err
  }
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
    const url_ = signObjectUrl('payment-proof', proofViewMatch[1], 300)
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

    const totalMinor = expectedTotalMinor(booking)
    const { currency, unitAmount } = stripeChargeAmount(totalMinor)
    const listingTitle = booking.listing?.titleEn || booking.listing?.titleAr || 'SYBNB stay'

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
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

    const proof = await finalizeStripeSession(session)
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
    for await (const chunk of req) chunks.push(chunk)
    const rawBody = Buffer.concat(chunks)

    let event
    try {
      event = stripe.webhooks.constructEvent(rawBody, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)
    } catch {
      const error = new Error('Invalid Stripe webhook signature.')
      error.statusCode = 400
      error.code = 'STRIPE_WEBHOOK_INVALID_SIGNATURE'
      error.expose = true
      throw error
    }

    if (event.type === 'checkout.session.completed') {
      await finalizeStripeSession(event.data.object)
    }

    return json(res, 200, { ok: true, received: true })
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
    const amountMinor = Number(body.amountMinor || 0)
    // platform-sale is the only plan with no upfront fee — SYBNB manages the sale and takes a
    // commission on close instead, so a review request can carry a zero amount for that plan only.
    const isZeroFeePlan = String(body.planCode || '').trim() === 'platform-sale'
    if (!Number.isFinite(amountMinor) || amountMinor < 0 || (amountMinor === 0 && !isZeroFeePlan)) {
      const error = new Error('Plan payment amount must be greater than zero.')
      error.statusCode = 400
      error.code = 'PAYMENT_AMOUNT_INVALID'
      error.expose = true
      throw error
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

    const legalName = body.legalName ? String(body.legalName).trim() : context.user.displayName
    const sellerType = body.sellerType ? String(body.sellerType).trim() : 'owner'
    const planCode = body.planCode ? String(body.planCode).trim() : undefined

    let proof
    try {
      const [created] = await db().$transaction([
        db().paymentProof.create({
          data: {
            userId: context.user.id,
            provider: 'seller_plan',
            status: 'PENDING_ADMIN_REVIEW',
            amountMinor,
            currency: body.currency || 'USD',
            proofAssetUrl: body.proofAssetUrl || undefined,
            providerRef,
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
        })
      : null

    if (body.bookingId && !booking) {
      const error = new Error('This booking is not available for payment proof upload.')
      error.statusCode = 403
      error.code = 'PAYMENT_BOOKING_FORBIDDEN'
      error.expose = true
      throw error
    }

    // When a booking is linked, its amountMinor is the real, server-computed truth — never trust a
    // client-supplied figure here (only a floor check existed before, with no ceiling, so a guest
    // could claim an arbitrarily inflated amountMinor and have it flow straight into the approved
    // payment proof an admin reviews). Client input is only used for the no-booking case (e.g. a
    // standalone seller-plan/advertising payment), which has no independent amount to check against.
    const amountMinor = booking ? booking.amountMinor : Number(body.amountMinor || 0)
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      const error = new Error('Payment proof amount must be greater than zero.')
      error.statusCode = 400
      error.code = 'PAYMENT_AMOUNT_INVALID'
      error.expose = true
      throw error
    }

    const providerRef = body.providerRef ? String(body.providerRef).trim() : ''
    if (!providerRef) {
      const error = new Error('Syrian wallet transaction reference is required.')
      error.statusCode = 400
      error.code = 'PAYMENT_REFERENCE_REQUIRED'
      error.expose = true
      throw error
    }

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

    let proof
    try {
      proof = await db().paymentProof.create({
        data: {
          bookingId: booking?.id || undefined,
          userId: context.user.id,
          provider: 'syrian_local_wallet',
          status: 'PENDING_ADMIN_REVIEW',
          amountMinor,
          currency: booking?.currency || body.currency || 'SYP',
          proofAssetUrl: body.proofAssetUrl || undefined,
          providerRef,
        },
      })
    } catch (err) {
      if (isProviderRefUniqueViolation(err)) throw paymentReferenceDuplicate()
      throw err
    }

    return json(res, 201, { ok: true, proof })
  }

  const paymentMatch = url.pathname.match(/^\/api\/payments\/([^/]+)$/)
  if (paymentMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)
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
