// SYBNB — SEC-002R ROUND 5: A8, the payment-event claim/effects boundary, MERGED INTO ONE TRANSACTION.
//
// WHAT ROUND 5 CHANGED
//
// Through round 4 the payment-event pipeline ran the CLAIM (attempts++ / APPLYING / claimToken) in
// its own transaction, which COMMITTED, and only then called each rail's apply(), which opened a
// SECOND transaction for the commit-boundary re-authorization and the money-moving effects. When the
// apply phase's re-authorization refused a revoked actor, a THIRD, compensating transaction ran
// afterwards to decrement attempts and restore the prior status.
//
// Between commit #1 and commit #3 the row was DURABLY `APPLYING` with an inflated attempts count --
// observable by any concurrent reader, and permanent if the process died in between. That is the
// residual A8 carried as "bounded race remains", explicitly NOT "atomicity guaranteed".
//
// Round 5 merges the claim and the effects into ONE transaction using Postgres SAVEPOINTs
// (server/lib/tx-scope.mjs + applyPaymentEvent in server/lib/payment-event-pipeline.mjs):
//
//     FOR UPDATE the event row          <- lock taken BEFORE the savepoint, so it survives rollback
//     SAVEPOINT sp_before_claim
//     claim CAS (attempts++, APPLYING, token)
//     SAVEPOINT sp_before_effects
//     apply()  -- verifyAndLockClaim -> beforeEffects (reauthorizeAtCommit) -> the real effects
//     [commit gate: authorizeClaim]
//     COMMIT
//
//   * a RE-AUTHORIZATION failure  -> ROLLBACK TO sp_before_claim   (the claim itself is undone; the
//                                    transaction commits a net-zero result -- there is no compensating
//                                    transaction any more, so there is nothing left that can fail,
//                                    strand a row, or need a reconciliation marker)
//   * EVERY OTHER failure         -> ROLLBACK TO sp_before_effects (effects undone, the attempts
//                                    increment SURVIVES and commits with the FAILED/DEAD_LETTERED
//                                    bookkeeping -- the retry/dead-letter contract is byte-for-byte
//                                    what it was)
//
// WHAT THIS SUITE PROVES
//
// Not "the code has a savepoint in it" -- that would prove nothing. Every section below asserts
// DIRECT DATABASE STATE, and the central ones assert properties that are only true of a single
// transaction and were FALSE under the two-transaction design:
//
//   §1/§2   the claim row and the PaymentProof row share the same `xmin` -- Postgres's own record of
//           which transaction wrote a tuple. Equal xmin IS the definition of "committed by one
//           transaction"; under rounds 1-4 these were necessarily two different values.
//   §3/§4   a concurrent reader on a SEPARATE connection, sampling continuously throughout the apply,
//           NEVER observes the intermediate `APPLYING`/attempts+1 state. Under rounds 1-4 that state
//           was durable and this sampling would have caught it.
//   §5/§6   a re-authorization refusal leaves the event row BYTE-IDENTICAL to what it was, compared
//           field by field over the whole row -- restored by Postgres, not rewritten by a
//           compensating UPDATE that could itself fail.
//   §9/§10  the interleaved-concurrency proof the owner asked for: 3+ genuinely simultaneous claim
//           attempts on the SAME event with a revocation landing in the middle of the window, over
//           many repetitions, asserting a single coherent outcome and never a torn one.
//
// RELATIONSHIP TO ROUND 3 §6a-2 / §6a-3 (STATED, NOT HIDDEN)
//
// Round 3's §6a-2 and §6a-3 assert, by reading from a SEPARATE connection while apply() is running,
// that "the CLAIM had genuinely COMMITTED before the revocation" (status APPLYING, attempts 2 -> 3,
// a token held). Those two assertions are assertions ABOUT THE TWO-TRANSACTION ARCHITECTURE, and no
// single-transaction design can satisfy them: uncommitted data is invisible across connections, by
// definition. They fail under round 5, and §3/§4/§15 below assert the exact OPPOSITE property on
// purpose. Round 3 is frozen evidence and has NOT been edited; this is recorded here so the conflict
// is visible in the code rather than only in a report. Every other assertion in round 3 -- including
// all of §6a-6..15, all of §6b (the stale-priorStatus differential) and all of §6c (the stripe rail)
// -- still passes unchanged.
//
// METHOD: same discipline as rounds 1-4. Real server-issued sessions via issueUserSession(); the
// real production pipeline wiring copied from server/routes/payment-intents.mjs's replay route (ONE
// reauthorizeAtCommit hook passed as both authorizeClaim and beforeEffects, driving the real
// applyPaymentIntentEvent / applyStripeCheckoutEvent); real revocation via POST /api/auth/logout-all;
// every race followed by a positive control with fresh authority that must genuinely commit.
//
// Run: node tests/e2e/commit-boundary-reauthorization-round5.e2e.mjs  (API_BASE default 127.0.0.1:3051)

import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'
import { issueUserSession } from '../../server/lib/session-store.mjs'
import { hashPassword } from '../../server/lib/security.mjs'
import { createSessionToken } from './_session.mjs'
import { reauthorizeAtCommit } from '../../server/lib/commit-authorization.mjs'
import { applyPaymentEvent as applyPaymentEventPipeline, DEAD_LETTER_THRESHOLD } from '../../server/lib/payment-event-pipeline.mjs'
import { applyPaymentIntentEvent } from '../../server/routes/payment-intents.mjs'
import { applyStripeCheckoutEvent } from '../../server/lib/stripe-checkout-apply.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'

let pass = 0
let fail = 0
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`   PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) }
}

const BOUNDARY_CODES = [
  'SESSION_REVOKED_BEFORE_COMMIT',
  'SESSION_EPOCH_STALE_BEFORE_COMMIT',
  'ACCOUNT_NOT_ACTIVE_BEFORE_COMMIT',
  'ROLE_REVOKED_BEFORE_COMMIT',
]
const isBoundaryThrow = (err) => BOUNDARY_CODES.includes(err?.code)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let j
  try { j = JSON.parse(text) } catch { j = { raw: text.slice(0, 400) } }
  return { status: res.status, j }
}

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------
const host = { id: process.env.HOST }
const guest = { id: process.env.GUEST }
const admin = { id: process.env.ADMIN }
if (!host.id || !guest.id || !admin.id) {
  console.error('Missing HOST/GUEST/ADMIN env')
  process.exit(2)
}
const H = await createSessionToken({ id: host.id, roles: [{ role: 'HOST' }] })
const G = await createSessionToken({ id: guest.id, roles: [{ role: 'GUEST' }] })
const A = await createSessionToken({ id: admin.id, roles: [{ role: 'ADMIN' }] })

const RUN = Date.now()
const PASSWORD = 'Sec002R-Round5-Pw!'
// A DEDICATED synthetic ADMIN. This suite revokes its sessions repeatedly; it must never be a shared
// fixture account other suites depend on.
const actorId = randomUUID()

async function makeActor() {
  await db().user.create({
    data: {
      id: actorId,
      email: `sec002r5-${actorId.slice(0, 8)}-${RUN}@sybnb.test`,
      passwordHash: hashPassword(PASSWORD),
      displayName: `sec002r5-${actorId.slice(0, 8)}`,
      status: 'ACTIVE',
      roles: { create: [{ role: 'ADMIN' }] },
    },
  })
}
async function cleanupActor() {
  await db().adminAuditLog.deleteMany({ where: { OR: [{ actorUserId: actorId }, { entityId: actorId }] } }).catch(() => {})
  await db().user.delete({ where: { id: actorId } }).catch(() => {})
}

// The exact shape server/lib/auth-context.mjs's getAuthContext() returns -- built directly because
// these sections must hold a window open that no HTTP request can hold open (identical reasoning,
// and identical helper, to round 3 §6).
async function authContextFor(userId) {
  const user = await db().user.findUnique({ where: { id: userId }, include: { roles: true } })
  const issued = await issueUserSession(user)
  return {
    token: issued.token,
    context: { user, roles: user.roles.map((r) => r.role), sessionId: issued.sessionId, epoch: user.sessionEpoch },
  }
}
// Real revocation through the real route, from a SECOND live session for the same account.
async function logoutAll(userId) {
  const user = await db().user.findUnique({ where: { id: userId }, include: { roles: true } })
  const issued = await issueUserSession(user)
  const out = await call('POST', '/api/auth/logout-all', issued.token, {})
  return out.status === 200
}

const REPLAY_ACTION = { action: 'ADMIN_PAYMENT_EVENT_REPLAYED', requiredRoles: ['ADMIN'] }

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
    division: 'STAYS', titleAr: 'شقة اختبار R5', titleEn: 'R5 test flat', priceMinor, currency: 'SYP', instantBookEnabled: true,
  })
  const id = created.j?.listing?.id
  await call('PATCH', `/api/listings/${id}/submit`, H)
  await call('PATCH', `/api/admin/review-queue/listing/${id}`, A, { decision: 'APPROVE' })
  return id
}

// Every booking needs its own non-overlapping date range on the shared listing.
let dateCursor = 900
function nextDates() {
  const checkIn = dateCursor
  dateCursor -= 4
  return { checkIn, checkOut: checkIn - 3 }
}
async function makeBooking(listingId) {
  const { checkIn, checkOut } = nextDates()
  const created = await call('POST', '/api/bookings', G, { listingId, checkIn: daysAgoIso(checkIn), checkOut: daysAgoIso(checkOut) })
  return created.j?.booking
}

// A fresh payment_intent-rail event at RECEIVED, plus everything its apply needs.
async function seedIntentEvent(listingId, tag) {
  const booking = await makeBooking(listingId)
  const intentRes = await call('POST', '/api/payments/intents', G, { bookingId: booking.id })
  const intent = intentRes.j?.intent
  if (!intent) throw new Error(`could not create a payment intent for ${tag}: ${JSON.stringify(intentRes.j)}`)
  const obj = { id: `pi_r5_${tag}_${randomUUID().slice(0, 8)}`, amount_minor: intent.amountMinor, currency: intent.currency }
  const event = await db().paymentEvent.create({
    data: {
      rail: 'payment_intent', provider: 'sandbox', providerEndpointKey: 'sandbox-test-account', environment: 'test',
      subjectType: 'PAYMENT_INTENT', providerReference: intent.reference, intentId: intent.id,
      originalIntentId: intent.id, originalBookingId: intent.bookingId ?? null,
      providerEventId: `evt_r5_${tag}_${randomUUID()}`, type: 'payment_intent.succeeded',
      amountMinor: intent.amountMinor, currency: intent.currency, providerObjectId: obj.id,
      payloadDigest: `r5_${tag}_${randomUUID().slice(0, 8)}`, processingStatus: 'RECEIVED',
    },
  })
  return { event, intent, obj, booking }
}
// A fresh stripe_checkout-rail event at RECEIVED, plus a matching Stripe session object.
async function seedStripeEvent(listingId, tag) {
  const booking = await makeBooking(listingId)
  const sessionId = `cs_r5_${tag}_${randomUUID().replace(/-/g, '').slice(0, 20)}`
  const event = await db().paymentEvent.create({
    data: {
      rail: 'stripe_checkout', provider: 'stripe', providerEndpointKey: 'stripe-checkout', environment: 'test',
      subjectType: 'BOOKING', providerReference: booking.id, bookingId: booking.id, originalBookingId: booking.id,
      providerEventId: `evt_r5_${tag}_${randomUUID()}`, type: 'checkout.session.completed',
      amountMinor: booking.amountMinor, currency: 'syp', providerObjectId: sessionId, paymentStatus: 'paid',
      payloadDigest: `r5_${tag}_${randomUUID().slice(0, 8)}`, processingStatus: 'RECEIVED',
    },
  })
  const session = { id: sessionId, payment_status: 'paid', metadata: { bookingId: booking.id, sypTotalMinor: String(booking.amountMinor) } }
  return { event, session, booking }
}

// Production wiring, copied from server/routes/payment-intents.mjs's replay route.
const runIntentReplay = ({ event, intent, obj, reauth, wrap }) => applyPaymentEventPipeline({
  eventId: event.id,
  rail: 'payment_intent',
  authorizeClaim: reauth,
  apply: async (claimToken) => {
    if (wrap) await wrap()
    return applyPaymentIntentEvent({
      eventId: event.id, intentId: intent.id, type: 'payment_intent.succeeded', obj, claimToken, beforeEffects: reauth,
    })
  },
})
const runStripeReplay = ({ event, session, reauth, wrap }) => applyPaymentEventPipeline({
  eventId: event.id,
  rail: 'stripe_checkout',
  authorizeClaim: reauth,
  apply: async (claimToken) => {
    if (wrap) await wrap()
    return applyStripeCheckoutEvent({ eventId: event.id, session, claimToken, beforeEffects: reauth })
  },
})

// Postgres's own record of WHICH TRANSACTION wrote a tuple. Two rows with the same xmin were written
// by the same transaction -- this is not an inference, it is what the column means.
async function xminOf(table, id) {
  const rows = await db().$queryRawUnsafe(`SELECT xmin::text AS xmin FROM ${table} WHERE id = '${id}'::uuid`)
  return rows[0]?.xmin ?? null
}
// The fields a concurrent observer would use to tell "claimed" from "not yet" from "settled".
const observable = (row) => (row
  ? { processingStatus: row.processingStatus, attempts: row.attempts, claimToken: row.claimToken }
  : null)
const sameObservable = (a, b) => JSON.stringify(a) === JSON.stringify(b)
// Every column, for the byte-identical-rollback assertions.
const wholeRow = (row) => JSON.stringify(row, (k, v) => (v instanceof Date ? v.toISOString() : v))

// Samples the event row from a SEPARATE pooled connection as fast as it can until stopped, and
// returns every DISTINCT observable state it saw, in order.
function startObserver(eventId) {
  const seen = []
  let running = true
  const done = (async () => {
    while (running) {
      const row = await db().paymentEvent.findUnique({ where: { id: eventId } }).catch(() => null)
      const o = observable(row)
      if (o && (seen.length === 0 || !sameObservable(seen[seen.length - 1], o))) seen.push(o)
      await sleep(3)
    }
    const row = await db().paymentEvent.findUnique({ where: { id: eventId } }).catch(() => null)
    const o = observable(row)
    if (o && (seen.length === 0 || !sameObservable(seen[seen.length - 1], o))) seen.push(o)
    return seen
  })()
  return { stop: async () => { running = false; return done } }
}

// =================================================================================================
console.log('=== SEC-002R ROUND 5 — A8 CLAIM/EFFECTS MERGED INTO ONE TRANSACTION (SAVEPOINTS) ===')
// =================================================================================================
await makeActor()
await verifyHostForPublishing()
const listing = await makeStaysListing(160000)
// Section 13 asserts across every refusal this suite performs, so it needs a baseline taken first.
const strandedMarkersAtStart = await db().adminAuditLog.count({ where: { action: 'PAYMENT_EVENT_REAUTH_REVERSAL_FAILED' } })

try {
  // ===============================================================================================
  console.log('\n=== 1. POSITIVE CONTROL + SINGLE-TRANSACTION PROOF — payment_intent rail ===')
  // ===============================================================================================
  // Normal operation, no revocation, no interleaving. The effects must genuinely commit -- and the
  // event row and the PaymentProof must carry the SAME xmin, which is only possible if one
  // transaction wrote both. Under rounds 1-4 the claim committed in one transaction and the proof in
  // a later one, so these were necessarily different.
  {
    const { event, intent, obj, booking } = await seedIntentEvent(listing, 'pos-pi')
    const { context } = await authContextFor(actorId)
    const reauth = (tx) => reauthorizeAtCommit(tx, context, REPLAY_ACTION)

    const result = await runIntentReplay({ event, intent, obj, reauth })
    const after = await db().paymentEvent.findUnique({ where: { id: event.id } })
    const proof = await db().paymentProof.findFirst({ where: { provider: 'payment_intent', providerRef: intent.reference } })
    const intentAfter = await db().paymentIntent.findUnique({ where: { id: intent.id } })
    const bookingAfter = await db().booking.findUnique({ where: { id: booking.id } })

    check('1a. normal operation still applies (result.applied)', result?.applied === true, JSON.stringify(result))
    check('1b. DB: the event settled APPLIED with exactly one attempt consumed and the claim released',
      after.processingStatus === 'APPLIED' && after.attempts === 1 && after.claimToken === null && after.claimExpiresAt === null,
      `${after.processingStatus}/${after.attempts}/${after.claimToken}`)
    check('1c. DB: the real financial effect committed (a PaymentProof exists)', Boolean(proof), 'no PaymentProof')
    check('1d. DB: the intent advanced to SUCCEEDED', intentAfter.status === 'SUCCEEDED', intentAfter.status)
    check('1e. DB: the booking left PAYMENT_PENDING (the effect reached the booking too)',
      bookingAfter.status !== 'PAYMENT_PENDING', bookingAfter.status)

    const evXmin = await xminOf('payment_events', event.id)
    const proofXmin = await xminOf('payment_proofs', proof.id)
    check('1f. ATOMICITY: the claim row and the PaymentProof carry the SAME xmin -- ONE transaction wrote both (two transactions could not)',
      evXmin !== null && evXmin === proofXmin, `event xmin=${evXmin} proof xmin=${proofXmin}`)
  }

  // ===============================================================================================
  console.log('\n=== 2. POSITIVE CONTROL + SINGLE-TRANSACTION PROOF — stripe_checkout rail ===')
  // ===============================================================================================
  {
    const { event, session, booking } = await seedStripeEvent(listing, 'pos-sc')
    const { context } = await authContextFor(actorId)
    const reauth = (tx) => reauthorizeAtCommit(tx, context, REPLAY_ACTION)

    const result = await runStripeReplay({ event, session, reauth })
    const after = await db().paymentEvent.findUnique({ where: { id: event.id } })
    const proof = await db().paymentProof.findFirst({ where: { provider: 'stripe', providerRef: session.id } })
    const bookingAfter = await db().booking.findUnique({ where: { id: booking.id } })

    check('2a. normal operation still applies (result.applied)', result?.applied === true, JSON.stringify(result))
    check('2b. DB: the event settled APPLIED with exactly one attempt consumed and the claim released',
      after.processingStatus === 'APPLIED' && after.attempts === 1 && after.claimToken === null && after.claimExpiresAt === null,
      `${after.processingStatus}/${after.attempts}/${after.claimToken}`)
    check('2c. DB: the real financial effect committed (a PaymentProof exists)', Boolean(proof), 'no PaymentProof')
    check('2d. DB: the booking left PAYMENT_PENDING', bookingAfter.status !== 'PAYMENT_PENDING', bookingAfter.status)

    const evXmin = await xminOf('payment_events', event.id)
    const proofXmin = await xminOf('payment_proofs', proof.id)
    check('2e. ATOMICITY: the claim row and the PaymentProof carry the SAME xmin on this rail too -- ONE transaction',
      evXmin !== null && evXmin === proofXmin, `event xmin=${evXmin} proof xmin=${proofXmin}`)
  }

  // ===============================================================================================
  console.log('\n=== 3. NO DURABLE INTERMEDIATE STATE — payment_intent rail (the A8 window itself) ===')
  // ===============================================================================================
  // A separate connection samples the event row continuously for the whole duration of a SUCCESSFUL
  // apply. Under rounds 1-4 it would have observed {APPLYING, attempts 1, <token>} for as long as the
  // apply transaction ran. Under the merge the only states that exist to observe are the pre-claim
  // one and the final one.
  {
    const { event, intent, obj } = await seedIntentEvent(listing, 'window-pi')
    const { context } = await authContextFor(actorId)
    const reauth = (tx) => reauthorizeAtCommit(tx, context, REPLAY_ACTION)
    const before = observable(await db().paymentEvent.findUnique({ where: { id: event.id } }))

    const observer = startObserver(event.id)
    await runIntentReplay({ event, intent, obj, reauth, wrap: () => sleep(400) })
    const seen = await observer.stop()
    const final = observable(await db().paymentEvent.findUnique({ where: { id: event.id } }))

    const intermediate = seen.filter((s) => !sameObservable(s, before) && !sameObservable(s, final))
    check('3a. the observer genuinely sampled the row (it saw at least the before and after states)',
      seen.length >= 2, JSON.stringify(seen))
    check('3b. NO INTERMEDIATE DURABLE STATE: every state a concurrent reader could observe was either the pre-claim row or the final row',
      intermediate.length === 0, JSON.stringify(intermediate))
    check('3c. specifically: the APPLYING/attempts-incremented claim state was NEVER visible to another connection',
      !seen.some((s) => s.processingStatus === 'APPLYING'), JSON.stringify(seen))
    check('3d. and the apply genuinely succeeded (this was not a vacuous window)',
      final.processingStatus === 'APPLIED' && final.attempts === 1, JSON.stringify(final))
  }

  // ===============================================================================================
  console.log('\n=== 4. NO DURABLE INTERMEDIATE STATE — stripe_checkout rail ===')
  // ===============================================================================================
  {
    const { event, session } = await seedStripeEvent(listing, 'window-sc')
    const { context } = await authContextFor(actorId)
    const reauth = (tx) => reauthorizeAtCommit(tx, context, REPLAY_ACTION)
    const before = observable(await db().paymentEvent.findUnique({ where: { id: event.id } }))

    const observer = startObserver(event.id)
    await runStripeReplay({ event, session, reauth, wrap: () => sleep(400) })
    const seen = await observer.stop()
    const final = observable(await db().paymentEvent.findUnique({ where: { id: event.id } }))

    const intermediate = seen.filter((s) => !sameObservable(s, before) && !sameObservable(s, final))
    check('4a. stripe rail: NO INTERMEDIATE DURABLE STATE was observable at any point',
      intermediate.length === 0, JSON.stringify(intermediate))
    check('4b. stripe rail: the APPLYING claim state was NEVER visible to another connection',
      !seen.some((s) => s.processingStatus === 'APPLYING'), JSON.stringify(seen))
    check('4c. and the apply genuinely succeeded', final.processingStatus === 'APPLIED' && final.attempts === 1, JSON.stringify(final))
  }

  // ===============================================================================================
  console.log('\n=== 5. RE-AUTH REFUSAL => BYTE-IDENTICAL ROLLBACK — payment_intent rail ===')
  // ===============================================================================================
  // A revocation lands between the claim and the effects. Rounds 1-4 answered this with a
  // compensating UPDATE that decremented attempts and wrote back a remembered status. Round 5 rolls
  // back to a savepoint instead, so the correct assertion is far stronger than "attempts went back
  // down": the WHOLE ROW must be identical, field for field, to what it was before the attempt.
  {
    const { event, intent } = await seedIntentEvent(listing, 'refuse-pi')
    // Seed a non-trivial prior state so a rollback is distinguishable from a lucky default.
    await db().paymentEvent.update({
      where: { id: event.id },
      data: { processingStatus: 'FAILED', attempts: 2, lastError: 'seeded by SEC-002R round 5' },
    })
    const rowBefore = await db().paymentEvent.findUnique({ where: { id: event.id } })
    const { context } = await authContextFor(actorId)
    const reauth = (tx) => reauthorizeAtCommit(tx, context, REPLAY_ACTION)

    let applyReached = false
    let outcome = null
    try {
      await runIntentReplay({
        event, intent, obj: { id: event.providerObjectId, amount_minor: event.amountMinor, currency: event.currency }, reauth,
        // The revocation lands INSIDE the claim -> effects window: the claim has been made (in this
        // transaction) and the effects have not started. It is performed from a separate connection,
        // exactly as a real concurrent logout-all would be.
        wrap: async () => { applyReached = true; await logoutAll(actorId); await sleep(100) },
      })
    } catch (err) { outcome = err }

    const rowAfter = await db().paymentEvent.findUnique({ where: { id: event.id } })
    const proof = await db().paymentProof.findFirst({ where: { provider: 'payment_intent', providerRef: intent.reference } })
    const intentAfter = await db().paymentIntent.findUnique({ where: { id: intent.id } })

    check('5a. the claim -> effects window was genuinely entered', applyReached, 'apply never ran')
    check('5b. the re-authorization REFUSED the revoked actor at the commit boundary', isBoundaryThrow(outcome),
      `${outcome?.code} ${outcome?.message?.slice(0, 120)}`)
    check('5c. the refusal is NOT a stranded-reversal error -- that error class no longer exists',
      outcome?.code !== 'PAYMENT_EVENT_REAUTH_REVERSAL_FAILED' && outcome?.reversalFailed === undefined, String(outcome?.code))
    check('5d. BYTE-IDENTICAL ROLLBACK: the ENTIRE event row is field-for-field what it was before the attempt',
      wholeRow(rowAfter) === wholeRow(rowBefore), `before=${wholeRow(rowBefore)} after=${wholeRow(rowAfter)}`)
    check('5e. specifically: attempts was not consumed, status not downgraded, lastError not overwritten',
      rowAfter.attempts === 2 && rowAfter.processingStatus === 'FAILED' && rowAfter.lastError === 'seeded by SEC-002R round 5',
      `${rowAfter.attempts}/${rowAfter.processingStatus}/${rowAfter.lastError}`)
    check('5f. NO money moved: no PaymentProof, intent not advanced', !proof && intentAfter.status !== 'SUCCEEDED',
      `${proof?.id} ${intentAfter.status}`)

    // Positive control: the identical seam with fresh authority must get past both hooks and settle.
    const fresh = await authContextFor(actorId)
    const freshReauth = (tx) => reauthorizeAtCommit(tx, fresh.context, REPLAY_ACTION)
    const ok = await runIntentReplay({ event, intent, obj: { id: event.providerObjectId, amount_minor: event.amountMinor, currency: event.currency }, reauth: freshReauth })
    const ctrl = await db().paymentEvent.findUnique({ where: { id: event.id } })
    check('5g. control: the identical seam with a live session completes', Boolean(ok), JSON.stringify(ok))
    check('5h. control: attempts DID advance to 3 -- proving 5d/5e measured a real, live counter', ctrl.attempts === 3, `attempts=${ctrl.attempts}`)
  }

  // ===============================================================================================
  console.log('\n=== 6. RE-AUTH REFUSAL => BYTE-IDENTICAL ROLLBACK — stripe_checkout rail ===')
  // ===============================================================================================
  {
    const { event, session } = await seedStripeEvent(listing, 'refuse-sc')
    await db().paymentEvent.update({
      where: { id: event.id },
      data: { processingStatus: 'DEAD_LETTERED', attempts: 4, lastError: 'seeded dead-lettered by round 5' },
    })
    const rowBefore = await db().paymentEvent.findUnique({ where: { id: event.id } })
    const { context } = await authContextFor(actorId)
    const reauth = (tx) => reauthorizeAtCommit(tx, context, REPLAY_ACTION)

    let applyReached = false
    let outcome = null
    try {
      await runStripeReplay({ event, session, reauth, wrap: async () => { applyReached = true; await logoutAll(actorId); await sleep(100) } })
    } catch (err) { outcome = err }

    const rowAfter = await db().paymentEvent.findUnique({ where: { id: event.id } })
    const proof = await db().paymentProof.findFirst({ where: { provider: 'stripe', providerRef: session.id } })

    check('6a. stripe rail: the claim -> effects window was genuinely entered', applyReached, 'apply never ran')
    check('6b. stripe rail: the re-authorization REFUSED the revoked actor', isBoundaryThrow(outcome), `${outcome?.code}`)
    check('6c. stripe rail BYTE-IDENTICAL ROLLBACK: the ENTIRE event row is field-for-field unchanged',
      wholeRow(rowAfter) === wholeRow(rowBefore), `before=${wholeRow(rowBefore)} after=${wholeRow(rowAfter)}`)
    check('6d. THE ROUND-3 §6b DEFECT STAYS CLOSED: a DEAD_LETTERED row is NOT silently un-dead-lettered by the refusal',
      rowAfter.processingStatus === 'DEAD_LETTERED' && rowAfter.attempts === 4,
      `${rowAfter.processingStatus}/${rowAfter.attempts}`)
    check('6e. stripe rail: NO PaymentProof was created by the refused attempt', !proof, String(proof?.id))

    const fresh = await authContextFor(actorId)
    const freshReauth = (tx) => reauthorizeAtCommit(tx, fresh.context, REPLAY_ACTION)
    await runStripeReplay({ event, session, reauth: freshReauth })
    const ctrl = await db().paymentEvent.findUnique({ where: { id: event.id } })
    check('6f. control: with a live session the stripe rail gets past both hooks and settles', ctrl.processingStatus === 'APPLIED', ctrl.processingStatus)
    check('6g. control: attempts DID advance to 5 -- proving 6c measured a real counter', ctrl.attempts === 5, `attempts=${ctrl.attempts}`)
  }

  // ===============================================================================================
  console.log('\n=== 7. THE RETRY CONTRACT IS UNCHANGED: a NON-reauth failure still durably consumes an attempt ===')
  // ===============================================================================================
  // This is the half the merge had to NOT break. A genuine business/data failure must roll back the
  // effects while KEEPING the attempts increment durable, or DEAD_LETTER_THRESHOLD becomes
  // unreachable and the bounded retry ceiling silently turns into an infinite loop.
  {
    // (a) a real rail failure: applyPaymentIntentEvent throws PAYMENT_INTENT_NOT_FOUND for an intent
    // id that does not exist -- a genuine, deterministic business error, not a re-authorization one.
    const { event } = await seedIntentEvent(listing, 'fail-pi')
    const { context } = await authContextFor(actorId)
    const reauth = (tx) => reauthorizeAtCommit(tx, context, REPLAY_ACTION)
    let threw = null
    try {
      await applyPaymentEventPipeline({
        eventId: event.id,
        rail: 'payment_intent',
        authorizeClaim: reauth,
        apply: (claimToken) => applyPaymentIntentEvent({
          eventId: event.id, intentId: randomUUID(), type: 'payment_intent.succeeded',
          obj: { id: event.providerObjectId }, claimToken, beforeEffects: reauth,
        }),
      })
    } catch (err) { threw = err }
    const after = await db().paymentEvent.findUnique({ where: { id: event.id } })
    check('7a. a genuine business failure still throws to the caller', threw?.code === 'PAYMENT_INTENT_NOT_FOUND', String(threw?.code))
    check('7b. RETRY CONTRACT: the attempts increment SURVIVED the failure (0 -> 1), durably committed',
      after.attempts === 1, `attempts=${after.attempts}`)
    check('7c. and the row was recorded FAILED with a sanitized lastError and the claim released',
      after.processingStatus === 'FAILED' && Boolean(after.lastError) && after.claimToken === null && after.claimExpiresAt === null,
      `${after.processingStatus}/${after.lastError}/${after.claimToken}`)

    // (b) a plain thrown error through the pipeline's own generic path, with no DB error at all --
    // proves the savepoint recovery is not merely masking an aborted-transaction artifact.
    const { event: e2 } = await seedIntentEvent(listing, 'fail-plain')
    let threw2 = null
    try {
      await applyPaymentEventPipeline({
        eventId: e2.id, rail: 'payment_intent',
        apply: async () => { throw new Error('synthetic non-reauth business failure') },
      })
    } catch (err) { threw2 = err }
    const after2 = await db().paymentEvent.findUnique({ where: { id: e2.id } })
    check('7d. a plain (non-DB) business failure behaves identically: thrown to the caller', threw2?.message === 'synthetic non-reauth business failure', String(threw2?.message))
    check('7e. RETRY CONTRACT: its attempts increment also survived and committed FAILED',
      after2.attempts === 1 && after2.processingStatus === 'FAILED', `${after2.attempts}/${after2.processingStatus}`)
  }

  // ===============================================================================================
  console.log('\n=== 8. THE DEAD-LETTER CEILING IS STILL REACHABLE ===')
  // ===============================================================================================
  // The single most important consequence of §7. If the merge had rolled the increment back with the
  // effects, this could never happen at all.
  {
    const { event } = await seedIntentEvent(listing, 'deadletter')
    await db().paymentEvent.update({ where: { id: event.id }, data: { processingStatus: 'FAILED', attempts: DEAD_LETTER_THRESHOLD - 1 } })
    let threw = null
    try {
      await applyPaymentEventPipeline({
        eventId: event.id, rail: 'payment_intent',
        apply: async () => { throw new Error('synthetic failure at the dead-letter threshold') },
      })
    } catch (err) { threw = err }
    const after = await db().paymentEvent.findUnique({ where: { id: event.id } })
    check('8a. the failing attempt still throws', Boolean(threw), 'did not throw')
    check(`8b. attempts reached DEAD_LETTER_THRESHOLD (${DEAD_LETTER_THRESHOLD}) and the row was DEAD_LETTERED`,
      after.attempts === DEAD_LETTER_THRESHOLD && after.processingStatus === 'DEAD_LETTERED',
      `${after.attempts}/${after.processingStatus}`)
  }

  // ===============================================================================================
  console.log('\n=== 9. INTERLEAVED CONCURRENCY + MID-WINDOW REVOCATION — payment_intent rail ===')
  // ===============================================================================================
  // The test the owner specifically asked for. THREE genuinely simultaneous claim/replay attempts on
  // the SAME event, started within the same few milliseconds, with a real logout-all landing in the
  // middle of the interleaving window. Repeated, asserting on DIRECT DB STATE.
  //
  // The invariant: the row must land on EXACTLY ONE of two coherent outcomes --
  //   (A) fully applied  : APPLIED, attempts 1, claim released, EXACTLY ONE PaymentProof
  //   (B) fully rolled back: byte-identical to the pre-attempt row, attempts 0, ZERO PaymentProofs
  // Anything else -- attempts incremented with nothing resolved, a claim left held, two proofs, a
  // proof with the row not APPLIED -- is torn state, and is what this section exists to catch.
  {
    const REPS = 6
    const torn = []
    let outcomeA = 0
    let outcomeB = 0
    for (let rep = 0; rep < REPS; rep++) {
      const { event, intent, obj } = await seedIntentEvent(listing, `conc-pi-${rep}`)
      const rowBefore = await db().paymentEvent.findUnique({ where: { id: event.id } })
      const { context } = await authContextFor(actorId)
      const reauth = (tx) => reauthorizeAtCommit(tx, context, REPLAY_ACTION)

      // Started as close together as the runtime allows: three promises constructed back to back in
      // one synchronous block, before any await.
      const workers = [0, 1, 2].map(() =>
        runIntentReplay({ event, intent, obj, reauth, wrap: () => sleep(250) })
          .then((value) => ({ value }), (err) => ({ err })))
      // The revocation lands in the MIDDLE of that window -- after the first worker has claimed
      // (inside its transaction) and before any of them reaches its effects.
      const revocation = (async () => { await sleep(80); return logoutAll(actorId) })()
      const settled = await Promise.all(workers)
      const revoked = await revocation

      const after = await db().paymentEvent.findUnique({ where: { id: event.id } })
      const proofs = await db().paymentProof.count({ where: { provider: 'payment_intent', providerRef: intent.reference } })

      const fullyApplied = after.processingStatus === 'APPLIED' && after.attempts === 1 &&
        after.claimToken === null && after.claimExpiresAt === null && proofs === 1
      const fullyRolledBack = wholeRow(after) === wholeRow(rowBefore) && after.attempts === 0 && proofs === 0
      if (fullyApplied) outcomeA++
      else if (fullyRolledBack) outcomeB++
      else torn.push({ rep, revoked, after: observable(after), proofs, settled: settled.map((s) => s.err?.code ?? s.value) })
    }
    check(`9a. THE INTERLEAVING PROOF: across ${REPS} repetitions of 3 simultaneous attempts with a revocation landing mid-window, EVERY repetition landed on exactly ONE coherent outcome -- never torn state`,
      torn.length === 0, JSON.stringify(torn))
    check('9b. and the race was real: both outcomes are legitimate, but at least one repetition was genuinely refused and fully rolled back',
      outcomeB > 0, `fully-applied=${outcomeA} fully-rolled-back=${outcomeB}`)
    check('9c. no repetition was ever left with an incremented attempts count and nothing resolved (the exact A8 residual)',
      torn.length === 0, JSON.stringify(torn))
  }

  // ===============================================================================================
  console.log('\n=== 10. INTERLEAVED CONCURRENCY + MID-WINDOW REVOCATION — stripe_checkout rail ===')
  // ===============================================================================================
  {
    const REPS = 6
    const torn = []
    let outcomeA = 0
    let outcomeB = 0
    for (let rep = 0; rep < REPS; rep++) {
      const { event, session } = await seedStripeEvent(listing, `conc-sc-${rep}`)
      const rowBefore = await db().paymentEvent.findUnique({ where: { id: event.id } })
      const { context } = await authContextFor(actorId)
      const reauth = (tx) => reauthorizeAtCommit(tx, context, REPLAY_ACTION)

      const workers = [0, 1, 2].map(() =>
        runStripeReplay({ event, session, reauth, wrap: () => sleep(250) })
          .then((value) => ({ value }), (err) => ({ err })))
      const revocation = (async () => { await sleep(80); return logoutAll(actorId) })()
      const settled = await Promise.all(workers)
      const revoked = await revocation

      const after = await db().paymentEvent.findUnique({ where: { id: event.id } })
      const proofs = await db().paymentProof.count({ where: { provider: 'stripe', providerRef: session.id } })

      const fullyApplied = after.processingStatus === 'APPLIED' && after.attempts === 1 &&
        after.claimToken === null && after.claimExpiresAt === null && proofs === 1
      const fullyRolledBack = wholeRow(after) === wholeRow(rowBefore) && after.attempts === 0 && proofs === 0
      if (fullyApplied) outcomeA++
      else if (fullyRolledBack) outcomeB++
      else torn.push({ rep, revoked, after: observable(after), proofs, settled: settled.map((s) => s.err?.code ?? s.value) })
    }
    check(`10a. stripe rail: across ${REPS} repetitions of 3 simultaneous attempts with a mid-window revocation, EVERY repetition landed on exactly ONE coherent outcome`,
      torn.length === 0, JSON.stringify(torn))
    check('10b. stripe rail: the race was real (at least one repetition was refused and fully rolled back)',
      outcomeB > 0, `fully-applied=${outcomeA} fully-rolled-back=${outcomeB}`)
  }

  // ===============================================================================================
  console.log('\n=== 11. SERIALIZATION CONTROL: 5 simultaneous attempts, NO revocation -> exactly one effect ===')
  // ===============================================================================================
  // Proves the merged transaction's row lock genuinely serializes concurrent claimants rather than
  // letting several through: exactly one attempt may consume an attempt and produce an effect.
  {
    const badReps = []
    for (let rep = 0; rep < 4; rep++) {
      const { event, intent, obj } = await seedIntentEvent(listing, `serial-${rep}`)
      const { context } = await authContextFor(actorId)
      const reauth = (tx) => reauthorizeAtCommit(tx, context, REPLAY_ACTION)
      const settled = await Promise.all([0, 1, 2, 3, 4].map(() =>
        runIntentReplay({ event, intent, obj, reauth }).then((value) => ({ value }), (err) => ({ err }))))
      const after = await db().paymentEvent.findUnique({ where: { id: event.id } })
      const proofs = await db().paymentProof.count({ where: { provider: 'payment_intent', providerRef: intent.reference } })
      const ok = after.processingStatus === 'APPLIED' && after.attempts === 1 && proofs === 1 &&
        after.claimToken === null && settled.filter((s) => s.value?.applied === true).length === 1
      if (!ok) badReps.push({ rep, after: observable(after), proofs, settled: settled.map((s) => s.err?.code ?? s.value) })
    }
    check('11a. 5 simultaneous attempts x 4 repetitions: exactly ONE consumed an attempt, exactly ONE effect exists, exactly ONE reported applied',
      badReps.length === 0, JSON.stringify(badReps))
  }

  // ===============================================================================================
  console.log('\n=== 12. THE ROUND-3 STALE-priorStatus RACE IS STILL CLOSED (and now closed twice over) ===')
  // ===============================================================================================
  // Round 3 fixed a race where priorStatus was read WITHOUT a lock before the locking CAS, so a
  // concurrent commit of DEAD_LETTERED could be silently un-dead-lettered by a reversal writing back
  // the stale FAILED value. The locking read is unchanged. On top of it, the restore is now performed
  // by ROLLBACK TO SAVEPOINT rather than by writing a remembered value back at all -- so even a
  // hypothetically stale priorStatus could no longer corrupt anything.
  {
    const { event, intent } = await seedIntentEvent(listing, 'stale')
    await db().paymentEvent.update({ where: { id: event.id }, data: { processingStatus: 'FAILED', attempts: 1, lastError: 'seeded FAILED, flipped mid-claim' } })
    const { context } = await authContextFor(actorId)
    const reauth = (tx) => reauthorizeAtCommit(tx, context, REPLAY_ACTION)

    let pipelinePromise = null
    let blockedObserved = false
    await db().$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT id FROM payment_events WHERE id = '${event.id}'::uuid FOR UPDATE`)
      pipelinePromise = runIntentReplay({
        event, intent, obj: { id: event.providerObjectId, amount_minor: event.amountMinor, currency: event.currency }, reauth,
        wrap: async () => { await logoutAll(actorId); await sleep(100) },
      }).then((value) => ({ value }), (err) => ({ err }))
      // Prove the pipeline's own prior-status read genuinely BLOCKS on our row lock.
      for (let i = 0; i < 120 && !blockedObserved; i++) {
        const rows = await db().$queryRawUnsafe("SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted AND locktype IN ('transactionid','tuple')")
        if ((rows[0]?.n ?? 0) > 0) blockedObserved = true
        else await sleep(50)
      }
      await tx.$executeRawUnsafe(`UPDATE payment_events SET processing_status = 'DEAD_LETTERED' WHERE id = '${event.id}'::uuid`)
    }, { timeout: 60_000, maxWait: 30_000 })

    const settled = await pipelinePromise
    const after = await db().paymentEvent.findUnique({ where: { id: event.id } })
    check('12a. the pipeline\'s prior-status read genuinely BLOCKED on the row lock (it is still a locking read)', blockedObserved, 'no row-lock waiter observed')
    check('12b. the re-authorization refused the revoked actor', isBoundaryThrow(settled.err), `${settled.err?.code} ${JSON.stringify(settled.value)}`)
    check('12c. THE FIX HOLDS: the event is left at DEAD_LETTERED -- its TRUE, concurrently-committed prior status',
      after.processingStatus === 'DEAD_LETTERED', after.processingStatus)
    check('12d. THE DEFECT STAYS CLOSED: it was NOT silently un-dead-lettered back to the stale FAILED value',
      after.processingStatus !== 'FAILED', after.processingStatus)
    check('12e. attempts is back at the pre-claim value', after.attempts === 1, `attempts=${after.attempts}`)
  }

  // ===============================================================================================
  console.log('\n=== 13. THE SWALLOWED-FAILURE DEFECT IS NOW STRUCTURALLY IMPOSSIBLE, NOT MERELY HANDLED ===')
  // ===============================================================================================
  // Round 3 could only bound this defect: the reversal ran in its own transaction, so its failure had
  // to be retried and, on exhaustion, recorded as a durable "stranded claim" marker. Round 5 removes
  // the reversal transaction entirely -- there is no separate step left whose failure could be
  // swallowed, and therefore no stranded-claim condition to record.
  {
    const raw = readFileSync(new URL('../../server/lib/payment-event-pipeline.mjs', import.meta.url), 'utf8')
    // CODE only. The file's own comments deliberately still NAME the deleted helpers, to record what
    // was removed and why -- scanning the raw text would match that prose and prove nothing.
    const src = raw.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n')
    check('13a. the separate compensating-reversal transaction is GONE from the pipeline code (no reverseRefusedClaim)',
      !src.includes('reverseRefusedClaim'), 'reverseRefusedClaim still exists in code')
    check('13b. the stranded-claim marker writer is GONE from the pipeline code (no recordStrandedClaim)',
      !src.includes('recordStrandedClaim'), 'recordStrandedClaim still exists in code')
    check('13c. the PAYMENT_EVENT_REAUTH_REVERSAL_FAILED error class can no longer be raised at all',
      !src.includes('PAYMENT_EVENT_REAUTH_REVERSAL_FAILED'), 'the stranded error is still raised')
    check('13d. the failure path no longer opens ANY separate transaction: the pipeline has exactly one $transaction',
      (src.match(/\$transaction\(/g) || []).length === 1, `found ${(src.match(/\$transaction\(/g) || []).length}`)
    check('13e. and it does use the two savepoints the merge depends on',
      src.includes('SP_BEFORE_CLAIM') && src.includes('SP_BEFORE_EFFECTS'), 'savepoint constants missing')
    // The retry constants the old compensating transaction needed are gone with it.
    check('13g. the reversal retry/backoff machinery is gone too (no REVERSAL_MAX_ATTEMPTS)',
      !src.includes('REVERSAL_MAX_ATTEMPTS'), 'reversal retry constants still present')

    const strandedNow = await db().adminAuditLog.count({ where: { action: 'PAYMENT_EVENT_REAUTH_REVERSAL_FAILED' } })
    check('13f. BEHAVIOURAL: across every refusal this suite performed, ZERO stranded-claim reconciliation markers were written',
      strandedNow === strandedMarkersAtStart, `before=${strandedMarkersAtStart} after=${strandedNow}`)
  }

  // ===============================================================================================
  console.log('\n=== 14. THE EVENT-ROW LOCK IS HELD FOR THE ENTIRE MERGED TRANSACTION, NOT JUST THE CLAIM ===')
  // ===============================================================================================
  // The merge is only meaningful if the lock taken before the claim survives to the commit -- through
  // the effects, and through a ROLLBACK TO SAVEPOINT. Probed directly with FOR UPDATE NOWAIT from a
  // separate connection at several points during a deliberately-widened apply.
  {
    const { event, intent, obj } = await seedIntentEvent(listing, 'lockspan')
    const { context } = await authContextFor(actorId)
    const reauth = (tx) => reauthorizeAtCommit(tx, context, REPLAY_ACTION)
    const probes = []
    const probeLock = async () => {
      try {
        await db().$transaction(async (t) => {
          await t.$queryRawUnsafe(`SELECT id FROM payment_events WHERE id = '${event.id}'::uuid FOR UPDATE NOWAIT`)
        })
        return 'FREE'
      } catch (e) { return /55P03|could not obtain lock|lock/i.test(String(e?.message)) ? 'LOCKED' : `ERR:${String(e?.message).slice(0, 60)}` }
    }
    await runIntentReplay({
      event, intent, obj, reauth,
      wrap: async () => {
        for (let i = 0; i < 4; i++) { probes.push(await probeLock()); await sleep(60) }
      },
    })
    probes.push(`after-commit:${await probeLock()}`)
    check('14a. the event row was LOCKED at every probe taken during the merged transaction\'s effects phase',
      probes.slice(0, 4).every((p) => p === 'LOCKED'), JSON.stringify(probes))
    check('14b. and the lock was released once, at commit -- not earlier', probes[4] === 'after-commit:FREE', JSON.stringify(probes))
  }

  // ===============================================================================================
  console.log('\n=== 15. THE EFFECTS RE-AUTHORIZATION RUNS INSIDE THE SAME TRANSACTION AS THE CLAIM (both rails) ===')
  // ===============================================================================================
  // The positive statement of §3/§4. Inside the rail's beforeEffects hook -- the exact place the
  // commit-boundary re-authorization runs -- the claim is visible THROUGH THE TRANSACTION and
  // invisible from every other connection. That pair of facts is only true if the claim and the
  // effects share one transaction, which is the entire round-5 change.
  for (const rail of ['payment_intent', 'stripe_checkout']) {
    const seeded = rail === 'payment_intent'
      ? await seedIntentEvent(listing, 'sametx-pi')
      : await seedStripeEvent(listing, 'sametx-sc')
    const { context } = await authContextFor(actorId)
    let insideTx = null
    let outsideTx = null
    const reauth = async (tx) => {
      const r = await reauthorizeAtCommit(tx, context, REPLAY_ACTION)
      if (insideTx === null) {
        const rows = await tx.$queryRawUnsafe(`SELECT processing_status, attempts, claim_token FROM payment_events WHERE id = '${seeded.event.id}'::uuid`)
        insideTx = { processingStatus: rows[0]?.processing_status, attempts: Number(rows[0]?.attempts), claimToken: rows[0]?.claim_token }
        outsideTx = observable(await db().paymentEvent.findUnique({ where: { id: seeded.event.id } }))
      }
      return r
    }
    if (rail === 'payment_intent') await runIntentReplay({ event: seeded.event, intent: seeded.intent, obj: seeded.obj, reauth })
    else await runStripeReplay({ event: seeded.event, session: seeded.session, reauth })

    check(`15-${rail}-a. INSIDE the transaction the commit-boundary check sees the claim it is protecting (APPLYING, attempts 1, a token held)`,
      insideTx?.processingStatus === 'APPLYING' && insideTx?.attempts === 1 && Boolean(insideTx?.claimToken), JSON.stringify(insideTx))
    check(`15-${rail}-b. at that SAME instant, a separate connection still sees the PRE-CLAIM row -- the claim is not durable yet`,
      outsideTx?.processingStatus === 'RECEIVED' && outsideTx?.attempts === 0 && outsideTx?.claimToken === null, JSON.stringify(outsideTx))
    const final = await db().paymentEvent.findUnique({ where: { id: seeded.event.id } })
    check(`15-${rail}-c. and both became durable together at the single commit`,
      final.processingStatus === 'APPLIED' && final.attempts === 1, `${final.processingStatus}/${final.attempts}`)
  }
} finally {
  await cleanupActor()
}

console.log(`\n=== SEC-002R ROUND 5 RESULT: ${pass} passed, ${fail} failed ===`)
await disconnectDb()
process.exit(fail ? 1 : 0)
