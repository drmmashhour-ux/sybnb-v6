// SYBNB — SEC-002R ROUND 3: the six items an independent code-level spot-check of round 2 found open.
//
// WHY THIS FILE EXISTS
//
// Round 2 (6cb808b -> b59c99e -> 1d75718) closed GAP-1/A8/G1/G2 plus eight endpoints its own sweep
// found. An independent spot-check of round 2 then found round 2 itself incomplete:
//
//   1  PATCH /api/me/id-document      the SELF-SERVICE half of G1. Untransacted KYC-state rewrite
//                                     followed by an IRREVERSIBLE deleteIdDocument() of the actor's
//                                     own prior identity document, with no re-authorization at all.
//   2  PATCH /api/sr/rides/:id/assign-driver
//                                     the same durable effect as /claim (protected in round 2) --
//                                     dispatching a driver to a live passenger -- left bare.
//   3  PATCH /api/sr/rides/:id/cancel writes cancellationFeeMinor, a real money field with no
//                                     reversal endpoint, bare.
//   4  PATCH /api/driver/rides/:id/status -> COMPLETED
//                                     the write that makes a fare BILLABLE to a corporate account
//                                     (business.mjs sums COMPLETED rides' fareMinor), bare.
//   5  POST  /api/admin/sr/business-accounts
//                                     an ADMIN could name THEMSELVES the business-admin of a company
//                                     they create, then grant riders standing authority to bill real
//                                     rides to it. Round 2 deliberately deferred this; round 3 closes
//                                     it as a genuine authorization rule, not a timing fix.
//   6  A8's REVERSAL mechanism        round 2 called A8 "atomicity guaranteed". The claim gate is
//                                     genuinely atomic (round 2 §7 proves it), but the COMPENSATING
//                                     reversal -- what runs when re-authorization fails during the
//                                     later apply() phase -- was never exercised by ANY test on
//                                     EITHER rail: both prior suites park the handler BEFORE the
//                                     claim transaction opens, so they only ever exercise the claim
//                                     gate. And its restored status came from a NON-LOCKING read
//                                     taken before the locking CAS, so a concurrent commit could make
//                                     it stale and silently UN-DEAD-LETTER a real payment event.
//
// This suite proves all six. It does NOT replace or edit rounds 1 and 2 -- those files are frozen
// evidence and run unchanged alongside this one.
//
// METHOD (identical discipline to rounds 1 and 2, deliberately)
//   - real, server-issued sessions via the production issueUserSession()
//   - the real HTTP API for items 1-5
//   - the delay is created OUTSIDE the server, never by slowing production code
//   - real revocation: POST /api/auth/logout-all (bumps users.session_epoch for the whole account)
//   - every race asserts the HTTP/throw outcome AND, SEPARATELY, direct DB state
//   - every race is followed by a positive control with fresh authority, which must genuinely commit
//
// Item 6 is the one exception to "real HTTP", and the reason is structural, stated rather than
// papered over: the branch under test only exists in the window BETWEEN the claim transaction's
// COMMIT and the apply transaction's re-authorization. Over HTTP there is nothing to hold that window
// open -- a table lock parks the request before the claim, which is the branch round 2 already
// covered. So item 6 drives the EXACT production wiring the admin replay route uses
// (server/routes/payment-intents.mjs:815-856: the same reauthorizeAtCommit hook passed as BOTH
// authorizeClaim and beforeEffects, the same applyPaymentIntentEvent / applyStripeCheckoutEvent
// closures) and performs a REAL logout-all from inside the apply closure -- i.e. exactly in that
// window. Same technique round 2 used for GAP-1, for the same reason.
//
// Run: node tests/e2e/commit-boundary-reauthorization-round3.e2e.mjs  (API_BASE default 127.0.0.1:3051)

import net from 'node:net'
import { randomUUID } from 'node:crypto'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'
import { issueUserSession } from '../../server/lib/session-store.mjs'
import { hashPassword } from '../../server/lib/security.mjs'
import { reauthorizeAtCommit } from '../../server/lib/commit-authorization.mjs'
import { applyPaymentEvent as applyPaymentEventPipeline } from '../../server/lib/payment-event-pipeline.mjs'
import { applyPaymentIntentEvent } from '../../server/routes/payment-intents.mjs'
import { applyStripeCheckoutEvent } from '../../server/lib/stripe-checkout-apply.mjs'

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
// The four refusals commit-authorization.mjs raises for a revocation. Asserting one of THESE (never
// a bare non-200) is what distinguishes "admitted with full authority, then lost it at the boundary"
// from "the token was already dead on arrival", which fails at requireAuth with 401 AUTH_REQUIRED.
const BOUNDARY_CODES = [
  'SESSION_REVOKED_BEFORE_COMMIT',
  'SESSION_EPOCH_STALE_BEFORE_COMMIT',
  'ACCOUNT_NOT_ACTIVE_BEFORE_COMMIT',
  'ROLE_REVOKED_BEFORE_COMMIT',
]
const isBoundaryRefusal = (r) => BOUNDARY_CODES.includes(code(r))
const isBoundaryThrow = (err) => BOUNDARY_CODES.includes(err?.code)

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
// A ROW lock waiter does not show up as an ungranted RELATION lock -- it waits on the holder's
// transactionid. Used by section 6b, which holds a single-row SELECT ... FOR UPDATE rather than a
// table lock, precisely because the code under test takes a ROW lock.
async function waitForRowLockWaiter(label) {
  for (let i = 0; i < 120; i++) {
    const rows = await db().$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM pg_locks
       WHERE NOT granted AND locktype IN ('transactionid', 'tuple')`,
    )
    if ((rows[0]?.n ?? 0) > 0) return true
    await sleep(50)
  }
  console.log(`   (never observed a row-lock waiter for ${label})`)
  return false
}

// ---------------------------------------------------------------------------------------------
// Fixtures. Dedicated synthetic accounts only -- this suite revokes its actors' sessions.
// ---------------------------------------------------------------------------------------------
const RUN = Date.now()
const PASSWORD = 'Sec002R-Round3-Pw!'
const ids = {
  actor: randomUUID(),      // the ADMIN whose authority is revoked mid-request
  operator: randomUUID(),   // second ADMIN, never revoked -- does setup the actor must not do
  support: randomUUID(),    // SUPPORT: proves the assign-driver role pair is honoured, not narrowed
  kyc: randomUUID(),        // ordinary account submitting its own ID document (item 1)
  rider: randomUUID(),      // GUEST whose ride is cancelled (item 3)
  driver: randomUUID(),     // DRIVER completing a ride (item 4) / assignment target (item 2)
  bizAdmin: randomUUID(),   // legitimate third-party business admin (item 5 positive control)
}

async function makeUser(id, roles) {
  await db().user.create({
    data: {
      id,
      email: `sec002r3-${id.slice(0, 8)}-${RUN}@sybnb.test`,
      passwordHash: hashPassword(PASSWORD),
      displayName: `sec002r3-${id.slice(0, 8)}`,
      status: 'ACTIVE',
      roles: { create: roles.map((role) => ({ role })) },
    },
  })
}

async function cleanup() {
  const all = Object.values(ids)
  await db().rateLimitBucket.deleteMany({ where: { bucketKey: { in: all.map((id) => `admin-action:${id}`) } } }).catch(() => {})
  await db().businessAccountMember.deleteMany({ where: { userId: { in: all } } }).catch(() => {})
  await db().businessAccount.deleteMany({ where: { adminUserId: { in: all } } }).catch(() => {})
  await db().rideRequest.deleteMany({ where: { OR: [{ riderId: { in: all } }, { driverId: { in: all } }] } }).catch(() => {})
  for (const id of all) {
    await db().adminAuditLog.deleteMany({ where: { OR: [{ actorUserId: id }, { entityId: id }] } }).catch(() => {})
    // Best effort, same posture as every other suite here: accounts that acquired rows we cannot
    // safely delete (FK restrict) are left in place. Ids are fresh per run.
    await db().user.delete({ where: { id } }).catch(() => {})
  }
}

async function session(userId) {
  const user = await db().user.findUnique({ where: { id: userId }, include: { roles: true } })
  return issueUserSession(user)
}

// The exact shape server/lib/auth-context.mjs's getAuthContext() returns. Built here (rather than by
// driving an HTTP request) only for section 6, which must hold a window open that no HTTP request
// can hold open -- see the file header.
async function authContextFor(userId) {
  const user = await db().user.findUnique({ where: { id: userId }, include: { roles: true } })
  const issued = await issueUserSession(user)
  return {
    token: issued.token,
    context: {
      user,
      roles: user.roles.map((row) => row.role),
      sessionId: issued.sessionId,
      epoch: user.sessionEpoch,
    },
  }
}

// Real revocation, run from a SECOND live session for the same account. logout-all bumps
// users.session_epoch, invalidating every outstanding token for the account at once.
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
  console.log('=== SEC-002R ROUND 3 — the six items the round-2 spot-check left open ===')
  await cleanup()
  // ADMIN + GUEST: section 5 needs an actor who could plausibly BE a business admin, so that
  // "the downstream attack is unreachable" is proven by the business-admin check itself rather than
  // by an unrelated missing GUEST role.
  await makeUser(ids.actor, ['ADMIN', 'GUEST'])
  await makeUser(ids.operator, ['ADMIN'])
  await makeUser(ids.support, ['SUPPORT'])
  await makeUser(ids.kyc, ['GUEST'])
  await makeUser(ids.rider, ['GUEST'])
  await makeUser(ids.driver, ['DRIVER', 'GUEST'])
  await makeUser(ids.bizAdmin, ['GUEST'])

  const OP = (await session(ids.operator)).token

  // =============================================================================================
  console.log('\n=== 1. ITEM 1 — PATCH /api/me/id-document (SELF-SERVICE KYC, the G1 half round 2 missed) ===')
  // =============================================================================================
  // Two things must hold, and the second is the one that matters: (a) a revoked actor's KYC-state
  // rewrite must not commit, and (b) the IRREVERSIBLE deleteIdDocument() of the actor's PREVIOUS
  // identity document must not run either. Round 2's G1 section proves both for the admin-onto-
  // another-user path; before this round the self-service path had neither.
  {
    // Seed a genuine FIRST submission, with full authority, so there is a real previous document for
    // the refused request to (wrongly) destroy.
    const firstToken = (await session(ids.kyc)).token
    const first = await call('PATCH', '/api/me/id-document', firstToken, { fileBase64: 'Zmlyc3Q=', mimeType: 'image/png' })
    check('1-fixture: first ID document submitted with full authority (200)', first.status === 200, `${first.status} ${JSON.stringify(first.j).slice(0, 200)}`)
    const seeded = await db().user.findUnique({ where: { id: ids.kyc }, select: { idDocumentRef: true, idDocumentMimeType: true, idDocumentStatus: true } })
    check('1-fixture: a previous document ref genuinely exists', Boolean(seeded.idDocumentRef), String(seeded.idDocumentRef))
    // Move it out of PENDING_REVIEW so the refused upload's reset to PENDING_REVIEW would be visible
    // in the DB if it landed -- otherwise "still PENDING_REVIEW" would prove nothing.
    await db().user.update({ where: { id: ids.kyc }, data: { idDocumentStatus: 'REJECTED' } })

    const raceToken = (await session(ids.kyc)).token
    const res = await raceBody({
      method: 'PATCH',
      path: '/api/me/id-document',
      token: raceToken,
      body: { fileBase64: 'c2Vjb25k', mimeType: 'image/jpeg' },
      actorId: ids.kyc,
      adminMarker: false,
      label: '1. self-service-kyc-upload',
      revoke: () => logoutAll(ids.kyc, '1'),
    })

    check('1a. in-flight self-service ID upload is REFUSED', res.status !== 200, `status=${res.status} body=${JSON.stringify(res.j).slice(0, 250)}`)
    check('1b. refusal is a COMMIT-BOUNDARY refusal', isBoundaryRefusal(res), `${res.status} ${code(res)}`)

    const after = await db().user.findUnique({ where: { id: ids.kyc }, select: { idDocumentRef: true, idDocumentMimeType: true, idDocumentStatus: true } })
    check('1c. DB: idDocumentRef still points at the PREVIOUS document', after.idDocumentRef === seeded.idDocumentRef, `${seeded.idDocumentRef} -> ${after.idDocumentRef}`)
    check('1d. DB: mime type not rewritten', after.idDocumentMimeType === seeded.idDocumentMimeType, `${seeded.idDocumentMimeType} -> ${after.idDocumentMimeType}`)
    check('1e. DB: review state NOT reset to PENDING_REVIEW by the refused upload', after.idDocumentStatus === 'REJECTED', after.idDocumentStatus)

    // THE DESTRUCTIVE HALF. Read the previous document back through the real endpoint with a fresh
    // session: if the refused request had deleted it, this is where that shows up -- a DB row alone
    // cannot prove a blob still exists.
    const readToken = (await session(ids.kyc)).token
    const fileRes = await fetch(`${API}/api/me/id-document/file`, { headers: { authorization: `Bearer ${readToken}` } })
    const fileBody = Buffer.from(await fileRes.arrayBuffer())
    check('1f. the PREVIOUS identity document is still readable through the real endpoint (the irreversible delete did NOT run)',
      fileRes.status === 200 && fileBody.length > 0, `status=${fileRes.status} bytes=${fileBody.length}`)
    check('1g. and it is genuinely the ORIGINAL bytes, not the refused upload\'s',
      fileBody.toString('utf8') === 'first', JSON.stringify(fileBody.toString('utf8').slice(0, 40)))

    // Positive control: the identical request with a live session must succeed AND commit.
    const fresh = (await session(ids.kyc)).token
    const ok = await call('PATCH', '/api/me/id-document', fresh, { fileBase64: 'c2Vjb25k', mimeType: 'image/jpeg' })
    check('1h. control: identical upload with a live session SUCCEEDS (200)', ok.status === 200, `${ok.status} ${JSON.stringify(ok.j).slice(0, 200)}`)
    const ctrl = await db().user.findUnique({ where: { id: ids.kyc }, select: { idDocumentRef: true, idDocumentMimeType: true, idDocumentStatus: true } })
    check('1i. DB: control genuinely committed (ref replaced)', ctrl.idDocumentRef !== seeded.idDocumentRef, `${seeded.idDocumentRef} -> ${ctrl.idDocumentRef}`)
    check('1j. DB: control genuinely committed (state back to PENDING_REVIEW, mime rewritten)',
      ctrl.idDocumentStatus === 'PENDING_REVIEW' && ctrl.idDocumentMimeType === 'image/jpeg', `${ctrl.idDocumentStatus} / ${ctrl.idDocumentMimeType}`)
    const ctrlFile = await fetch(`${API}/api/me/id-document/file`, { headers: { authorization: `Bearer ${fresh}` } })
    const ctrlBody = Buffer.from(await ctrlFile.arrayBuffer())
    check('1k. control: the NEW document is what the endpoint now serves', ctrlBody.toString('utf8') === 'second', JSON.stringify(ctrlBody.toString('utf8').slice(0, 40)))
  }

  // =============================================================================================
  console.log('\n=== 2. ITEM 2 — PATCH /api/sr/rides/:id/assign-driver (dispatch to a live passenger) ===')
  // =============================================================================================
  // Same durable effect as /claim, which round 2 protected: a named driver is dispatched to a real
  // waiting passenger. Reads a request body (driverId), so T1.
  {
    const ride = await db().rideRequest.create({
      data: { riderId: ids.rider, status: 'REQUESTED', fareMinor: 60_000, currency: 'SYP' },
    })
    check('2-fixture: an unassigned REQUESTED ride exists', ride.status === 'REQUESTED' && ride.driverId === null, ride.status)

    const raceToken = (await session(ids.support)).token
    const res = await raceBody({
      method: 'PATCH',
      path: `/api/sr/rides/${ride.id}/assign-driver`,
      token: raceToken,
      body: { driverId: ids.driver },
      actorId: ids.support,
      adminMarker: false,
      label: '2. sr-assign-driver',
      revoke: () => logoutAll(ids.support, '2'),
    })

    check('2a. in-flight driver assignment is REFUSED', res.status !== 200, `status=${res.status} body=${JSON.stringify(res.j).slice(0, 250)}`)
    check('2b. refusal is a COMMIT-BOUNDARY refusal', isBoundaryRefusal(res), `${res.status} ${code(res)}`)
    const after = await db().rideRequest.findUnique({ where: { id: ride.id } })
    check('2c. DB: no driver was dispatched (driverId still null)', after.driverId === null, String(after.driverId))
    check('2d. DB: ride still REQUESTED', after.status === 'REQUESTED', after.status)
    const audit = await db().adminAuditLog.findFirst({ where: { actorUserId: ids.support, action: 'SR_DRIVER_ASSIGNED', entityId: ride.id } })
    check('2e. DB: no SR_DRIVER_ASSIGNED audit row', !audit, JSON.stringify(audit?.id))

    // Positive control, run as SUPPORT deliberately: it also proves the commit-boundary role
    // predicate admits the SAME pair the route's own requireAuth does (['ADMIN','SUPPORT']) and was
    // not silently narrowed to ADMIN.
    const fresh = (await session(ids.support)).token
    const ok = await call('PATCH', `/api/sr/rides/${ride.id}/assign-driver`, fresh, { driverId: ids.driver })
    check('2f. control: identical assignment by SUPPORT with a live session SUCCEEDS (200)', ok.status === 200, `${ok.status} ${JSON.stringify(ok.j).slice(0, 250)}`)
    const ctrl = await db().rideRequest.findUnique({ where: { id: ride.id } })
    check('2g. DB: control genuinely committed (driver assigned)', ctrl.driverId === ids.driver && ctrl.status === 'DRIVER_ASSIGNED', `${ctrl.driverId} / ${ctrl.status}`)
  }

  // =============================================================================================
  console.log('\n=== 3. ITEM 3 — PATCH /api/sr/rides/:id/cancel (writes cancellationFeeMinor: REAL MONEY) ===')
  // =============================================================================================
  // A cancel against an already-dispatched driver writes cancellationFeeMinor = 20% of the ride's own
  // locked fareMinor. Nothing in this codebase reverses that field. The handler reads NO request
  // body, so T1 cannot park it -- T2 on ride_requests instead (it stalls on its first read).
  {
    const ride = await db().rideRequest.create({
      data: { riderId: ids.rider, driverId: ids.driver, status: 'DRIVER_ASSIGNED', fareMinor: 50_000, currency: 'SYP' },
    })
    check('3-fixture: a DRIVER_ASSIGNED ride with a locked fare exists', ride.status === 'DRIVER_ASSIGNED' && ride.fareMinor === 50_000, `${ride.status} / ${ride.fareMinor}`)
    check('3-fixture: no cancellation fee yet', ride.cancellationFeeMinor === null, String(ride.cancellationFeeMinor))

    const raceToken = (await session(ids.rider)).token
    const res = await (await raceStalled({
      table: 'ride_requests',
      label: '3. sr-rider-cancel',
      actorId: ids.rider,
      adminMarker: false,
      start: () => call('PATCH', `/api/sr/rides/${ride.id}/cancel`, raceToken, undefined),
      revoke: () => logoutAll(ids.rider, '3'),
    }))

    check('3a. in-flight rider cancellation is REFUSED', res.status !== 200, `status=${res.status} body=${JSON.stringify(res.j).slice(0, 250)}`)
    check('3b. refusal is a COMMIT-BOUNDARY refusal', isBoundaryRefusal(res), `${res.status} ${code(res)}`)
    const after = await db().rideRequest.findUnique({ where: { id: ride.id } })
    check('3c. DB: NO cancellation fee was written', after.cancellationFeeMinor === null, String(after.cancellationFeeMinor))
    check('3d. DB: ride NOT cancelled', after.status === 'DRIVER_ASSIGNED', after.status)
    check('3e. DB: fare untouched', after.fareMinor === 50_000, String(after.fareMinor))

    const fresh = (await session(ids.rider)).token
    const ok = await call('PATCH', `/api/sr/rides/${ride.id}/cancel`, fresh, undefined)
    check('3f. control: identical cancellation with a live session SUCCEEDS (200)', ok.status === 200, `${ok.status} ${JSON.stringify(ok.j).slice(0, 250)}`)
    const ctrl = await db().rideRequest.findUnique({ where: { id: ride.id } })
    check('3g. DB: control genuinely committed (CANCELLED)', ctrl.status === 'CANCELLED', ctrl.status)
    check('3h. DB: control genuinely committed the REAL money field (20% of 50,000 = 10,000)',
      ctrl.cancellationFeeMinor === 10_000, String(ctrl.cancellationFeeMinor))
  }

  // =============================================================================================
  console.log('\n=== 4. ITEM 4 — PATCH /api/driver/rides/:id/status -> COMPLETED (makes a fare billable) ===')
  // =============================================================================================
  // business.mjs's /api/business/usage totals corporate spend as
  //   rides.filter(r => r.status === 'COMPLETED').reduce((sum, r) => sum + r.fareMinor, 0)
  // so writing COMPLETED is the act that turns a trip into money owed. There is no un-complete route.
  // Reads a request body (status), so T1.
  {
    const ride = await db().rideRequest.create({
      data: { riderId: ids.rider, driverId: ids.driver, status: 'IN_PROGRESS', fareMinor: 77_000, currency: 'SYP' },
    })
    check('4-fixture: an IN_PROGRESS ride assigned to this driver exists', ride.status === 'IN_PROGRESS', ride.status)

    const raceToken = (await session(ids.driver)).token
    const res = await raceBody({
      method: 'PATCH',
      path: `/api/driver/rides/${ride.id}/status`,
      token: raceToken,
      body: { status: 'COMPLETED' },
      actorId: ids.driver,
      adminMarker: false,
      label: '4. driver-complete',
      revoke: () => logoutAll(ids.driver, '4'),
    })

    check('4a. in-flight COMPLETED transition is REFUSED', res.status !== 200, `status=${res.status} body=${JSON.stringify(res.j).slice(0, 250)}`)
    check('4b. refusal is a COMMIT-BOUNDARY refusal', isBoundaryRefusal(res), `${res.status} ${code(res)}`)
    const after = await db().rideRequest.findUnique({ where: { id: ride.id } })
    check('4c. DB: ride NOT marked COMPLETED (fare did not become billable)', after.status === 'IN_PROGRESS', after.status)
    const audit = await db().adminAuditLog.findFirst({ where: { actorUserId: ids.driver, action: 'DRIVER_COMPLETED', entityId: ride.id } })
    check('4d. DB: no DRIVER_COMPLETED audit row', !audit, JSON.stringify(audit?.id))

    const fresh = (await session(ids.driver)).token
    const ok = await call('PATCH', `/api/driver/rides/${ride.id}/status`, fresh, { status: 'COMPLETED' })
    check('4e. control: identical completion with a live session SUCCEEDS (200)', ok.status === 200, `${ok.status} ${JSON.stringify(ok.j).slice(0, 250)}`)
    const ctrl = await db().rideRequest.findUnique({ where: { id: ride.id } })
    check('4f. DB: control genuinely committed (COMPLETED)', ctrl.status === 'COMPLETED', ctrl.status)
  }

  // =============================================================================================
  console.log('\n=== 5. ITEM 5 — POST /api/admin/sr/business-accounts SELF-DEALING (a real authorization rule) ===')
  // =============================================================================================
  // Not a timing fix. business.mjs's loadOwnBusinessAccount() derives business-admin authority from
  // `businessAccount.adminUserId === context.user.id` and NOTHING else -- so an ADMIN who named
  // themselves here then walked into POST /api/business/members and granted riders standing power to
  // bill real rides to that company. This section proves the rule blocks it, that a legitimate
  // third-party designation still works, that the downstream attack is genuinely unreachable, and
  // that the commit-boundary protection round 2 added to this same handler still holds after the
  // designated-admin read was moved inside the transaction.
  {
    await clearAdminBucket(ids.actor)
    const actorEmail = (await db().user.findUnique({ where: { id: ids.actor }, select: { email: true } })).email
    const bizEmail = (await db().user.findUnique({ where: { id: ids.bizAdmin }, select: { email: true } })).email

    // 5.1 THE RULE.
    const selfDeal = await call('POST', '/api/admin/sr/business-accounts', (await session(ids.actor)).token, {
      name: `SEC002R3 Self Dealing ${RUN}`,
      billingContactEmail: `billing-${RUN}@sybnb.test`,
      adminEmail: actorEmail,
    })
    check('5a. an ADMIN naming THEMSELVES as the business admin is REFUSED (403)', selfDeal.status === 403, `${selfDeal.status} ${JSON.stringify(selfDeal.j).slice(0, 250)}`)
    check('5b. and the refusal carries the specific rule code, not review-queue wording',
      code(selfDeal) === 'BUSINESS_ACCOUNT_SELF_DEALING', String(code(selfDeal)))
    const selfRow = await db().businessAccount.findFirst({ where: { adminUserId: ids.actor } })
    check('5c. DB: NO business account was created naming the acting admin', !selfRow, JSON.stringify(selfRow?.id))
    const selfAudit = await db().adminAuditLog.findFirst({ where: { actorUserId: ids.actor, action: 'SR_BUSINESS_ACCOUNT_CREATED' } })
    check('5d. DB: no SR_BUSINESS_ACCOUNT_CREATED audit row (the whole transaction rolled back)', !selfAudit, JSON.stringify(selfAudit?.id))

    // 5.2 THE DOWNSTREAM ATTACK IS GENUINELY UNREACHABLE. Without that row, the acting admin is not
    // a business admin at all, so the member-grant endpoint refuses them outright.
    const grabMembers = await call('POST', '/api/business/members', (await session(ids.actor)).token, { email: bizEmail })
    check('5e. the downstream attack is unreachable: the acting admin cannot grant corporate billing authority',
      grabMembers.status === 403 && code(grabMembers) === 'BUSINESS_ACCOUNT_NOT_ADMIN', `${grabMembers.status} ${code(grabMembers)}`)

    // 5.3 POSITIVE CONTROL: a legitimate third-party designation still works, so the rule refuses
    // self-dealing rather than breaking the endpoint.
    const legit = await call('POST', '/api/admin/sr/business-accounts', (await session(ids.actor)).token, {
      name: `SEC002R3 Legit Co ${RUN}`,
      billingContactEmail: `billing2-${RUN}@sybnb.test`,
      adminEmail: bizEmail,
    })
    check('5f. control: naming a DIFFERENT, real user as business admin still SUCCEEDS (201)', legit.status === 201, `${legit.status} ${JSON.stringify(legit.j).slice(0, 250)}`)
    const legitRow = await db().businessAccount.findFirst({ where: { adminUserId: ids.bizAdmin } })
    check('5g. DB: control genuinely committed, with the DESIGNATED user as adminUserId', legitRow?.adminUserId === ids.bizAdmin, String(legitRow?.adminUserId))

    // 5.4 The commit-boundary protection on this same handler still holds after the designated-admin
    // read moved inside the transaction. Reads a body, so T1.
    await clearAdminBucket(ids.actor)
    const raceToken = (await session(ids.actor)).token
    const res = await raceBody({
      method: 'POST',
      path: '/api/admin/sr/business-accounts',
      token: raceToken,
      body: { name: `SEC002R3 Raced Co ${RUN}`, billingContactEmail: `billing3-${RUN}@sybnb.test`, adminEmail: bizEmail },
      actorId: ids.actor,
      adminMarker: true,
      label: '5. business-account-create',
      revoke: () => logoutAll(ids.actor, '5'),
    })
    check('5h. in-flight business-account creation is still REFUSED at the commit boundary', res.status !== 201, `status=${res.status} body=${JSON.stringify(res.j).slice(0, 250)}`)
    check('5i. refusal is a COMMIT-BOUNDARY refusal (not the self-dealing rule)', isBoundaryRefusal(res), `${res.status} ${code(res)}`)
    const racedRow = await db().businessAccount.findFirst({ where: { name: `SEC002R3 Raced Co ${RUN}` } })
    check('5j. DB: the raced business account was NOT created', !racedRow, JSON.stringify(racedRow?.id))
  }

  // =============================================================================================
  console.log('\n=== 6. ITEM 6 — A8: the COMPENSATING REVERSAL branch, never exercised before ===')
  // =============================================================================================
  // See the file header for why this section drives the production seam rather than HTTP: the branch
  // only exists in the window BETWEEN the claim transaction's COMMIT and the apply transaction's
  // re-authorization, and no HTTP request can hold that window open.
  //
  // The wiring below is copied from server/routes/payment-intents.mjs:815-830 exactly: ONE
  // reauthorizeAtCommit hook passed as BOTH authorizeClaim and beforeEffects, driving the real
  // applyPaymentIntentEvent. The ONLY thing the test adds is a real logout-all performed from inside
  // the apply closure -- i.e. after the claim has genuinely committed and before apply's re-auth runs.
  {
    const replayAction = { action: 'ADMIN_PAYMENT_EVENT_REPLAYED', requiredRoles: ['ADMIN'] }

    // ---- 6a. payment_intent rail: the reversal branch is genuinely reached and genuinely reverses.
    {
      const { context } = await authContextFor(ids.actor)
      const reauth = (tx) => reauthorizeAtCommit(tx, context, replayAction)

      const intent = await db().paymentIntent.create({
        data: {
          userId: ids.actor,
          reference: `sec002r3-a8-${randomUUID()}`,
          status: 'REQUIRES_PAYMENT',
          amountMinor: 123_000,
          currency: 'SYP',
          provider: 'sandbox',
        },
      })
      const event = await db().paymentEvent.create({
        data: {
          rail: 'payment_intent', provider: 'sandbox', providerEndpointKey: 'sandbox-test-account',
          environment: 'test', subjectType: 'PAYMENT_INTENT', providerReference: intent.reference,
          providerEventId: `evt_sec002r3_a8_${randomUUID()}`, type: 'payment_intent.succeeded',
          amountMinor: intent.amountMinor, currency: intent.currency,
          providerObjectId: `pi_sec002r3_a8_${randomUUID()}`, payloadDigest: 'sec002r3-a8-digest',
          intentId: intent.id, originalIntentId: intent.id,
          processingStatus: 'FAILED', attempts: 2, lastError: 'seeded by SEC-002R round 3',
        },
      })

      let claimSnapshot = null
      let applyReached = false
      let outcome = null
      try {
        await applyPaymentEventPipeline({
          eventId: event.id,
          rail: 'payment_intent',
          authorizeClaim: reauth,
          apply: async (claimToken) => {
            applyReached = true
            // The claim transaction has COMMITTED by the time apply() is invoked. Read it from a
            // SEPARATE connection to prove that, rather than asserting it.
            claimSnapshot = await db().paymentEvent.findUnique({ where: { id: event.id } })
            // THE REVOCATION, landing exactly in the claim-commit -> apply window.
            await logoutAll(ids.actor, '6a')
            await sleep(100)
            return applyPaymentIntentEvent({
              eventId: event.id,
              intentId: intent.id,
              type: event.type,
              obj: { id: event.providerObjectId, amount_minor: event.amountMinor, currency: event.currency },
              claimToken,
              beforeEffects: reauth,
            })
          },
        })
      } catch (err) {
        outcome = err
      }

      check('6a-1. apply() was genuinely entered (the window under test was actually reached)', applyReached, 'apply never ran')
      check('6a-2. the CLAIM had genuinely COMMITTED before the revocation (status APPLYING)',
        claimSnapshot?.processingStatus === 'APPLYING', String(claimSnapshot?.processingStatus))
      check('6a-3. and the claim had genuinely incremented attempts (2 -> 3) and held a token',
        claimSnapshot?.attempts === 3 && Boolean(claimSnapshot?.claimToken), `attempts=${claimSnapshot?.attempts} token=${claimSnapshot?.claimToken}`)
      check('6a-4. the apply-phase re-authorization REFUSED the revoked actor', isBoundaryThrow(outcome), `${outcome?.code} ${outcome?.message?.slice(0, 120)}`)
      check('6a-5. and it was NOT a stranded-reversal error (the reversal itself applied cleanly)',
        outcome?.code !== 'PAYMENT_EVENT_REAUTH_REVERSAL_FAILED', String(outcome?.code))

      const after = await db().paymentEvent.findUnique({ where: { id: event.id } })
      check('6a-6. REVERSAL: attempts decremented back to the pre-claim value (3 -> 2)', after.attempts === 2, `attempts=${after.attempts}`)
      check('6a-7. REVERSAL: processingStatus restored to its true pre-claim value (FAILED)', after.processingStatus === 'FAILED', after.processingStatus)
      check('6a-8. REVERSAL: the claim was released', after.claimToken === null && after.claimExpiresAt === null, `${after.claimToken} / ${after.claimExpiresAt}`)
      check('6a-9. lastError was not overwritten by the refused attempt', after.lastError === 'seeded by SEC-002R round 3', String(after.lastError).slice(0, 120))
      check('6a-10. the event was NOT pushed toward DEAD_LETTERED', after.processingStatus !== 'DEAD_LETTERED', after.processingStatus)
      const intentAfter = await db().paymentIntent.findUnique({ where: { id: intent.id } })
      check('6a-11. NO money moved: the intent was not advanced', intentAfter.status === 'REQUIRES_PAYMENT', intentAfter.status)
      const strandedMarker = await db().adminAuditLog.findFirst({ where: { action: 'PAYMENT_EVENT_REAUTH_REVERSAL_FAILED', entityId: event.id } })
      check('6a-12. no stranded-claim reconciliation marker was needed', !strandedMarker, JSON.stringify(strandedMarker?.id))

      // Positive control: the identical seam with a LIVE session must get past BOTH hooks and settle.
      const fresh = await authContextFor(ids.actor)
      const freshReauth = (tx) => reauthorizeAtCommit(tx, fresh.context, replayAction)
      const okResult = await applyPaymentEventPipeline({
        eventId: event.id,
        rail: 'payment_intent',
        authorizeClaim: freshReauth,
        apply: (claimToken) => applyPaymentIntentEvent({
          eventId: event.id,
          intentId: intent.id,
          type: event.type,
          obj: { id: event.providerObjectId, amount_minor: event.amountMinor, currency: event.currency },
          claimToken,
          beforeEffects: freshReauth,
        }),
      })
      check('6a-13. control: identical seam with a live session completes without throwing', Boolean(okResult), JSON.stringify(okResult))
      const ctrl = await db().paymentEvent.findUnique({ where: { id: event.id } })
      check('6a-14. control: the event genuinely settled (no longer FAILED, no claim held)',
        ctrl.processingStatus !== 'FAILED' && ctrl.claimToken === null, `${ctrl.processingStatus} / ${ctrl.claimToken}`)
      check('6a-15. control: attempts DID advance to 3 (proving 6a-6 measured a real counter)', ctrl.attempts === 3, `attempts=${ctrl.attempts}`)
    }

    // ---- 6b. THE STALE-priorStatus DEFECT, proven differentially.
    //
    // Round 2 read priorStatus with a NON-LOCKING findUnique BEFORE the locking CAS. This section
    // forces exactly the interleaving that made that read stale: the test holds the event row's own
    // FOR UPDATE lock, starts the pipeline (which now blocks on its own FOR UPDATE read), then
    // commits a status change to DEAD_LETTERED and releases.
    //
    // Under the OLD code the non-locking findUnique would NOT have blocked -- it would have read
    // FAILED, and the reversal would have written FAILED back, SILENTLY UN-DEAD-LETTERING a real
    // payment event that a human had already been made responsible for. Under the locking read, the
    // pipeline observes DEAD_LETTERED and restores DEAD_LETTERED. The assertion is exactly that
    // difference.
    {
      const { context } = await authContextFor(ids.actor)
      const reauth = (tx) => reauthorizeAtCommit(tx, context, replayAction)

      const intent = await db().paymentIntent.create({
        data: {
          userId: ids.actor,
          reference: `sec002r3-stale-${randomUUID()}`,
          status: 'REQUIRES_PAYMENT',
          amountMinor: 45_000,
          currency: 'SYP',
          provider: 'sandbox',
        },
      })
      const event = await db().paymentEvent.create({
        data: {
          rail: 'payment_intent', provider: 'sandbox', providerEndpointKey: 'sandbox-test-account',
          environment: 'test', subjectType: 'PAYMENT_INTENT', providerReference: intent.reference,
          providerEventId: `evt_sec002r3_stale_${randomUUID()}`, type: 'payment_intent.succeeded',
          amountMinor: intent.amountMinor, currency: intent.currency,
          providerObjectId: `pi_sec002r3_stale_${randomUUID()}`, payloadDigest: 'sec002r3-stale-digest',
          intentId: intent.id, originalIntentId: intent.id,
          processingStatus: 'FAILED', attempts: 1, lastError: 'seeded FAILED, flipped to DEAD_LETTERED mid-claim',
        },
      })

      let pipelinePromise = null
      let blockedObserved = false
      await db().$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT id FROM payment_events WHERE id = '${event.id}'::uuid FOR UPDATE`)
        pipelinePromise = applyPaymentEventPipeline({
          eventId: event.id,
          rail: 'payment_intent',
          authorizeClaim: reauth,
          apply: async (claimToken) => {
            await logoutAll(ids.actor, '6b')
            await sleep(100)
            return applyPaymentIntentEvent({
              eventId: event.id,
              intentId: intent.id,
              type: event.type,
              obj: { id: event.providerObjectId, amount_minor: event.amountMinor, currency: event.currency },
              claimToken,
              beforeEffects: reauth,
            })
          },
        }).then((value) => ({ value }), (err) => ({ err }))
        // Prove the pipeline's own read is genuinely BLOCKED on our row lock -- if it were not, this
        // whole section would be testing nothing.
        blockedObserved = await waitForRowLockWaiter('6b')
        await tx.$executeRawUnsafe(`UPDATE payment_events SET processing_status = 'DEAD_LETTERED' WHERE id = '${event.id}'::uuid`)
      }, { timeout: 60_000, maxWait: 30_000 })

      const settled = await pipelinePromise
      check('6b-1. the pipeline\'s prior-status read genuinely BLOCKED on the row lock (it is a locking read)', blockedObserved, 'no row-lock waiter observed')
      check('6b-2. the apply-phase re-authorization REFUSED the revoked actor', isBoundaryThrow(settled.err), `${settled.err?.code} ${JSON.stringify(settled.value)}`)

      const after = await db().paymentEvent.findUnique({ where: { id: event.id } })
      check('6b-3. THE FIX: the event is restored to DEAD_LETTERED -- its TRUE prior status',
        after.processingStatus === 'DEAD_LETTERED', after.processingStatus)
      check('6b-4. THE DEFECT: it was NOT silently un-dead-lettered back to the stale FAILED value',
        after.processingStatus !== 'FAILED', after.processingStatus)
      check('6b-5. attempts reversed back to the pre-claim value', after.attempts === 1, `attempts=${after.attempts}`)
      check('6b-6. the claim was released', after.claimToken === null && after.claimExpiresAt === null, `${after.claimToken} / ${after.claimExpiresAt}`)
      const intentAfter = await db().paymentIntent.findUnique({ where: { id: intent.id } })
      check('6b-7. NO money moved', intentAfter.status === 'REQUIRES_PAYMENT', intentAfter.status)
    }

    // ---- 6c. THE SAME REVERSAL BRANCH ON THE stripe_checkout RAIL.
    //
    // The reversal itself lives in the rail-agnostic pipeline, so 6a already covers the changed code
    // in full; this proves the OTHER rail's apply implementation (applyStripeCheckoutEvent ->
    // finalizeStripeSession, an entirely different function) also routes a re-authorization failure
    // into that branch rather than into the FAILED/DEAD_LETTERED path.
    //
    // The session deliberately references a bookingId that does not exist, so even the CONTROL run
    // moves no money: finalizeStripeSession finds no booking and marks the event IGNORED. That is a
    // real settled outcome, and it keeps this section free of payment fixtures it does not need.
    {
      const { context } = await authContextFor(ids.actor)
      const reauth = (tx) => reauthorizeAtCommit(tx, context, replayAction)
      const sessionId = `cs_sec002r3_${randomUUID().replace(/-/g, '')}`
      const phantomBookingId = randomUUID()

      const event = await db().paymentEvent.create({
        data: {
          rail: 'stripe_checkout', provider: 'stripe', providerEndpointKey: 'stripe-checkout',
          environment: 'test', subjectType: 'BOOKING', providerReference: phantomBookingId,
          providerEventId: `evt_sec002r3_sc_${randomUUID()}`, type: 'checkout.session.completed',
          amountMinor: 90_000, currency: 'SYP',
          providerObjectId: sessionId, payloadDigest: 'sec002r3-sc-digest', paymentStatus: 'paid',
          processingStatus: 'FAILED', attempts: 3, lastError: 'seeded by SEC-002R round 3 (stripe rail)',
        },
      })
      const stripeSession = {
        id: sessionId,
        payment_status: 'paid',
        currency: 'SYP',
        metadata: { bookingId: phantomBookingId, sypTotalMinor: 90_000 },
      }

      let applyReached = false
      let outcome = null
      try {
        await applyPaymentEventPipeline({
          eventId: event.id,
          rail: 'stripe_checkout',
          authorizeClaim: reauth,
          apply: async (claimToken) => {
            applyReached = true
            await logoutAll(ids.actor, '6c')
            await sleep(100)
            return applyStripeCheckoutEvent({ eventId: event.id, session: stripeSession, claimToken, beforeEffects: reauth })
          },
        })
      } catch (err) {
        outcome = err
      }

      check('6c-1. stripe rail: apply() was genuinely entered', applyReached, 'apply never ran')
      check('6c-2. stripe rail: the apply-phase re-authorization REFUSED the revoked actor', isBoundaryThrow(outcome), `${outcome?.code} ${outcome?.message?.slice(0, 120)}`)
      const after = await db().paymentEvent.findUnique({ where: { id: event.id } })
      check('6c-3. stripe rail REVERSAL: attempts decremented back to 3', after.attempts === 3, `attempts=${after.attempts}`)
      check('6c-4. stripe rail REVERSAL: status restored to FAILED, not advanced to DEAD_LETTERED', after.processingStatus === 'FAILED', after.processingStatus)
      check('6c-5. stripe rail REVERSAL: the claim was released', after.claimToken === null && after.claimExpiresAt === null, `${after.claimToken} / ${after.claimExpiresAt}`)
      const proof = await db().paymentProof.findFirst({ where: { provider: 'stripe', providerRef: sessionId } })
      check('6c-6. stripe rail: NO PaymentProof was created by the refused attempt', !proof, JSON.stringify(proof?.id))

      const fresh = await authContextFor(ids.actor)
      const freshReauth = (tx) => reauthorizeAtCommit(tx, fresh.context, replayAction)
      await applyPaymentEventPipeline({
        eventId: event.id,
        rail: 'stripe_checkout',
        authorizeClaim: freshReauth,
        apply: (claimToken) => applyStripeCheckoutEvent({ eventId: event.id, session: stripeSession, claimToken, beforeEffects: freshReauth }),
      })
      const ctrl = await db().paymentEvent.findUnique({ where: { id: event.id } })
      check('6c-7. control: with a live session the stripe rail gets PAST both hooks and settles (IGNORED)',
        ctrl.processingStatus === 'IGNORED', ctrl.processingStatus)
      check('6c-8. control: attempts DID advance to 4 (proving 6c-3 measured a real counter)', ctrl.attempts === 4, `attempts=${ctrl.attempts}`)
    }
  }

  // =============================================================================================
  console.log('\n=== 7. NEGATIVE CONTROLS: the harness itself does not break requests ===')
  // =============================================================================================
  // Without these, every "REFUSED" above could be an artifact of sending a body in two pieces, or of
  // stalling a handler on a locked table. Same techniques, same hold times, NO revocation.
  {
    // T1 control on a route protected THIS round.
    const ride = await db().rideRequest.create({
      data: { riderId: ids.rider, status: 'REQUESTED', fareMinor: 30_000, currency: 'SYP' },
    })
    const t1Token = (await session(ids.support)).token
    const t1 = await slowRequest({
      method: 'PATCH',
      path: `/api/sr/rides/${ride.id}/assign-driver`,
      token: t1Token,
      body: { driverId: ids.driver },
      hold: async () => { await sleep(700) },
    })
    check('7a. T1 slow-body request with authority intact SUCCEEDS (200)', t1.status === 200, `${t1.status} ${JSON.stringify(t1.j).slice(0, 250)}`)
    const t1Row = await db().rideRequest.findUnique({ where: { id: ride.id } })
    check('7b. DB: that mutation genuinely committed', t1Row.driverId === ids.driver, String(t1Row.driverId))

    // T2 control on a route protected THIS round.
    const ride2 = await db().rideRequest.create({
      data: { riderId: ids.rider, driverId: ids.driver, status: 'DRIVER_ASSIGNED', fareMinor: 20_000, currency: 'SYP' },
    })
    const t2Token = (await session(ids.rider)).token
    let pending
    await withTableLock('ride_requests', async () => {
      pending = call('PATCH', `/api/sr/rides/${ride2.id}/cancel`, t2Token, undefined)
      await sleep(300)
      await waitForBlockedOn('ride_requests', 'negative-control-t2')
      await sleep(300)
    })
    const t2 = await pending
    check('7c. T2 stalled request with authority intact SUCCEEDS (200)', t2.status === 200, `${t2.status} ${JSON.stringify(t2.j).slice(0, 250)}`)
    const t2Row = await db().rideRequest.findUnique({ where: { id: ride2.id } })
    check('7d. DB: that mutation genuinely committed, fee and all', t2Row.status === 'CANCELLED' && t2Row.cancellationFeeMinor === 4_000, `${t2Row.status} / ${t2Row.cancellationFeeMinor}`)
  }

  console.log(`\n=== SEC-002R ROUND 3 RESULT: ${pass} passed, ${fail} failed ===`)
}

try {
  await main()
} catch (err) {
  fail++
  console.log(`  FAIL  suite threw -> ${err?.stack || err}`)
  console.log(`\n=== SEC-002R ROUND 3 RESULT: ${pass} passed, ${fail} failed ===`)
} finally {
  await cleanup().catch(() => {})
  await disconnectDb()
}
process.exit(fail ? 1 : 0)
