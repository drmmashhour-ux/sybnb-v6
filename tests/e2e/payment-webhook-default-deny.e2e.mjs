// SYBNB — Default-deny E2E, the exact condition independent review found the prior manual smoke
// test never actually exercised (its own log started the server WITH PAYMENT_INTENTS_ENABLED=true,
// which only proves country/operation policy denial, never the rail flag being off at all).
//
// Proves, over real HTTP against a server started WITHOUT PAYMENT_INTENTS_ENABLED set/true:
//   - webhook intake still returns 200 and durably persists an event (never a 503) — the direct fix
//     for the defect: requirePaymentIntentsEnabled() used to run before signature verification and
//     persistence, so an authenticated webhook was rejected before it was even authenticated;
//   - the persisted event still resolves its real local intent and correctly lands at
//     POLICY_DEFERRED (PAYMENT_INTENTS_ENABLED/operation flags may control webhook_apply — just not
//     intake);
//   - the creation route (POST /api/payments/intents) still correctly 503s — creation stays gated,
//     only intake was ever wrongly gated;
//   - an invalid signature still creates zero rows, flag state notwithstanding.
//
// Run: AUTH_SECRET=<secret> PAYMENT_WEBHOOK_SECRET=<secret> GUEST=<uuid>
//      node tests/e2e/payment-webhook-default-deny.e2e.mjs
//      (server MUST run with PAYMENT_INTENTS_ENABLED unset or explicitly 'false' — the whole point
//      of this suite is that this specific condition was never actually tested before)

import { randomUUID } from 'node:crypto'
import { createSessionToken } from './_session.mjs'
import { signWebhook } from '../../server/lib/payment-webhook.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
const PI_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || 'whsec_sandbox_test'

const guest = { id: process.env.GUEST }
if (!guest.id) {
  console.error('Missing GUEST env')
  process.exit(2)
}
const G = await createSessionToken({ id: guest.id, roles: [{ role: 'GUEST' }] })

let pass = 0
let fail = 0
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`   PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) }
}
async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let j
  try { j = JSON.parse(text) } catch { j = { raw: text } }
  return { status: res.status, j }
}
async function piWebhook(eventObj, { secret = PI_SECRET } = {}) {
  const payload = JSON.stringify(eventObj)
  const res = await fetch(`${API}/api/payments/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signWebhook(payload, secret) },
    body: payload,
  })
  const text = await res.text()
  let j
  try { j = JSON.parse(text) } catch { j = { raw: text } }
  return { status: res.status, j }
}

console.log('=== SETUP: seed a real PaymentIntent directly (bypasses the gated create route on purpose — the route itself is what section 1 below tests) ===')
const intent = await db().paymentIntent.create({
  data: { userId: guest.id, reference: `pi_dd_${randomUUID()}`, amountMinor: 120000, currency: 'syp', status: 'REQUIRES_PAYMENT', provider: 'sandbox' },
})
check('setup: real standalone PaymentIntent seeded', Boolean(intent?.id), JSON.stringify(intent))

console.log('\n=== 1. Creation route still correctly 503s with the flag off (creation stays gated — only intake was ever wrongly gated) ===')
{
  const res = await call('POST', '/api/payments/intents', G, {})
  check('creation is refused with PAYMENT_INTENTS_DISABLED', res.status === 503 && res.j?.error?.code === 'PAYMENT_INTENTS_DISABLED', JSON.stringify(res))
}

console.log('\n=== 2. Webhook intake still succeeds (200, not 503) with the flag off — the core fix ===')
{
  const eventId = `evt_dd_intake_${Date.now()}`
  const evt = { id: eventId, type: 'payment_intent.processing', data: { object: { reference: intent.reference, id: 'pi_prov_dd' } } }
  const before = await db().paymentEvent.count()
  const res = await piWebhook(evt)
  const after = await db().paymentEvent.count()
  check('webhook intake returns 200, not 503 (the flag no longer blocks authentication/intake)', res.status === 200, JSON.stringify(res))
  check('exactly one new PaymentEvent row was durably created', after === before + 1, `${before} -> ${after}`)

  const row = await db().paymentEvent.findFirst({ where: { providerEventId: eventId } })
  check('the persisted row correctly resolved the real local intent (intentId set)', row?.intentId === intent.id, JSON.stringify(row))
  check('the row is POLICY_DEFERRED (application denied by the same flag), not silently applied', row?.processingStatus === 'POLICY_DEFERRED', row?.processingStatus)
  check('the response reflects policyDeferred, not a bare error', res.j?.applied === false && res.j?.policyDeferred === true, JSON.stringify(res))
}

console.log('\n=== 3. Invalid signature still creates zero rows, flag state notwithstanding ===')
{
  const before = await db().paymentEvent.count()
  const payload = JSON.stringify({ id: `evt_dd_bad_${Date.now()}`, type: 'payment_intent.succeeded', data: { object: { reference: intent.reference, id: 'pi_prov_dd_bad' } } })
  const res = await fetch(`${API}/api/payments/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' },
    body: payload,
  })
  const after = await db().paymentEvent.count()
  check('invalid-signature request is still rejected (400)', res.status === 400, res.status)
  check('zero PaymentEvent rows created', before === after, `${before} -> ${after}`)
}

console.log(`\n==== PAYMENT WEBHOOK DEFAULT-DENY (PAYMENT_INTENTS_ENABLED unset/false): ${pass} passed, ${fail} failed ====`)
await disconnectDb()
process.exit(fail ? 1 : 0)
