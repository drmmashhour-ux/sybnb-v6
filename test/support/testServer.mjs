import request from 'supertest'
import { server } from '../../server/index.mjs'
import { db } from '../../server/lib/prisma.mjs'

// The server module exports the raw http.Server without auto-listening when imported (see
// server/index.mjs's isMainModule guard) — Supertest binds it to an ephemeral port itself, so
// tests never collide with a real running dev server on 3051.
export function testApp() {
  return server
}

const TEST_EMAIL_SUFFIX = '@sybnb.test'
let counter = 0

// Deterministic-enough unique identifiers per test run without a shared sequence file: process
// start time + an in-process counter. Not cryptographically unique, only "unique enough to not
// collide within one test run against the shared local dev database."
const RUN_ID = Date.now().toString(36)

export function uniqueTestEmail(label) {
  counter += 1
  return `t-${RUN_ID}-${counter}-${label}${TEST_EMAIL_SUFFIX}`
}

// User.referralCode is required + unique (server/lib/referrals.mjs normally generates a
// collision-checked one at registration) -- tests that create a User row directly via Prisma,
// bypassing /api/auth/register entirely (e.g. to bootstrap an ADMIN, which cannot self-register),
// need to supply one by hand. Uniqueness within a test run is all that matters here.
export function uniqueTestReferralCode() {
  counter += 1
  return `T${RUN_ID}${counter}`.toUpperCase().slice(0, 12)
}

// GUEST self-registration now requires a real, server-verified email code (see
// server/lib/email-verification.mjs) — this drives the actual send+verify endpoints exactly as a
// real client must, using the dev-only devCode response instead of a mailbox. Fixture setup for
// non-GUEST roles (HOST/SELLER/DRIVER) is unaffected; only GUEST is gated.
// purpose defaults to 'guest-signup' (matches the server's own default) -- pass 'staff-login' for
// HOST/DRIVER/ADMIN test accounts, which now require the same real email-OTP gate at
// registration/sign-in as guests do (see server/routes/auth.mjs STAFF_ROLES_REQUIRING_OTP).
export async function verifyEmailForTest(app, email, purpose = 'guest-signup') {
  const sendRes = await request(app).post('/api/auth/email-code/send').send({ email, purpose })
  const code = sendRes.body.devCode
  if (!code) {
    throw new Error('Test email-code send did not return a devCode — is NODE_ENV=production set?')
  }
  const verifyRes = await request(app).post('/api/auth/email-code/verify').send({ email, code, purpose })
  if (!verifyRes.body.ok) {
    throw new Error(`Test email-code verify failed: ${JSON.stringify(verifyRes.body)}`)
  }
}

export function uniqueTestPhone() {
  counter += 1
  // +963 9XX XXXXXX shaped, deterministically derived from the run id + counter so it stays
  // inside a plausible Syrian mobile range without needing real numbers.
  const suffix = String(900000000 + (Number(`${Date.now()}`.slice(-6)) + counter) % 99999999).padStart(9, '0')
  return `+963${suffix}`
}

// Tracks every user id this test run created, for cleanup. Domain rows (bookings, payment
// proofs, ride requests, listings) referencing these users are deleted in cleanupTestUsers().
//
// A test user that ever acted as an admin/support/driver (approving a review, claiming a ride,
// etc.) leaves an admin_audit_logs row behind, and this fine-grained cleanup deliberately leaves
// that user in place rather than deleting their audit rows first (admin_audit_logs.actorUserId
// has no cascade). Historically (when this suite ran against the shared development database)
// this was load-bearing: the security order this suite was built under prohibits deleting real
// audit history, and there was no way to tell "real" from "test" audit rows except by leaving
// every referenced user alone. Now that tests run against the isolated `sybnb_v6_test` database
// (see docs/testing/SYBNB_V6_TEST_DATABASE_SETUP.md), that constraint no longer applies here —
// every row in this database is synthetic and disposable — but the fine-grained cleanup is left
// as-is anyway since it's harmless and keeps each test file's own footprint small between runs.
// For a guaranteed-clean slate (e.g. proving repeatability across two full suite runs), use
// test/support/resetTestDatabase.mjs's full TRUNCATE-based reset instead, which is what
// test/support/setup.env.mjs calls once at the start of every db-backed Vitest run.
const createdUserIds = new Set()

export function trackTestUser(id) {
  if (id) createdUserIds.add(id)
}

export async function cleanupTestUsers() {
  const ids = Array.from(createdUserIds)
  if (!ids.length) return

  await db().paymentProof.deleteMany({ where: { userId: { in: ids } } }).catch(() => {})
  await db().rideRequest.deleteMany({ where: { OR: [{ riderId: { in: ids } }, { driverId: { in: ids } }] } }).catch(() => {})
  await db().booking.deleteMany({ where: { guestId: { in: ids } } }).catch(() => {})
  await db().listing.deleteMany({ where: { ownerId: { in: ids } } }).catch(() => {})

  // Only delete users with zero remaining admin_audit_logs references (see comment above) —
  // anything else is left for the manual maintenance script.
  const blocked = await db().adminAuditLog.findMany({
    where: { actorUserId: { in: ids } },
    select: { actorUserId: true },
    distinct: ['actorUserId'],
  })
  const blockedIds = new Set(blocked.map((row) => row.actorUserId))
  const deletable = ids.filter((id) => !blockedIds.has(id))
  if (deletable.length) {
    await db().user.deleteMany({ where: { id: { in: deletable } } }).catch(() => {})
  }
  createdUserIds.clear()
}
