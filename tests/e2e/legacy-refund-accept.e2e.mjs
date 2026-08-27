// SYBNB — Item 2 Phase 2b round 1: legacy_refund_accept E2E (governed evidence artifact).
//
// Proves, over real HTTP against the real running server + real Postgres, that the
// PATCH /api/admin/refunds/:refundId/legacy-accept route correctly implements the approved 6-step
// legacy_refund_accept transaction (already proven at the schema level, as raw SQL, in the Item 2
// Phase 2a evidence package) and enforces every mandatory boundary from this round's authorization:
//   - ADMIN-only (policy-gated, not just route-level requireAuth)
//   - applies ONLY to migrated legacy refunds (never a non-legacy ACTION_REQUIRED refund)
//   - applies ONLY to refunds with a real LEGACY_PENDING_CONFIRMATION attempt -- a refund whose only
//     attempt is LEGACY_UNVERIFIED is refused, by explicit owner decision (Finding 8): zero-evidence
//     legacy rows get no automated acceptance path in this phase.
//   - reasonCode is never written by this route at all (it only transitions an existing Refund's
//     status; reasonCode was set once, at backfill time, and is immutable here) -- confirmed by
//     reading it back unchanged after acceptance.
//   - a genuine two-process concurrency race on the same refund: exactly one winner, one loser
//     refused with zero effects, no double-acceptance.
//   - a sequential re-run on an already-accepted refund is refused with zero further effects.
//   - malformed reason input is refused before any transaction opens.
//   - the payment_proof counter transfer and refund/attempt status transitions match exactly, with
//     the superseded original attempt's own immutable/supersession-once triggers (already proven at
//     the schema level) enforced transparently underneath this route.
//
// Fixture note: LEGACY_PENDING_CONFIRMATION/LEGACY_UNVERIFIED attempts only ever exist from the
// one-time historical backfill (scripts/migrate-legacy-refunds-2a.mjs) -- no live route creates them
// (Phase 2b round 1 deliberately excludes new refund request creation). This suite seeds that exact
// shape directly via Prisma, mirroring the backfill script's own construction precisely, since there
// is no HTTP-driven path that could ever produce it.
//
// Run: AUTH_SECRET=<secret> ADMIN=<uuid> HOST=<uuid> GUEST=<uuid>
//      node tests/e2e/legacy-refund-accept.e2e.mjs
//      (server must run with the full payment-policy config this repo's run-all-e2e.sh sets,
//      including PAYMENT_OPERATION_MANUAL_PROOF_LEGACY_REFUND_ACCEPT_ENABLED=true)

import { randomUUID } from 'node:crypto'
import { createSessionToken } from '../../server/lib/security.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'

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

// Seeds a listing + booking + payment_proof directly (minimal, valid rows -- no HTTP flow needed
// for these, since this suite's focus is the accept route, not the booking pipeline).
async function seedProofAndBooking(amountMinor) {
  const listing = await db().listing.create({
    data: { ownerId: host.id, division: 'STAYS', titleAr: 'شقة اختبار LRA', priceMinor: amountMinor, status: 'APPROVED' },
  })
  const booking = await db().booking.create({
    data: { listingId: listing.id, guestId: guest.id, amountMinor, status: 'CANCELLED' },
  })
  const proof = await db().paymentProof.create({
    data: {
      bookingId: booking.id, userId: guest.id, provider: 'payment_intent', status: 'REFUNDED',
      amountMinor, currency: 'SYP', providerRef: `pi_lra_${randomUUID()}`,
    },
  })
  return { listing, booking, proof }
}

// reservedOverride lets a test deliberately desync PaymentProof.reservedRefundMinor from this
// refund's own amountMinor -- default is the correct, in-sync value every real backfilled row has.
// proofAmountMinor lets the underlying proof carry MORE total capacity than this refund needs (a
// prerequisite for a realistic over-reservation scenario -- reservedRefundMinor can never itself
// exceed proof.amountMinor, per the refund_minor_within_amount CHECK from Phase 2a).
async function seedLegacyPendingConfirmationRefund(amountMinor, reservedOverride, proofAmountMinor) {
  const { proof } = await seedProofAndBooking(proofAmountMinor ?? amountMinor)
  const event = await db().paymentEvent.create({
    data: {
      providerEventId: `evt_lra_${randomUUID()}`, type: 'charge.refunded', rail: 'payment_intent',
      provider: 'sandbox', providerEndpointKey: 'sandbox-test-account', environment: 'test',
      subjectType: 'PAYMENT_INTENT', providerReference: proof.providerRef, processingStatus: 'APPLIED',
    },
  })
  const refund = await db().refund.create({
    data: {
      paymentProofId: proof.id, bookingId: proof.bookingId, amountMinor, currency: proof.currency,
      reason: 'test fixture', reasonCode: 'LEGACY_UNKNOWN', rail: 'payment_intent',
      status: 'ACTION_REQUIRED', reservationHeld: true, migratedFromLegacy: true,
    },
  })
  const attempt = await db().refundAttempt.create({
    data: {
      refundId: refund.id, status: 'LEGACY_PENDING_CONFIRMATION', migratedFromLegacy: true,
      completedAt: new Date(), legacyPaymentEventId: event.id,
    },
  })
  await db().paymentProof.update({ where: { id: proof.id }, data: { reservedRefundMinor: reservedOverride ?? amountMinor } })
  return { proof, refund, attempt, event }
}

async function seedLegacyUnverifiedRefund(amountMinor) {
  const { proof } = await seedProofAndBooking(amountMinor)
  const refund = await db().refund.create({
    data: {
      paymentProofId: proof.id, bookingId: proof.bookingId, amountMinor: proof.amountMinor, currency: proof.currency,
      reason: 'test fixture', reasonCode: 'LEGACY_UNKNOWN', rail: 'payment_intent',
      status: 'ACTION_REQUIRED', reservationHeld: true, migratedFromLegacy: true,
    },
  })
  const attempt = await db().refundAttempt.create({
    data: { refundId: refund.id, status: 'LEGACY_UNVERIFIED', migratedFromLegacy: true, completedAt: new Date() },
  })
  await db().paymentProof.update({ where: { id: proof.id }, data: { reservedRefundMinor: proof.amountMinor } })
  return { proof, refund, attempt }
}

async function seedNonLegacyActionRequiredRefund(amountMinor) {
  const { proof } = await seedProofAndBooking(amountMinor)
  const refund = await db().refund.create({
    data: {
      paymentProofId: proof.id, bookingId: proof.bookingId, amountMinor: proof.amountMinor, currency: proof.currency,
      reason: 'test fixture (non-legacy)', reasonCode: 'ADMIN_REJECTED_BOOKING', rail: 'payment_intent',
      status: 'ACTION_REQUIRED', reservationHeld: true, migratedFromLegacy: false,
    },
  })
  await db().paymentProof.update({ where: { id: proof.id }, data: { reservedRefundMinor: proof.amountMinor } })
  return { proof, refund }
}

async function main() {
  console.log('=== LEGACY_REFUND_ACCEPT E2E ===')

  // --- 1. Happy path: full 6-step transaction over real HTTP ---
  {
    const { proof, refund, attempt } = await seedLegacyPendingConfirmationRefund(107000)
    const res = await call('PATCH', `/api/admin/refunds/${refund.id}/legacy-accept`, A, { reason: 'accepted per manual review' })
    check('happy path: HTTP 200', res.status === 200, JSON.stringify(res.j))
    check('happy path: refund status ACCOUNTING_ACCEPTED', res.j?.refund?.status === 'ACCOUNTING_ACCEPTED', res.j?.refund?.status)
    check('happy path: reservationHeld false', res.j?.refund?.reservationHeld === false, res.j?.refund?.reservationHeld)
    check('happy path: reasonCode unchanged (LEGACY_UNKNOWN, never rewritten by this route)', res.j?.refund?.reasonCode === 'LEGACY_UNKNOWN', res.j?.refund?.reasonCode)
    check('happy path: succeededAt still null (never conflated with genuine SUCCEEDED)', res.j?.refund?.succeededAt === null, res.j?.refund?.succeededAt)

    const attempts = res.j?.refund?.attempts || []
    const original = attempts.find((a) => a.id === attempt.id)
    const accepted = attempts.find((a) => a.status === 'LEGACY_ACCOUNTING_ACCEPTED')
    check('happy path: exactly 2 attempts (original + new)', attempts.length === 2, attempts.length)
    check('happy path: original attempt superseded by the new one', original?.supersededByAttemptId === accepted?.id, JSON.stringify({ original, accepted }))
    check('happy path: new attempt legacyAcceptedByUserId is the real actor', accepted?.legacyAcceptedByUserId === admin.id, accepted?.legacyAcceptedByUserId)
    check('happy path: new attempt has a real 64-hex evidenceDigest', /^[0-9a-f]{64}$/.test(accepted?.legacyAcceptanceEvidenceDigest || ''), accepted?.legacyAcceptanceEvidenceDigest)

    const freshProof = await db().paymentProof.findUnique({ where: { id: proof.id } })
    check('happy path: proof reservedRefundMinor -> 0', freshProof.reservedRefundMinor === 0, freshProof.reservedRefundMinor)
    check('happy path: proof acceptedRefundMinor -> full amount', freshProof.acceptedRefundMinor === proof.amountMinor, freshProof.acceptedRefundMinor)
    check('happy path: proof succeededRefundMinor untouched (still 0)', freshProof.succeededRefundMinor === 0, freshProof.succeededRefundMinor)

    const auditLog = await db().adminAuditLog.findFirst({ where: { entityType: 'refunds', entityId: refund.id, action: 'ADMIN_LEGACY_REFUND_ACCEPTED' }, orderBy: { createdAt: 'desc' } })
    check('happy path: admin audit log recorded', !!auditLog, auditLog)

    // --- sequential re-run on the now-accepted refund ---
    const reRes = await call('PATCH', `/api/admin/refunds/${refund.id}/legacy-accept`, A, { reason: 'second attempt' })
    check('sequential re-run: refused with 409', reRes.status === 409, JSON.stringify(reRes.j))
    check('sequential re-run: correct error code', reRes.j?.error?.code === 'REFUND_NOT_CLAIMABLE', reRes.j?.error?.code)
    const attemptCountAfterReRun = await db().refundAttempt.count({ where: { refundId: refund.id } })
    check('sequential re-run: no third attempt created (zero effects)', attemptCountAfterReRun === 2, attemptCountAfterReRun)
  }

  // --- 2. LEGACY_UNVERIFIED exclusion (Finding 8 boundary) ---
  {
    const { refund } = await seedLegacyUnverifiedRefund(50000)
    const res = await call('PATCH', `/api/admin/refunds/${refund.id}/legacy-accept`, A, { reason: 'attempting to accept unverified' })
    check('LEGACY_UNVERIFIED: refused with 409', res.status === 409, JSON.stringify(res.j))
    check('LEGACY_UNVERIFIED: correct error code', res.j?.error?.code === 'NO_ACCEPTABLE_LEGACY_ATTEMPT', res.j?.error?.code)
    const fresh = await db().refund.findUnique({ where: { id: refund.id } })
    check('LEGACY_UNVERIFIED: refund still ACTION_REQUIRED (zero effects)', fresh.status === 'ACTION_REQUIRED', fresh.status)
    check('LEGACY_UNVERIFIED: reservationHeld still true', fresh.reservationHeld === true, fresh.reservationHeld)
    const attemptCount = await db().refundAttempt.count({ where: { refundId: refund.id } })
    check('LEGACY_UNVERIFIED: still exactly 1 attempt (no new attempt created)', attemptCount === 1, attemptCount)
  }

  // --- 3. Non-legacy refund exclusion ---
  {
    const { refund } = await seedNonLegacyActionRequiredRefund(60000)
    const res = await call('PATCH', `/api/admin/refunds/${refund.id}/legacy-accept`, A, { reason: 'attempting to fast-track a non-legacy refund' })
    check('non-legacy refund: refused with 400', res.status === 400, JSON.stringify(res.j))
    check('non-legacy refund: correct error code', res.j?.error?.code === 'REFUND_NOT_LEGACY', res.j?.error?.code)
    const fresh = await db().refund.findUnique({ where: { id: refund.id } })
    check('non-legacy refund: status unchanged (zero effects)', fresh.status === 'ACTION_REQUIRED', fresh.status)
  }

  // --- 4. ADMIN-only enforcement (policy-gated, not just route-level) ---
  {
    const { refund } = await seedLegacyPendingConfirmationRefund(70000)
    const hostRes = await call('PATCH', `/api/admin/refunds/${refund.id}/legacy-accept`, H, { reason: 'host trying to accept' })
    check('non-admin (HOST): refused with 403', hostRes.status === 403, JSON.stringify(hostRes.j))
    const guestRes = await call('PATCH', `/api/admin/refunds/${refund.id}/legacy-accept`, G, { reason: 'guest trying to accept' })
    check('non-admin (GUEST): refused with 403', guestRes.status === 403, JSON.stringify(guestRes.j))
    const noAuthRes = await call('PATCH', `/api/admin/refunds/${refund.id}/legacy-accept`, null, { reason: 'unauthenticated' })
    check('unauthenticated: refused with 401', noAuthRes.status === 401, JSON.stringify(noAuthRes.j))
    const fresh = await db().refund.findUnique({ where: { id: refund.id } })
    check('ADMIN-only: refund untouched by all 3 refused attempts', fresh.status === 'ACTION_REQUIRED', fresh.status)
    const attemptCount = await db().refundAttempt.count({ where: { refundId: refund.id } })
    check('ADMIN-only: still exactly 1 attempt (zero effects from any refused caller)', attemptCount === 1, attemptCount)
  }

  // --- 5. Malformed reason input ---
  {
    const { refund } = await seedLegacyPendingConfirmationRefund(80000)
    const emptyRes = await call('PATCH', `/api/admin/refunds/${refund.id}/legacy-accept`, A, { reason: '   ' })
    check('empty reason: refused with 400', emptyRes.status === 400, JSON.stringify(emptyRes.j))
    check('empty reason: correct error code', emptyRes.j?.error?.code === 'INVALID_ACCEPTANCE_REASON', emptyRes.j?.error?.code)
    const tooLongRes = await call('PATCH', `/api/admin/refunds/${refund.id}/legacy-accept`, A, { reason: 'x'.repeat(2001) })
    check('too-long reason: refused with 400', tooLongRes.status === 400, JSON.stringify(tooLongRes.j))
    const noBodyRes = await call('PATCH', `/api/admin/refunds/${refund.id}/legacy-accept`, A, {})
    check('missing reason: refused with 400', noBodyRes.status === 400, JSON.stringify(noBodyRes.j))
    const fresh = await db().refund.findUnique({ where: { id: refund.id } })
    check('malformed reason: refund untouched (zero effects, transaction never opened)', fresh.status === 'ACTION_REQUIRED', fresh.status)
  }

  // --- 6. Genuine two-process concurrency race ---
  {
    const { proof, refund } = await seedLegacyPendingConfirmationRefund(90000)
    const [r1, r2] = await Promise.all([
      call('PATCH', `/api/admin/refunds/${refund.id}/legacy-accept`, A, { reason: 'race attempt 1' }),
      call('PATCH', `/api/admin/refunds/${refund.id}/legacy-accept`, A, { reason: 'race attempt 2' }),
    ])
    const statuses = [r1.status, r2.status].sort()
    check('concurrency race: exactly one 200 and one 409', statuses[0] === 200 && statuses[1] === 409, JSON.stringify({ r1: r1.status, r2: r2.status }))
    const fresh = await db().refund.findUnique({ where: { id: refund.id } })
    check('concurrency race: refund settled to ACCOUNTING_ACCEPTED exactly once', fresh.status === 'ACCOUNTING_ACCEPTED', fresh.status)
    const attemptCount = await db().refundAttempt.count({ where: { refundId: refund.id } })
    check('concurrency race: exactly 2 attempts total (not 3 -- no double-acceptance)', attemptCount === 2, attemptCount)
    const freshProof = await db().paymentProof.findUnique({ where: { id: proof.id } })
    check('concurrency race: proof accepted exactly once, not twice', freshProof.acceptedRefundMinor === proof.amountMinor, freshProof.acceptedRefundMinor)
    check('concurrency race: proof reserved fully drained, not negative or double-decremented', freshProof.reservedRefundMinor === 0, freshProof.reservedRefundMinor)
  }

  // --- 7. Adversarial: reservedRefundMinor is GREATER than this refund's own amountMinor (round-2
  // corrective fix, independent review finding). Step 5's guard now requires an EXACT match, not
  // merely "at least this much" -- a proof carrying MORE reserved capacity than this specific refund
  // accounts for is a genuine data inconsistency (refunds_one_active_per_payment_proof guarantees at
  // most one active refund per proof, so once Step 1 claims this one, reservedRefundMinor should
  // equal exactly its amountMinor) and must be refused, not silently transferred through. ---
  {
    // proof carries 150000 total capacity; this refund only accounts for 100000 of it; but
    // reservedRefundMinor is set to the full 150000 -- an inconsistency Step 5 must now catch.
    const { proof, refund, attempt } = await seedLegacyPendingConfirmationRefund(100000, 150000, 150000)
    const res = await call('PATCH', `/api/admin/refunds/${refund.id}/legacy-accept`, A, { reason: 'attempting to accept against an over-reserved proof' })
    check('over-reserved proof: refused with 500 (anomaly, not silently accepted)', res.status === 500, JSON.stringify(res.j))
    check('over-reserved proof: correct error code', res.j?.error?.code === 'COUNTER_TRANSFER_ANOMALY', res.j?.error?.code)

    const freshRefund = await db().refund.findUnique({ where: { id: refund.id } })
    check('over-reserved proof: refund rolled back to ACTION_REQUIRED (Step 1-4 undone, not stuck at IN_PROGRESS)', freshRefund.status === 'ACTION_REQUIRED', freshRefund.status)
    check('over-reserved proof: reservationHeld still true after rollback', freshRefund.reservationHeld === true, freshRefund.reservationHeld)

    const attemptCount = await db().refundAttempt.count({ where: { refundId: refund.id } })
    check('over-reserved proof: still exactly 1 attempt (the new LEGACY_ACCOUNTING_ACCEPTED attempt from Step 3 was rolled back, not left orphaned)', attemptCount === 1, attemptCount)
    const freshAttempt = await db().refundAttempt.findUnique({ where: { id: attempt.id } })
    check('over-reserved proof: original attempt NOT superseded (Step 4 rolled back too)', freshAttempt.supersededByAttemptId === null, freshAttempt.supersededByAttemptId)

    const freshProof = await db().paymentProof.findUnique({ where: { id: proof.id } })
    check('over-reserved proof: reservedRefundMinor completely untouched by the failed transaction', freshProof.reservedRefundMinor === 150000, freshProof.reservedRefundMinor)
    check('over-reserved proof: acceptedRefundMinor still 0 (zero partial financial effect)', freshProof.acceptedRefundMinor === 0, freshProof.acceptedRefundMinor)

    // Sanity: the SAME refund amount, with reservedRefundMinor correctly in sync, DOES succeed --
    // proves the fix rejects only the genuine inconsistency, not every over-capacity proof.
    const { proof: proof2, refund: refund2 } = await seedLegacyPendingConfirmationRefund(100000)
    const res2 = await call('PATCH', `/api/admin/refunds/${refund2.id}/legacy-accept`, A, { reason: 'control: reservedRefundMinor correctly in sync' })
    check('control (in-sync reservedRefundMinor): succeeds normally', res2.status === 200, JSON.stringify(res2.j))
    const freshProof2 = await db().paymentProof.findUnique({ where: { id: proof2.id } })
    check('control: reservedRefundMinor correctly drained to 0', freshProof2.reservedRefundMinor === 0, freshProof2.reservedRefundMinor)
  }

  console.log(`\n==== LEGACY_REFUND_ACCEPT E2E: ${pass} passed, ${fail} failed ====`)
  await disconnectDb()
  process.exit(fail ? 1 : 0)
}

main().catch(async (err) => {
  console.error(err)
  await disconnectDb()
  process.exit(1)
})
