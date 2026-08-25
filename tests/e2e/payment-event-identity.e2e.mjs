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
//   - the SAME literal event-id string delivered under two different (provider, providerEndpointKey,
//     environment) identities produces two INDEPENDENT rows, never a collision — the direct proof
//     providerEventId is no longer globally unique;
//   - a redelivery under the same canonical identity but with an ALTERED payload (different digest)
//     is a genuine conflict, recorded in a SEPARATE, append-only PaymentEventConflict row — the
//     ORIGINAL event row is proven byte-for-byte unchanged (not just its identity fields), including
//     the critical case where the original had already reached APPLIED (an earlier version of this
//     fix overwrote exactly this — independent review found it, this file now proves it can't recur);
//   - 20 REPETITIONS of 20 concurrent identical deliveries, each against FRESH booking/intent state,
//     produce at most one real financial effect (a PaymentProof row) every time, on BOTH rails —
//     not just "one PaymentEvent row" (a status-only 'processing' event has nothing to duplicate in
//     the first place, which independent review correctly flagged as not actually proving anything
//     about effect-duplication);
//   - a live redelivery racing an admin replay of the same event produces exactly one effect, never
//     two.
//
// Run: AUTH_SECRET=<secret> PAYMENT_WEBHOOK_SECRET=<secret> STRIPE_WEBHOOK_SECRET=<secret>
//      STRIPE_SECRET_KEY=sk_test_fake HOST=<uuid> GUEST=<uuid> ADMIN=<uuid>
//      node tests/e2e/payment-event-identity.e2e.mjs
//      (server must run with PAYMENT_INTENTS_ENABLED=true, PAYMENTS_ENABLED=true, and the SAME
//      PAYMENT_WEBHOOK_SECRET / STRIPE_WEBHOOK_SECRET / STRIPE_SECRET_KEY — this suite is slower than
//      most others in this repo, since section 7 alone issues 800 real HTTP requests across 40
//      repetitions)

import { createHash } from 'node:crypto'
import { createSessionToken } from '../../server/lib/security.mjs'
import { signWebhook } from '../../server/lib/payment-webhook.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'
import { policyEnvironment } from '../../server/lib/payment-policy.mjs'

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

console.log('\n=== 6a. Redelivery under the same identity with an ALTERED payload -> conflict recorded SEPARATELY, ORIGINAL EVENT ROW NEVER MUTATED ===')
{
  const eventId = `evt_pei_conflict_${Date.now()}`
  const evt1 = { id: eventId, type: 'payment_intent.processing', data: { object: { reference: intent.reference, id: 'pi_prov_conflict_v1' } } }
  // Same event id, DIFFERENT payload (different provider object id -> different payload digest).
  const evt2 = { id: eventId, type: 'payment_intent.processing', data: { object: { reference: intent.reference, id: 'pi_prov_conflict_v2_ALTERED' } } }

  const r1 = await piWebhook(evt1)
  const rowAfterFirst = await db().paymentEvent.findFirst({ where: { providerEventId: eventId } })
  const conflictsBefore = await db().paymentEventConflict.count({ where: { paymentEventId: rowAfterFirst.id } })
  const r2 = await piWebhook(evt2)
  const rowAfterSecond = await db().paymentEvent.findFirst({ where: { providerEventId: eventId } })
  const conflictsAfter = await db().paymentEventConflict.count({ where: { paymentEventId: rowAfterFirst.id } })
  const count = await db().paymentEvent.count({ where: { providerEventId: eventId, rail: 'payment_intent' } })

  check('first (genuine) delivery succeeds', r1.status === 200, JSON.stringify(r1))
  check('the altered-payload redelivery is acknowledged (200), not a crash', r2.status === 200 && r2.j?.conflict === true, JSON.stringify(r2))
  check('still exactly one PaymentEvent row for this event id -- the conflict never creates a second event row', count === 1, count)
  check(
    'the ORIGINAL event row is COMPLETELY UNCHANGED by the conflict -- every field byte-identical, not just the identity fields (the exact defect independent review found)',
    JSON.stringify(rowAfterFirst) === JSON.stringify(rowAfterSecond),
    JSON.stringify({ before: rowAfterFirst, after: rowAfterSecond }),
  )
  check('a NEW, separate PaymentEventConflict row was created to record the conflicting delivery', conflictsAfter === conflictsBefore + 1, `${conflictsBefore} -> ${conflictsAfter}`)
  const conflictRow = await db().paymentEventConflict.findFirst({ where: { paymentEventId: rowAfterFirst.id }, orderBy: { receivedAt: 'desc' } })
  check('the conflict record captures the INCOMING (altered) providerObjectId for investigation, distinct from the original', conflictRow?.providerObjectId === 'pi_prov_conflict_v2_ALTERED', conflictRow?.providerObjectId)
  check('the conflict record stores a payload digest, never a raw payload field', Boolean(conflictRow?.payloadDigest) && conflictRow?.payloadDigest !== JSON.stringify(evt2), conflictRow?.payloadDigest)
}

console.log('\n=== 6b. Conflict against an ALREADY-APPLIED original -- the critical case: a successful payment\'s true outcome must never be destroyed ===')
{
  const bookingConflict = await makeBooking(listing, 30, 27)
  const intentConflictRes = await call('POST', '/api/payments/intents', G, { bookingId: bookingConflict.id })
  const intentConflict = intentConflictRes.j?.intent
  const eventId = `evt_pei_conflict_applied_${Date.now()}`
  const goodEvt = { id: eventId, type: 'payment_intent.succeeded', data: { object: { reference: intentConflict.reference, id: 'pi_prov_applied_good', amount_minor: intentConflict.amountMinor, currency: intentConflict.currency } } }
  const badEvt = { id: eventId, type: 'payment_intent.succeeded', data: { object: { reference: intentConflict.reference, id: 'pi_prov_applied_BOGUS', amount_minor: intentConflict.amountMinor, currency: intentConflict.currency } } }

  const r1 = await piWebhook(goodEvt)
  check('the genuine event applies successfully', r1.status === 200 && r1.j?.applied === true, JSON.stringify(r1))
  const appliedRow = await db().paymentEvent.findFirst({ where: { providerEventId: eventId } })
  check('setup: the original row genuinely reached APPLIED', appliedRow?.processingStatus === 'APPLIED', appliedRow?.processingStatus)
  const proofCountBefore = await db().paymentProof.count({ where: { provider: 'payment_intent', providerRef: intentConflict.reference } })

  const r2 = await piWebhook(badEvt)
  const rowAfterConflict = await db().paymentEvent.findFirst({ where: { providerEventId: eventId } })
  const proofCountAfter = await db().paymentProof.count({ where: { provider: 'payment_intent', providerRef: intentConflict.reference } })

  check('the conflicting delivery against an APPLIED original is acknowledged as a conflict, not applied', r2.status === 200 && r2.j?.conflict === true, JSON.stringify(r2))
  check('the ALREADY-APPLIED original stays APPLIED -- its true, authoritative outcome is never destroyed by a later conflicting delivery', rowAfterConflict?.processingStatus === 'APPLIED', rowAfterConflict?.processingStatus)
  check(
    'appliedAt/attempts/lastError on the original are completely unchanged',
    rowAfterConflict?.appliedAt?.getTime() === appliedRow?.appliedAt?.getTime() && rowAfterConflict?.attempts === appliedRow?.attempts && rowAfterConflict?.lastError === appliedRow?.lastError,
    JSON.stringify({ before: appliedRow, after: rowAfterConflict }),
  )
  check('zero new PaymentProof rows -- the conflicting delivery against an APPLIED original never applies anything', proofCountBefore === proofCountAfter, `${proofCountBefore} -> ${proofCountAfter}`)
  const conflictRecord = await db().paymentEventConflict.findFirst({ where: { paymentEventId: appliedRow.id } })
  check('the conflict is still durably recorded as its own audit entry, referencing the original', Boolean(conflictRecord), 'no conflict record created')
}

console.log('\n=== 7. Financial-effect concurrency: 20 repetitions x 20 simultaneous deliveries, fresh state each time, both rails ===')
{
  // payment_intent rail, live HTTP: a REAL succeeded event (a genuine effect to duplicate, unlike
  // the earlier version of this test which used 'processing' -- a status-only transition with
  // nothing to duplicate in the first place). Fresh booking+intent every repetition.
  let piMaxRowsPerEvent = 0
  let piMaxProofsPerRef = 0
  let piAnyBadStatus = false
  for (let rep = 0; rep < 20; rep++) {
    const b = await makeBooking(listing, 40 + rep * 4, 37 + rep * 4) // 4-day spacing > the 3-day booking window, so consecutive repetitions never overlap
    const iRes = await call('POST', '/api/payments/intents', G, { bookingId: b.id })
    const i = iRes.j?.intent
    const eventId = `evt_pei_conc_pi_${rep}_${Date.now()}`
    const evt = { id: eventId, type: 'payment_intent.succeeded', data: { object: { reference: i.reference, id: `pi_prov_conc_${rep}`, amount_minor: i.amountMinor, currency: i.currency } } }
    const results = await Promise.all(Array.from({ length: 20 }, () => piWebhook(evt)))
    if (!results.every((r) => r.status === 200)) piAnyBadStatus = true
    const rowCount = await db().paymentEvent.count({ where: { providerEventId: eventId, rail: 'payment_intent' } })
    const proofCount = await db().paymentProof.count({ where: { provider: 'payment_intent', providerRef: i.reference } })
    piMaxRowsPerEvent = Math.max(piMaxRowsPerEvent, rowCount)
    piMaxProofsPerRef = Math.max(piMaxProofsPerRef, proofCount)
  }
  check('payment_intent rail: all 400 concurrent deliveries (20 reps x 20) returned 200, no raw errors under the race', !piAnyBadStatus, 'some non-200 response seen')
  check('payment_intent rail: never more than one PaymentEvent row per event id, across all 20 repetitions', piMaxRowsPerEvent === 1, piMaxRowsPerEvent)
  check('payment_intent rail: never more than one PaymentProof (the real financial effect) per intent reference, across all 20 repetitions', piMaxProofsPerRef === 1, piMaxProofsPerRef)

  // stripe_checkout rail: webhook_apply is intentionally, permanently policy-deferred on this server
  // (stripe has no approved provider config -- see payment-policy.mjs), so a live-HTTP concurrency
  // test would trivially show zero effects for the wrong reason (never reaching apply at all, not
  // because concurrency was handled safely). Proving the APPLY MECHANISM's own concurrency safety
  // therefore uses the same direct in-process technique established in earlier rounds
  // (payment-webhook-durability.e2e.mjs), bypassing only the policy gate, never the DB-level race.
  const { applyStripeCheckoutEvent } = await import('../../server/lib/stripe-checkout-apply.mjs')
  let stripeMaxProofsPerSession = 0
  let stripeAnyThrew = false
  for (let rep = 0; rep < 20; rep++) {
    const b = await makeBooking(listing, 200 + rep * 4, 197 + rep * 4) // far enough from the payment_intent-rail loop's own date range above, 4-day spacing avoids self-overlap too
    const sessionId = `cs_test_conc_${rep}_${Date.now()}`
    const eventRow = await db().paymentEvent.create({
      data: {
        rail: 'stripe_checkout', provider: 'stripe', providerEndpointKey: 'stripe-checkout', environment: 'test', subjectType: 'BOOKING',
        providerReference: b.id, bookingId: b.id, originalBookingId: b.id,
        providerEventId: `evt_pei_conc_stripe_${rep}_${Date.now()}`, type: 'checkout.session.completed',
        amountMinor: 160000, currency: 'syp', providerObjectId: sessionId, payloadDigest: `digest_${rep}`, processingStatus: 'RECEIVED',
      },
    })
    const session = { id: sessionId, payment_status: 'paid', metadata: { bookingId: b.id, sypTotalMinor: '160000' } }
    try {
      await Promise.all(Array.from({ length: 20 }, () => applyStripeCheckoutEvent({ eventId: eventRow.id, session })))
    } catch {
      stripeAnyThrew = true
    }
    const proofCount = await db().paymentProof.count({ where: { provider: 'stripe', providerRef: sessionId } })
    stripeMaxProofsPerSession = Math.max(stripeMaxProofsPerSession, proofCount)
  }
  check('stripe_checkout rail: 20 concurrent apply calls never throw an unhandled error, across all 20 repetitions', !stripeAnyThrew, 'an apply call threw')
  check('stripe_checkout rail: never more than one PaymentProof per session, across all 20 repetitions of 20 concurrent applies', stripeMaxProofsPerSession === 1, stripeMaxProofsPerSession)
}

console.log('\n=== 8. Concurrency between a LIVE redelivery and an ADMIN REPLAY of the same event -> exactly one effect, never two ===')
{
  const bookingReplay = await makeBooking(listing, 130, 127) // comfortably past the loop above's date range (up to ~119 days ago)
  const intentReplayRes = await call('POST', '/api/payments/intents', G, { bookingId: bookingReplay.id })
  const intentReplay = intentReplayRes.j?.intent
  const eventId = `evt_pei_replay_race_${Date.now()}`
  const evtObj = { id: eventId, type: 'payment_intent.succeeded', data: { object: { reference: intentReplay.reference, id: 'pi_prov_replay_race', amount_minor: intentReplay.amountMinor, currency: intentReplay.currency } } }
  // Seed a FAILED (not DEAD_LETTERED) delivery directly -- eligible for both admin replay and a live
  // redelivery falling through to re-attempt, exactly the two paths this test races against each other.
  const payloadDigest = createHash('sha256').update(JSON.stringify(evtObj)).digest('hex')
  const seeded = await db().paymentEvent.create({
    data: {
      rail: 'payment_intent', provider: 'sandbox', providerEndpointKey: 'sandbox-test-account', environment: policyEnvironment(),
      subjectType: 'PAYMENT_INTENT', providerReference: intentReplay.reference, intentId: intentReplay.id,
      originalIntentId: intentReplay.id, originalBookingId: intentReplay.bookingId ?? null,
      providerEventId: eventId, type: 'payment_intent.succeeded', amountMinor: intentReplay.amountMinor, currency: intentReplay.currency,
      providerObjectId: 'pi_prov_replay_race', payloadDigest, processingStatus: 'FAILED', attempts: 2, lastError: 'synthetic seed for replay-vs-redelivery race test',
    },
  })
  const proofCountBefore = await db().paymentProof.count({ where: { provider: 'payment_intent', providerRef: intentReplay.reference } })

  const [replayRes, webhookRes] = await Promise.all([
    call('POST', `/api/admin/payment-events/${seeded.id}/replay`, A, {}),
    piWebhook(evtObj),
  ])

  const proofCountAfter = await db().paymentProof.count({ where: { provider: 'payment_intent', providerRef: intentReplay.reference } })
  const finalRow = await db().paymentEvent.findUnique({ where: { id: seeded.id } })
  check('the admin replay call completed without a raw server error', replayRes.status === 200 || replayRes.status === 409, JSON.stringify(replayRes))
  check('the concurrent live redelivery call completed without a raw server error', webhookRes.status === 200, JSON.stringify(webhookRes))
  check('exactly one real financial effect resulted from the two racing attempts, never two', proofCountAfter === proofCountBefore + 1, `${proofCountBefore} -> ${proofCountAfter}`)
  check('the event settled at APPLIED, not left FAILED/DEAD_LETTERED by the race', finalRow?.processingStatus === 'APPLIED', finalRow?.processingStatus)
}

console.log(`\n==== PAYMENT EVENT CANONICAL IDENTITY: ${pass} passed, ${fail} failed ====`)
await disconnectDb()
process.exit(fail ? 1 : 0)
