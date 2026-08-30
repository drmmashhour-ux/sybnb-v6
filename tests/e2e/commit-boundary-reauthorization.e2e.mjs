// SYBNB — SEC-002R: commit-boundary re-authorization (permanent concurrency regression).
//
// WHAT THIS SUITE DEFENDS
//
// SEC-002 made sessions revocable. A follow-up adversarial pentest then found finding N4: SYBNB
// evaluates authorization exactly ONCE per request, in server/index.mjs, via getAuthContext() --
// and that call happens BEFORE the route handler has even read the request body. The resulting
// `context` is then trusted for the rest of the request's life and is never re-checked before a
// mutation commits. Proven live against the pre-fix build: a PATCH whose body was still being
// dribbled onto the socket was admitted with valid ADMIN authority, the acting admin's own session
// was revoked (logout-all) while that body was still arriving, and the request nevertheless
// returned 200 with the mutation genuinely applied -- a real account was suspended by an admin who
// had no session at all by the time the write landed.
//
// SEC-002R closes that window for Class A operations (irreversible money movement and privilege
// change) by re-asserting authority against LOCKED, authoritative DB rows inside the same
// transaction as the protected write -- see server/lib/commit-authorization.mjs.
//
// This suite is the permanent proof. Every race below:
//   - uses a REAL, server-issued session (issueUserSession -- the production issuance path),
//   - drives the REAL HTTP API,
//   - creates the delay OUTSIDE the server (never by making production code slower for tests),
//   - revokes authority for real (POST /api/auth/logout-all, a real admin suspension, or a real
//     role removal) while the request is genuinely in flight,
//   - asserts the HTTP outcome AND, separately, that the database was not mutated,
//   - and then re-runs the SAME action with fresh authority as a positive control, so a "blocked"
//     result can never be confused with a broken endpoint or a broken fixture.
//
// TWO DELAY TECHNIQUES, BOTH OUTSIDE PRODUCTION CODE
//
// T1 -- slow request body. A raw TCP socket sends the full request head plus exactly ONE byte of
//       the JSON body, then holds. getAuthContext() has already run (the head is complete), the
//       handler is parked inside readJson() awaiting the rest, and nothing has been written. This
//       is the literal N4 scenario. Used for every handler that reads a body.
//
// T2 -- stalled pre-transaction read. Three Class A handlers (payout release, refund execution,
//       payment-event replay) read no request body at all, so there is nothing to dribble. Instead
//       the test itself takes an ACCESS EXCLUSIVE lock on the table the handler reads FIRST after
//       admission (bookings / refunds / payment_events) in its own transaction, and the handler is
//       admitted and then parks on that read. The test
//       confirms the stall by observing the ungranted lock in pg_locks -- real evidence the request
//       is in flight -- revokes authority, releases the lock, and lets the handler continue into
//       its own transaction. No production code is modified or slowed.
//
// WHY THE RESPONSE CODE ITSELF PROVES THE RACE WAS REAL
//
// A request that was NEVER admitted fails at requireAuth() with 401 AUTH_REQUIRED. A request that
// WAS admitted with full authority and only lost it at the commit boundary fails with one of
// commit-authorization.mjs's own distinct codes (SESSION_REVOKED_BEFORE_COMMIT,
// ACCOUNT_NOT_ACTIVE_BEFORE_COMMIT, SESSION_EPOCH_STALE_BEFORE_COMMIT, ROLE_REVOKED_BEFORE_COMMIT).
// Every race below asserts the specific commit-boundary code, so "the token was already dead when
// it arrived" can never masquerade as a pass.
//
// Run: node tests/e2e/commit-boundary-reauthorization.e2e.mjs   (API_BASE default 127.0.0.1:3051)

import net from 'node:net'
import { randomUUID } from 'node:crypto'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'
import { issueUserSession } from '../../server/lib/session-store.mjs'
import { hashPassword } from '../../server/lib/security.mjs'

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

// T1: the N4 delay. Head + 1 body byte, then `hold()` runs while the handler sits in readJson(),
// then the remaining bytes. The delay is entirely a property of how the CLIENT writes the request.
function slowRequest({ method, path, token, body, hold }) {
  const payload = Buffer.from(JSON.stringify(body ?? {}), 'utf8')
  return new Promise((resolve, reject) => {
    const socket = net.connect(PORT, HOSTNAME, async () => {
      socket.write(
        `${method} ${path} HTTP/1.1\r\n` +
        `Host: ${HOSTNAME}:${PORT}\r\n` +
        `Authorization: Bearer ${token}\r\n` +
        `Content-Type: application/json\r\n` +
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

// Minimal HTTP/1.1 response parser for the raw-socket path. Node answers these requests with
// Transfer-Encoding: chunked (json() writes no Content-Length), so the chunk framing has to be
// stripped on bytes -- not on a decoded string, whose character count would not match the hex
// byte lengths for any non-ASCII message.
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

// Real, DB-observable proof that an /api/admin/* mutating request was ADMITTED: server/index.mjs
// increments this bucket via isRateLimited() AFTER getAuthContext() returned an ADMIN context, and
// before the handler runs. Used only as belt-and-braces -- the commit-boundary error code asserted
// in every race is the primary proof.
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

// T2: hold an ACCESS EXCLUSIVE lock on `table` for the duration of `body()`. The lock is taken by
// the TEST, in the TEST's own transaction -- production code is untouched.
async function withTableLock(table, body) {
  return db().$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`)
    return body()
  }, { timeout: 30_000, maxWait: 20_000 })
}
// Real evidence the in-flight request is genuinely parked on that table: an ungranted lock request.
async function waitForBlockedOn(table, label) {
  for (let i = 0; i < 80; i++) {
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
// Fixtures. Dedicated synthetic accounts only: this suite suspends and re-roles its actor, so it
// must never touch the shared ADMIN/HOST/GUEST env fixtures other suites depend on.
// ---------------------------------------------------------------------------------------------
const RUN = Date.now()
const PASSWORD = 'Sec002R-Regression-Pw!'
const ids = {
  actor: randomUUID(),      // the ADMIN whose authority is revoked mid-request
  operator: randomUUID(),   // a second ADMIN: does setup the actor must not do, and suspensions
  host: randomUUID(),
  guest: randomUUID(),
  sender: randomUUID(),     // funded wallet, sends the gift
  claimant: randomUUID(),   // claims the gift; its own session is revoked mid-claim
  kyc: randomUUID(),        // ID-document review subject
}
const RECIPIENT_PHONE = `+96390${String(RUN).slice(-7)}`

async function makeUser(id, roles) {
  await db().user.create({
    data: {
      id,
      email: `sec002r-${id.slice(0, 8)}-${RUN}@sybnb.test`,
      passwordHash: hashPassword(PASSWORD),
      displayName: `sec002r-${id.slice(0, 8)}`,
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
    // Best effort. Accounts that acquired listings/bookings/wallet history during the run cannot be
    // deleted (their FKs restrict it) and are left in place, exactly like every other suite in this
    // repo leaves the fixtures it created. The ids are freshly random per run, so nothing collides.
    await db().user.delete({ where: { id } }).catch(() => {})
  }
}
// A fresh, real session for an account, issued through the production path.
async function session(userId) {
  const user = await db().user.findUnique({ where: { id: userId }, include: { roles: true } })
  return issueUserSession(user)
}

async function main() {
  console.log('=== SEC-002R — COMMIT-BOUNDARY RE-AUTHORIZATION (N4) ===')
  await cleanup()
  await makeUser(ids.actor, ['ADMIN'])
  await makeUser(ids.operator, ['ADMIN'])
  await makeUser(ids.host, ['HOST'])
  await makeUser(ids.guest, ['GUEST'])
  await makeUser(ids.sender, ['GUEST'])
  await makeUser(ids.claimant, ['GUEST'])
  await makeUser(ids.kyc, ['GUEST'])

  const OP = (await session(ids.operator)).token
  const HOST_T = (await session(ids.host)).token
  const GUEST_T = (await session(ids.guest)).token
  const SENDER_T = (await session(ids.sender)).token

  // --- host can publish: approved ID + signed listing agreement (approved by the OPERATOR, never
  // by the actor, so no self-review confusion enters the races below) ---
  await call('PATCH', '/api/me/id-document', HOST_T, { fileBase64: 'ZmFrZQ==', mimeType: 'image/png' })
  await call('PATCH', `/api/admin/review-queue/iddocument/${ids.host}`, OP, { decision: 'APPROVE' })
  const legal = await call('GET', '/api/legal', null)
  const agreement = legal.j?.documents?.find((d) => d.key === 'listing-agreement')
  await call('POST', '/api/legal/consent', HOST_T, { documentKey: 'listing-agreement', version: agreement.version })

  const listingRes = await call('POST', '/api/listings', HOST_T, {
    division: 'STAYS', titleAr: 'شقة SEC-002R', titleEn: 'SEC-002R flat', priceMinor: 200000, currency: 'SYP', instantBookEnabled: true,
  })
  const listingId = listingRes.j?.listing?.id
  await call('PATCH', `/api/listings/${listingId}/submit`, HOST_T)
  await call('PATCH', `/api/admin/review-queue/listing/${listingId}`, OP, { decision: 'APPROVE' })
  check('fixture: listing approved', Boolean(listingId), JSON.stringify(listingRes.j).slice(0, 200))

  let dayCursor = 6
  async function makeBooking() {
    const inDays = dayCursor
    const outDays = dayCursor + 2
    dayCursor += 4
    const iso = (d) => new Date(Date.now() + d * 86_400_000).toISOString()
    const res = await call('POST', '/api/bookings', GUEST_T, { listingId, checkIn: iso(inDays), checkOut: iso(outDays) })
    return res.j?.booking
  }
  async function payAndApprove(bookingId) {
    const proof = await call('POST', '/api/payments/local-wallet-proof', GUEST_T, { bookingId, providerRef: `wallet_sec002r_${randomUUID()}` })
    const proofId = proof.j?.proof?.id
    const amountMinor = proof.j?.proof?.amountMinor
    await call('PATCH', `/api/admin/review-queue/payment/${proofId}`, OP, {
      decision: 'APPROVE',
      shamCashReconciliation: { accountMinor: amountMinor, expectedMinor: amountMinor, differenceMinor: 0 },
    })
    return { proofId, amountMinor }
  }

  // =============================================================================================
  console.log('\n=== 1. ACCOUNT-STATUS CHANGE (privilege) — T1 slow body vs logout-all ===')
  // =============================================================================================
  {
    const victim = ids.kyc // status target; a real, unrelated account
    const before = await db().user.findUnique({ where: { id: victim }, select: { status: true } })
    const raceToken = (await session(ids.actor)).token
    const revokeToken = (await session(ids.actor)).token
    const baseline = await adminActionCount(ids.actor)

    const res = await slowRequest({
      method: 'PATCH',
      path: `/api/admin/users/${victim}/status`,
      token: raceToken,
      body: { status: 'SUSPENDED' },
      hold: async () => {
        await waitForAdmission(ids.actor, baseline, 'status-change')
        const out = await call('POST', '/api/auth/logout-all', revokeToken, {})
        check('1a. logout-all landed while the status PATCH was mid-body', out.status === 200, JSON.stringify(out.j))
        await sleep(150)
      },
    })

    check('1b. in-flight status change is REFUSED', res.status !== 200, `status=${res.status} body=${JSON.stringify(res.j)}`)
    check('1c. refusal is a COMMIT-BOUNDARY refusal (proves it was admitted with full authority first)',
      ['SESSION_REVOKED_BEFORE_COMMIT', 'SESSION_EPOCH_STALE_BEFORE_COMMIT'].includes(code(res)),
      `${res.status} ${code(res)}`)

    const after = await db().user.findUnique({ where: { id: victim }, select: { status: true, sessionEpoch: true } })
    check('1d. DB: target account status UNCHANGED', after.status === before.status, `${before.status} -> ${after.status}`)
    const audit = await db().adminAuditLog.findFirst({ where: { actorUserId: ids.actor, action: 'ADMIN_ACCOUNT_STATUS_CHANGED' } })
    check('1e. DB: no ADMIN_ACCOUNT_STATUS_CHANGED audit row was written', !audit, JSON.stringify(audit))

    // Positive control: same action, fresh authority, same target -- must succeed and commit.
    const fresh = (await session(ids.actor)).token
    const ok = await call('PATCH', `/api/admin/users/${victim}/status`, fresh, { status: 'SUSPENDED' })
    check('1f. control: identical request with a live session SUCCEEDS', ok.status === 200, JSON.stringify(ok.j))
    const controlled = await db().user.findUnique({ where: { id: victim }, select: { status: true } })
    check('1g. DB: control genuinely committed (target now SUSPENDED)', controlled.status === 'SUSPENDED', controlled.status)
    // restore, so later sections can still use this account
    await call('PATCH', `/api/admin/users/${victim}/status`, (await session(ids.actor)).token, { status: 'ACTIVE' })
  }

  // =============================================================================================
  console.log('\n=== 2. ROLE CHANGE (privilege) — T1 slow body vs logout-all ===')
  // =============================================================================================
  {
    // Deliberately NOT ids.guest: applyRoleChange revokes the target's sessions, and the guest's
    // session is still needed by sections 3/6/7. The claimant's sessions are re-issued in section 5.
    const target = ids.claimant
    const rolesBefore = (await db().userRole.findMany({ where: { userId: target } })).map((r) => r.role).sort()
    const raceToken = (await session(ids.actor)).token
    const revokeToken = (await session(ids.actor)).token
    const baseline = await adminActionCount(ids.actor)

    const res = await slowRequest({
      method: 'PATCH',
      path: `/api/admin/users/${target}/roles`,
      token: raceToken,
      body: { add: ['SUPPORT'] },
      hold: async () => {
        await waitForAdmission(ids.actor, baseline, 'role-change')
        const out = await call('POST', '/api/auth/logout-all', revokeToken, {})
        check('2a. logout-all landed while the roles PATCH was mid-body', out.status === 200, JSON.stringify(out.j))
        await sleep(150)
      },
    })

    check('2b. in-flight role grant is REFUSED', res.status !== 200, `status=${res.status} body=${JSON.stringify(res.j)}`)
    check('2c. refusal is a COMMIT-BOUNDARY refusal',
      ['SESSION_REVOKED_BEFORE_COMMIT', 'SESSION_EPOCH_STALE_BEFORE_COMMIT'].includes(code(res)),
      `${res.status} ${code(res)}`)

    const rolesAfter = (await db().userRole.findMany({ where: { userId: target } })).map((r) => r.role).sort()
    check('2d. DB: target roles UNCHANGED (no SUPPORT granted)',
      JSON.stringify(rolesAfter) === JSON.stringify(rolesBefore), `${rolesBefore} -> ${rolesAfter}`)

    const fresh = (await session(ids.actor)).token
    const ok = await call('PATCH', `/api/admin/users/${target}/roles`, fresh, { add: ['SUPPORT'] })
    check('2e. control: identical role grant with a live session SUCCEEDS', ok.status === 200, JSON.stringify(ok.j))
    const rolesControl = (await db().userRole.findMany({ where: { userId: target } })).map((r) => r.role)
    check('2f. DB: control genuinely committed (SUPPORT present)', rolesControl.includes('SUPPORT'), String(rolesControl))
    await call('PATCH', `/api/admin/users/${target}/roles`, (await session(ids.actor)).token, { remove: ['SUPPORT'] })
  }

  // =============================================================================================
  console.log('\n=== 3. PAYMENT APPROVAL / wallet money (review queue) — T1 slow body vs logout-all ===')
  // =============================================================================================
  {
    const booking = await makeBooking()
    const proofRes = await call('POST', '/api/payments/local-wallet-proof', GUEST_T, { bookingId: booking.id, providerRef: `wallet_sec002r_${randomUUID()}` })
    const proofId = proofRes.j?.proof?.id
    const amountMinor = proofRes.j?.proof?.amountMinor
    check('3-fixture: payment proof is PENDING_ADMIN_REVIEW', Boolean(proofId), JSON.stringify(proofRes.j).slice(0, 200))

    const raceToken = (await session(ids.actor)).token
    const revokeToken = (await session(ids.actor)).token
    const baseline = await adminActionCount(ids.actor)

    const res = await slowRequest({
      method: 'PATCH',
      path: `/api/admin/review-queue/payment/${proofId}`,
      token: raceToken,
      body: { decision: 'APPROVE', shamCashReconciliation: { accountMinor: amountMinor, expectedMinor: amountMinor, differenceMinor: 0 } },
      hold: async () => {
        await waitForAdmission(ids.actor, baseline, 'payment-approval')
        const out = await call('POST', '/api/auth/logout-all', revokeToken, {})
        check('3a. logout-all landed while the approval PATCH was mid-body', out.status === 200, JSON.stringify(out.j))
        await sleep(150)
      },
    })

    check('3b. in-flight payment approval is REFUSED', res.status !== 200, `status=${res.status} body=${JSON.stringify(res.j)}`)
    check('3c. refusal is a COMMIT-BOUNDARY refusal',
      ['SESSION_REVOKED_BEFORE_COMMIT', 'SESSION_EPOCH_STALE_BEFORE_COMMIT'].includes(code(res)),
      `${res.status} ${code(res)}`)

    const proofAfter = await db().paymentProof.findUnique({ where: { id: proofId } })
    check('3d. DB: proof still PENDING_ADMIN_REVIEW', proofAfter.status === 'PENDING_ADMIN_REVIEW', proofAfter.status)
    const hold = await db().walletEntry.findFirst({ where: { referenceType: 'booking_payout', referenceId: booking.id } })
    check('3e. DB: NO host HOLD wallet entry was created', !hold, JSON.stringify(hold))
    const share = await db().walletEntry.findFirst({ where: { referenceType: 'booking_admin_share', referenceId: booking.id } })
    check('3f. DB: NO platform-share wallet entry was created', !share, JSON.stringify(share))
    const bookingAfter = await db().booking.findUnique({ where: { id: booking.id } })
    check('3g. DB: booking not confirmed by the refused approval', bookingAfter.status !== 'CONFIRMED', bookingAfter.status)

    const fresh = (await session(ids.actor)).token
    const ok = await call('PATCH', `/api/admin/review-queue/payment/${proofId}`, fresh, {
      decision: 'APPROVE', shamCashReconciliation: { accountMinor: amountMinor, expectedMinor: amountMinor, differenceMinor: 0 },
    })
    check('3h. control: identical approval with a live session SUCCEEDS', ok.status === 200, JSON.stringify(ok.j))
    const holdAfter = await db().walletEntry.findFirst({ where: { referenceType: 'booking_payout', referenceId: booking.id } })
    check('3i. DB: control genuinely committed (host HOLD entry now exists)', Boolean(holdAfter), 'no hold entry')
  }

  // =============================================================================================
  console.log('\n=== 4. KYC / ENTITLEMENT APPROVAL — T1 slow body vs live ADMIN role removal ===')
  // =============================================================================================
  // Different revocation mechanism on purpose: the ADMIN role row is deleted directly, WITHOUT an
  // epoch bump, so the session itself stays perfectly valid. Only the ROLE check can catch this --
  // it isolates commit-authorization.mjs's live-role predicate from its session predicates.
  {
    const KYC_T = (await session(ids.kyc)).token
    await call('PATCH', '/api/me/id-document', KYC_T, { fileBase64: 'ZmFrZQ==', mimeType: 'image/png' })
    const pending = await db().user.findUnique({ where: { id: ids.kyc }, select: { idDocumentStatus: true } })
    check('4-fixture: subject ID document is PENDING_REVIEW', pending.idDocumentStatus === 'PENDING_REVIEW', pending.idDocumentStatus)

    const raceToken = (await session(ids.actor)).token
    const baseline = await adminActionCount(ids.actor)

    const res = await slowRequest({
      method: 'PATCH',
      path: `/api/admin/review-queue/iddocument/${ids.kyc}`,
      token: raceToken,
      body: { decision: 'APPROVE' },
      hold: async () => {
        await waitForAdmission(ids.actor, baseline, 'kyc-approval')
        const removed = await db().userRole.deleteMany({ where: { userId: ids.actor, role: 'ADMIN' } })
        check('4a. actor lost ADMIN mid-request (session left intact, no epoch bump)', removed.count === 1, String(removed.count))
        await sleep(150)
      },
    })

    check('4b. in-flight KYC approval is REFUSED', res.status !== 200, `status=${res.status} body=${JSON.stringify(res.j)}`)
    check('4c. refusal is the LIVE-ROLE commit-boundary refusal', code(res) === 'ROLE_REVOKED_BEFORE_COMMIT', `${res.status} ${code(res)}`)

    const subject = await db().user.findUnique({ where: { id: ids.kyc }, select: { idDocumentStatus: true, idDocumentReviewedById: true } })
    check('4d. DB: ID document still PENDING_REVIEW (entitlement NOT granted)', subject.idDocumentStatus === 'PENDING_REVIEW', subject.idDocumentStatus)
    check('4e. DB: no reviewer was recorded', subject.idDocumentReviewedById === null, String(subject.idDocumentReviewedById))

    await db().userRole.create({ data: { userId: ids.actor, role: 'ADMIN' } })
    const fresh = (await session(ids.actor)).token
    const ok = await call('PATCH', `/api/admin/review-queue/iddocument/${ids.kyc}`, fresh, { decision: 'APPROVE' })
    check('4f. control: identical approval with ADMIN restored SUCCEEDS', ok.status === 200, JSON.stringify(ok.j))
    const approved = await db().user.findUnique({ where: { id: ids.kyc }, select: { idDocumentStatus: true } })
    check('4g. DB: control genuinely committed (ID document APPROVED)', approved.idDocumentStatus === 'APPROVED', approved.idDocumentStatus)
  }

  // =============================================================================================
  console.log('\n=== 5. WALLET MONEY, NON-ADMIN ACTOR (gift claim) — T1 slow body vs logout-all ===')
  // =============================================================================================
  {
    await db().wallet.upsert({
      where: { userId_currency: { userId: ids.sender, currency: 'SYP' } },
      create: { userId: ids.sender, currency: 'SYP', cachedBalanceMinor: 5_000_000 },
      update: { cachedBalanceMinor: 5_000_000 },
    })
    const giftRes = await call('POST', '/api/wallet/gifts', SENDER_T, { amountMinor: 12_000, currency: 'SYP', recipientPhone: RECIPIENT_PHONE })
    const gift = giftRes.j?.gift
    const claimCode = giftRes.j?.claimCode
    check('5-fixture: gift created and SENT', gift?.status === 'SENT', JSON.stringify(giftRes.j).slice(0, 250))

    const raceToken = (await session(ids.claimant)).token
    const revokeToken = (await session(ids.claimant)).token
    const balanceBefore = (await db().wallet.findUnique({ where: { userId_currency: { userId: ids.claimant, currency: 'SYP' } } }))?.cachedBalanceMinor ?? 0

    const res = await slowRequest({
      method: 'POST',
      path: `/api/wallet/gifts/${gift.id}/claim`,
      token: raceToken,
      body: { phone: RECIPIENT_PHONE, code: claimCode },
      hold: async () => {
        await sleep(400) // no admin-action marker exists for a non-admin route; the assertion below
                         // (a commit-boundary code, not AUTH_REQUIRED) is what proves admission.
        const out = await call('POST', '/api/auth/logout-all', revokeToken, {})
        check('5a. logout-all landed while the claim POST was mid-body', out.status === 200, JSON.stringify(out.j))
        await sleep(150)
      },
    })

    check('5b. in-flight gift claim is REFUSED', res.status !== 200, `status=${res.status} body=${JSON.stringify(res.j)}`)
    check('5c. refusal is a COMMIT-BOUNDARY refusal',
      ['SESSION_REVOKED_BEFORE_COMMIT', 'SESSION_EPOCH_STALE_BEFORE_COMMIT'].includes(code(res)),
      `${res.status} ${code(res)}`)

    const giftAfter = await db().walletGift.findUnique({ where: { id: gift.id } })
    check('5d. DB: gift still SENT (not consumed)', giftAfter.status === 'SENT', giftAfter.status)
    check('5e. DB: gift has no recipient recorded', giftAfter.recipientUserId === null, String(giftAfter.recipientUserId))
    const entry = await db().walletEntry.findFirst({ where: { referenceType: 'wallet_gift', referenceId: gift.id } })
    check('5f. DB: NO wallet CREDIT entry was created', !entry, JSON.stringify(entry))
    const balanceAfter = (await db().wallet.findUnique({ where: { userId_currency: { userId: ids.claimant, currency: 'SYP' } } }))?.cachedBalanceMinor ?? 0
    check('5g. DB: claimant balance unchanged', balanceAfter === balanceBefore, `${balanceBefore} -> ${balanceAfter}`)

    const fresh = (await session(ids.claimant)).token
    const ok = await call('POST', `/api/wallet/gifts/${gift.id}/claim`, fresh, { phone: RECIPIENT_PHONE, code: claimCode })
    check('5h. control: identical claim with a live session SUCCEEDS', ok.status === 200, JSON.stringify(ok.j))
    const claimed = await db().walletGift.findUnique({ where: { id: gift.id } })
    check('5i. DB: control genuinely committed (gift CLAIMED)', claimed.status === 'CLAIMED', claimed.status)
  }

  // =============================================================================================
  console.log('\n=== 6. PAYOUT RELEASE (money) — T2 stalled read vs a real admin suspension ===')
  // =============================================================================================
  {
    const booking = await makeBooking()
    await payAndApprove(booking.id)
    // Age the stay past the 14-day payout hold and complete it. Fixture data only -- the release
    // itself still goes through the real endpoint with the real eligibility logic.
    const past = (d) => new Date(Date.now() - d * 86_400_000)
    await db().booking.update({ where: { id: booking.id }, data: { checkIn: past(24), checkOut: past(22), status: 'COMPLETED' } })

    const raceToken = (await session(ids.actor)).token
    const baseline = await adminActionCount(ids.actor)
    let res
    await withTableLock('bookings', async () => {
      const pending = call('PATCH', `/api/admin/payouts/${booking.id}/release`, raceToken, undefined)
      const admitted = await waitForAdmission(ids.actor, baseline, 'payout-release')
      check('6a. request was ADMITTED with full ADMIN authority', admitted, 'admission marker never advanced')
      const blocked = await waitForBlockedOn('bookings', 'payout-release')
      check('6b. request is genuinely IN FLIGHT (ungranted lock observed in pg_locks)', blocked, 'no blocked lock seen')
      const susp = await call('PATCH', `/api/admin/users/${ids.actor}/status`, OP, { status: 'SUSPENDED' })
      check('6c. a second admin SUSPENDED the acting admin mid-request', susp.status === 200, JSON.stringify(susp.j))
      res = pending
    })
    res = await res

    check('6d. in-flight payout release is REFUSED', res.status !== 200, `status=${res.status} body=${JSON.stringify(res.j)}`)
    check('6e. refusal is a COMMIT-BOUNDARY refusal',
      ['SESSION_REVOKED_BEFORE_COMMIT', 'ACCOUNT_NOT_ACTIVE_BEFORE_COMMIT', 'SESSION_EPOCH_STALE_BEFORE_COMMIT'].includes(code(res)),
      `${res.status} ${code(res)}`)

    const release = await db().walletEntry.findFirst({ where: { referenceType: 'booking_payout', referenceId: booking.id, type: 'RELEASE' } })
    check('6f. DB: NO RELEASE wallet entry exists — the host was NOT paid', !release, JSON.stringify(release))
    const audit = await db().adminAuditLog.findFirst({ where: { action: 'ADMIN_PAYOUT_RELEASED', entityId: booking.id } })
    check('6g. DB: no ADMIN_PAYOUT_RELEASED audit row', !audit, JSON.stringify(audit))

    // Reinstate the actor (a suspension revokes forever, so this needs a brand-new session).
    await call('PATCH', `/api/admin/users/${ids.actor}/status`, OP, { status: 'ACTIVE' })
    const fresh = (await session(ids.actor)).token
    const ok = await call('PATCH', `/api/admin/payouts/${booking.id}/release`, fresh, undefined)
    check('6h. control: identical release with a live, ACTIVE session SUCCEEDS', ok.status === 200, JSON.stringify(ok.j))
    const releaseAfter = await db().walletEntry.findFirst({ where: { referenceType: 'booking_payout', referenceId: booking.id, type: 'RELEASE' } })
    check('6i. DB: control genuinely committed (RELEASE entry now exists)', Boolean(releaseAfter), 'no release entry')
  }

  // =============================================================================================
  console.log('\n=== 7. REFUND EXECUTION (money) — T2 stalled read vs logout-all ===')
  // =============================================================================================
  {
    const booking = await makeBooking()
    const { proofId } = await payAndApprove(booking.id)
    const cancel = await call('PATCH', `/api/bookings/${booking.id}/cancel`, GUEST_T, {})
    check('7-fixture: guest cancelled, refund request created', cancel.status === 200, JSON.stringify(cancel.j).slice(0, 200))
    const refund = await db().refund.findFirst({ where: { paymentProofId: proofId } })
    check('7-fixture: refund row exists and is IN_PROGRESS', refund?.status === 'IN_PROGRESS', JSON.stringify(refund))

    const payerBefore = (await db().wallet.findUnique({ where: { userId_currency: { userId: ids.guest, currency: refund.currency } } }))?.cachedBalanceMinor ?? 0
    const raceToken = (await session(ids.actor)).token
    const revokeToken = (await session(ids.actor)).token
    const baseline = await adminActionCount(ids.actor)
    let res
    await withTableLock('refunds', async () => {
      const pending = call('PATCH', `/api/admin/refunds/${refund.id}/execute`, raceToken, undefined)
      const admitted = await waitForAdmission(ids.actor, baseline, 'refund-execute')
      check('7a. request was ADMITTED with full ADMIN authority', admitted, 'admission marker never advanced')
      const blocked = await waitForBlockedOn('refunds', 'refund-execute')
      check('7b. request is genuinely IN FLIGHT (ungranted lock observed in pg_locks)', blocked, 'no blocked lock seen')
      const out = await call('POST', '/api/auth/logout-all', revokeToken, {})
      check('7c. logout-all revoked the acting admin mid-request', out.status === 200, JSON.stringify(out.j))
      res = pending
    })
    res = await res

    check('7d. in-flight refund execution is REFUSED', res.status !== 200, `status=${res.status} body=${JSON.stringify(res.j)}`)
    check('7e. refusal is a COMMIT-BOUNDARY refusal',
      ['SESSION_REVOKED_BEFORE_COMMIT', 'SESSION_EPOCH_STALE_BEFORE_COMMIT'].includes(code(res)),
      `${res.status} ${code(res)}`)

    const refundAfter = await db().refund.findUnique({ where: { id: refund.id }, include: { attempts: true } })
    check('7f. DB: refund still IN_PROGRESS (not SUCCEEDED)', refundAfter.status === 'IN_PROGRESS', refundAfter.status)
    check('7g. DB: refund attempt still CLAIMED (not SUCCEEDED)',
      refundAfter.attempts.every((a) => a.status !== 'SUCCEEDED'), JSON.stringify(refundAfter.attempts.map((a) => a.status)))
    const credit = await db().walletEntry.findFirst({ where: { referenceType: 'booking_refund', referenceId: booking.id, type: 'REFUND' } })
    check('7h. DB: NO refund CREDIT wallet entry — the payer was NOT paid', !credit, JSON.stringify(credit))
    const payerAfter = (await db().wallet.findUnique({ where: { userId_currency: { userId: ids.guest, currency: refund.currency } } }))?.cachedBalanceMinor ?? 0
    check('7i. DB: payer wallet balance unchanged', payerAfter === payerBefore, `${payerBefore} -> ${payerAfter}`)
    const proofAfter = await db().paymentProof.findUnique({ where: { id: proofId } })
    check('7j. DB: proof refund counters untouched (reserved still held, nothing succeeded)',
      proofAfter.succeededRefundMinor === 0 && proofAfter.reservedRefundMinor === refund.amountMinor,
      `reserved=${proofAfter.reservedRefundMinor} succeeded=${proofAfter.succeededRefundMinor} refund=${refund.amountMinor}`)

    const fresh = (await session(ids.actor)).token
    const ok = await call('PATCH', `/api/admin/refunds/${refund.id}/execute`, fresh, undefined)
    check('7k. control: identical execution with a live session SUCCEEDS', ok.status === 200, JSON.stringify(ok.j))
    const creditAfter = await db().walletEntry.findFirst({ where: { referenceType: 'booking_refund', referenceId: booking.id, type: 'REFUND' } })
    check('7l. DB: control genuinely committed (refund CREDIT entry now exists)', Boolean(creditAfter), 'no credit entry')
  }

  // =============================================================================================
  console.log('\n=== 8. PAYMENT-EVENT REPLAY (money) — T2 stalled read vs logout-all ===')
  // =============================================================================================
  // Admin replay re-runs a real financial application (PaymentProof creation + approval, wallet
  // HOLD/CREDIT, booking confirmation). Its rails manage their own apply transactions, so the
  // re-authorization is injected through the rail's existing pre-effect hook -- this section proves
  // that injection actually rolls the whole application back.
  {
    const booking = await makeBooking()
    const intentRes = await call('POST', '/api/payments/intents', GUEST_T, { bookingId: booking.id })
    const intent = intentRes.j?.intent
    check('8-fixture: real PaymentIntent created', Boolean(intent?.id), JSON.stringify(intentRes.j).slice(0, 250))
    const event = await db().paymentEvent.create({
      data: {
        rail: 'payment_intent', provider: 'sandbox', providerEndpointKey: 'sandbox-test-account',
        environment: 'test', subjectType: 'PAYMENT_INTENT', providerReference: intent.reference,
        providerEventId: `evt_sec002r_${randomUUID()}`, type: 'payment_intent.succeeded',
        amountMinor: intent.amountMinor, currency: intent.currency,
        providerObjectId: `pi_sec002r_${randomUUID()}`, payloadDigest: 'sec002r-synthetic-digest',
        intentId: intent.id, originalIntentId: intent.id, originalBookingId: booking.id,
        processingStatus: 'FAILED', attempts: 1, lastError: 'seeded FAILED so admin replay is reachable',
      },
    })

    const raceToken = (await session(ids.actor)).token
    const revokeToken = (await session(ids.actor)).token
    const baseline = await adminActionCount(ids.actor)
    let res
    await withTableLock('payment_events', async () => {
      const pending = call('POST', `/api/admin/payment-events/${event.id}/replay`, raceToken, undefined)
      const admitted = await waitForAdmission(ids.actor, baseline, 'payment-event-replay')
      check('8a. request was ADMITTED with full ADMIN authority', admitted, 'admission marker never advanced')
      const blocked = await waitForBlockedOn('payment_events', 'payment-event-replay')
      check('8b. request is genuinely IN FLIGHT (ungranted lock observed in pg_locks)', blocked, 'no blocked lock seen')
      const out = await call('POST', '/api/auth/logout-all', revokeToken, {})
      check('8c. logout-all revoked the acting admin mid-request', out.status === 200, JSON.stringify(out.j))
      res = pending
    })
    res = await res

    check('8d. in-flight replay is REFUSED', res.status !== 200, `status=${res.status} body=${JSON.stringify(res.j).slice(0, 300)}`)
    check('8e. refusal is a COMMIT-BOUNDARY refusal',
      ['SESSION_REVOKED_BEFORE_COMMIT', 'SESSION_EPOCH_STALE_BEFORE_COMMIT'].includes(code(res)),
      `${res.status} ${code(res)}`)

    const eventAfter = await db().paymentEvent.findUnique({ where: { id: event.id } })
    check('8f. DB: event NOT marked APPLIED', eventAfter.processingStatus !== 'APPLIED', eventAfter.processingStatus)
    const intentAfter = await db().paymentIntent.findUnique({ where: { id: intent.id } })
    check('8g. DB: intent NOT moved to SUCCEEDED', intentAfter.status !== 'SUCCEEDED', intentAfter.status)
    const proof = await db().paymentProof.findFirst({ where: { bookingId: booking.id } })
    check('8h. DB: NO PaymentProof was created by the refused replay', !proof, JSON.stringify(proof))
    const share = await db().walletEntry.findFirst({ where: { referenceType: 'booking_admin_share', referenceId: booking.id } })
    check('8i. DB: NO platform-share wallet entry was created', !share, JSON.stringify(share))

    const fresh = (await session(ids.actor)).token
    const ok = await call('POST', `/api/admin/payment-events/${event.id}/replay`, fresh, undefined)
    check('8j. control: identical replay with a live session SUCCEEDS', ok.status === 200, JSON.stringify(ok.j).slice(0, 300))
    const eventOk = await db().paymentEvent.findUnique({ where: { id: event.id } })
    check('8k. DB: control genuinely committed (event now APPLIED)', eventOk.processingStatus === 'APPLIED', eventOk.processingStatus)
  }

  // =============================================================================================
  console.log('\n=== 9. NEGATIVE CONTROL: a slow request with NO revocation still commits ===')
  // =============================================================================================
  // Proves the harness itself does not break requests: the identical T1 dribble, same hold time,
  // no revocation -- the mutation must succeed. Without this, every "REFUSED" above could just be
  // an artifact of sending a body in two pieces.
  {
    const target = ids.sender
    const raceToken = (await session(ids.actor)).token
    const baseline = await adminActionCount(ids.actor)
    const res = await slowRequest({
      method: 'PATCH',
      path: `/api/admin/users/${target}/roles`,
      token: raceToken,
      body: { add: ['SUPPORT'] },
      hold: async () => { await waitForAdmission(ids.actor, baseline, 'no-revocation-control'); await sleep(600) },
    })
    check('9a. slow-body request with authority intact SUCCEEDS (200)', res.status === 200, `${res.status} ${JSON.stringify(res.j)}`)
    const roles = (await db().userRole.findMany({ where: { userId: target } })).map((r) => r.role)
    check('9b. DB: that mutation genuinely committed', roles.includes('SUPPORT'), String(roles))
  }

  console.log(`\n=== SEC-002R RESULT: ${pass} passed, ${fail} failed ===`)
}

try {
  await main()
} catch (err) {
  fail++
  console.log(`  FAIL  suite threw -> ${err?.stack || err}`)
  console.log(`\n=== SEC-002R RESULT: ${pass} passed, ${fail} failed ===`)
} finally {
  await cleanup().catch(() => {})
  await disconnectDb()
}
process.exit(fail ? 1 : 0)
