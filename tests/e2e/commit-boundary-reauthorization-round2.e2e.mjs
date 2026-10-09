// SYBNB — SEC-002R ROUND 2: commit-boundary re-authorization, the coverage round 1 did not have.
//
// WHY THIS FILE EXISTS
//
// Round 1 (commit e244bae) wired reauthorizeAtCommit() into 10 endpoints and proved 8 races in
// tests/e2e/commit-boundary-reauthorization.e2e.mjs. Two independent fresh-agent reviews then
// returned a FAIL / REMEDIATION REQUIRED verdict on that round. Their findings, in the owner's
// numbering:
//
//   GAP-1  POST /api/payments/stripe/confirm called finalizeStripeSession() with no options object,
//          so the PaymentProof create + approvePaymentProof (the SAME money-moving primitive the
//          review-queue payment-approve path protects) ran with no commit-boundary check at all. It
//          was unreachable in practice only because 'stripe' is absent from APPROVED_PROVIDER_CONFIGS
//          -- a configuration gate, explicitly refused by the owner as a security boundary.
//   A8     The payment-event replay's CLAIM step (attempts increment + APPLYING) and its failure-path
//          write (FAILED / DEAD_LETTERED) happened OUTSIDE and BEFORE the re-authorized transaction,
//          so a revoked admin could still advance `attempts` and, at the 5th attempt, push a real
//          event into DEAD_LETTERED.
//   G1     PATCH /api/admin/id-document/:userId/upload -- bare db().user.update on ANOTHER user's KYC
//          state plus an irreversible deleteIdDocument of their previous document, no transaction, no
//          re-authorization. Reproduced live: a revoked admin's write committed 265ms after the same
//          token was proven dead.
//   G2     POST /api/admin/sr/promo-codes -- bare db().promoCode.create, same shape, also reproduced.
//
// It also did not race four things round 1 had wired but never exercised (A2 finalize-cancellation,
// A4 legacy-refund-accept, A9 wallet gift CREATION, and 4 of A5's 6 review-queue decision types), and
// the fresh codebase-wide mutation sweep this round required turned up further Class A paths with no
// protection at all (admin review-hide, promo-code toggle, business-account onboarding, business
// membership add/remove, guest booking cancellation, host booking decision, driver ride claim).
//
// This suite proves every one of those. It does NOT replace round 1 -- that file is frozen evidence
// for the FAIL verdict and is untouched; both suites run.
//
// METHOD (identical discipline to round 1, deliberately)
//   - real, server-issued sessions via the production issueUserSession()
//   - the real HTTP API (except GAP-1, see its section -- that route cannot be driven end to end
//     without a live Stripe account, so its race runs against the exact production seam instead)
//   - the delay is created OUTSIDE the server, never by slowing production code
//   - real revocation: POST /api/auth/logout-all, a real admin suspension, or a real role removal
//   - every race asserts the HTTP/throw outcome AND, SEPARATELY, direct DB state -- an HTTP status
//     alone never proves a race was blocked
//   - every race is followed by a positive control: the identical action with fresh authority, which
//     must succeed and genuinely commit, so "blocked" can never be a broken endpoint or fixture
//
// Run: node tests/e2e/commit-boundary-reauthorization-round2.e2e.mjs  (API_BASE default 127.0.0.1:3051)

import net from 'node:net'
import { randomUUID } from 'node:crypto'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'
import { issueUserSession } from '../../server/lib/session-store.mjs'
import { hashPassword } from '../../server/lib/security.mjs'
import { confirmStripeCheckoutSessionForActor } from '../../server/lib/stripe-checkout-apply.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
const API_URL = new URL(API)
const HOSTNAME = API_URL.hostname
const PORT = Number(API_URL.port || 80)

let pass = 0
let fail = 0
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`   PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) }
}
const code = (r) => r.j?.error?.code || r.j?.code
// The four distinct refusals commit-authorization.mjs raises. Asserting one of THESE (never a bare
// non-200) is what distinguishes "admitted with full authority, then lost it at the boundary" from
// "the token was already dead when the request arrived", which would fail at requireAuth with 401
// AUTH_REQUIRED instead.
const BOUNDARY_CODES = [
  'SESSION_REVOKED_BEFORE_COMMIT',
  'SESSION_EPOCH_STALE_BEFORE_COMMIT',
  'ACCOUNT_NOT_ACTIVE_BEFORE_COMMIT',
  'ROLE_REVOKED_BEFORE_COMMIT',
]
const isBoundaryRefusal = (r) => BOUNDARY_CODES.includes(code(r))

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

// T1 -- the literal N4 delay: full request head plus exactly ONE byte of the JSON body, then hold.
// getAuthContext() has already run; the handler is parked in readJson(); nothing has been written.
function slowRequest({ method, path, token, body, hold }) {
  const payload = Buffer.from(JSON.stringify(body ?? {}), 'utf8')
  return new Promise((resolve, reject) => {
    const socket = net.connect(PORT, HOSTNAME, async () => {
      socket.write(
        `${method} ${path} HTTP/1.1\r\n` +
        `Host: ${HOSTNAME}:${PORT}\r\n` +
        `Authorization: Bearer ${token}\r\n` +
        'Content-Type: application/json\r\n' +
        `Content-Length: ${payload.length}\r\n` +
        'Connection: close\r\n\r\n',
      )
      socket.write(payload.subarray(0, 1))
      try { await hold() } catch (err) { console.log(`   (hold threw: ${err.message})`) }
      socket.write(payload.subarray(1))
    })
    const chunks = []
    socket.on('data', (chunk) => { chunks.push(chunk) })
    socket.on('error', reject)
    socket.on('close', () => resolve(parseRawHttpResponse(Buffer.concat(chunks))))
  })
}

function parseRawHttpResponse(buf) {
  const sep = buf.indexOf('\r\n\r\n')
  const head = buf.subarray(0, sep === -1 ? buf.length : sep).toString('latin1')
  const status = Number((head.match(/^HTTP\/1\.\d (\d{3})/) || [])[1] || 0)
  let body = sep === -1 ? Buffer.alloc(0) : buf.subarray(sep + 4)
  if (/transfer-encoding:\s*chunked/i.test(head)) {
    const parts = []
    let rest = body
    for (;;) {
      const nl = rest.indexOf('\r\n')
      if (nl === -1) break
      const size = parseInt(rest.subarray(0, nl).toString('latin1').trim(), 16)
      if (!Number.isFinite(size) || size <= 0) break
      parts.push(rest.subarray(nl + 2, nl + 2 + size))
      rest = rest.subarray(nl + 2 + size + 2)
    }
    body = Buffer.concat(parts)
  }
  const text = body.toString('utf8')
  let j
  try { j = JSON.parse(text) } catch { j = { raw: text.slice(0, 400) } }
  return { status, j }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// DB-observable proof that an /api/admin/* mutating request was ADMITTED: server/index.mjs bumps this
// bucket AFTER getAuthContext() returned an ADMIN context and BEFORE the handler runs.
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
// ADMIN_ACTION_RATE_MAX defaults to 250/minute per admin account. This suite performs far more admin
// actions than round 1 did, so the bucket is cleared between sections; a 429 would otherwise start
// masquerading as a refusal and every assertion downstream of it would be meaningless.
async function clearAdminBucket(adminId) {
  await db().rateLimitBucket.deleteMany({ where: { bucketKey: `admin-action:${adminId}` } }).catch(() => {})
}

// T2 -- hold an ACCESS EXCLUSIVE lock on `table` for the duration of body(). Taken by the TEST, in
// the TEST's own transaction; production code is untouched. Used for handlers that read no request
// body (there is nothing to dribble) -- they park on their first post-admission read instead.
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

// ---------------------------------------------------------------------------------------------
// Fixtures. Dedicated synthetic accounts only -- this suite suspends and re-roles its actors.
// ---------------------------------------------------------------------------------------------
const RUN = Date.now()
const PASSWORD = 'Sec002R-Round2-Pw!'
const ids = {
  actor: randomUUID(),      // the ADMIN whose authority is revoked mid-request
  operator: randomUUID(),   // second ADMIN: does setup the actor must not do
  host: randomUUID(),
  guest: randomUUID(),
  guest2: randomUUID(),
  sender: randomUUID(),
  kyc: randomUUID(),
  driver: randomUUID(),
  bizAdmin: randomUUID(),
  bizMember: randomUUID(),
}

async function makeUser(id, roles) {
  await db().user.create({
    data: {
      id,
      email: `sec002r2-${id.slice(0, 8)}-${RUN}@sybnb.test`,
      passwordHash: hashPassword(PASSWORD),
      displayName: `sec002r2-${id.slice(0, 8)}`,
      status: 'ACTIVE',
      // Host verification (migration 049): seeded hosts are pre-verified so their stays are public/bookable.
      hostVerifiedAt: roles.includes('HOST') ? new Date() : undefined,
      roles: { create: roles.map((role) => ({ role })) },
    },
  })
}
async function cleanup() {
  const all = Object.values(ids)
  await db().rateLimitBucket.deleteMany({ where: { bucketKey: { in: all.map((id) => `admin-action:${id}`) } } }).catch(() => {})
  await db().businessAccountMember.deleteMany({ where: { userId: { in: all } } }).catch(() => {})
  await db().businessAccount.deleteMany({ where: { adminUserId: { in: all } } }).catch(() => {})
  await db().promoCode.deleteMany({ where: { createdByAdminId: { in: all } } }).catch(() => {})
  for (const id of all) {
    await db().adminAuditLog.deleteMany({ where: { OR: [{ actorUserId: id }, { entityId: id }] } }).catch(() => {})
    // Best effort, same posture as every other suite here: accounts that acquired listings/bookings/
    // wallet history cannot be deleted (FK restrict) and are left in place. Ids are fresh per run.
    await db().user.delete({ where: { id } }).catch(() => {})
  }
}
async function session(userId) {
  const user = await db().user.findUnique({ where: { id: userId }, include: { roles: true } })
  return issueUserSession(user)
}
// Real revocation, run from a second live session for the same account. logout-all bumps
// users.session_epoch, which invalidates every outstanding token for the account at once.
async function logoutAll(userId, label) {
  const t = (await session(userId)).token
  const out = await call('POST', '/api/auth/logout-all', t, {})
  check(`${label}: logout-all landed while the request was in flight`, out.status === 200, JSON.stringify(out.j))
}

// A T1 race: admit, revoke mid-body, return the response.
async function raceBody({ method, path, token, body, actorId, adminMarker = true, revoke, label }) {
  const baseline = adminMarker ? await adminActionCount(actorId) : 0
  return slowRequest({
    method,
    path,
    token,
    body,
    hold: async () => {
      if (adminMarker) {
        const admitted = await waitForAdmission(actorId, baseline, label)
        check(`${label}: request was ADMITTED with full authority`, admitted, 'admission marker never advanced')
      } else {
        // No admission marker exists for non-admin routes. The commit-boundary error code asserted
        // after the race (never a bare 401 AUTH_REQUIRED) is what proves admission there.
        await sleep(400)
      }
      await revoke()
      await sleep(150)
    },
  })
}

// A T2 race: stall the handler on its first post-admission read, revoke, release, return the response.
async function raceStalled({ table, start, actorId, adminMarker = true, revoke, label }) {
  const baseline = adminMarker ? await adminActionCount(actorId) : 0
  let pending
  await withTableLock(table, async () => {
    pending = start()
    if (adminMarker) {
      const admitted = await waitForAdmission(actorId, baseline, label)
      check(`${label}: request was ADMITTED with full authority`, admitted, 'admission marker never advanced')
    } else {
      await sleep(300)
    }
    const blocked = await waitForBlockedOn(table, label)
    check(`${label}: request is genuinely IN FLIGHT (ungranted lock on ${table})`, blocked, 'no blocked lock seen')
    await revoke()
  })
  return pending
}

async function main() {
  console.log('=== SEC-002R ROUND 2 — COMMIT-BOUNDARY RE-AUTHORIZATION (post-FAIL remediation) ===')
  await cleanup()
  await makeUser(ids.actor, ['ADMIN'])
  await makeUser(ids.operator, ['ADMIN'])
  await makeUser(ids.host, ['HOST'])
  await makeUser(ids.guest, ['GUEST'])
  await makeUser(ids.guest2, ['GUEST'])
  await makeUser(ids.sender, ['GUEST'])
  await makeUser(ids.kyc, ['GUEST'])
  await makeUser(ids.driver, ['DRIVER', 'GUEST'])
  await makeUser(ids.bizAdmin, ['GUEST'])
  await makeUser(ids.bizMember, ['GUEST'])

  // Only the OPERATOR keeps a long-lived token: it is the one account this suite never revokes.
  // Every other actor's sessions are deliberately destroyed mid-suite (that is the whole point), so
  // their tokens are minted fresh at each use rather than cached -- a cached one would be dead from
  // the first race onward and every later section would fail as 401 AUTH_REQUIRED, which looks
  // exactly like a passing refusal but proves nothing.
  const OP = (await session(ids.operator)).token
  const hostT = async () => (await session(ids.host)).token
  const guestT = async () => (await session(ids.guest)).token

  // --- host can publish: approved ID + signed listing agreement, both done by the OPERATOR ---
  const HOST_T = await hostT()
  await call('PATCH', '/api/me/id-document', HOST_T, { fileBase64: 'ZmFrZQ==', mimeType: 'image/png' })
  await call('PATCH', `/api/admin/review-queue/iddocument/${ids.host}`, OP, { decision: 'APPROVE' })
  const legal = await call('GET', '/api/legal', null)
  const agreement = legal.j?.documents?.find((d) => d.key === 'listing-agreement')
  await call('POST', '/api/legal/consent', HOST_T, { documentKey: 'listing-agreement', version: agreement.version })

  async function makeListing({ instantBook }) {
    const res = await call('POST', '/api/listings', await hostT(), {
      division: 'STAYS',
      titleAr: 'شقة SEC-002R2',
      titleEn: `SEC-002R2 flat ${randomUUID().slice(0, 6)}`,
      priceMinor: 200000,
      currency: 'SYP',
      instantBookEnabled: instantBook,
    })
    const id = res.j?.listing?.id
    await call('PATCH', `/api/listings/${id}/submit`, await hostT())
    await call('PATCH', `/api/admin/review-queue/listing/${id}`, OP, { decision: 'APPROVE' })
    return id
  }
  const instantListingId = await makeListing({ instantBook: true })
  const requestListingId = await makeListing({ instantBook: false })
  check('fixture: both listings approved', Boolean(instantListingId && requestListingId),
    `${instantListingId} / ${requestListingId}`)

  let dayCursor = 40
  async function makeBooking(listingId, guestToken) {
    const inDays = dayCursor
    const outDays = dayCursor + 2
    dayCursor += 4
    const iso = (d) => new Date(Date.now() + d * 86_400_000).toISOString()
    const res = await call('POST', '/api/bookings', guestToken || (await guestT()), { listingId, checkIn: iso(inDays), checkOut: iso(outDays) })
    if (!res.j?.booking) throw new Error(`booking fixture failed: ${res.status} ${JSON.stringify(res.j).slice(0, 300)}`)
    return res.j.booking
  }
  async function submitProof(bookingId, guestToken) {
    const proof = await call('POST', '/api/payments/local-wallet-proof', guestToken || (await guestT()), {
      bookingId, providerRef: `wallet_sec002r2_${randomUUID()}`,
    })
    if (!proof.j?.proof) throw new Error(`proof fixture failed: ${proof.status} ${JSON.stringify(proof.j).slice(0, 300)}`)
    return { proofId: proof.j.proof.id, amountMinor: proof.j.proof.amountMinor }
  }
  async function payAndApprove(bookingId, guestToken) {
    const { proofId, amountMinor } = await submitProof(bookingId, guestToken)
    await call('PATCH', `/api/admin/review-queue/payment/${proofId}`, OP, {
      decision: 'APPROVE',
      shamCashReconciliation: { accountMinor: amountMinor, expectedMinor: amountMinor, differenceMinor: 0 },
    })
    return { proofId, amountMinor }
  }
  async function fundWallet(userId, minor) {
    await db().wallet.upsert({
      where: { userId_currency: { userId, currency: 'SYP' } },
      create: { userId, currency: 'SYP', cachedBalanceMinor: minor },
      update: { cachedBalanceMinor: minor },
    })
  }

  // =============================================================================================
  console.log('\n=== 1. GAP-1: STRIPE CHECKOUT CONFIRM (money) — the rail round 1 left unprotected ===')
  // =============================================================================================
  // This route cannot be driven end to end over HTTP: it calls stripe.checkout.sessions.retrieve()
  // against the real Stripe API before it reaches any local effect, and no test-runtime Stripe
  // account exists. So the race is run against confirmStripeCheckoutSessionForActor() -- the exact
  // function the route now calls, holding the entire effect (PaymentProof create +
  // approvePaymentProof: host HOLD, platform CREDIT, protection fee, booking confirmation). Session
  // ownership (session.metadata.guestId === actor) is checked by the route against Stripe's own
  // authenticated response and is out of scope here; what is proved here is the commit-boundary
  // authority half, which is what GAP-1 was about.
  {
    const booking = await makeBooking(instantListingId)
    const stripeSessionId = `cs_test_sec002r2_${randomUUID().replace(/-/g, '')}`
    const stripeSession = {
      id: stripeSessionId,
      payment_status: 'paid',
      currency: booking.currency,
      payment_intent: `pi_sec002r2_${randomUUID().replace(/-/g, '')}`,
      metadata: { bookingId: booking.id, guestId: ids.guest, sypTotalMinor: String(booking.amountMinor) },
    }
    check('1-fixture: booking is PAYMENT_PENDING', booking.status === 'PAYMENT_PENDING', booking.status)

    // A real, server-issued session -- then genuinely revoked, exactly as a mid-request logout-all
    // would leave it. The context object is byte-for-byte the shape getAuthContext() returns.
    const issued = await session(ids.guest)
    const guestRow = await db().user.findUnique({ where: { id: ids.guest }, include: { roles: true } })
    const revokedContext = {
      user: guestRow,
      roles: guestRow.roles.map((r) => r.role),
      sessionId: issued.sessionId,
      epoch: guestRow.sessionEpoch,
    }
    await call('POST', '/api/auth/logout-all', issued.token, {})

    let thrown = null
    try {
      await confirmStripeCheckoutSessionForActor({ session: stripeSession, context: revokedContext })
    } catch (err) { thrown = err }

    check('1a. revoked confirm is REFUSED', Boolean(thrown), 'the call returned instead of throwing')
    check('1b. refusal is a COMMIT-BOUNDARY refusal', BOUNDARY_CODES.includes(thrown?.code), String(thrown?.code))

    const proofAfter = await db().paymentProof.findFirst({ where: { provider: 'stripe', providerRef: stripeSessionId } })
    check('1c. DB: NO PaymentProof was created', !proofAfter, JSON.stringify(proofAfter))
    const holdAfter = await db().walletEntry.findFirst({ where: { referenceType: 'booking_payout', referenceId: booking.id } })
    check('1d. DB: NO host HOLD wallet entry', !holdAfter, JSON.stringify(holdAfter))
    const shareAfter = await db().walletEntry.findFirst({ where: { referenceType: 'booking_admin_share', referenceId: booking.id } })
    check('1e. DB: NO platform-share wallet entry', !shareAfter, JSON.stringify(shareAfter))
    const bookingAfter = await db().booking.findUnique({ where: { id: booking.id } })
    check('1f. DB: booking still PAYMENT_PENDING', bookingAfter.status === 'PAYMENT_PENDING', bookingAfter.status)

    // Positive control: identical call, fresh authority.
    const fresh = await session(ids.guest)
    const guestFresh = await db().user.findUnique({ where: { id: ids.guest }, include: { roles: true } })
    const liveContext = {
      user: guestFresh,
      roles: guestFresh.roles.map((r) => r.role),
      sessionId: fresh.sessionId,
      epoch: guestFresh.sessionEpoch,
    }
    const proof = await confirmStripeCheckoutSessionForActor({ session: stripeSession, context: liveContext })
    check('1g. control: identical confirm with a live session SUCCEEDS', Boolean(proof), JSON.stringify(proof))
    const proofOk = await db().paymentProof.findFirst({ where: { provider: 'stripe', providerRef: stripeSessionId } })
    check('1h. DB: control genuinely committed (PaymentProof exists, APPROVED)',
      proofOk?.status === 'APPROVED', JSON.stringify(proofOk?.status))
    const holdOk = await db().walletEntry.findFirst({ where: { referenceType: 'booking_payout', referenceId: booking.id } })
    check('1i. DB: control genuinely committed (host HOLD entry exists)', Boolean(holdOk), 'no hold entry')
  }

  // =============================================================================================
  console.log('\n=== 2. THE LOCKS ARE REAL: a revocation racing INTO the window BLOCKS, never lands ===')
  // =============================================================================================
  // Round 1's design claim is that reauthorizeAtCommit() takes genuine SELECT ... FOR UPDATE locks on
  // user_sessions and users and HOLDS them to commit, so a concurrent revoker either commits before
  // the lock is granted (caught) or blocks until the protected transaction ends -- "there is no third
  // ordering". Every race elsewhere in both suites exercises the FIRST ordering. This section is the
  // only direct proof of the SECOND, and therefore the only direct proof the locks exist at all
  // rather than the check being a plain fresh read.
  //
  // Method: stall a Class A transaction AFTER its re-authorization has passed (an ACCESS EXCLUSIVE
  // lock on payment_proofs, which finalizeStripeSession reads only after beforeEffects has run), then
  // fire a real logout-all for the same actor and observe that it does not complete until the
  // protected transaction has committed.
  {
    const booking = await makeBooking(instantListingId)
    const stripeSessionId = `cs_test_lock_${randomUUID().replace(/-/g, '')}`
    const stripeSession = {
      id: stripeSessionId,
      payment_status: 'paid',
      currency: booking.currency,
      metadata: { bookingId: booking.id, guestId: ids.guest, sypTotalMinor: String(booking.amountMinor) },
    }
    const issued = await session(ids.guest)
    const guestRow = await db().user.findUnique({ where: { id: ids.guest }, include: { roles: true } })
    const ctx = { user: guestRow, roles: guestRow.roles.map((r) => r.role), sessionId: issued.sessionId, epoch: guestRow.sessionEpoch }

    const order = []
    let confirmPromise
    let revokePromise
    await withTableLock('payment_proofs', async () => {
      confirmPromise = confirmStripeCheckoutSessionForActor({ session: stripeSession, context: ctx })
        .then((p) => { order.push('confirm'); return p })
      const stalled = await waitForBlockedOn('payment_proofs', 'lock-proof confirm')
      check('2a. the protected transaction is past its re-authorization and stalled on its own effect',
        stalled, 'never observed a blocked lock on payment_proofs')
      // The revoker now wants the very rows reauthorizeAtCommit() is holding.
      revokePromise = call('POST', '/api/auth/logout-all', issued.token, {}).then((r) => { order.push('revoke'); return r })
      await sleep(1200)
      check('2b. the concurrent revocation is BLOCKED (has not completed while the locks are held)',
        order.length === 0, `order=${JSON.stringify(order)}`)
    })
    const confirmed = await confirmPromise
    const revoked = await revokePromise

    check('2c. the protected transaction committed FIRST', order[0] === 'confirm', JSON.stringify(order))
    check('2d. the revocation completed only AFTER it', order[1] === 'revoke', JSON.stringify(order))
    check('2e. the protected mutation genuinely committed', Boolean(confirmed), JSON.stringify(confirmed))
    check('2f. the revocation itself still succeeded (it was delayed, never lost)', revoked.status === 200, JSON.stringify(revoked.j))
    const sessionRow = await db().userSession.findUnique({ where: { id: issued.sessionId } })
    check('2g. DB: the session IS now revoked (the revocation is real, just ordered after)',
      Boolean(sessionRow?.revokedAt), JSON.stringify(sessionRow?.revokedAt))
  }

  // =============================================================================================
  console.log('\n=== 3. A2 FINALIZE-CANCELLATION (money) — T2 stalled read vs logout-all ===')
  // =============================================================================================
  // Round 1 wired this but never raced it. It posts the commission reversal and the cancellation-fee
  // wallet entries -- real, irreversible money movement. It reads NO request body, so T2.
  {
    await clearAdminBucket(ids.actor)
    const booking = await makeBooking(instantListingId)
    await payAndApprove(booking.id)
    const cancel = await call('PATCH', `/api/bookings/${booking.id}/cancel`, await guestT(), {})
    check('3-fixture: guest cancelled the paid booking', cancel.status === 200, JSON.stringify(cancel.j).slice(0, 200))

    const raceToken = (await session(ids.actor)).token
    const res = await (await raceStalled({
      table: 'bookings',
      label: '3. finalize-cancellation',
      actorId: ids.actor,
      start: () => call('PATCH', `/api/admin/bookings/${booking.id}/finalize-cancellation`, raceToken, undefined),
      revoke: () => logoutAll(ids.actor, '3'),
    }))

    check('3a. in-flight finalization is REFUSED', res.status !== 200, `status=${res.status} body=${JSON.stringify(res.j)}`)
    check('3b. refusal is a COMMIT-BOUNDARY refusal', isBoundaryRefusal(res), `${res.status} ${code(res)}`)

    const reversal = await db().walletEntry.findFirst({ where: { referenceType: 'booking_admin_share_reversal', referenceId: booking.id } })
    check('3c. DB: NO commission-reversal wallet entry', !reversal, JSON.stringify(reversal))
    const feeEntries = await db().walletEntry.findMany({ where: { referenceId: booking.id, referenceType: { contains: 'cancellation' } } })
    check('3d. DB: NO cancellation-fee wallet entries', feeEntries.length === 0, JSON.stringify(feeEntries.map((e) => e.referenceType)))
    const audit = await db().adminAuditLog.findFirst({ where: { actorUserId: ids.actor, action: 'BOOKING_CANCELLATION_FINALIZED', entityId: booking.id } })
    check('3e. DB: no BOOKING_CANCELLATION_FINALIZED audit row', !audit, JSON.stringify(audit))

    // The control needs the guest's refund executed first -- finalizing charges the guest's
    // cancellation fee against a wallet the refund is what funds (REFUND_MUST_EXECUTE_FIRST). Done
    // by the OPERATOR, and deliberately AFTER the race: the race's refusal came from
    // reauthorizeAtCommit(), which is the first statement inside finalizeInTransaction and therefore
    // runs strictly before that ordering check could ever be reached (3b asserts the exact code).
    const refundRow = await db().refund.findFirst({ where: { bookingId: booking.id } })
    const executed = await call('PATCH', `/api/admin/refunds/${refundRow.id}/execute`, OP, undefined)
    check('3f-fixture: the guest refund was executed by a second admin', executed.status === 200, JSON.stringify(executed.j).slice(0, 250))

    const fresh = (await session(ids.actor)).token
    const ok = await call('PATCH', `/api/admin/bookings/${booking.id}/finalize-cancellation`, fresh, undefined)
    check('3f. control: identical finalization with a live session SUCCEEDS', ok.status === 200, JSON.stringify(ok.j).slice(0, 300))
    const reversalAfter = await db().walletEntry.findFirst({ where: { referenceType: 'booking_admin_share_reversal', referenceId: booking.id } })
    check('3g. DB: control genuinely committed (the commission-reversal entry 3c proved absent now exists)',
      Boolean(reversalAfter), 'no commission-reversal entry')
  }

  // =============================================================================================
  console.log('\n=== 4. A4 LEGACY-REFUND-ACCEPT (money) — T1 slow body vs logout-all ===')
  // =============================================================================================
  // Round 1 wired this but never raced it. It claims the refund (ACTION_REQUIRED -> IN_PROGRESS) and
  // transfers the payment proof's reserved -> accepted refund counters. Reads a body, so T1.
  {
    await clearAdminBucket(ids.actor)
    const amountMinor = 90_000
    const listing = await db().listing.create({
      data: { ownerId: ids.host, division: 'STAYS', titleAr: 'شقة LRA R2', priceMinor: amountMinor, status: 'APPROVED' },
    })
    const legacyBooking = await db().booking.create({
      data: { listingId: listing.id, guestId: ids.guest2, amountMinor, status: 'CANCELLED' },
    })
    const proof = await db().paymentProof.create({
      data: {
        bookingId: legacyBooking.id, userId: ids.guest2, provider: 'payment_intent', status: 'REFUNDED',
        amountMinor, currency: 'SYP', providerRef: `pi_r2lra_${randomUUID()}`, reservedRefundMinor: amountMinor,
      },
    })
    const event = await db().paymentEvent.create({
      data: {
        providerEventId: `evt_r2lra_${randomUUID()}`, type: 'charge.refunded', rail: 'payment_intent',
        provider: 'sandbox', providerEndpointKey: 'sandbox-test-account', environment: 'test',
        subjectType: 'PAYMENT_INTENT', providerReference: proof.providerRef, processingStatus: 'APPLIED',
      },
    })
    const refund = await db().refund.create({
      data: {
        paymentProofId: proof.id, bookingId: legacyBooking.id, amountMinor, currency: 'SYP',
        reason: 'sec002r2 fixture', reasonCode: 'LEGACY_UNKNOWN', rail: 'payment_intent',
        status: 'ACTION_REQUIRED', reservationHeld: true, migratedFromLegacy: true,
      },
    })
    await db().refundAttempt.create({
      data: {
        refundId: refund.id, status: 'LEGACY_PENDING_CONFIRMATION', migratedFromLegacy: true,
        completedAt: new Date(), legacyPaymentEventId: event.id,
      },
    })
    check('4-fixture: legacy refund is ACTION_REQUIRED + reservationHeld', refund.status === 'ACTION_REQUIRED' && refund.reservationHeld, JSON.stringify(refund.status))

    const raceToken = (await session(ids.actor)).token
    const res = await raceBody({
      method: 'PATCH',
      path: `/api/admin/refunds/${refund.id}/legacy-accept`,
      token: raceToken,
      body: { reason: 'SEC-002R round 2 race — accounting accepted this legacy refund.' },
      actorId: ids.actor,
      label: '4. legacy-refund-accept',
      revoke: () => logoutAll(ids.actor, '4'),
    })

    check('4a. in-flight legacy acceptance is REFUSED', res.status !== 200, `status=${res.status} body=${JSON.stringify(res.j)}`)
    check('4b. refusal is a COMMIT-BOUNDARY refusal', isBoundaryRefusal(res), `${res.status} ${code(res)}`)

    const refundAfter = await db().refund.findUnique({ where: { id: refund.id }, include: { attempts: true } })
    check('4c. DB: refund still ACTION_REQUIRED (the claim never landed)', refundAfter.status === 'ACTION_REQUIRED', refundAfter.status)
    check('4d. DB: reservation still held', refundAfter.reservationHeld === true, String(refundAfter.reservationHeld))
    check('4e. DB: no ACCOUNTING_ACCEPTED attempt was created',
      refundAfter.attempts.every((a) => a.status === 'LEGACY_PENDING_CONFIRMATION'),
      JSON.stringify(refundAfter.attempts.map((a) => a.status)))
    const proofAfter = await db().paymentProof.findUnique({ where: { id: proof.id } })
    check('4f. DB: proof refund counters untouched (reserved still held, nothing accepted)',
      proofAfter.reservedRefundMinor === amountMinor,
      `reserved=${proofAfter.reservedRefundMinor} expected=${amountMinor}`)

    const fresh = (await session(ids.actor)).token
    const ok = await call('PATCH', `/api/admin/refunds/${refund.id}/legacy-accept`, fresh, { reason: 'SEC-002R round 2 control.' })
    check('4g. control: identical acceptance with a live session SUCCEEDS', ok.status === 200, JSON.stringify(ok.j).slice(0, 300))
    const refundOk = await db().refund.findUnique({ where: { id: refund.id } })
    check('4h. DB: control genuinely committed (refund now ACCOUNTING_ACCEPTED)',
      refundOk.status === 'ACCOUNTING_ACCEPTED', refundOk.status)
  }

  // =============================================================================================
  console.log('\n=== 5. A9 WALLET GIFT CREATION (money) — T1 slow body vs logout-all ===')
  // =============================================================================================
  // Round 1 raced the CLAIM but never the CREATION. Creation debits real ledger money out of the
  // sender's own wallet into an instrument someone else can then claim.
  {
    await fundWallet(ids.sender, 5_000_000)
    const SENDER = (await session(ids.sender)).token
    const balanceBefore = (await db().wallet.findUnique({ where: { userId_currency: { userId: ids.sender, currency: 'SYP' } } }))?.cachedBalanceMinor ?? 0
    const giftsBefore = await db().walletGift.count({ where: { senderUserId: ids.sender } })
    const recipientPhone = `+96391${String(RUN).slice(-7)}`

    const res = await raceBody({
      method: 'POST',
      path: '/api/wallet/gifts',
      token: SENDER,
      body: { amountMinor: 12_000, currency: 'SYP', recipientPhone },
      actorId: ids.sender,
      adminMarker: false,
      label: '5. wallet-gift-create',
      revoke: () => logoutAll(ids.sender, '5'),
    })

    check('5a. in-flight gift creation is REFUSED', res.status !== 201, `status=${res.status} body=${JSON.stringify(res.j)}`)
    check('5b. refusal is a COMMIT-BOUNDARY refusal (proves it was admitted first)', isBoundaryRefusal(res), `${res.status} ${code(res)}`)

    const giftsAfter = await db().walletGift.count({ where: { senderUserId: ids.sender } })
    check('5c. DB: NO WalletGift row was created', giftsAfter === giftsBefore, `${giftsBefore} -> ${giftsAfter}`)
    const balanceAfter = (await db().wallet.findUnique({ where: { userId_currency: { userId: ids.sender, currency: 'SYP' } } }))?.cachedBalanceMinor ?? 0
    check('5d. DB: sender wallet balance UNCHANGED (no debit)', balanceAfter === balanceBefore, `${balanceBefore} -> ${balanceAfter}`)
    // WalletEntry is keyed by walletId, not userId -- resolve the sender's SYP wallet first.
    const senderWallet = await db().wallet.findUnique({ where: { userId_currency: { userId: ids.sender, currency: 'SYP' } } })
    const debitsAfter = await db().walletEntry.count({ where: { walletId: senderWallet.id, referenceType: 'wallet_gift_sent' } })
    check('5e. DB: no wallet_gift_sent DEBIT entry was created by the refused attempt',
      debitsAfter === giftsBefore, `debits=${debitsAfter} gifts=${giftsBefore}`)

    const fresh = (await session(ids.sender)).token
    const ok = await call('POST', '/api/wallet/gifts', fresh, { amountMinor: 12_000, currency: 'SYP', recipientPhone })
    check('5f. control: identical creation with a live session SUCCEEDS', ok.status === 201, JSON.stringify(ok.j).slice(0, 250))
    const balanceControl = (await db().wallet.findUnique({ where: { userId_currency: { userId: ids.sender, currency: 'SYP' } } }))?.cachedBalanceMinor ?? 0
    check('5g. DB: control genuinely committed (sender debited by exactly the gift amount)',
      balanceControl === balanceBefore - 12_000, `${balanceBefore} -> ${balanceControl}`)
  }

  // =============================================================================================
  console.log('\n=== 5b. WALLET GIFT FAILED-CLAIM LOCKOUT — the A8-shaped residual on this route ===')
  // =============================================================================================
  // registerFailedGiftClaim() writes a durable attempt counter, and a 10-minute lockout at 3 tries,
  // onto ANOTHER party's gift row -- and it ran outside the claim's re-authorized transaction, before
  // it. Same shape as A8's claim bookkeeping: a revoked session could still deny a legitimate
  // recipient access to their own money, repeatedly. Closed rather than documented as acceptable.
  {
    await fundWallet(ids.sender, 5_000_000)
    const SENDER = (await session(ids.sender)).token
    const recipientPhone = `+96394${String(RUN).slice(-7)}`
    const giftRes = await call('POST', '/api/wallet/gifts', SENDER, { amountMinor: 9_000, currency: 'SYP', recipientPhone })
    const gift = giftRes.j?.gift
    check('5b-fixture: a claimable gift exists', gift?.status === 'SENT', JSON.stringify(giftRes.j).slice(0, 200))
    check('5b-fixture: attempt counter starts at 0', gift.claimAttemptCount === 0, String(gift.claimAttemptCount))

    const raceToken = (await session(ids.guest2)).token
    const res = await raceBody({
      method: 'POST',
      path: `/api/wallet/gifts/${gift.id}/claim`,
      token: raceToken,
      // Right phone, WRONG code -- the branch that registers a failed attempt.
      body: { phone: recipientPhone, code: '000000' },
      actorId: ids.guest2,
      adminMarker: false,
      label: '5b. gift-failed-claim',
      revoke: () => logoutAll(ids.guest2, '5b'),
    })

    check('5b-a. in-flight failed claim is REFUSED', res.status !== 200, `status=${res.status} body=${JSON.stringify(res.j)}`)
    check('5b-b. refusal is a COMMIT-BOUNDARY refusal, not GIFT_CODE_INVALID', isBoundaryRefusal(res), `${res.status} ${code(res)}`)
    const after = await db().walletGift.findUnique({ where: { id: gift.id } })
    check('5b-c. DB: attempt counter did NOT advance', after.claimAttemptCount === 0, String(after.claimAttemptCount))
    check('5b-d. DB: no lockout was applied to the recipient', after.lockedUntil === null, String(after.lockedUntil))

    // Control: identical wrong code, live session -- the counter MUST advance, proving 5b-c measured
    // a real, reachable write rather than a branch the request never got to.
    const fresh = (await session(ids.guest2)).token
    const ok = await call('POST', `/api/wallet/gifts/${gift.id}/claim`, fresh, { phone: recipientPhone, code: '000000' })
    check('5b-e. control: identical wrong code with a live session reaches the real failure path',
      code(ok) === 'GIFT_CODE_INVALID', `${ok.status} ${code(ok)}`)
    const ctrl = await db().walletGift.findUnique({ where: { id: gift.id } })
    check('5b-f. DB: control genuinely committed the attempt counter (0 -> 1)', ctrl.claimAttemptCount === 1, String(ctrl.claimAttemptCount))
  }

  // =============================================================================================
  console.log('\n=== 6. A5 REVIEW QUEUE — all six decision types, raced individually ===')
  // =============================================================================================
  // Round 1 raced only payment-APPROVE and iddocument-APPROVE. The dispatcher is ONE transaction
  // covering six distinct irreversible decisions; a single re-authorization covers every branch, but
  // "covers" is a claim about code, and each branch reaches a different write. Each is raced here.
  {
    // ---- 6.1 listing APPROVE -------------------------------------------------------------------
    await clearAdminBucket(ids.actor)
    {
      const created = await call('POST', '/api/listings', await hostT(), {
        division: 'STAYS', titleAr: 'شقة مراجعة', titleEn: `SEC-002R2 review ${randomUUID().slice(0, 6)}`,
        priceMinor: 150000, currency: 'SYP',
      })
      const listingId = created.j?.listing?.id
      await call('PATCH', `/api/listings/${listingId}/submit`, await hostT())
      const before = await db().listing.findUnique({ where: { id: listingId } })
      check('6.1-fixture: listing is PENDING_REVIEW', before?.status === 'PENDING_REVIEW', before?.status)

      const raceToken = (await session(ids.actor)).token
      const res = await raceBody({
        method: 'PATCH', path: `/api/admin/review-queue/listing/${listingId}`, token: raceToken,
        body: { decision: 'APPROVE' }, actorId: ids.actor, label: '6.1 listing-approve',
        revoke: () => logoutAll(ids.actor, '6.1'),
      })
      check('6.1a. listing APPROVE is REFUSED', res.status !== 200, `${res.status} ${JSON.stringify(res.j)}`)
      check('6.1b. refusal is a COMMIT-BOUNDARY refusal', isBoundaryRefusal(res), `${res.status} ${code(res)}`)
      const after = await db().listing.findUnique({ where: { id: listingId } })
      check('6.1c. DB: listing still PENDING_REVIEW', after.status === 'PENDING_REVIEW', after.status)
      const audit = await db().adminAuditLog.findFirst({ where: { actorUserId: ids.actor, entityId: listingId } })
      check('6.1d. DB: no audit row for the refused decision', !audit, JSON.stringify(audit))

      const ok = await call('PATCH', `/api/admin/review-queue/listing/${listingId}`, (await session(ids.actor)).token, { decision: 'APPROVE' })
      check('6.1e. control: SUCCEEDS with a live session', ok.status === 200, JSON.stringify(ok.j).slice(0, 200))
      const ctrl = await db().listing.findUnique({ where: { id: listingId } })
      check('6.1f. DB: control genuinely committed (listing APPROVED)', ctrl.status === 'APPROVED', ctrl.status)
    }

    // ---- 6.2 payment REJECT --------------------------------------------------------------------
    await clearAdminBucket(ids.actor)
    {
      const booking = await makeBooking(instantListingId)
      const { proofId } = await submitProof(booking.id)
      check('6.2-fixture: proof is PENDING_ADMIN_REVIEW', Boolean(proofId), String(proofId))

      const raceToken = (await session(ids.actor)).token
      const res = await raceBody({
        method: 'PATCH', path: `/api/admin/review-queue/payment/${proofId}`, token: raceToken,
        body: { decision: 'REJECT', adminNote: 'sec002r2 race' }, actorId: ids.actor, label: '6.2 payment-reject',
        revoke: () => logoutAll(ids.actor, '6.2'),
      })
      check('6.2a. payment REJECT is REFUSED', res.status !== 200, `${res.status} ${JSON.stringify(res.j)}`)
      check('6.2b. refusal is a COMMIT-BOUNDARY refusal', isBoundaryRefusal(res), `${res.status} ${code(res)}`)
      const after = await db().paymentProof.findUnique({ where: { id: proofId } })
      check('6.2c. DB: proof still PENDING_ADMIN_REVIEW', after.status === 'PENDING_ADMIN_REVIEW', after.status)
      check('6.2d. DB: no reviewer recorded', after.reviewedById === null, String(after.reviewedById))

      const ok = await call('PATCH', `/api/admin/review-queue/payment/${proofId}`, (await session(ids.actor)).token, { decision: 'REJECT' })
      check('6.2e. control: SUCCEEDS with a live session', ok.status === 200, JSON.stringify(ok.j).slice(0, 200))
      const ctrl = await db().paymentProof.findUnique({ where: { id: proofId } })
      check('6.2f. DB: control genuinely committed (proof REJECTED)', ctrl.status === 'REJECTED', ctrl.status)
    }

    // ---- 6.3 wallet gift APPROVE ---------------------------------------------------------------
    await clearAdminBucket(ids.actor)
    {
      await fundWallet(ids.sender, 5_000_000)
      const SENDER = (await session(ids.sender)).token
      // At/above giftReviewThresholdMinor('SYP') = 100000 the gift lands CLAIM_PENDING for review.
      const giftRes = await call('POST', '/api/wallet/gifts', SENDER, {
        amountMinor: 150_000, currency: 'SYP', recipientPhone: `+96392${String(RUN).slice(-7)}`,
      })
      const gift = giftRes.j?.gift
      check('6.3-fixture: gift is CLAIM_PENDING (above the review threshold)', gift?.status === 'CLAIM_PENDING', JSON.stringify(giftRes.j).slice(0, 200))

      const raceToken = (await session(ids.actor)).token
      const res = await raceBody({
        method: 'PATCH', path: `/api/admin/review-queue/gift/${gift.id}`, token: raceToken,
        body: { decision: 'APPROVE' }, actorId: ids.actor, label: '6.3 gift-approve',
        revoke: () => logoutAll(ids.actor, '6.3'),
      })
      check('6.3a. gift APPROVE is REFUSED', res.status !== 200, `${res.status} ${JSON.stringify(res.j)}`)
      check('6.3b. refusal is a COMMIT-BOUNDARY refusal', isBoundaryRefusal(res), `${res.status} ${code(res)}`)
      const after = await db().walletGift.findUnique({ where: { id: gift.id } })
      check('6.3c. DB: gift still CLAIM_PENDING (not released to the recipient)', after.status === 'CLAIM_PENDING', after.status)

      const ok = await call('PATCH', `/api/admin/review-queue/gift/${gift.id}`, (await session(ids.actor)).token, { decision: 'APPROVE' })
      check('6.3e. control: SUCCEEDS with a live session', ok.status === 200, JSON.stringify(ok.j).slice(0, 200))
      const ctrl = await db().walletGift.findUnique({ where: { id: gift.id } })
      check('6.3f. DB: control genuinely committed (gift SENT)', ctrl.status === 'SENT', ctrl.status)
    }

    // ---- 6.4 wallet gift REJECT (blocked -> sender refund: real money) --------------------------
    await clearAdminBucket(ids.actor)
    {
      await fundWallet(ids.sender, 5_000_000)
      const SENDER = (await session(ids.sender)).token
      const giftRes = await call('POST', '/api/wallet/gifts', SENDER, {
        amountMinor: 160_000, currency: 'SYP', recipientPhone: `+96393${String(RUN).slice(-7)}`,
      })
      const gift = giftRes.j?.gift
      check('6.4-fixture: gift is CLAIM_PENDING', gift?.status === 'CLAIM_PENDING', JSON.stringify(giftRes.j).slice(0, 200))
      const senderBalanceBefore = (await db().wallet.findUnique({ where: { userId_currency: { userId: ids.sender, currency: 'SYP' } } })).cachedBalanceMinor

      const raceToken = (await session(ids.actor)).token
      const res = await raceBody({
        method: 'PATCH', path: `/api/admin/review-queue/gift/${gift.id}`, token: raceToken,
        body: { decision: 'REJECT' }, actorId: ids.actor, label: '6.4 gift-block',
        revoke: () => logoutAll(ids.actor, '6.4'),
      })
      check('6.4a. gift BLOCK is REFUSED', res.status !== 200, `${res.status} ${JSON.stringify(res.j)}`)
      check('6.4b. refusal is a COMMIT-BOUNDARY refusal', isBoundaryRefusal(res), `${res.status} ${code(res)}`)
      const after = await db().walletGift.findUnique({ where: { id: gift.id } })
      check('6.4c. DB: gift still CLAIM_PENDING (not blocked)', after.status === 'CLAIM_PENDING', after.status)
      const refundEntry = await db().walletEntry.findFirst({ where: { referenceType: 'wallet_gift_blocked', referenceId: gift.id } })
      check('6.4d. DB: NO sender-refund wallet entry was created', !refundEntry, JSON.stringify(refundEntry))
      const senderBalanceAfter = (await db().wallet.findUnique({ where: { userId_currency: { userId: ids.sender, currency: 'SYP' } } })).cachedBalanceMinor
      check('6.4e. DB: sender balance unchanged by the refused block', senderBalanceAfter === senderBalanceBefore, `${senderBalanceBefore} -> ${senderBalanceAfter}`)

      const ok = await call('PATCH', `/api/admin/review-queue/gift/${gift.id}`, (await session(ids.actor)).token, { decision: 'REJECT' })
      check('6.4f. control: SUCCEEDS with a live session', ok.status === 200, JSON.stringify(ok.j).slice(0, 200))
      const ctrl = await db().walletGift.findUnique({ where: { id: gift.id } })
      check('6.4g. DB: control genuinely committed (gift ADMIN_BLOCKED)', ctrl.status === 'ADMIN_BLOCKED', ctrl.status)
      const refundOk = await db().walletEntry.findFirst({ where: { referenceType: 'wallet_gift_blocked', referenceId: gift.id } })
      check('6.4h. DB: control genuinely committed (sender refunded)', Boolean(refundOk), 'no refund entry')
    }

    // ---- 6.5 booking REJECT (refund request + platform-share reversal: real money) --------------
    await clearAdminBucket(ids.actor)
    {
      const booking = await makeBooking(requestListingId)
      await payAndApprove(booking.id)
      const seeded = await db().booking.findUnique({ where: { id: booking.id } })
      check('6.5-fixture: booking is REQUESTED (host-review listing)', seeded.status === 'REQUESTED', seeded.status)

      const raceToken = (await session(ids.actor)).token
      const res = await raceBody({
        method: 'PATCH', path: `/api/admin/review-queue/booking/${booking.id}`, token: raceToken,
        body: { decision: 'REJECT' }, actorId: ids.actor, label: '6.5 booking-reject',
        revoke: () => logoutAll(ids.actor, '6.5'),
      })
      check('6.5a. booking REJECT is REFUSED', res.status !== 200, `${res.status} ${JSON.stringify(res.j)}`)
      check('6.5b. refusal is a COMMIT-BOUNDARY refusal', isBoundaryRefusal(res), `${res.status} ${code(res)}`)
      const after = await db().booking.findUnique({ where: { id: booking.id }, include: { payments: true } })
      check('6.5c. DB: booking still REQUESTED (not cancelled)', after.status === 'REQUESTED', after.status)
      check('6.5d. DB: payment proof NOT flipped to REFUNDED',
        after.payments.every((p) => p.status !== 'REFUNDED'), JSON.stringify(after.payments.map((p) => p.status)))
      const refundRow = await db().refund.findFirst({ where: { bookingId: booking.id } })
      check('6.5e. DB: NO Refund row was created', !refundRow, JSON.stringify(refundRow?.id))
      const reversal = await db().walletEntry.findFirst({ where: { referenceType: 'booking_admin_share_reversal', referenceId: booking.id } })
      check('6.5f. DB: NO platform-share reversal entry', !reversal, JSON.stringify(reversal))

      const ok = await call('PATCH', `/api/admin/review-queue/booking/${booking.id}`, (await session(ids.actor)).token, { decision: 'REJECT' })
      check('6.5g. control: SUCCEEDS with a live session', ok.status === 200, JSON.stringify(ok.j).slice(0, 200))
      const ctrl = await db().booking.findUnique({ where: { id: booking.id } })
      check('6.5h. DB: control genuinely committed (booking CANCELLED)', ctrl.status === 'CANCELLED', ctrl.status)
      const refundCtrl = await db().refund.findFirst({ where: { bookingId: booking.id } })
      check('6.5i. DB: control genuinely committed (Refund row now exists)', Boolean(refundCtrl), 'no refund row')
    }

    // ---- 6.6 iddocument REJECT -----------------------------------------------------------------
    await clearAdminBucket(ids.actor)
    {
      const KYC_T = (await session(ids.kyc)).token
      await call('PATCH', '/api/me/id-document', KYC_T, { fileBase64: 'ZmFrZQ==', mimeType: 'image/png' })
      const before = await db().user.findUnique({ where: { id: ids.kyc }, select: { idDocumentStatus: true } })
      check('6.6-fixture: subject ID document is PENDING_REVIEW', before.idDocumentStatus === 'PENDING_REVIEW', before.idDocumentStatus)

      const raceToken = (await session(ids.actor)).token
      const res = await raceBody({
        method: 'PATCH', path: `/api/admin/review-queue/iddocument/${ids.kyc}`, token: raceToken,
        body: { decision: 'REJECT' }, actorId: ids.actor, label: '6.6 kyc-reject',
        revoke: () => logoutAll(ids.actor, '6.6'),
      })
      check('6.6a. iddocument REJECT is REFUSED', res.status !== 200, `${res.status} ${JSON.stringify(res.j)}`)
      check('6.6b. refusal is a COMMIT-BOUNDARY refusal', isBoundaryRefusal(res), `${res.status} ${code(res)}`)
      const after = await db().user.findUnique({ where: { id: ids.kyc }, select: { idDocumentStatus: true, idDocumentReviewedById: true } })
      check('6.6c. DB: ID document still PENDING_REVIEW', after.idDocumentStatus === 'PENDING_REVIEW', after.idDocumentStatus)
      check('6.6d. DB: no reviewer recorded', after.idDocumentReviewedById === null, String(after.idDocumentReviewedById))

      const ok = await call('PATCH', `/api/admin/review-queue/iddocument/${ids.kyc}`, (await session(ids.actor)).token, { decision: 'REJECT' })
      check('6.6e. control: SUCCEEDS with a live session', ok.status === 200, JSON.stringify(ok.j).slice(0, 200))
      const ctrl = await db().user.findUnique({ where: { id: ids.kyc }, select: { idDocumentStatus: true } })
      check('6.6f. DB: control genuinely committed (ID document REJECTED)', ctrl.idDocumentStatus === 'REJECTED', ctrl.idDocumentStatus)
    }
  }

  // =============================================================================================
  console.log('\n=== 7. A8 — a refused replay must not advance attempts or reach DEAD_LETTERED ===')
  // =============================================================================================
  // THE finding. Round 1's re-authorization sat inside the rail's apply() transaction only; the CLAIM
  // (attempts increment + APPLYING) and the failure write (FAILED / DEAD_LETTERED) were outside and
  // before it. Round 1's own section 8 asserted only "not APPLIED", which is exactly why it passed
  // while this was broken. Here the assertion is the one that matters: attempts must be IDENTICAL
  // and the row must not be pushed one step closer to (or into) DEAD_LETTERED.
  {
    await clearAdminBucket(ids.actor)
    const booking = await makeBooking(instantListingId)
    const intentRes = await call('POST', '/api/payments/intents', await guestT(), { bookingId: booking.id })
    const intent = intentRes.j?.intent
    check('7-fixture: real PaymentIntent created', Boolean(intent?.id), JSON.stringify(intentRes.j).slice(0, 250))

    // attempts = DEAD_LETTER_THRESHOLD - 1. One more increment is all it takes to dead-letter this
    // event, which is precisely the escalation a revoked admin must not be able to cause.
    const event = await db().paymentEvent.create({
      data: {
        rail: 'payment_intent', provider: 'sandbox', providerEndpointKey: 'sandbox-test-account',
        environment: 'test', subjectType: 'PAYMENT_INTENT', providerReference: intent.reference,
        providerEventId: `evt_sec002r2_a8_${randomUUID()}`, type: 'payment_intent.succeeded',
        amountMinor: intent.amountMinor, currency: intent.currency,
        providerObjectId: `pi_sec002r2_a8_${randomUUID()}`, payloadDigest: 'sec002r2-a8-digest',
        intentId: intent.id, originalIntentId: intent.id, originalBookingId: booking.id,
        processingStatus: 'FAILED', attempts: 4, lastError: 'seeded one attempt below the dead-letter threshold',
      },
    })

    const raceToken = (await session(ids.actor)).token
    const res = await (await raceStalled({
      table: 'payment_events',
      label: '7. payment-event-replay',
      actorId: ids.actor,
      start: () => call('POST', `/api/admin/payment-events/${event.id}/replay`, raceToken, undefined),
      revoke: () => logoutAll(ids.actor, '7'),
    }))

    check('7a. in-flight replay is REFUSED', res.status !== 200, `status=${res.status} body=${JSON.stringify(res.j).slice(0, 300)}`)
    check('7b. refusal is a COMMIT-BOUNDARY refusal', isBoundaryRefusal(res), `${res.status} ${code(res)}`)

    const eventAfter = await db().paymentEvent.findUnique({ where: { id: event.id } })
    check('7c. DB(A8): attempts did NOT advance (still 4)', eventAfter.attempts === 4, `attempts=${eventAfter.attempts}`)
    check('7d. DB(A8): the event was NOT pushed to DEAD_LETTERED', eventAfter.processingStatus !== 'DEAD_LETTERED', eventAfter.processingStatus)
    check('7e. DB(A8): the event was not left stranded at APPLYING either', eventAfter.processingStatus === 'FAILED', eventAfter.processingStatus)
    check('7f. DB(A8): no claim was left held', eventAfter.claimToken === null && eventAfter.claimExpiresAt === null,
      `claimToken=${eventAfter.claimToken} claimExpiresAt=${eventAfter.claimExpiresAt}`)
    check('7g. DB(A8): lastError was not overwritten by the refused attempt',
      eventAfter.lastError === 'seeded one attempt below the dead-letter threshold', String(eventAfter.lastError).slice(0, 120))
    check('7h. DB: event NOT marked APPLIED', eventAfter.processingStatus !== 'APPLIED', eventAfter.processingStatus)
    const intentAfter = await db().paymentIntent.findUnique({ where: { id: intent.id } })
    check('7i. DB: intent NOT moved to SUCCEEDED', intentAfter.status !== 'SUCCEEDED', intentAfter.status)
    const proof = await db().paymentProof.findFirst({ where: { bookingId: booking.id } })
    check('7j. DB: NO PaymentProof was created by the refused replay', !proof, JSON.stringify(proof?.id))
    // The refusal IS audited -- deliberately. Recording that a revoked actor attempted a replay is a
    // security benefit, and the row carries no business state.
    const auditRow = await db().adminAuditLog.findFirst({
      where: { actorUserId: ids.actor, action: 'ADMIN_PAYMENT_EVENT_REPLAYED', entityId: event.id },
      orderBy: { createdAt: 'desc' },
    })
    check('7k. DB: the refused attempt IS recorded in the audit log, marked as refused',
      Boolean(auditRow?.after?.refused), JSON.stringify(auditRow?.after))

    const fresh = (await session(ids.actor)).token
    const ok = await call('POST', `/api/admin/payment-events/${event.id}/replay`, fresh, undefined)
    check('7l. control: identical replay with a live session SUCCEEDS', ok.status === 200, JSON.stringify(ok.j).slice(0, 300))
    const eventOk = await db().paymentEvent.findUnique({ where: { id: event.id } })
    check('7m. DB: control genuinely committed (event now APPLIED)', eventOk.processingStatus === 'APPLIED', eventOk.processingStatus)
    check('7n. DB: the control attempt DID advance attempts to 5 (proving 7c measured a real counter)',
      eventOk.attempts === 5, `attempts=${eventOk.attempts}`)
  }

  // =============================================================================================
  console.log('\n=== 8. G1 ADMIN ID-DOCUMENT UPLOAD (KYC) — T1 slow body vs logout-all ===')
  // =============================================================================================
  // Reproduced live by the review that ordered this round: a revoked admin's write committed 265ms
  // after the same token was proven dead. Beyond the row write, this path DELETES the target's
  // previous identity document -- the destructive half must not happen either.
  {
    await clearAdminBucket(ids.actor)
    // Give the subject a real, current document first, so the "previous document must survive a
    // refused upload" assertion has something to protect.
    const KYC_T = (await session(ids.kyc)).token
    await call('PATCH', '/api/me/id-document', KYC_T, { fileBase64: 'b3JpZ2luYWw=', mimeType: 'image/png' })
    const before = await db().user.findUnique({
      where: { id: ids.kyc },
      select: { idDocumentRef: true, idDocumentMimeType: true, idDocumentStatus: true },
    })
    check('8-fixture: subject has a current ID document on file', Boolean(before.idDocumentRef), String(before.idDocumentRef))

    const raceToken = (await session(ids.actor)).token
    const res = await raceBody({
      method: 'PATCH',
      path: `/api/admin/id-document/${ids.kyc}/upload`,
      token: raceToken,
      body: { fileBase64: 'cmVwbGFjZW1lbnQ=', mimeType: 'image/jpeg' },
      actorId: ids.actor,
      label: '8. admin-id-document-upload',
      revoke: () => logoutAll(ids.actor, '8'),
    })

    check('8a. in-flight admin KYC upload is REFUSED', res.status !== 200, `status=${res.status} body=${JSON.stringify(res.j)}`)
    check('8b. refusal is a COMMIT-BOUNDARY refusal', isBoundaryRefusal(res), `${res.status} ${code(res)}`)

    const after = await db().user.findUnique({
      where: { id: ids.kyc },
      select: { idDocumentRef: true, idDocumentMimeType: true, idDocumentStatus: true },
    })
    check('8c. DB: target idDocumentRef UNCHANGED (the replacement did not land)',
      after.idDocumentRef === before.idDocumentRef, `${before.idDocumentRef} -> ${after.idDocumentRef}`)
    check('8d. DB: target idDocumentMimeType UNCHANGED',
      after.idDocumentMimeType === before.idDocumentMimeType, `${before.idDocumentMimeType} -> ${after.idDocumentMimeType}`)
    check('8e. DB: target idDocumentStatus UNCHANGED',
      after.idDocumentStatus === before.idDocumentStatus, `${before.idDocumentStatus} -> ${after.idDocumentStatus}`)
    const audit = await db().adminAuditLog.findFirst({
      where: { actorUserId: ids.actor, action: 'ID_DOCUMENT_UPLOADED_BY_ADMIN', entityId: ids.kyc },
    })
    check('8f. DB: no ID_DOCUMENT_UPLOADED_BY_ADMIN audit row', !audit, JSON.stringify(audit))
    // The destructive half: the previous document must still be readable through the real endpoint.
    const readBack = await fetch(`${API}/api/admin/id-document/${ids.kyc}/file`, {
      headers: { authorization: `Bearer ${OP}` },
    })
    check("8g. the target's PREVIOUS identity document was NOT deleted (still readable)",
      readBack.status === 200, `status=${readBack.status}`)

    const fresh = (await session(ids.actor)).token
    const ok = await call('PATCH', `/api/admin/id-document/${ids.kyc}/upload`, fresh, { fileBase64: 'cmVwbGFjZW1lbnQ=', mimeType: 'image/jpeg' })
    check('8h. control: identical upload with a live session SUCCEEDS', ok.status === 200, JSON.stringify(ok.j).slice(0, 250))
    const ctrl = await db().user.findUnique({ where: { id: ids.kyc }, select: { idDocumentRef: true, idDocumentMimeType: true } })
    check('8i. DB: control genuinely committed (idDocumentRef replaced)',
      ctrl.idDocumentRef !== before.idDocumentRef && ctrl.idDocumentMimeType === 'image/jpeg',
      `${before.idDocumentRef} -> ${ctrl.idDocumentRef} (${ctrl.idDocumentMimeType})`)
  }

  // =============================================================================================
  console.log('\n=== 9. G2 PROMO CODE CREATE + TOGGLE (commercial instrument) — T1 vs logout-all ===')
  // =============================================================================================
  {
    await clearAdminBucket(ids.actor)
    const codeString = `SEC002R2${String(RUN).slice(-8)}`
    const raceToken = (await session(ids.actor)).token
    const res = await raceBody({
      method: 'POST',
      path: '/api/admin/sr/promo-codes',
      token: raceToken,
      body: { code: codeString, discountType: 'PERCENT', discountValue: 25 },
      actorId: ids.actor,
      label: '9. promo-code-create',
      revoke: () => logoutAll(ids.actor, '9'),
    })

    check('9a. in-flight promo-code creation is REFUSED', res.status !== 201, `status=${res.status} body=${JSON.stringify(res.j)}`)
    check('9b. refusal is a COMMIT-BOUNDARY refusal', isBoundaryRefusal(res), `${res.status} ${code(res)}`)
    const created = await db().promoCode.findFirst({ where: { code: codeString } })
    check('9c. DB: NO PromoCode row exists', !created, JSON.stringify(created))
    const audit = await db().adminAuditLog.findFirst({ where: { actorUserId: ids.actor, action: 'SR_PROMO_CODE_CREATED' } })
    check('9d. DB: no SR_PROMO_CODE_CREATED audit row', !audit, JSON.stringify(audit))

    const fresh = (await session(ids.actor)).token
    const ok = await call('POST', '/api/admin/sr/promo-codes', fresh, { code: codeString, discountType: 'PERCENT', discountValue: 25 })
    check('9e. control: identical creation with a live session SUCCEEDS', ok.status === 201, JSON.stringify(ok.j).slice(0, 250))
    const promo = await db().promoCode.findFirst({ where: { code: codeString } })
    check('9f. DB: control genuinely committed (PromoCode exists and is active)', promo?.active === true, JSON.stringify(promo?.active))

    // ---- 9.2 promo-code toggle (the on/off switch for a live discount instrument) ---------------
    await clearAdminBucket(ids.actor)
    const toggleToken = (await session(ids.actor)).token
    const res2 = await raceBody({
      method: 'PATCH',
      path: `/api/admin/sr/promo-codes/${promo.id}`,
      token: toggleToken,
      body: { active: false },
      actorId: ids.actor,
      label: '9.2 promo-code-toggle',
      revoke: () => logoutAll(ids.actor, '9.2'),
    })
    check('9g. in-flight promo-code toggle is REFUSED', res2.status !== 200, `status=${res2.status} body=${JSON.stringify(res2.j)}`)
    check('9h. refusal is a COMMIT-BOUNDARY refusal', isBoundaryRefusal(res2), `${res2.status} ${code(res2)}`)
    const stillActive = await db().promoCode.findUnique({ where: { id: promo.id } })
    check('9i. DB: promo code is STILL ACTIVE (the toggle did not land)', stillActive.active === true, String(stillActive.active))

    const ok2 = await call('PATCH', `/api/admin/sr/promo-codes/${promo.id}`, (await session(ids.actor)).token, { active: false })
    check('9j. control: identical toggle with a live session SUCCEEDS', ok2.status === 200, JSON.stringify(ok2.j).slice(0, 200))
    const toggled = await db().promoCode.findUnique({ where: { id: promo.id } })
    check('9k. DB: control genuinely committed (promo code now inactive)', toggled.active === false, String(toggled.active))
  }

  // =============================================================================================
  console.log('\n=== 10. BUSINESS-ACCOUNT ONBOARDING (privilege) — T1 slow body vs logout-all ===')
  // =============================================================================================
  // Creating this row IS the privilege grant: business.mjs derives business-admin authority purely
  // from businessAccount.adminUserId === context.user.id, so the named person immediately gains the
  // standing power to enrol riders who can bill real rides to the company.
  {
    await clearAdminBucket(ids.actor)
    const bizAdminRow = await db().user.findUnique({ where: { id: ids.bizAdmin }, select: { email: true } })
    const companyName = `SEC-002R2 Co ${String(RUN).slice(-6)}`
    const raceToken = (await session(ids.actor)).token
    const res = await raceBody({
      method: 'POST',
      path: '/api/admin/sr/business-accounts',
      token: raceToken,
      body: { name: companyName, billingContactEmail: bizAdminRow.email, adminEmail: bizAdminRow.email },
      actorId: ids.actor,
      label: '10. business-account-create',
      revoke: () => logoutAll(ids.actor, '10'),
    })

    check('10a. in-flight business-account creation is REFUSED', res.status !== 201, `status=${res.status} body=${JSON.stringify(res.j)}`)
    check('10b. refusal is a COMMIT-BOUNDARY refusal', isBoundaryRefusal(res), `${res.status} ${code(res)}`)
    const created = await db().businessAccount.findFirst({ where: { adminUserId: ids.bizAdmin } })
    check('10c. DB: NO BusinessAccount row exists (no privilege was granted)', !created, JSON.stringify(created?.id))
    // The privilege itself, tested through the API the grant would have unlocked.
    const BIZ = (await session(ids.bizAdmin)).token
    const denied = await call('GET', '/api/business/account', BIZ, undefined)
    check('10d. the named user genuinely has NO business-admin authority', denied.status === 403, `${denied.status} ${code(denied)}`)

    const fresh = (await session(ids.actor)).token
    const ok = await call('POST', '/api/admin/sr/business-accounts', fresh, {
      name: companyName, billingContactEmail: bizAdminRow.email, adminEmail: bizAdminRow.email,
    })
    check('10e. control: identical creation with a live session SUCCEEDS', ok.status === 201, JSON.stringify(ok.j).slice(0, 250))
    const granted = await call('GET', '/api/business/account', (await session(ids.bizAdmin)).token, undefined)
    check('10f. control genuinely committed (the user now HAS business-admin authority)', granted.status === 200, `${granted.status} ${code(granted)}`)
  }

  // =============================================================================================
  console.log('\n=== 11. BUSINESS MEMBERSHIP add/remove (privilege) — T1 + T2 ===')
  // =============================================================================================
  {
    const BIZ = (await session(ids.bizAdmin)).token
    const memberRow = await db().user.findUnique({ where: { id: ids.bizMember }, select: { email: true } })

    // ---- 11.1 add member (T1: reads a body) ----------------------------------------------------
    const res = await raceBody({
      method: 'POST',
      path: '/api/business/members',
      token: BIZ,
      body: { email: memberRow.email },
      actorId: ids.bizAdmin,
      adminMarker: false,
      label: '11.1 business-member-add',
      revoke: () => logoutAll(ids.bizAdmin, '11.1'),
    })
    check('11a. in-flight member add is REFUSED', res.status !== 201, `status=${res.status} body=${JSON.stringify(res.j)}`)
    check('11b. refusal is a COMMIT-BOUNDARY refusal', isBoundaryRefusal(res), `${res.status} ${code(res)}`)
    const memberAfter = await db().businessAccountMember.findFirst({ where: { userId: ids.bizMember } })
    check('11c. DB: NO membership row was created', !memberAfter, JSON.stringify(memberAfter?.id))

    const BIZ2 = (await session(ids.bizAdmin)).token
    const ok = await call('POST', '/api/business/members', BIZ2, { email: memberRow.email })
    check('11d. control: identical add with a live session SUCCEEDS', ok.status === 201, JSON.stringify(ok.j).slice(0, 250))
    const memberOk = await db().businessAccountMember.findFirst({ where: { userId: ids.bizMember } })
    check('11e. DB: control genuinely committed (membership exists)', Boolean(memberOk), 'no membership row')

    // ---- 11.2 remove member (T2: reads no body; parks on the business_accounts read) ------------
    const BIZ3 = (await session(ids.bizAdmin)).token
    const res2 = await (await raceStalled({
      table: 'business_accounts',
      label: '11.2 business-member-remove',
      actorId: ids.bizAdmin,
      adminMarker: false,
      start: () => call('DELETE', `/api/business/members/${ids.bizMember}`, BIZ3, undefined),
      revoke: () => logoutAll(ids.bizAdmin, '11.2'),
    }))
    check('11f. in-flight member removal is REFUSED', res2.status !== 200, `status=${res2.status} body=${JSON.stringify(res2.j)}`)
    check('11g. refusal is a COMMIT-BOUNDARY refusal', isBoundaryRefusal(res2), `${res2.status} ${code(res2)}`)
    const stillMember = await db().businessAccountMember.findFirst({ where: { userId: ids.bizMember } })
    check('11h. DB: membership row still exists (the removal did not land)', Boolean(stillMember), 'membership was deleted')

    const BIZ4 = (await session(ids.bizAdmin)).token
    const ok2 = await call('DELETE', `/api/business/members/${ids.bizMember}`, BIZ4, undefined)
    check('11i. control: identical removal with a live session SUCCEEDS', ok2.status === 200, JSON.stringify(ok2.j).slice(0, 200))
    const gone = await db().businessAccountMember.findFirst({ where: { userId: ids.bizMember } })
    check('11j. DB: control genuinely committed (membership deleted)', !gone, JSON.stringify(gone?.id))
  }

  // =============================================================================================
  console.log('\n=== 12. ADMIN REVIEW HIDE (moderation) — T2 stalled read vs logout-all ===')
  // =============================================================================================
  // Hiding a public review is durable, publicly visible, attributed to an account, and has no un-hide
  // endpoint anywhere in this codebase. Reads no request body, so T2 on listing_reviews.
  {
    await clearAdminBucket(ids.actor)
    const booking = await makeBooking(instantListingId)
    await payAndApprove(booking.id)
    await db().booking.update({
      where: { id: booking.id },
      data: { checkIn: new Date(Date.now() - 5 * 86_400_000), checkOut: new Date(Date.now() - 3 * 86_400_000), status: 'COMPLETED' },
    })
    const reviewRes = await call('POST', '/api/reviews', await guestT(), { bookingId: booking.id, rating: 1, comment: 'sec002r2 review' })
    const reviewId = reviewRes.j?.review?.id
    check('12-fixture: a public review exists', Boolean(reviewId), JSON.stringify(reviewRes.j).slice(0, 250))

    const raceToken = (await session(ids.actor)).token
    const res = await (await raceStalled({
      table: 'listing_reviews',
      label: '12. admin-review-hide',
      actorId: ids.actor,
      start: () => call('PATCH', `/api/admin/reviews/${reviewId}/hide`, raceToken, undefined),
      revoke: () => logoutAll(ids.actor, '12'),
    }))

    check('12a. in-flight review hide is REFUSED', res.status !== 200, `status=${res.status} body=${JSON.stringify(res.j)}`)
    check('12b. refusal is a COMMIT-BOUNDARY refusal', isBoundaryRefusal(res), `${res.status} ${code(res)}`)
    const after = await db().listingReview.findUnique({ where: { id: reviewId } })
    check('12c. DB: review still visible (hiddenAt null)', after.hiddenAt === null, String(after.hiddenAt))
    check('12d. DB: no hiding admin recorded', after.hiddenByAdminId === null, String(after.hiddenByAdminId))
    const audit = await db().adminAuditLog.findFirst({ where: { actorUserId: ids.actor, action: 'ADMIN_REVIEW_HIDDEN', entityId: reviewId } })
    check('12e. DB: no ADMIN_REVIEW_HIDDEN audit row', !audit, JSON.stringify(audit))

    const fresh = (await session(ids.actor)).token
    const ok = await call('PATCH', `/api/admin/reviews/${reviewId}/hide`, fresh, undefined)
    check('12f. control: identical hide with a live session SUCCEEDS', ok.status === 200, JSON.stringify(ok.j).slice(0, 200))
    const ctrl = await db().listingReview.findUnique({ where: { id: reviewId } })
    check('12g. DB: control genuinely committed (review now hidden)', Boolean(ctrl.hiddenAt), String(ctrl.hiddenAt))
  }

  // =============================================================================================
  console.log('\n=== 13. GUEST BOOKING CANCELLATION (reserves refund capacity) — T1 ===')
  // =============================================================================================
  // Newly classified Class A by this round's fresh sweep: marks real payment proofs REFUNDED and
  // calls createRefundRequest(), which reserves refund capacity against the proof's ledger counters.
  {
    const booking = await makeBooking(instantListingId)
    const { proofId } = await payAndApprove(booking.id)
    const proofBefore = await db().paymentProof.findUnique({ where: { id: proofId } })
    check('13-fixture: paid booking with an APPROVED proof', proofBefore.status === 'APPROVED', proofBefore.status)

    const raceToken = (await session(ids.guest)).token
    const res = await raceBody({
      method: 'PATCH',
      path: `/api/bookings/${booking.id}/cancel`,
      token: raceToken,
      body: {},
      actorId: ids.guest,
      adminMarker: false,
      label: '13. guest-booking-cancel',
      revoke: () => logoutAll(ids.guest, '13'),
    })

    check('13a. in-flight guest cancellation is REFUSED', res.status !== 200, `status=${res.status} body=${JSON.stringify(res.j)}`)
    check('13b. refusal is a COMMIT-BOUNDARY refusal', isBoundaryRefusal(res), `${res.status} ${code(res)}`)
    const bookingAfter = await db().booking.findUnique({ where: { id: booking.id } })
    check('13c. DB: booking NOT cancelled', bookingAfter.status !== 'CANCELLED', bookingAfter.status)
    const proofAfter = await db().paymentProof.findUnique({ where: { id: proofId } })
    check('13d. DB: payment proof still APPROVED (not flipped to REFUNDED)', proofAfter.status === 'APPROVED', proofAfter.status)
    check('13e. DB: no refund capacity was reserved on the proof',
      proofAfter.reservedRefundMinor === proofBefore.reservedRefundMinor,
      `${proofBefore.reservedRefundMinor} -> ${proofAfter.reservedRefundMinor}`)
    const refundRow = await db().refund.findFirst({ where: { bookingId: booking.id } })
    check('13f. DB: NO Refund row was created', !refundRow, JSON.stringify(refundRow?.id))

    const fresh = (await session(ids.guest)).token
    const ok = await call('PATCH', `/api/bookings/${booking.id}/cancel`, fresh, {})
    check('13g. control: identical cancellation with a live session SUCCEEDS', ok.status === 200, JSON.stringify(ok.j).slice(0, 250))
    const ctrl = await db().booking.findUnique({ where: { id: booking.id } })
    check('13h. DB: control genuinely committed (booking CANCELLED)', ctrl.status === 'CANCELLED', ctrl.status)
    const refundCtrl = await db().refund.findFirst({ where: { bookingId: booking.id } })
    check('13i. DB: control genuinely committed (Refund row now exists)', Boolean(refundCtrl), 'no refund row')
  }

  // =============================================================================================
  console.log('\n=== 14. HOST BOOKING DECISION (reserves refund capacity) — T1 ===')
  // =============================================================================================
  {
    const booking = await makeBooking(requestListingId)
    const { proofId } = await payAndApprove(booking.id)
    const seeded = await db().booking.findUnique({ where: { id: booking.id } })
    check('14-fixture: booking is REQUESTED and awaiting the host', seeded.status === 'REQUESTED', seeded.status)

    const raceToken = (await session(ids.host)).token
    const res = await raceBody({
      method: 'PATCH',
      path: `/api/host/requests/${booking.id}`,
      token: raceToken,
      body: { decision: 'CANCELLED' },
      actorId: ids.host,
      adminMarker: false,
      label: '14. host-booking-cancel',
      revoke: () => logoutAll(ids.host, '14'),
    })

    check('14a. in-flight host cancellation is REFUSED', res.status !== 200, `status=${res.status} body=${JSON.stringify(res.j)}`)
    check('14b. refusal is a COMMIT-BOUNDARY refusal', isBoundaryRefusal(res), `${res.status} ${code(res)}`)
    const bookingAfter = await db().booking.findUnique({ where: { id: booking.id } })
    check('14c. DB: booking still REQUESTED', bookingAfter.status === 'REQUESTED', bookingAfter.status)
    const proofAfter = await db().paymentProof.findUnique({ where: { id: proofId } })
    check('14d. DB: payment proof still APPROVED', proofAfter.status === 'APPROVED', proofAfter.status)
    const refundRow = await db().refund.findFirst({ where: { bookingId: booking.id } })
    check('14e. DB: NO Refund row was created', !refundRow, JSON.stringify(refundRow?.id))

    const fresh = (await session(ids.host)).token
    const ok = await call('PATCH', `/api/host/requests/${booking.id}`, fresh, { decision: 'CANCELLED' })
    check('14f. control: identical decision with a live session SUCCEEDS', ok.status === 200, JSON.stringify(ok.j).slice(0, 250))
    const ctrl = await db().booking.findUnique({ where: { id: booking.id } })
    check('14g. DB: control genuinely committed (booking CANCELLED)', ctrl.status === 'CANCELLED', ctrl.status)
    // The host's own session was revoked in this section; re-issue for anything downstream.
  }

  // =============================================================================================
  console.log('\n=== 15. DRIVER RIDE CLAIM (fare mutation + dispatch) — T2 stalled read ===')
  // =============================================================================================
  // A claim assigns THIS driver to a live passenger and, when pooled, rewrites fareMinor on two
  // riders' rides. A driver suspended or de-roled mid-request is exactly the actor who must not end
  // up assigned. Reads no request body, so T2 on ride_requests.
  {
    const ride = await db().rideRequest.create({
      data: { riderId: ids.guest2, status: 'REQUESTED', fareMinor: 50_000, currency: 'SYP' },
    })
    check('15-fixture: an unclaimed REQUESTED ride exists', ride.status === 'REQUESTED' && ride.driverId === null, ride.status)

    const raceToken = (await session(ids.driver)).token
    const res = await (await raceStalled({
      table: 'ride_requests',
      label: '15. driver-ride-claim',
      actorId: ids.driver,
      adminMarker: false,
      start: () => call('PATCH', `/api/sr/rides/${ride.id}/claim`, raceToken, undefined),
      revoke: () => logoutAll(ids.driver, '15'),
    }))

    check('15a. in-flight ride claim is REFUSED', res.status !== 200, `status=${res.status} body=${JSON.stringify(res.j)}`)
    check('15b. refusal is a COMMIT-BOUNDARY refusal', isBoundaryRefusal(res), `${res.status} ${code(res)}`)
    const after = await db().rideRequest.findUnique({ where: { id: ride.id } })
    check('15c. DB: ride still unassigned (driverId null)', after.driverId === null, String(after.driverId))
    check('15d. DB: ride still REQUESTED', after.status === 'REQUESTED', after.status)
    check('15e. DB: fare unchanged', after.fareMinor === 50_000, String(after.fareMinor))

    const fresh = (await session(ids.driver)).token
    const ok = await call('PATCH', `/api/sr/rides/${ride.id}/claim`, fresh, undefined)
    check('15f. control: identical claim with a live session SUCCEEDS', ok.status === 200, JSON.stringify(ok.j).slice(0, 250))
    const ctrl = await db().rideRequest.findUnique({ where: { id: ride.id } })
    check('15g. DB: control genuinely committed (driver assigned)', ctrl.driverId === ids.driver, String(ctrl.driverId))
  }

  // =============================================================================================
  console.log('\n=== 16. NEGATIVE CONTROLS: the harness itself does not break requests ===')
  // =============================================================================================
  // Without these, every "REFUSED" above could be an artifact of sending a body in two pieces, or of
  // stalling a handler on a locked table. Same techniques, same hold times, NO revocation.
  {
    await clearAdminBucket(ids.actor)
    // T1 control, on a newly-protected route.
    const codeString = `SEC002R2NEG${String(RUN).slice(-6)}`
    const raceToken = (await session(ids.actor)).token
    const baseline = await adminActionCount(ids.actor)
    const res = await slowRequest({
      method: 'POST',
      path: '/api/admin/sr/promo-codes',
      token: raceToken,
      body: { code: codeString, discountType: 'FLAT', discountValue: 500 },
      hold: async () => { await waitForAdmission(ids.actor, baseline, 'negative-control-t1'); await sleep(600) },
    })
    check('16a. T1 slow-body request with authority intact SUCCEEDS (201)', res.status === 201, `${res.status} ${JSON.stringify(res.j)}`)
    const promo = await db().promoCode.findFirst({ where: { code: codeString } })
    check('16b. DB: that mutation genuinely committed', Boolean(promo), 'no promo row')

    // T2 control, on a newly-protected route.
    const booking = await makeBooking(instantListingId)
    await payAndApprove(booking.id)
    await db().booking.update({
      where: { id: booking.id },
      data: { checkIn: new Date(Date.now() - 9 * 86_400_000), checkOut: new Date(Date.now() - 7 * 86_400_000), status: 'COMPLETED' },
    })
    const reviewRes = await call('POST', '/api/reviews', (await session(ids.guest)).token, { bookingId: booking.id, rating: 2, comment: 'sec002r2 negative control' })
    const reviewId = reviewRes.j?.review?.id
    const hideToken = (await session(ids.actor)).token
    const baseline2 = await adminActionCount(ids.actor)
    let pending
    await withTableLock('listing_reviews', async () => {
      pending = call('PATCH', `/api/admin/reviews/${reviewId}/hide`, hideToken, undefined)
      await waitForAdmission(ids.actor, baseline2, 'negative-control-t2')
      await waitForBlockedOn('listing_reviews', 'negative-control-t2')
      await sleep(300)
    })
    const hidden = await pending
    check('16c. T2 stalled request with authority intact SUCCEEDS (200)', hidden.status === 200, `${hidden.status} ${JSON.stringify(hidden.j)}`)
    const reviewRow = await db().listingReview.findUnique({ where: { id: reviewId } })
    check('16d. DB: that mutation genuinely committed', Boolean(reviewRow?.hiddenAt), String(reviewRow?.hiddenAt))
  }

  console.log(`\n=== SEC-002R ROUND 2 RESULT: ${pass} passed, ${fail} failed ===`)
}

try {
  await main()
} catch (err) {
  fail++
  console.log(`  FAIL  suite threw -> ${err?.stack || err}`)
  console.log(`\n=== SEC-002R ROUND 2 RESULT: ${pass} passed, ${fail} failed ===`)
} finally {
  await cleanup().catch(() => {})
  await disconnectDb()
}
process.exit(fail ? 1 : 0)
