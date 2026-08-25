// SYBNB — Payment Sandbox E2E (governed evidence artifact)
//
// Proves the electronic-payment architecture end-to-end in SANDBOX: server-created intents with
// authoritative amount/currency, a cryptographically verified provider webhook, replay/idempotency,
// state machine, amount/currency rejection, refund, reconciliation, and no double effect. NO real
// money, NO live provider, NO real credentials — signatures are minted with a sandbox test secret.
//
// Run: AUTH_SECRET=<secret> PAYMENT_WEBHOOK_SECRET=<secret> BUYER=<uuid> OTHER=<uuid>
//      node tests/e2e/payment-sandbox.e2e.mjs   (server must run with the SAME PAYMENT_WEBHOOK_SECRET
//      AND with PAYMENT_INTENTS_ENABLED=true — this whole subsystem 503s otherwise. See also
//      tests/e2e/payment-intents-booking.e2e.mjs for the booking/wallet wiring on top of this.)

import { createSessionToken } from '../../server/lib/security.mjs'
import { signWebhook } from '../../server/lib/payment-webhook.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
const SECRET = process.env.PAYMENT_WEBHOOK_SECRET || 'whsec_sandbox_test'
const buyer = { id: process.env.BUYER, roles: [{ role: 'GUEST' }] }
const other = { id: process.env.OTHER, roles: [{ role: 'SELLER' }] }
if (!buyer.id || !other.id) { console.error('Missing BUYER/OTHER env'); process.exit(2) }
const B = createSessionToken(buyer), O = createSessionToken(other)

let pass = 0, fail = 0
async function call(method, path, token, body) {
  const res = await fetch(API + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  let j; const text = await res.text(); try { j = JSON.parse(text) } catch { j = { raw: text } }
  return { status: res.status, j }
}
async function webhook(eventObj, { secret = SECRET, timestamp } = {}) {
  const payload = JSON.stringify(eventObj)
  const res = await fetch(API + '/api/payments/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signWebhook(payload, secret, timestamp) },
    body: payload,
  })
  let j; const t = await res.text(); try { j = JSON.parse(t) } catch { j = { raw: t } }
  return { status: res.status, j }
}
function check(label, cond, detail) { if (cond) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) } }
const code = r => r.j?.error?.code || r.j?.code
let evtSeq = 0
const evt = (type, ref, extra = {}) => ({ id: `evt_${Date.now()}_${evtSeq++}`, type, data: { object: { reference: ref, id: `pi_prov_${evtSeq}`, ...extra } } })

console.log('=== 1. SERVER-CREATED INTENT (authoritative amount/currency) ===')
check('client cannot create a zero/negative-amount intent', code(await call('POST', '/api/payments/intents', B, { amountMinor: 0, currency: 'usd' })) === 'PAYMENT_AMOUNT_INVALID', 'accepted')
check('invalid currency rejected', code(await call('POST', '/api/payments/intents', B, { amountMinor: 1000, currency: 'US' })) === 'PAYMENT_CURRENCY_INVALID', 'accepted')
const created = await call('POST', '/api/payments/intents', B, { amountMinor: 5000, currency: 'usd' })
check('intent created REQUIRES_PAYMENT', created.status === 201 && created.j?.intent?.status === 'REQUIRES_PAYMENT', created.status)
const ref = created.j?.intent?.reference
const intentId = created.j?.intent?.id

console.log('\n=== 2. WEBHOOK AUTHENTICITY (no client can declare success) ===')
check('unsigned webhook rejected', (await fetch(API + '/api/payments/webhook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(evt('payment_intent.succeeded', ref)) })).status >= 400)
check('tampered signature rejected (PAYMENT_SIGNATURE_INVALID)', code(await webhook(evt('payment_intent.succeeded', ref), { secret: 'wrong_secret' })) === 'PAYMENT_SIGNATURE_INVALID', 'accepted')
check('stale timestamp rejected (replay window, PAYMENT_SIGNATURE_EXPIRED)', code(await webhook(evt('payment_intent.succeeded', ref), { timestamp: Math.floor(Date.now() / 1000) - 3600 })) === 'PAYMENT_SIGNATURE_EXPIRED', 'accepted')

console.log('\n=== 3. AMOUNT / CURRENCY AUTHORITY ===')
// Corrective-round behavior: a mismatch no longer throws a pre-persistence 400 -- the authenticated
// event is durably persisted (200) and QUARANTINED instead (see payment-event-identity.e2e.mjs for
// the direct row-level proof of this). Checked here via the response body's `quarantined` flag.
check('wrong amount is durably received but quarantined, not applied', (await webhook(evt('payment_intent.succeeded', ref, { amount_minor: 999999, currency: 'usd' }))).j?.quarantined === true, 'not quarantined')
check('wrong currency is durably received but quarantined, not applied', (await webhook(evt('payment_intent.succeeded', ref, { amount_minor: 5000, currency: 'eur' }))).j?.quarantined === true, 'not quarantined')

console.log('\n=== 4. SUCCESS + IDEMPOTENCY / REPLAY ===')
const succ = evt('payment_intent.succeeded', ref, { amount_minor: 5000, currency: 'usd' })
const s1 = await webhook(succ)
check('valid signed success applies -> SUCCEEDED', s1.status === 200 && s1.j?.applied === true && s1.j?.status === 'SUCCEEDED', JSON.stringify(s1.j))
const s2 = await webhook(succ) // same event id
check('duplicate event id is a no-op (idempotent)', s2.status === 200 && s2.j?.duplicate === true, JSON.stringify(s2.j))
const detail = await call('GET', `/api/payments/intents/${intentId}`, B)
// Corrective-round behavior: section 3's two amount/currency-mismatched events are now ALSO
// durably persisted (QUARANTINED, not silently rejected pre-persistence) -- so the event history
// now correctly has 3 'payment_intent.succeeded'-type rows total (2 quarantined + 1 applied), not 1.
// The real invariant (no double-effect) is that exactly ONE of them ever reached APPLIED.
check(
  'intent is SUCCEEDED with exactly one APPLIED success event (2 earlier quarantined mismatches are durably tracked too, correctly, not applied)',
  detail.j?.intent?.status === 'SUCCEEDED' &&
    detail.j.intent.events.filter(e => e.type === 'payment_intent.succeeded' && e.processingStatus === 'APPLIED').length === 1 &&
    detail.j.intent.events.filter(e => e.type === 'payment_intent.succeeded' && e.processingStatus === 'QUARANTINED').length === 2,
  JSON.stringify(detail.j?.intent?.events?.map(e => ({ type: e.type, status: e.processingStatus }))),
)

console.log('\n=== 5. ILLEGAL TRANSITIONS BLOCKED ===')
check('cannot go SUCCEEDED -> FAILED', (await webhook(evt('payment_intent.payment_failed', ref, { amount_minor: 5000 }))).j?.applied === false, 'applied illegal')

console.log('\n=== 6. REFUND STATE + IDEMPOTENCY ===')
const refund = evt('charge.refunded', ref, { amount_minor: 5000 })
const r1 = await webhook(refund)
check('refund after success -> REFUNDED', r1.j?.applied === true && r1.j?.status === 'REFUNDED', JSON.stringify(r1.j))
const r2 = await webhook(refund)
check('duplicate refund event is a no-op', r2.j?.duplicate === true, JSON.stringify(r2.j))
check('cannot refund twice (REFUNDED is terminal)', (await webhook(evt('charge.refunded', ref, { amount_minor: 5000 }))).j?.applied === false, 'double refund')

console.log('\n=== 7. FAILURE / CANCEL PATHS (separate intents) ===')
const c2 = await call('POST', '/api/payments/intents', B, { amountMinor: 2000, currency: 'usd' })
check('failed webhook -> FAILED', (await webhook(evt('payment_intent.payment_failed', c2.j.intent.reference, { amount_minor: 2000 }))).j?.status === 'FAILED', 'not failed')
const c3 = await call('POST', '/api/payments/intents', B, { amountMinor: 3000, currency: 'usd' })
check('canceled webhook -> CANCELED', (await webhook(evt('payment_intent.canceled', c3.j.intent.reference, { amount_minor: 3000 }))).j?.status === 'CANCELED', 'not canceled')
check('unhandled event type acknowledged, not applied', (await webhook(evt('customer.created', ref))).j?.ignored === 'customer.created', 'not ignored')

console.log('\n=== 8. AUTHORIZATION / ISOLATION + RECONCILIATION ===')
check('other user cannot read this intent (403)', (await call('GET', `/api/payments/intents/${intentId}`, O)).status === 403)
check('unknown intent -> 404', (await call('GET', '/api/payments/intents/11111111-1111-1111-1111-111111111111', B)).status === 404)
check('reconciliation reports local status consistent with latest event', detail.j?.reconciliation?.reconciled === true, JSON.stringify((await call('GET', `/api/payments/intents/${intentId}`, B)).j?.reconciliation))

console.log(`\n==== PAYMENT SANDBOX E2E: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
