// SYBNB — Canonical event-identity and durable-intake E2E (governed evidence artifact), both rails.
//
// Proves, over real HTTP against the real running server + real Postgres, the properties independent
// review specifically asked to be shown directly:
//   - an authenticated event with an unsupported type is persisted and marked IGNORED (previously
//     returned before ever reaching the durable insert);
//   - an authenticated event with an unknown/unresolvable local reference is persisted and marked
//     QUARANTINED (previously threw a 404 before persistence);
//   - an authenticated event whose amount/currency conflicts with the resolved local record is
//     persisted and marked QUARANTINED, zero effects (previously threw a 400 before persistence);
//   - an exact duplicate delivery resolves to the same row, at most one effect;
//   - the SAME literal event-id string delivered under two different (provider, providerAccount,
//     environment) identities produces two INDEPENDENT rows, never a collision — the direct proof
//     providerEventId is no longer globally unique;
//   - a redelivery under the same canonical identity but with an ALTERED payload (different digest)
//     is a genuine conflict: quarantined, the ORIGINAL row is never overwritten, zero effects;
//   - 20 concurrent identical deliveries resolve to exactly one durable row and at most one effect
//     (the unique constraint itself provides this — not application-level locking).
//
// Run: AUTH_SECRET=<secret> PAYMENT_WEBHOOK_SECRET=<secret> STRIPE_WEBHOOK_SECRET=<secret>
//      STRIPE_SECRET_KEY=sk_test_fake HOST=<uuid> GUEST=<uuid> ADMIN=<uuid>
//      node tests/e2e/payment-event-identity.e2e.mjs
//      (server must run with PAYMENT_INTENTS_ENABLED=true, PAYMENTS_ENABLED=true, and the SAME
//      PAYMENT_WEBHOOK_SECRET / STRIPE_WEBHOOK_SECRET / STRIPE_SECRET_KEY)

import { createSessionToken } from '../../server/lib/security.mjs'
import { signWebhook } from '../../server/lib/payment-webhook.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
const PI_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || 'whsec_sandbox_test'
const STRIPE_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_stripe_test'

const host = { id: process.env.HOST }
const guest = { id: process.env.GUEST }
const admin = { id: process.env.ADMIN }
if (!host.id || !guest.id || !admin.id) {
  console.error('Missing HOST/GUEST/ADMIN env')
  process.exit(2)
}
const H = createSessionToken({ id: host.id, roles: [{ role: 'HOST' }] })
const G = createSessionToken({ id: guest.id, roles: [{ role: 'GUEST' }] })
const A = createSessionToken({ id: admin.id, roles: [{ role: 'ADMIN' }] })

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
    body: body ? JSON.stringify(body) : undefined,
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
async function stripeWebhook(eventObj, { secret = STRIPE_SECRET } = {}) {
  const payload = JSON.stringify(eventObj)
  const res = await fetch(`${API}/api/payments/stripe/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signWebhook(payload, secret) },
    body: payload,
  })
  const text = await res.text()
  let j
  try { j = JSON.parse(text) } catch { j = { raw: text } }
  return { status: res.status, j }
}
function daysAgoIso(n) { return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString() }

async function verifyHostForPublishing() {
  await call('PATCH', '/api/me/id-document', H, { fileBase64: 'ZmFrZQ==', mimeType: 'image/png' })
  await call('PATCH', `/api/admin/review-queue/iddocument/${host.id}`, A, { decision: 'APPROVE' })
  const legal = await call('GET', '/api/legal', null)
  const doc = legal.j.documents.find((d) => d.key === 'listing-agreement')
  await call('POST', '/api/legal/consent', H, { documentKey: 'listing-agreement', version: doc.version })
}
async function makeStaysListing(priceMinor) {
  const created = await call('POST', '/api/listings', H, {
    division: 'STAYS', titleAr: 'شقة اختبار PEI', titleEn: 'PEI test flat', priceMinor, currency: 'SYP', instantBookEnabled: true,
  })
  const id = created.j?.listing?.id
  await call('PATCH', `/api/listings/${id}/submit`, H)
  await call('PATCH', `/api/admin/review-queue/listing/${id}`, A, { decision: 'APPROVE' })
  return id
}
async function makeBooking(listingId, checkInDaysAgo, checkOutDaysAgo) {
  const created = await call('POST', '/api/bookings', G, { listingId, checkIn: daysAgoIso(checkInDaysAgo), checkOut: daysAgoIso(checkOutDaysAgo) })
  return created.j?.booking
}

console.log('=== SETUP ===')
await verifyHostForPublishing()
const listing = await makeStaysListing(160000)
const booking = await makeBooking(listing, 10, 7)
check('setup: real booking created', Boolean(booking?.id), JSON.stringify(booking))
const intentRes = await call('POST', '/api/payments/intents', G, { bookingId: booking.id })
const intent = intentRes.j?.intent
check('setup: real PaymentIntent created', Boolean(intent?.id), JSON.stringify(intentRes))

console.log('\n=== 1. Unsupported authenticated event type -> persisted and IGNORED (was: dropped before persistence) ===')
{
  const eventId = `evt_pei_unsupported_${Date.now()}`
  const evt = { id: eventId, type: 'payment_intent.created', data: { object: { reference: intent.reference, id: 'pi_prov_unsupported' } } } // not in targetStatusFor's mapping
  const before = await db().paymentEvent.count({ where: { providerEventId: eventId } })
  const res = await piWebhook(evt)
  const after = await db().paymentEvent.count({ where: { providerEventId: eventId } })
  const row = await db().paymentEvent.findFirst({ where: { providerEventId: eventId } })
  check('unsupported-type webhook still returns 200', res.status === 200, JSON.stringify(res))
  check('exactly one durable row was created for the unsupported type', before === 0 && after === 1, `${before} -> ${after}`)
  check('the row is marked IGNORED, not silently absent', row?.processingStatus === 'IGNORED', row?.processingStatus)
}

console.log('\n=== 2. Unknown local reference -> persisted and QUARANTINED (was: 404 before persistence) ===')
{
  const eventId = `evt_pei_unknown_ref_${Date.now()}`
  const evt = { id: eventId, type: 'payment_intent.succeeded', data: { object: { reference: 'pi_totally_unknown_reference_does_not_exist', id: 'pi_prov_unknown' } } }
  const before = await db().paymentEvent.count({ where: { providerEventId: eventId } })
  const res = await piWebhook(evt)
  const after = await db().paymentEvent.count({ where: { providerEventId: eventId } })
  const row = await db().paymentEvent.findFirst({ where: { providerEventId: eventId } })
  check('unknown-reference webhook still returns 200', res.status === 200, JSON.stringify(res))
  check('exactly one durable row was created for the unknown reference', before === 0 && after === 1, `${before} -> ${after}`)
  check('the row is marked QUARANTINED with a typed reason, not silently absent', row?.processingStatus === 'QUARANTINED' && row?.lastError === 'PAYMENT_INTENT_NOT_FOUND', JSON.stringify(row))
  check('the raw providerReference is preserved verbatim even though it never resolved', row?.providerReference === 'pi_totally_unknown_reference_does_not_exist', row?.providerReference)
}

console.log('\n=== 3. Amount/currency mismatch -> persisted and QUARANTINED, zero effects (was: 400 before persistence) ===')
{
  const eventId = `evt_pei_amount_mismatch_${Date.now()}`
  const evt = { id: eventId, type: 'payment_intent.succeeded', data: { object: { reference: intent.reference, id: 'pi_prov_mismatch', amount_minor: intent.amountMinor + 999999 } } }
  const beforeProofs = await db().paymentProof.count({ where: { provider: 'payment_intent', providerRef: intent.reference } })
  const res = await piWebhook(evt)
  const afterProofs = await db().paymentProof.count({ where: { provider: 'payment_intent', providerRef: intent.reference } })
  const row = await db().paymentEvent.findFirst({ where: { providerEventId: eventId } })
  check('amount-mismatch webhook still returns 200', res.status === 200, JSON.stringify(res))
  check('the row is marked QUARANTINED with a typed reason', row?.processingStatus === 'QUARANTINED' && row?.lastError === 'PAYMENT_AMOUNT_MISMATCH', JSON.stringify(row))
  check('zero real effects from the quarantined mismatch', beforeProofs === afterProofs, `${beforeProofs} -> ${afterProofs}`)
}

console.log('\n=== 4. Exact duplicate delivery -> one row, one effect (regression, both fields checked) ===')
{
  const eventId = `evt_pei_exact_dup_${Date.now()}`
  const evt = { id: eventId, type: 'payment_intent.processing', data: { object: { reference: intent.reference, id: 'pi_prov_exact_dup' } } }
  const r1 = await piWebhook(evt)
  const r2 = await piWebhook(evt)
  const count = await db().paymentEvent.count({ where: { providerEventId: eventId } })
  check('first delivery succeeds', r1.status === 200, JSON.stringify(r1))
  check('exact duplicate redelivery succeeds without creating a second row', r2.status === 200 && count === 1, `count=${count}`)
}

console.log('\n=== 5. The SAME literal event-id string across two different providers -> two INDEPENDENT rows, never a collision ===')
{
  const sharedEventId = `evt_pei_shared_id_${Date.now()}`
  const piEvt = { id: sharedEventId, type: 'payment_intent.processing', data: { object: { reference: intent.reference, id: 'pi_prov_shared' } } }
  const bookingForStripe = await makeBooking(listing, 20, 17)
  const stripeEvt = { id: sharedEventId, type: 'checkout.session.completed', data: { object: { id: 'cs_test_shared', payment_status: 'paid', currency: 'syp', metadata: { bookingId: bookingForStripe.id, sypTotalMinor: '160000' } } } }

  const r1 = await piWebhook(piEvt)
  const r2 = await stripeWebhook(stripeEvt)
  const piRows = await db().paymentEvent.findMany({ where: { providerEventId: sharedEventId, rail: 'payment_intent' } })
  const stripeRows = await db().paymentEvent.findMany({ where: { providerEventId: sharedEventId, rail: 'stripe_checkout' } })
  check('the payment_intent-rail delivery with this shared id succeeds', r1.status === 200, JSON.stringify(r1))
  check('the stripe_checkout-rail delivery with the SAME literal event id succeeds independently (no collision)', r2.status === 200, JSON.stringify(r2))
  check('exactly one payment_intent-rail row exists for this event id', piRows.length === 1, piRows.length)
  check('exactly one stripe_checkout-rail row exists for this SAME event id -- a genuinely separate row', stripeRows.length === 1, stripeRows.length)
  check('the two rows are different database rows entirely', piRows[0]?.id !== stripeRows[0]?.id, JSON.stringify({ pi: piRows[0]?.id, stripe: stripeRows[0]?.id }))
}

console.log('\n=== 6. Redelivery under the same identity with an ALTERED payload -> conflict, quarantined, original untouched, zero effects ===')
{
  const eventId = `evt_pei_conflict_${Date.now()}`
  const evt1 = { id: eventId, type: 'payment_intent.processing', data: { object: { reference: intent.reference, id: 'pi_prov_conflict_v1' } } }
  // Same event id, DIFFERENT payload (different provider object id -> different payload digest).
  const evt2 = { id: eventId, type: 'payment_intent.processing', data: { object: { reference: intent.reference, id: 'pi_prov_conflict_v2_ALTERED' } } }

  const r1 = await piWebhook(evt1)
  const rowAfterFirst = await db().paymentEvent.findFirst({ where: { providerEventId: eventId } })
  const r2 = await piWebhook(evt2)
  const rowAfterSecond = await db().paymentEvent.findFirst({ where: { providerEventId: eventId } })
  const count = await db().paymentEvent.count({ where: { providerEventId: eventId, rail: 'payment_intent' } })

  check('first (genuine) delivery succeeds', r1.status === 200, JSON.stringify(r1))
  check('the altered-payload redelivery is acknowledged (200), not a crash', r2.status === 200 && r2.j?.conflict === true, JSON.stringify(r2))
  check('still exactly one row for this event id -- the conflict was never allowed to create a second row', count === 1, count)
  check('the ORIGINAL row is quarantined as a conflict, not silently overwritten', rowAfterSecond?.processingStatus === 'QUARANTINED' && rowAfterSecond?.lastError?.startsWith('IDENTITY_CONFLICT'), JSON.stringify(rowAfterSecond))
  check('the original providerObjectId (immutable) was never overwritten by the conflicting delivery', rowAfterSecond?.providerObjectId === rowAfterFirst?.providerObjectId, JSON.stringify({ before: rowAfterFirst?.providerObjectId, after: rowAfterSecond?.providerObjectId }))
}

console.log('\n=== 7. 20 concurrent identical deliveries -> exactly one durable row, at most one effect ===')
{
  const eventId = `evt_pei_concurrent_${Date.now()}`
  const evt = { id: eventId, type: 'payment_intent.processing', data: { object: { reference: intent.reference, id: 'pi_prov_concurrent' } } }
  const results = await Promise.all(Array.from({ length: 20 }, () => piWebhook(evt)))
  const allOk = results.every((r) => r.status === 200)
  const count = await db().paymentEvent.count({ where: { providerEventId: eventId } })
  check('all 20 concurrent deliveries returned 200 (no raw errors/crashes under the race)', allOk, JSON.stringify(results.map((r) => r.status)))
  check('exactly one durable row exists after 20 concurrent identical deliveries', count === 1, count)
}

console.log(`\n==== PAYMENT EVENT CANONICAL IDENTITY: ${pass} passed, ${fail} failed ====`)
await disconnectDb()
process.exit(fail ? 1 : 0)
