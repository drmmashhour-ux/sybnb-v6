import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { verifyWebhook, targetStatusFor, canTransition, paymentWebhookSecret } from '../lib/payment-webhook.mjs'

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

export async function handlePaymentIntents(req, res, url, context) {
  // Server creates the intent with an AUTHORITATIVE amount + currency. The client cannot declare
  // success; status only advances via a verified webhook.
  if (url.pathname === '/api/payments/intents') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)
    const body = await readJson(req)
    const amountMinor = Math.round(Number(body.amountMinor))
    const currency = String(body.currency || '').toLowerCase()
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) throw fail(400, 'PAYMENT_AMOUNT_INVALID', 'Amount must be greater than zero.')
    if (!/^[a-z]{3}$/.test(currency)) throw fail(400, 'PAYMENT_CURRENCY_INVALID', 'A 3-letter currency is required.')
    const reference = `pi_${context.user.id.slice(0, 8)}_${Date.now()}_${Math.round(amountMinor)}`
    const intent = await db().paymentIntent.create({
      data: { userId: context.user.id, reference, amountMinor, currency, status: 'REQUIRES_PAYMENT', bookingId: body.bookingId || undefined },
    })
    return json(res, 201, { ok: true, intent: { id: intent.id, reference: intent.reference, amountMinor: intent.amountMinor, currency: intent.currency, status: intent.status } })
  }

  // Provider webhook — public, authenticated by the signature (NOT a session). Idempotent by event id.
  if (url.pathname === '/api/payments/webhook') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
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

    const result = await db().$transaction(async (tx) => {
      // Idempotency/replay: the unique provider_event_id makes a duplicate delivery a no-op.
      const already = await tx.paymentEvent.findUnique({ where: { providerEventId: event.id } })
      if (already) return { applied: false, status: intent.status, duplicate: true }

      const fresh = await tx.paymentIntent.findUnique({ where: { id: intent.id } })
      if (!canTransition(fresh.status, target)) {
        // Record the event for audit, but do not apply an illegal transition (e.g. refund before
        // success, or a second terminal transition).
        await tx.paymentEvent.create({ data: { intentId: intent.id, providerEventId: event.id, type: event.type, amountMinor: obj.amount_minor ?? null, currency: obj.currency ?? null } })
        return { applied: false, status: fresh.status, illegal: true }
      }
      await tx.paymentEvent.create({ data: { intentId: intent.id, providerEventId: event.id, type: event.type, amountMinor: obj.amount_minor ?? null, currency: obj.currency ?? null } })
      const updated = await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: target, providerRef: obj.id || fresh.providerRef } })
      return { applied: true, status: updated.status }
    })

    return json(res, 200, { ok: true, ...result })
  }

  // Intent status + auditable event history (owner or admin). Includes a reconciliation view.
  const detail = url.pathname.match(/^\/api\/payments\/intents\/([^/]+)$/)
  if (detail) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)
    const intent = await db().paymentIntent.findUnique({ where: { id: detail[1] }, include: { events: { orderBy: { receivedAt: 'asc' } } } })
    if (!intent) throw fail(404, 'PAYMENT_INTENT_NOT_FOUND', 'Payment intent not found.')
    if (intent.userId !== context.user.id && !context.roles.includes('ADMIN') && !context.roles.includes('SUPPORT')) {
      throw fail(403, 'PAYMENT_INTENT_FORBIDDEN', 'This payment intent is not available for this account.')
    }
    // Reconciliation: the current status should equal the target implied by the latest applied
    // event. Any divergence is flagged for operator follow-up (provider-vs-local disagreement).
    const applied = intent.events.map((e) => ({ type: e.type, target: targetStatusFor(e.type) })).filter((e) => e.target)
    const latest = applied[applied.length - 1]
    const reconciled = !latest || latest.target === intent.status
    return json(res, 200, { ok: true, intent, reconciliation: { reconciled, latestEventTarget: latest?.target || null, localStatus: intent.status } })
  }

  return false
}
