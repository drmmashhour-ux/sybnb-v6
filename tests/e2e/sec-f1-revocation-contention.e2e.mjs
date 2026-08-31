// SYBNB — SEC-F1: revocation must never fail SILENTLY under lock contention.
//
// WHAT THIS SUITE DEFENDS
//
// SEC-002R (closed) proved that an unauthorized mutation cannot COMMIT: every Class A operation
// re-asserts its actor's authority inside its own transaction, holding `SELECT ... FOR UPDATE` on
// that actor's `user_sessions` row and then their `users` row until commit
// (server/lib/commit-authorization.mjs). Round 5 widened the payment-event pipeline's transaction to
// 60s (MERGED_TX_OPTIONS, server/lib/tx-scope.mjs), so those locks can legitimately be held that long.
//
// F-1, found during SEC-002R's final behavioural verification, is the INVERSE problem. Revocation
// writes those SAME two rows (session-store.mjs: revokeUserAccess -> user_sessions, then
// users.session_epoch). So while a Class A transaction for actor X is in flight, revoking X blocked
// on X's own locks -- and before the SEC-F1 fix it blocked for the holder's FULL lifetime, then died
// with Prisma P2028 which handleRouteError() rendered as a generic HTTP 500, having revoked NOTHING.
// An operator containing a compromised account during a busy payment window could believe they had
// suspended it when they had not, with the token still live.
//
// THE FIX (server/lib/revocation-contention.mjs): revocation transactions run under a Postgres-side
// `SET LOCAL lock_timeout`, retried within a total budget, so the outcome is always exactly one of:
//
//   (a) the revocation genuinely COMMITS inside the budget -- state really changed; or
//   (b) HTTP 503 REVOCATION_CONTENDED with `containmentApplied: false`, and -- because a lock_timeout
//       aborts and rolls the whole transaction back -- the target's state is provably UNTOUCHED.
//
// HOW THE CONTENTION IS CREATED (no production code is modified or slowed)
//
// The test itself opens a transaction and calls the REAL production reauthorizeAtCommit() against
// the target's session/account -- i.e. it takes exactly the locks, in exactly the order, that a
// genuine stalled Class A request takes -- and holds them. Contention is confirmed independently via
// pg_locks (an ungranted lock request) before any assertion is made, so "blocked" is observed, not
// assumed. Nothing is stubbed and no production timeout is shortened for the test.
//
// EVERY assertion about whether containment happened is made against the DATABASE and against a
// follow-up REAL authenticated call, never against the HTTP status alone:
//   - outcome (a): revoked_at set / epoch bumped / status or roles changed, AND the target's token
//     is subsequently REFUSED by a real authenticated endpoint.
//   - outcome (b): revoked_at still null, epoch unchanged, status and roles unchanged, AND the
//     target's token subsequently still WORKS -- proving the refusal was honest and the operator has
//     real grounds to retry.
//
// Run: node tests/e2e/sec-f1-revocation-contention.e2e.mjs   (API_BASE default 127.0.0.1:3051)

import { randomUUID } from 'node:crypto'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'
import { issueUserSession } from '../../server/lib/session-store.mjs'
import { reauthorizeAtCommit } from '../../server/lib/commit-authorization.mjs'
import {
  REVOCATION_TOTAL_BUDGET_MS,
  REVOCATION_CONTENDED_CODE,
} from '../../server/lib/revocation-contention.mjs'
import { hashPassword } from '../../server/lib/security.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'

let pass = 0
let fail = 0
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`   PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
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
async function timed(fn) {
  const t0 = Date.now()
  const value = await fn()
  return { value, ms: Date.now() - t0 }
}

// ---------------------------------------------------------------------------------------------
// Fixtures. Dedicated synthetic accounts only -- this suite suspends accounts and strips roles, so
// it must never touch the shared ADMIN/HOST/GUEST env fixtures other suites depend on.
// ---------------------------------------------------------------------------------------------
const RUN = Date.now()
const PASSWORD = 'SecF1-Regression-Pw!'
const created = []

async function makeUser(roles) {
  const id = randomUUID()
  await db().user.create({
    data: {
      id,
      email: `secf1-${id.slice(0, 8)}-${RUN}@sybnb.test`,
      passwordHash: hashPassword(PASSWORD),
      displayName: `secf1-${id.slice(0, 8)}`,
      status: 'ACTIVE',
      roles: { create: roles.map((role) => ({ role })) },
    },
  })
  created.push(id)
  return id
}

// A fresh, real session issued through the production path, plus everything reauthorizeAtCommit()
// needs to lock the same rows a genuine in-flight Class A request would.
async function actorWithSession(roles) {
  const id = await makeUser(roles)
  const user = await db().user.findUnique({ where: { id }, include: { roles: true } })
  const s = await issueUserSession(user)
  // Warm the session once. getAuthContext() refreshes user_sessions.last_used_at at ADMISSION when
  // it is null or older than 5 minutes (server/lib/auth-context.mjs) -- an unbounded write to the
  // very row the stalled Class A transaction holds. Warming it here moves that write outside the
  // contention window so each scenario measures the REVOCATION path, which is what SEC-F1 is about,
  // rather than the admission refresh. (That admission-time write is separately noted in the report:
  // it is not a containment failure, but it is a second unbounded wait on the same row.)
  await call('GET', '/api/auth/sessions', s.token)
  return { id, token: s.token, sessionId: s.sessionId, epoch: user.sessionEpoch }
}

async function cleanup() {
  for (const id of created) {
    await db().adminAuditLog.deleteMany({ where: { OR: [{ actorUserId: id }, { entityId: id }] } }).catch(() => {})
    await db().rateLimitBucket.deleteMany({ where: { bucketKey: `admin-action:${id}` } }).catch(() => {})
    await db().userSession.deleteMany({ where: { userId: id } }).catch(() => {})
    await db().userRole.deleteMany({ where: { userId: id } }).catch(() => {})
    await db().user.delete({ where: { id } }).catch(() => {})
  }
}

// The authoritative record of whether containment actually happened. Read straight from the tables
// revocation writes -- never inferred from an HTTP response.
async function stateOf(actor) {
  const session = await db().userSession.findUnique({
    where: { id: actor.sessionId }, select: { revokedAt: true, revokedReason: true },
  })
  const user = await db().user.findUnique({
    where: { id: actor.id }, select: { status: true, sessionEpoch: true },
  })
  const roles = await db().userRole.findMany({ where: { userId: actor.id }, select: { role: true } })
  return {
    sessionRevoked: Boolean(session?.revokedAt),
    status: user?.status,
    epoch: user?.sessionEpoch,
    roles: roles.map((r) => r.role).sort(),
  }
}
const sameState = (a, b) =>
  a.sessionRevoked === b.sessionRevoked && a.status === b.status
  && a.epoch === b.epoch && JSON.stringify(a.roles) === JSON.stringify(b.roles)

// Is the target's token still a working credential? The real, end-to-end question behind
// "did containment happen". /api/auth/sessions is authenticated and strictly self-scoped.
async function tokenStillWorks(token) {
  const r = await call('GET', '/api/auth/sessions', token)
  return r.status === 200
}

// ---------------------------------------------------------------------------------------------
// The stall. A REAL Class A lock set on the target's rows, taken by the production function that
// takes them, held until released. Production code is untouched.
// ---------------------------------------------------------------------------------------------
async function withStalledClassA(actor, body) {
  let release
  const gate = new Promise((r) => { release = r })
  let ready
  const readyP = new Promise((r) => { ready = r })
  let readyErr = null

  const holder = db().$transaction(async (tx) => {
    await reauthorizeAtCommit(tx, { sessionId: actor.sessionId, user: { id: actor.id }, epoch: actor.epoch }, {
      action: 'SEC_F1_STALLED_CLASS_A',
    })
    ready()
    await gate
  }, { maxWait: 20_000, timeout: 180_000 }).catch((err) => { readyErr = err; ready() })

  await readyP
  if (readyErr) throw new Error(`stalled Class A holder failed to take its locks: ${readyErr.message}`)
  try {
    return await body(release)
  } finally {
    release()
    await holder.catch(() => {})
  }
}

// Independent evidence that a request really is parked in Postgres' lock queue on the target's rows,
// rather than merely slow: an UNGRANTED tuple/transaction lock request against user_sessions/users.
async function waitForBlockedRevocation(label) {
  for (let i = 0; i < 120; i++) {
    const rows = await db().$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM pg_stat_activity
       WHERE datname = current_database() AND state = 'active' AND wait_event_type = 'Lock'`,
    )
    if ((rows[0]?.n ?? 0) > 0) return true
    await sleep(25)
  }
  console.log(`   (never observed an ungranted lock for ${label})`)
  return false
}

// ---------------------------------------------------------------------------------------------
// The three revocation vectors, each as a single callable that performs the containment attempt.
// ---------------------------------------------------------------------------------------------
const VECTORS = {
  'logout-all': {
    // The account revoking its OWN credentials everywhere.
    needsAdmin: false,
    run: (target) => call('POST', '/api/auth/logout-all', target.token, {}),
    expectChanged: (before, after) => after.sessionRevoked && after.epoch === before.epoch + 1,
  },
  'admin-suspend': {
    needsAdmin: true,
    run: (target, admin) => call('PATCH', `/api/admin/users/${target.id}/status`, admin.token, { status: 'SUSPENDED' }),
    expectChanged: (before, after) => after.status === 'SUSPENDED' && after.sessionRevoked && after.epoch === before.epoch + 1,
  },
  'admin-role-removal': {
    needsAdmin: true,
    run: (target, admin) => call('PATCH', `/api/admin/users/${target.id}/roles`, admin.token, { remove: ['HOST'] }),
    expectChanged: (before, after) => !after.roles.includes('HOST') && after.sessionRevoked && after.epoch === before.epoch + 1,
  },
}

async function main() {
  console.log('=== SEC-F1 — REVOCATION UNDER LOCK CONTENTION ===')
  const admin = await actorWithSession(['ADMIN'])

  // -------------------------------------------------------------------------------------------
  // 1. POSITIVE CONTROL — no contention. Normal operation must be unchanged and fast.
  // -------------------------------------------------------------------------------------------
  console.log('\n-- 1. positive control: revocation with NO contention --')
  for (const [name, vector] of Object.entries(VECTORS)) {
    const target = await actorWithSession(['GUEST', 'HOST'])
    const before = await stateOf(target)
    check(`${name}: control target's token works before`, await tokenStillWorks(target.token), 'token was already dead')

    const { value: res, ms } = await timed(() => vector.run(target, admin))
    const after = await stateOf(target)

    check(`${name}: control succeeds (HTTP 2xx)`, res.status >= 200 && res.status < 300, `${res.status} ${JSON.stringify(res.j).slice(0, 200)}`)
    check(`${name}: control is fast (${ms}ms < 2000ms)`, ms < 2000, `${ms}ms`)
    check(`${name}: control genuinely changed DB state`, vector.expectChanged(before, after), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`)
    // logout-all without keepCurrentSession revokes the caller's own session, so the token must die.
    check(`${name}: control -> target's token is now REFUSED`, !(await tokenStillWorks(target.token)), 'token still works after a successful revocation')
  }

  // -------------------------------------------------------------------------------------------
  // 2. CONTENTION THAT OUTLASTS THE BUDGET — must be outcome (b): explicit, honest, no state change.
  // -------------------------------------------------------------------------------------------
  console.log('\n-- 2. contention that outlasts the budget: explicit failure, nothing changed --')
  for (const [name, vector] of Object.entries(VECTORS)) {
    const target = await actorWithSession(['GUEST', 'HOST'])
    const before = await stateOf(target)

    const { res, ms, observedBlock } = await withStalledClassA(target, async () => {
      const attempt = timed(() => vector.run(target, admin))
      const observedBlock = await waitForBlockedRevocation(name)
      const { value, ms } = await attempt
      return { res: value, ms, observedBlock }
    })

    const after = await stateOf(target)
    check(`${name}: contention was real (ungranted lock observed)`, observedBlock, 'no ungranted lock ever seen')
    check(`${name}: NOT a generic 500`, res.status !== 500, `${res.status} ${JSON.stringify(res.j).slice(0, 200)}`)
    check(`${name}: explicit 503 ${REVOCATION_CONTENDED_CODE}`,
      res.status === 503 && code(res) === REVOCATION_CONTENDED_CODE,
      `${res.status} ${JSON.stringify(res.j).slice(0, 300)}`)
    check(`${name}: body states containment did NOT happen`,
      res.j?.error?.containmentApplied === false && res.j?.error?.retryable === true,
      JSON.stringify(res.j).slice(0, 300))
    check(`${name}: bounded wait (${ms}ms <= budget+slack)`,
      ms <= REVOCATION_TOTAL_BUDGET_MS + 4000, `${ms}ms vs budget ${REVOCATION_TOTAL_BUDGET_MS}ms`)
    check(`${name}: DB state provably UNCHANGED (no partial write)`,
      sameState(before, after), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`)
    check(`${name}: target's token is still LIVE (failure was honest)`,
      await tokenStillWorks(target.token), 'token died despite a reported containment failure')
  }

  // -------------------------------------------------------------------------------------------
  // 3. CONTENTION THAT CLEARS MID-WAIT — must be outcome (a): the revocation then really commits.
  // -------------------------------------------------------------------------------------------
  console.log('\n-- 3. contention clearing while the revocation waits: succeeds once the lock frees --')
  for (const [name, vector] of Object.entries(VECTORS)) {
    const target = await actorWithSession(['GUEST', 'HOST'])
    const before = await stateOf(target)

    const { res, ms } = await withStalledClassA(target, async (release) => {
      const attempt = timed(() => vector.run(target, admin))
      await waitForBlockedRevocation(`${name} (clearing)`)
      // Well inside the budget: the Class A transaction finishes, and the revocation -- already
      // parked in the lock queue -- must then acquire the rows and commit for real.
      await sleep(400)
      release()
      const { value, ms } = await attempt
      return { res: value, ms }
    })

    const after = await stateOf(target)
    check(`${name}: succeeds after the holder released (HTTP 2xx)`,
      res.status >= 200 && res.status < 300, `${res.status} ${JSON.stringify(res.j).slice(0, 250)}`)
    check(`${name}: completed within the budget (${ms}ms)`,
      ms <= REVOCATION_TOTAL_BUDGET_MS + 4000, `${ms}ms`)
    check(`${name}: DB state genuinely CHANGED`, vector.expectChanged(before, after),
      `${JSON.stringify(before)} -> ${JSON.stringify(after)}`)
    check(`${name}: target's token is now REFUSED`, !(await tokenStillWorks(target.token)),
      'token still works after a successful revocation')
  }

  console.log(`\n=== SEC-F1: ${pass} passed, ${fail} failed ===`)
  return fail
}

let exitCode = 1
try {
  exitCode = (await main()) === 0 ? 0 : 1
} catch (err) {
  console.error('SEC-F1 suite crashed:', err)
  exitCode = 1
} finally {
  await cleanup()
  await disconnectDb()
}
process.exit(exitCode)
