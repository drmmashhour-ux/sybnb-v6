// SYBNB — SEC-002R ROUND 2: the stripe_checkout REPLAY rail's commit boundary (finding A8).
//
// WHY THIS IS A SEPARATE FILE
//
// Round 1 raced the admin payment-event replay on the payment_intent rail only. The replay route
// serves BOTH rails, and the stripe_checkout rail reaches a completely different apply implementation
// (applyStripeCheckoutEvent -> finalizeStripeSession, which manages its own transaction and is also
// called synchronously from a non-webhook route) -- so "the payment_intent rail is safe" says nothing
// about it. Independent review named exactly that as an untested claim.
//
// It cannot live in the main round-2 suite because the stripe_checkout REPLAY operation is refused by
// payment policy on the ordinary server: 'stripe' is absent from APPROVED_PROVIDER_CONFIGS, and
// PAYMENT_OPERATION_STRIPE_CHECKOUT_REPLAY_ENABLED is not set there either. It runs against the
// stripe-approved, NODE_ENV=test server the suite runner already starts on :3052 for
// payment-event-stripe-policy-deferred-recovery.e2e.mjs (see scripts/run-all-e2e.sh) -- the same
// test-runtime-only synthetic approval, never a real one.
//
// WHAT IT PROVES (the A8 assertions, on this rail)
//   - a revoked admin's replay is refused with a commit-boundary code, not a 401
//   - `attempts` does NOT advance -- the claim itself is now gated
//   - the event is NOT pushed to DEAD_LETTERED, and not stranded at APPLYING
//   - no PaymentProof, no wallet entries, no booking confirmation
//   - and the identical replay with a live session genuinely commits all of it
//
// Run: API_BASE=http://127.0.0.1:3052 node tests/e2e/commit-boundary-reauthorization-stripe-round2.e2e.mjs

import { randomUUID } from 'node:crypto'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'
import { issueUserSession } from '../../server/lib/session-store.mjs'
import { hashPassword } from '../../server/lib/security.mjs'

const API = process.env.API_BASE_APPROVED || process.env.API_BASE || 'http://127.0.0.1:3052'

let pass = 0
let fail = 0
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`   PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) }
}
const code = (r) => r.j?.error?.code || r.j?.code
const BOUNDARY_CODES = [
  'SESSION_REVOKED_BEFORE_COMMIT',
  'SESSION_EPOCH_STALE_BEFORE_COMMIT',
  'ACCOUNT_NOT_ACTIVE_BEFORE_COMMIT',
  'ROLE_REVOKED_BEFORE_COMMIT',
]

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function adminActionCount(adminId) {
  const row = await db().rateLimitBucket.findFirst({ where: { bucketKey: `admin-action:${adminId}` } })
  return row?.count ?? 0
}
async function waitForAdmission(adminId, baseline, label) {
  for (let i = 0; i < 60; i++) {
    if ((await adminActionCount(adminId)) > baseline) return true
    await sleep(50)
  }
  console.log(`   (admission marker never advanced for ${label})`)
  return false
}
// T2 -- the replay route reads no request body, so the stall is created by holding a lock on the
// first table it touches after admission. Taken by the TEST; production code is untouched.
async function withTableLock(table, body) {
  return db().$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`)
    return body()
  }, { timeout: 60_000, maxWait: 30_000 })
}
async function waitForBlockedOn(table, label) {
  for (let i = 0; i < 100; i++) {
    const rows = await db().$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
       WHERE c.relname = '${table}' AND NOT l.granted`,
    )
    if ((rows[0]?.n ?? 0) > 0) return true
    await sleep(50)
  }
  console.log(`   (never observed a blocked lock on ${table} for ${label})`)
  return false
}

const RUN = Date.now()
const ids = { actor: randomUUID(), host: randomUUID(), guest: randomUUID() }
async function makeUser(id, roles) {
  await db().user.create({
    data: {
      id,
      email: `sec002r2s-${id.slice(0, 8)}-${RUN}@sybnb.test`,
      passwordHash: hashPassword('Sec002R-Round2-Stripe-Pw!'),
      displayName: `sec002r2s-${id.slice(0, 8)}`,
      status: 'ACTIVE',
      roles: { create: roles.map((role) => ({ role })) },
    },
  })
}
async function cleanup() {
  const all = Object.values(ids)
  await db().rateLimitBucket.deleteMany({ where: { bucketKey: { in: all.map((id) => `admin-action:${id}`) } } }).catch(() => {})
  for (const id of all) {
    await db().adminAuditLog.deleteMany({ where: { OR: [{ actorUserId: id }, { entityId: id }] } }).catch(() => {})
    await db().user.delete({ where: { id } }).catch(() => {})
  }
}
async function session(userId) {
  const user = await db().user.findUnique({ where: { id: userId }, include: { roles: true } })
  return issueUserSession(user)
}

async function main() {
  console.log('=== SEC-002R ROUND 2 — STRIPE_CHECKOUT REPLAY RAIL (A8) ===')
  console.log(`    API: ${API}`)
  await cleanup()
  await makeUser(ids.actor, ['ADMIN'])
  await makeUser(ids.host, ['HOST'])
  await makeUser(ids.guest, ['GUEST'])

  // Fixtures are seeded directly: this suite is about the replay rail's commit boundary, not about
  // the listing/booking creation flow (which the main round-2 suite exercises through the real API).
  const listing = await db().listing.create({
    data: { ownerId: ids.host, division: 'STAYS', titleAr: 'شقة ستريب R2', titleEn: 'SEC-002R2 stripe flat', priceMinor: 200_000, currency: 'SYP', status: 'APPROVED' },
  })
  const booking = await db().booking.create({
    data: { listingId: listing.id, guestId: ids.guest, amountMinor: 200_000, currency: 'SYP', status: 'PAYMENT_PENDING' },
  })
  const checkoutSessionId = `cs_test_r2rail_${randomUUID().replace(/-/g, '')}`
  // attempts = DEAD_LETTER_THRESHOLD - 1: one more increment dead-letters this event, which is
  // exactly the escalation a revoked admin must not be able to cause.
  const event = await db().paymentEvent.create({
    data: {
      rail: 'stripe_checkout', provider: 'stripe', providerEndpointKey: 'stripe-test-approved',
      environment: 'test', subjectType: 'CHECKOUT_SESSION', providerReference: checkoutSessionId,
      providerEventId: `evt_r2rail_${randomUUID()}`, type: 'checkout.session.completed',
      amountMinor: 200_000, currency: 'SYP', providerObjectId: checkoutSessionId,
      payloadDigest: 'sec002r2-stripe-rail-digest', paymentStatus: 'paid',
      bookingId: booking.id, originalBookingId: booking.id,
      processingStatus: 'FAILED', attempts: 4, lastError: 'seeded one attempt below the dead-letter threshold',
    },
  })
  check('fixture: stripe_checkout event seeded FAILED at attempts=4', event.attempts === 4 && event.processingStatus === 'FAILED', JSON.stringify({ a: event.attempts, s: event.processingStatus }))

  const raceToken = (await session(ids.actor)).token
  const baseline = await adminActionCount(ids.actor)
  let pending
  await withTableLock('payment_events', async () => {
    pending = call('POST', `/api/admin/payment-events/${event.id}/replay`, raceToken, undefined)
    const admitted = await waitForAdmission(ids.actor, baseline, 'stripe-replay')
    check('a. request was ADMITTED with full ADMIN authority', admitted, 'admission marker never advanced')
    const blocked = await waitForBlockedOn('payment_events', 'stripe-replay')
    check('b. request is genuinely IN FLIGHT (ungranted lock on payment_events)', blocked, 'no blocked lock seen')
    const revokeToken = (await session(ids.actor)).token
    const out = await call('POST', '/api/auth/logout-all', revokeToken, {})
    check('c. logout-all revoked the acting admin mid-request', out.status === 200, JSON.stringify(out.j))
  })
  const res = await pending

  check('d. in-flight stripe_checkout replay is REFUSED', res.status !== 200, `status=${res.status} body=${JSON.stringify(res.j).slice(0, 300)}`)
  check('e. refusal is a COMMIT-BOUNDARY refusal (not a policy denial, not a 401)',
    BOUNDARY_CODES.includes(code(res)), `${res.status} ${code(res)}`)

  const after = await db().paymentEvent.findUnique({ where: { id: event.id } })
  check('f. DB(A8): attempts did NOT advance (still 4)', after.attempts === 4, `attempts=${after.attempts}`)
  check('g. DB(A8): the event was NOT pushed to DEAD_LETTERED', after.processingStatus !== 'DEAD_LETTERED', after.processingStatus)
  check('h. DB(A8): the event was not stranded at APPLYING', after.processingStatus === 'FAILED', after.processingStatus)
  check('i. DB(A8): no claim left held', after.claimToken === null && after.claimExpiresAt === null,
    `claimToken=${after.claimToken} claimExpiresAt=${after.claimExpiresAt}`)
  check('j. DB(A8): lastError not overwritten by the refused attempt',
    after.lastError === 'seeded one attempt below the dead-letter threshold', String(after.lastError).slice(0, 120))
  const proof = await db().paymentProof.findFirst({ where: { provider: 'stripe', providerRef: checkoutSessionId } })
  check('k. DB: NO PaymentProof was created', !proof, JSON.stringify(proof?.id))
  const hold = await db().walletEntry.findFirst({ where: { referenceType: 'booking_payout', referenceId: booking.id } })
  check('l. DB: NO host HOLD wallet entry', !hold, JSON.stringify(hold?.id))
  const share = await db().walletEntry.findFirst({ where: { referenceType: 'booking_admin_share', referenceId: booking.id } })
  check('m. DB: NO platform-share wallet entry', !share, JSON.stringify(share?.id))
  const bookingAfter = await db().booking.findUnique({ where: { id: booking.id } })
  check('n. DB: booking still PAYMENT_PENDING', bookingAfter.status === 'PAYMENT_PENDING', bookingAfter.status)

  // Positive control -- without it, every refusal above could be a broken rail rather than a blocked race.
  const fresh = (await session(ids.actor)).token
  const ok = await call('POST', `/api/admin/payment-events/${event.id}/replay`, fresh, undefined)
  check('o. control: identical replay with a live session SUCCEEDS', ok.status === 200, JSON.stringify(ok.j).slice(0, 300))
  const eventOk = await db().paymentEvent.findUnique({ where: { id: event.id } })
  check('p. DB: control genuinely committed (event APPLIED)', eventOk.processingStatus === 'APPLIED', eventOk.processingStatus)
  check('q. DB: the control attempt DID advance attempts to 5 (proving f measured a real counter)', eventOk.attempts === 5, `attempts=${eventOk.attempts}`)
  const proofOk = await db().paymentProof.findFirst({ where: { provider: 'stripe', providerRef: checkoutSessionId } })
  check('r. DB: control genuinely committed (PaymentProof created and APPROVED)', proofOk?.status === 'APPROVED', String(proofOk?.status))

  console.log(`\n=== SEC-002R ROUND 2 STRIPE RAIL RESULT: ${pass} passed, ${fail} failed ===`)
}

try {
  await main()
} catch (err) {
  fail++
  console.log(`  FAIL  suite threw -> ${err?.stack || err}`)
  console.log(`\n=== SEC-002R ROUND 2 STRIPE RAIL RESULT: ${pass} passed, ${fail} failed ===`)
} finally {
  await cleanup().catch(() => {})
  await disconnectDb()
}
process.exit(fail ? 1 : 0)
