// SYBNB — Destructive-parent regression E2E (governed evidence artifact), BOTH rails.
//
// Migration 016 gave payment_events.intent_id a real onDelete: Cascade (inherited unchanged from
// before that migration) and the Prisma schema declared the same (wrong) Cascade for the new
// booking_id relation — independent review correctly found this: a durable financial webhook inbox
// must not disappear when its parent Booking/PaymentIntent is deleted. Migration 017 fixes both
// relations to ON DELETE SET NULL and adds permanent, non-FK snapshot columns (originalIntentId/
// originalBookingId/provider/providerEndpointKey/environment/subjectType) that are never cleared by any
// deletion. This file proves that fix directly against a real database — a real DELETE, not a
// simulation — for both rails, plus the specific "cannot apply to an unrelated/gone record" and
// "orphan replay fails safely and is still audited" properties the review asked to be shown.
//
// Run: AUTH_SECRET=<secret> PAYMENT_WEBHOOK_SECRET=<secret> STRIPE_WEBHOOK_SECRET=<secret>
//      STRIPE_SECRET_KEY=sk_test_fake HOST=<uuid> GUEST=<uuid> ADMIN=<uuid>
//      node tests/e2e/payment-event-durability.e2e.mjs
//      (server must run with PAYMENT_INTENTS_ENABLED=true, PAYMENTS_ENABLED=true, and the SAME
//      PAYMENT_WEBHOOK_SECRET / STRIPE_WEBHOOK_SECRET / STRIPE_SECRET_KEY)

import { randomUUID } from 'node:crypto'
import { createSessionToken } from '../../server/lib/security.mjs'
import { signWebhook } from '../../server/lib/payment-webhook.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'
import { intakeEvent } from '../../server/lib/payment-event-pipeline.mjs'

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
    division: 'STAYS', titleAr: 'شقة اختبار PED', titleEn: 'PED test flat', priceMinor, currency: 'SYP', instantBookEnabled: true,
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
const listing = await makeStaysListing(180000)
const bookingA = await makeBooking(listing, 10, 7) // payment_intent rail scenario
const bookingB = await makeBooking(listing, 20, 17) // stripe_checkout rail scenario
check('setup: two real bookings created', Boolean(bookingA?.id) && Boolean(bookingB?.id), JSON.stringify({ bookingA, bookingB }))

const intentRes = await call('POST', '/api/payments/intents', G, { bookingId: bookingA.id })
const intentA = intentRes.j?.intent
check('setup: real PaymentIntent created for booking A', Boolean(intentA?.id), JSON.stringify(intentRes))

console.log('\n=== A. PAYMENT_INTENT RAIL — deleting the linked PaymentIntent must not delete its PaymentEvent ===')
{
  // Seed a synthetic DEAD_LETTERED event directly (avoids going through a real apply, which would
  // create a PaymentProof FK-linked to the booking and complicate a clean delete below -- the point
  // here is event-row survival, not re-testing application, which other suites already cover).
  const seededEventId = `evt_ped_dl_${Date.now()}`
  const seedFields = {
    rail: 'payment_intent', provider: 'sandbox', providerEndpointKey: 'sandbox-test-account',
    environment: 'test', subjectType: 'PAYMENT_INTENT', providerReference: intentA.reference,
    providerEventId: seededEventId, type: 'payment_intent.succeeded',
    amountMinor: intentA.amountMinor, currency: intentA.currency,
    providerObjectId: `pi_prov_ped_${Date.now()}`, payloadDigest: 'synthetic-digest-for-test',
  }
  const seeded = await db().paymentEvent.create({
    data: {
      ...seedFields,
      intentId: intentA.id, originalIntentId: intentA.id, originalBookingId: bookingA.id,
      processingStatus: 'DEAD_LETTERED', attempts: 3, lastError: 'synthetic seed for destructive-parent test',
    },
  })

  const before = { intentId: seeded.intentId, originalIntentId: seeded.originalIntentId, originalBookingId: seeded.originalBookingId, providerEventId: seeded.providerEventId, processingStatus: seeded.processingStatus, attempts: seeded.attempts, lastError: seeded.lastError }

  await db().paymentIntent.delete({ where: { id: intentA.id } })

  const after = await db().paymentEvent.findUnique({ where: { id: seeded.id } })
  check('the PaymentEvent row still exists after its PaymentIntent is deleted', Boolean(after), 'row is gone -- CASCADE still in effect')
  check('the live intentId FK is cleared to null (SET NULL, not silently left dangling)', after?.intentId === null, after?.intentId)
  check('originalIntentId (permanent snapshot) is UNCHANGED', after?.originalIntentId === before.originalIntentId, `${before.originalIntentId} -> ${after?.originalIntentId}`)
  check('originalBookingId (permanent snapshot) is UNCHANGED', after?.originalBookingId === before.originalBookingId, `${before.originalBookingId} -> ${after?.originalBookingId}`)
  check('providerEventId is UNCHANGED (identity survives)', after?.providerEventId === before.providerEventId, `${before.providerEventId} -> ${after?.providerEventId}`)
  check('dead-letter history survives: processingStatus unchanged', after?.processingStatus === before.processingStatus, after?.processingStatus)
  check('dead-letter history survives: attempts unchanged', after?.attempts === before.attempts, after?.attempts)
  check('dead-letter history survives: lastError unchanged', after?.lastError === before.lastError, after?.lastError)

  // Queryable/reconcilable: fetch it back by its natural identity, not just by internal id.
  // providerEventId is no longer independently unique (migration 018 — canonical identity is now
  // (provider, providerEndpointKey, environment, providerEventId)), so this uses findFirst.
  const byProviderEventId = await db().paymentEvent.findFirst({ where: { providerEventId: seededEventId } })
  check('the orphaned event remains queryable by providerEventId', byProviderEventId?.id === seeded.id, JSON.stringify(byProviderEventId))

  // Duplicate-delivery dedup still resolves to the SAME row, even orphaned -- proven at the exact
  // mechanism both webhook routes now share (intakeEvent's create-then-catch-P2002-then-compare
  // pattern), not re-derived from HTTP (a live redelivery for this specific rail would 404 earlier,
  // at the now-gone intent's reference lookup -- a separate, expected, unrelated behavior; this
  // proves the DEDUP mechanism itself, with immutable fields matching -> an ordinary duplicate).
  const dup = await intakeEvent(seedFields)
  check('a duplicate intake on the same canonical identity resolves to the SAME orphaned row, not a new one', dup.eventRow.id === seeded.id, `${seeded.id} vs ${dup.eventRow.id}`)
  check('the duplicate intake is recognized as an ordinary match, not a conflict (immutable fields identical)', dup.conflict === false, JSON.stringify(dup))
  check('the duplicate intake did not corrupt the dead-letter history', dup.eventRow.attempts === before.attempts && dup.eventRow.lastError === before.lastError, JSON.stringify(dup.eventRow))

  // Orphan replay: must fail SAFELY (a governed error, not a raw crash) and remain audited.
  const auditCountBefore = await db().adminAuditLog.count({ where: { entityType: 'payment_event', entityId: seeded.id } })
  const replayRes = await call('POST', `/api/admin/payment-events/${seeded.id}/replay`, A, {})
  const auditCountAfter = await db().adminAuditLog.count({ where: { entityType: 'payment_event', entityId: seeded.id } })
  check('replay of an orphaned event fails safely with a governed error (not a raw 500 crash)', replayRes.status === 409 && replayRes.j?.error?.code === 'PAYMENT_EVENT_ORPHANED', JSON.stringify(replayRes))
  check('the orphan-refusal is still recorded in the admin audit log', auditCountAfter === auditCountBefore + 1, `${auditCountBefore} -> ${auditCountAfter}`)
  const afterReplay = await db().paymentEvent.findUnique({ where: { id: seeded.id } })
  check('the refused replay left the event row completely unchanged (no attempted, no side effect)', afterReplay.attempts === before.attempts && afterReplay.processingStatus === before.processingStatus, JSON.stringify(afterReplay))
}

console.log('\n=== B. STRIPE_CHECKOUT RAIL — deleting the linked Booking must not delete its PaymentEvent ===')
{
  const sessionId = `cs_test_ped_${Date.now()}`
  const eventId = `evt_ped_stripe_${Date.now()}`
  const evt = { id: eventId, type: 'checkout.session.completed', data: { object: { id: sessionId, payment_status: 'paid', currency: 'syp', metadata: { bookingId: bookingB.id, sypTotalMinor: '180000' } } } }
  const r1 = await stripeWebhook(evt)
  check('setup: a real webhook durably received for booking B', r1.status === 200, JSON.stringify(r1))

  const beforeRow = await db().paymentEvent.findFirst({ where: { providerEventId: eventId } })
  const before = { originalBookingId: beforeRow?.originalBookingId, providerEventId: beforeRow?.providerEventId, processingStatus: beforeRow?.processingStatus }
  check('setup: the durable row correctly snapshots originalBookingId', before.originalBookingId === bookingB.id, before.originalBookingId)

  await db().booking.delete({ where: { id: bookingB.id } })

  const afterRow = await db().paymentEvent.findFirst({ where: { providerEventId: eventId } })
  check('the PaymentEvent row still exists after its Booking is deleted', Boolean(afterRow), 'row is gone')
  check('the live bookingId FK is cleared to null (SET NULL)', afterRow?.bookingId === null, afterRow?.bookingId)
  check('originalBookingId (permanent snapshot) is UNCHANGED', afterRow?.originalBookingId === before.originalBookingId, `${before.originalBookingId} -> ${afterRow?.originalBookingId}`)
  check('providerEventId is UNCHANGED', afterRow?.providerEventId === before.providerEventId, afterRow?.providerEventId)

  // A REAL redelivery is meaningfully testable for this rail (unlike payment_intent's), since intake
  // reads bookingId from the incoming payload, not from a DB lookup of an existing booking.
  const countBefore = await db().paymentEvent.count({ where: { providerEventId: eventId } })
  const r2 = await stripeWebhook(evt) // exact redelivery after the booking is gone
  const countAfter = await db().paymentEvent.count({ where: { providerEventId: eventId } })
  check('a real redelivery after the booking is gone still resolves to the existing row (still exactly one)', countBefore === 1 && countAfter === 1, `${countBefore} -> ${countAfter}`)
  check('the redelivery response reflects the same (deferred/duplicate) outcome, not a crash', r2.status === 200, JSON.stringify(r2))

  // Cannot apply effects to a gone record: prove the underlying apply MECHANISM itself refuses,
  // in-process (bypassing the intentionally-closed stripe policy gate, same technique as
  // payment-webhook-durability.e2e.mjs) -- finalizeStripeSession's own existence check must hold.
  // applyStripeCheckoutEvent now requires a real, genuinely-held claim (round 8 -- independent review
  // found the previous nullish-token bypass a real defect, not a harmless test convenience), so this
  // test seeds one directly, matching exactly what applyPaymentEvent's own outer claim would have
  // done had this gone through the full pipeline instead of calling the rail function directly.
  const { applyStripeCheckoutEvent } = await import('../../server/lib/stripe-checkout-apply.mjs')
  const claimToken = randomUUID()
  await db().paymentEvent.update({
    where: { id: afterRow.id },
    data: { processingStatus: 'APPLYING', claimToken, attempts: { increment: 1 }, lastAttemptAt: new Date(), claimExpiresAt: new Date(Date.now() + 60_000) },
  })
  const proofCountBefore = await db().paymentProof.count({ where: { provider: 'stripe', providerRef: sessionId } })
  const applyResult = await applyStripeCheckoutEvent({
    eventId: afterRow.id,
    claimToken,
    session: { id: sessionId, payment_status: 'paid', metadata: { bookingId: bookingB.id, sypTotalMinor: '180000' } }, // bookingB no longer exists
  })
  const proofCountAfter = await db().paymentProof.count({ where: { provider: 'stripe', providerRef: sessionId } })
  check('applying an event whose booking no longer exists is a safe no-op (illegal:true), never a crash', applyResult.applied === false && applyResult.illegal === true, JSON.stringify(applyResult))
  check('zero PaymentProof rows created against the gone booking', proofCountBefore === 0 && proofCountAfter === 0, `${proofCountBefore} -> ${proofCountAfter}`)
  const finalRow = await db().paymentEvent.findUnique({ where: { id: afterRow.id } })
  check('the event is correctly marked IGNORED (a deterministic no-op), not FAILED/DEAD_LETTERED', finalRow?.processingStatus === 'IGNORED', finalRow?.processingStatus)
}

console.log(`\n==== PAYMENT EVENT DESTRUCTIVE-PARENT REGRESSION: ${pass} passed, ${fail} failed ====`)
await disconnectDb()
process.exit(fail ? 1 : 0)
