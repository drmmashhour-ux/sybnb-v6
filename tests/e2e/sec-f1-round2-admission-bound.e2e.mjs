// SYBNB — SEC-F1 ROUND 2: the containment bound is END-TO-END, not just the route handler's share.
//
// WHAT THIS SUITE DEFENDS
//
// SEC-F1 round 1 (tests/e2e/sec-f1-revocation-contention.e2e.mjs, unmodified and still authoritative
// for its own property) proved that the three containment vectors -- logout-all, admin suspend,
// admin role removal -- never fail SILENTLY under lock contention: each one either genuinely commits
// or returns an explicit 503 REVOCATION_CONTENDED having provably written nothing. That HONESTY
// property was independently verified over ~1,079 attempts and is not re-litigated here.
//
// What round 1 did NOT establish is the BOUND it advertised. runBoundedRevocation()
// (server/lib/revocation-contention.mjs) caps the ROUTE HANDLER at REVOCATION_TOTAL_BUDGET_MS.
// But every authenticated request first passes through getAuthContext()
// (server/lib/auth-context.mjs), which refreshes `user_sessions.last_used_at` whenever the ACTING
// session has been idle longer than five minutes. That refresh is an UPDATE on the acting session's
// own row -- the very row a stalled Class A transaction holds `SELECT ... FOR UPDATE` on via
// reauthorizeAtCommit() -- and before round 2 it carried no lock_timeout and sat inside no bounded
// transaction. So it blocked for the holder's ENTIRE lifetime, before the bounded wrapper ever ran.
//
// Measured on this repo against local sybnb_v6 before the round-2 fix, logout-all:
//     warm acting session, 12s holder ->  6,241ms, HTTP 503 REVOCATION_CONTENDED   (bound held)
//     COLD acting session, 12s holder -> 12,026ms, HTTP 200                         (bound defeated)
//     COLD acting session, 40s holder -> 40,014ms, HTTP 200                         (bound defeated)
//
// A five-minute idle window is not an edge case -- it is the ordinary state of an operator opening
// the admin console to respond to an incident. Round 5's MERGED_TX_OPTIONS lets a legitimate Class A
// holder run 60s, so the containment button could hang for about a minute with nothing to look at.
//
// THE ROUND-2 FIX: that one write now runs under its own Postgres `SET LOCAL lock_timeout`
// (LAST_USED_LOCK_WAIT_MS) and, on lock contention ONLY, is abandoned and logged
// (`session_last_used_refresh_contended`) instead of waited on. `last_used_at` is telemetry -- it is
// written only at that site and read only by listActiveSessions() for the "your active sessions"
// display; nothing authorizes, expires or revokes on it -- so a skipped refresh has no correctness
// or security consequence. Any NON-contention error still propagates and still fails the request.
//
// WHAT IS ASSERTED, AND HOW
//
// The bound measured here is WALL CLOCK FROM REQUEST TO RESPONSE for the whole operator-facing
// operation. Every scenario also re-checks the full two-outcome contract, because a fast wrong
// answer is worse than a slow right one:
//
//   Outcome A (HTTP 2xx): containment GENUINELY committed -- proven by DB state AND by a real
//     authenticated follow-up call with the target's token being REFUSED.
//   Outcome B (HTTP 503 REVOCATION_CONTENDED): containment did NOT happen -- proven by DB state
//     byte-identical to before, AND by the target's token still WORKING on a real authenticated
//     call, AND -- re-read after the holder is released and given time to finish -- by the absence
//     of any LATE commit landing after the refusal was already returned.
//   Anything else is an ambiguous third outcome and fails.
//
// Contention is real, never simulated: the suite opens a transaction and calls the REAL production
// reauthorizeAtCommit() to take exactly the locks a genuine stalled Class A request takes, and
// confirms an ungranted lock request in pg_stat_activity before asserting. No production code is
// stubbed and no production timeout is shortened. Each holder is released as soon as the attempt
// returns, and the suite records whether the holder was STILL HOLDING at that moment -- which is
// what makes "bounded against a 60s holder" a measurement rather than a claim.
//
// WHICH SESSION IS THE COLD ONE. The admission-time write is on the ACTING session's row. For
// logout-all the actor is the target, so one stall covers both paths. For the two admin vectors the
// actor is the ADMIN, so exercising the admission path requires stalling the ADMIN's rows; the
// worst case -- and what these scenarios run -- is BOTH the admin's and the target's rows stalled at
// once, which is the shape where the admission wait and the revocation wait would compound.
//
// Run: node tests/e2e/sec-f1-round2-admission-bound.e2e.mjs   (API_BASE default 127.0.0.1:3051)

import { randomUUID } from 'node:crypto'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'
import { issueUserSession } from '../../server/lib/session-store.mjs'
import { reauthorizeAtCommit } from '../../server/lib/commit-authorization.mjs'
import {
  REVOCATION_TOTAL_BUDGET_MS,
  REVOCATION_CONTENDED_CODE,
} from '../../server/lib/revocation-contention.mjs'
import { LAST_USED_LOCK_WAIT_MS } from '../../server/lib/auth-context.mjs'
import { hashPassword } from '../../server/lib/security.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'

// The end-to-end ceiling this round exists to establish: the admission-time lock wait plus the
// revocation budget, plus slack for ordinary request/DB round trips on a loaded local machine.
// Deliberately far below the 12s/40s/60s holder lifetimes the scenarios run against -- the failure
// this catches was the request tracking the HOLDER's duration, which is orders of magnitude away.
const HANDLING_SLACK_MS = 4_000
const END_TO_END_BOUND_MS = LAST_USED_LOCK_WAIT_MS + REVOCATION_TOTAL_BUDGET_MS + HANDLING_SLACK_MS

let pass = 0
let fail = 0
const failures = []
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`   PASS  ${label}`) }
  else { fail++; failures.push(`${label} -> ${detail}`); console.log(`   FAIL  ${label}  -> ${detail}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const code = (r) => r.j?.error?.code || r.j?.code
const iso = (t) => new Date(t).toISOString()

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
// Fixtures. Dedicated synthetic accounts only -- this suite suspends accounts and strips roles.
// ---------------------------------------------------------------------------------------------
const RUN = Date.now()
const PASSWORD = 'SecF1R2-Regression-Pw!'
const created = []

async function makeUser(roles) {
  const id = randomUUID()
  await db().user.create({
    data: {
      id,
      email: `secf1r2-${id.slice(0, 8)}-${RUN}@sybnb.test`,
      passwordHash: hashPassword(PASSWORD),
      displayName: `secf1r2-${id.slice(0, 8)}`,
      status: 'ACTIVE',
      roles: { create: roles.map((role) => ({ role })) },
    },
  })
  created.push(id)
  return id
}

async function actorWithSession(roles) {
  const id = await makeUser(roles)
  const user = await db().user.findUnique({ where: { id }, include: { roles: true } })
  const s = await issueUserSession(user)
  return { id, token: s.token, sessionId: s.sessionId, epoch: user.sessionEpoch }
}

// WARM: drive one real authenticated request so getAuthContext() refreshes last_used_at now, moving
// the admission write outside the contention window (this is what round 1's suite did for every
// scenario). COLD: force last_used_at older than LAST_USED_REFRESH_MS so the refresh is due, which
// is the state an idle operator console is actually in.
async function warm(actor) {
  await call('GET', '/api/auth/sessions', actor.token)
}
async function chill(actor) {
  await db().userSession.update({
    where: { id: actor.sessionId },
    data: { lastUsedAt: new Date(Date.now() - 30 * 60_000) },
  })
}
async function lastUsedOf(actor) {
  const row = await db().userSession.findUnique({
    where: { id: actor.sessionId }, select: { lastUsedAt: true },
  })
  return row?.lastUsedAt ? row.lastUsedAt.toISOString() : null
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

// The authoritative record of whether containment happened. Read straight from the tables
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
    revokedReason: session?.revokedReason ?? null,
    status: user?.status,
    epoch: user?.sessionEpoch,
    roles: roles.map((r) => r.role).sort(),
  }
}
const sameState = (a, b) =>
  a.sessionRevoked === b.sessionRevoked && a.status === b.status
  && a.epoch === b.epoch && JSON.stringify(a.roles) === JSON.stringify(b.roles)

async function tokenStillWorks(token) {
  const r = await call('GET', '/api/auth/sessions', token)
  return r.status === 200
}

// ---------------------------------------------------------------------------------------------
// The stall. REAL Class A locks, taken by the production function that takes them. Held until the
// returned handle is released (or holdMs elapses, whichever comes first). `finished` lets a scenario
// record whether the holder was STILL HOLDING when the containment response arrived.
// ---------------------------------------------------------------------------------------------
function stallClassA(actor, holdMs) {
  let release
  const gate = new Promise((r) => { release = r })
  let ready
  const readyP = new Promise((r) => { ready = r })
  let readyErr = null
  const handle = { finished: false, release: () => release(), ready: readyP }

  handle.done = db().$transaction(async (tx) => {
    await reauthorizeAtCommit(tx, { sessionId: actor.sessionId, user: { id: actor.id }, epoch: actor.epoch }, {
      action: 'SEC_F1_R2_STALLED_CLASS_A',
    })
    ready()
    await Promise.race([gate, sleep(holdMs)])
  }, { maxWait: 20_000, timeout: 240_000 })
    .catch((err) => { readyErr = err; ready() })
    .finally(() => { handle.finished = true })

  handle.assertReady = async () => {
    await readyP
    if (readyErr) throw new Error(`stalled Class A holder failed to take its locks: ${readyErr.message}`)
  }
  return handle
}

async function withStalls(actors, holdMs, body) {
  const handles = []
  try {
    for (const a of actors) {
      const h = stallClassA(a, holdMs)
      await h.assertReady()
      handles.push(h)
    }
    return await body(handles)
  } finally {
    for (const h of handles) h.release()
    for (const h of handles) await h.done.catch(() => {})
  }
}

// Independent evidence that a request really is parked in Postgres' lock queue rather than merely
// slow: an UNGRANTED lock wait in this database.
async function waitForBlocked(label, timeoutMs = 3_000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
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
// The three containment vectors.
// ---------------------------------------------------------------------------------------------
const VECTORS = {
  'logout-all': {
    needsAdmin: false,
    // The acting session IS the target's session, so one stall covers admission AND revocation.
    actingIsTarget: true,
    run: (target) => call('POST', '/api/auth/logout-all', target.token, {}),
    expectChanged: (before, after) => after.sessionRevoked && after.epoch === before.epoch + 1,
  },
  'admin-suspend': {
    needsAdmin: true,
    actingIsTarget: false,
    run: (target, admin) => call('PATCH', `/api/admin/users/${target.id}/status`, admin.token, { status: 'SUSPENDED' }),
    expectChanged: (before, after) => after.status === 'SUSPENDED' && after.sessionRevoked && after.epoch === before.epoch + 1,
  },
  'admin-role-removal': {
    needsAdmin: true,
    actingIsTarget: false,
    run: (target, admin) => call('PATCH', `/api/admin/users/${target.id}/roles`, admin.token, { remove: ['HOST'] }),
    expectChanged: (before, after) => !after.roles.includes('HOST') && after.sessionRevoked && after.epoch === before.epoch + 1,
  },
}

// ---------------------------------------------------------------------------------------------
// One scenario = one containment attempt under a described contention shape, fully evidenced.
//
// `releaseAtMs`, when set, releases the holders that many ms after the attempt starts -- used by the
// boundary-timing section to land the release clearly before, near, and just after the deadline.
// ---------------------------------------------------------------------------------------------
async function scenario({ section, name, vectorName, holdMs, cold, releaseAtMs = null }) {
  const vector = VECTORS[vectorName]
  const label = `${section} ${vectorName} ${name}`
  const target = await actorWithSession(['GUEST', 'HOST'])
  // A fresh admin per scenario, so one scenario's stall or state can never colour the next.
  const admin = vector.needsAdmin ? await actorWithSession(['ADMIN']) : null
  const acting = vector.actingIsTarget ? target : admin

  // Pre-flight, before any lock exists: the target must start out genuinely usable.
  const before = await stateOf(target)
  const tokenLiveBefore = await tokenStillWorks(target.token)

  // Set the acting session's temperature LAST -- these helpers issue real requests / writes against
  // the same row, so they must happen before anything is locked.
  if (vector.needsAdmin) await warm(target)
  if (cold) await chill(acting)
  else await warm(acting)
  const lastUsedBefore = await lastUsedOf(acting)

  // Stall the acting session's rows (the admission path) and, for the admin vectors, the target's
  // rows too (the revocation path) -- the compounding worst case.
  const stalled = vector.actingIsTarget ? [target] : [admin, target]

  let res, ms, startedAt, endedAt, observedBlock, holderStillHolding
  await withStalls(stalled, holdMs, async (handles) => {
    startedAt = Date.now()
    const attempt = (async () => {
      const t0 = Date.now()
      const value = await vector.run(target, admin)
      return { value, ms: Date.now() - t0 }
    })()
    observedBlock = await waitForBlocked(label)
    if (releaseAtMs !== null) {
      const wait = releaseAtMs - (Date.now() - startedAt)
      if (wait > 0) await sleep(wait)
      for (const h of handles) h.release()
    }
    const out = await attempt
    endedAt = Date.now()
    // Captured BEFORE the finally-block releases: were the locks still held when we answered?
    holderStillHolding = handles.some((h) => !h.finished)
    res = out.value
    ms = out.ms
  })

  const after = await stateOf(target)
  const tokenLiveAfter = await tokenStillWorks(target.token)
  const lastUsedAfter = await lastUsedOf(acting)

  // A late commit can only land after the holders are gone; give the released transactions real
  // time to do so before declaring the refusal final.
  await sleep(2_000)
  const settled = await stateOf(target)
  const tokenLiveSettled = await tokenStillWorks(target.token)

  const outcome = res.status >= 200 && res.status < 300 ? 'A'
    : (res.status === 503 && code(res) === REVOCATION_CONTENDED_CODE) ? 'B' : 'AMBIGUOUS'

  console.log(`\n  [${label}] hold=${holdMs}ms cold=${cold ? 'Y' : 'N'}${releaseAtMs !== null ? ` release@${releaseAtMs}ms` : ''}`)
  console.log(`    start=${iso(startedAt)}  end=${iso(endedAt)}  duration=${ms}ms  (bound ${END_TO_END_BOUND_MS}ms)`)
  console.log(`    http=${res.status} code=${code(res) || 'none'} outcome=${outcome} holderStillHolding=${holderStillHolding} ungrantedLockObserved=${observedBlock}`)
  console.log(`    acting.last_used_at  before=${lastUsedBefore}  after=${lastUsedAfter}`)
  console.log(`    db.before  =${JSON.stringify(before)}`)
  console.log(`    db.after   =${JSON.stringify(after)}`)
  console.log(`    db.settled =${JSON.stringify(settled)}   (re-read 2000ms after holders released)`)
  console.log(`    target token live: before=${tokenLiveBefore} after=${tokenLiveAfter} settled=${tokenLiveSettled}`)

  check(`${label}: target's token was live before the attempt`, tokenLiveBefore, 'target token was already dead')
  check(`${label}: NOT a generic 500`, res.status !== 500, `${res.status} ${JSON.stringify(res.j).slice(0, 200)}`)
  check(`${label}: outcome is A or B, never ambiguous`, outcome !== 'AMBIGUOUS',
    `${res.status} ${JSON.stringify(res.j).slice(0, 300)}`)
  check(`${label}: END-TO-END bounded (${ms}ms <= ${END_TO_END_BOUND_MS}ms)`,
    ms <= END_TO_END_BOUND_MS, `${ms}ms against a ${holdMs}ms holder`)

  if (outcome === 'A') {
    check(`${label}: A -> DB state genuinely CHANGED`, vector.expectChanged(before, after),
      `${JSON.stringify(before)} -> ${JSON.stringify(after)}`)
    check(`${label}: A -> target's token is REFUSED (containment real)`, !tokenLiveAfter,
      'token still works after a reported success')
    check(`${label}: A -> still contained after settling (no rollback)`,
      vector.expectChanged(before, settled) && !tokenLiveSettled,
      `${JSON.stringify(settled)} tokenLive=${tokenLiveSettled}`)
  } else if (outcome === 'B') {
    check(`${label}: B -> body states containment did NOT happen`,
      res.j?.error?.containmentApplied === false && res.j?.error?.retryable === true,
      JSON.stringify(res.j).slice(0, 300))
    check(`${label}: B -> DB state provably UNCHANGED (no partial containment)`,
      sameState(before, after), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`)
    check(`${label}: B -> target's token is still LIVE (refusal was honest)`, tokenLiveAfter,
      'token died despite a reported containment failure')
    check(`${label}: B -> NO LATE COMMIT after the refusal`,
      sameState(before, settled) && tokenLiveSettled,
      `settled=${JSON.stringify(settled)} tokenLive=${tokenLiveSettled} (containment landed AFTER a refusal was returned)`)
  }

  // The bound is only meaningful if the contention was still present when we answered. For the
  // boundary-timing scenarios the release is deliberate, so this is informational there.
  if (releaseAtMs === null) {
    check(`${label}: holder was STILL HOLDING when the response arrived`, holderStillHolding,
      'the holder had already finished -- this scenario did not actually measure a bound')
  }

  return { label, ms, status: res.status, outcome }
}

async function main() {
  console.log('=== SEC-F1 ROUND 2 — END-TO-END CONTAINMENT BOUND (admission-time write) ===')
  console.log(`API=${API}`)
  console.log(`bound = LAST_USED_LOCK_WAIT_MS(${LAST_USED_LOCK_WAIT_MS}) + REVOCATION_TOTAL_BUDGET_MS(${REVOCATION_TOTAL_BUDGET_MS}) + slack(${HANDLING_SLACK_MS}) = ${END_TO_END_BOUND_MS}ms`)
  const rows = []

  // -------------------------------------------------------------------------------------------
  console.log('\n\n== 1. POSITIVE CONTROL — cold acting session, NO contention ==')
  console.log('   (proves the bounded refresh did not break the ordinary path, and that a cold')
  console.log('    session still gets its last_used_at written when nothing is holding the row)')
  for (const vectorName of Object.keys(VECTORS)) {
    const vector = VECTORS[vectorName]
    const target = await actorWithSession(['GUEST', 'HOST'])
    const admin = vector.needsAdmin ? await actorWithSession(['ADMIN']) : null
    const acting = vector.actingIsTarget ? target : admin
    if (vector.needsAdmin) await warm(target)
    await chill(acting)
    const before = await stateOf(target)
    const lastUsedBefore = await lastUsedOf(acting)
    const t0 = Date.now()
    const res = await vector.run(target, admin)
    const ms = Date.now() - t0
    const after = await stateOf(target)
    const lastUsedAfter = await lastUsedOf(acting)
    console.log(`\n  [control ${vectorName}] ${ms}ms http=${res.status}`)
    console.log(`    acting.last_used_at before=${lastUsedBefore} after=${lastUsedAfter}`)
    console.log(`    db.before=${JSON.stringify(before)}`)
    console.log(`    db.after =${JSON.stringify(after)}`)
    check(`control ${vectorName}: succeeds (HTTP 2xx)`, res.status >= 200 && res.status < 300,
      `${res.status} ${JSON.stringify(res.j).slice(0, 200)}`)
    check(`control ${vectorName}: fast (${ms}ms < 2000ms)`, ms < 2000, `${ms}ms`)
    check(`control ${vectorName}: DB state genuinely changed`, vector.expectChanged(before, after),
      `${JSON.stringify(before)} -> ${JSON.stringify(after)}`)
    check(`control ${vectorName}: target's token is now REFUSED`, !(await tokenStillWorks(target.token)),
      'token still works after a successful revocation')
    check(`control ${vectorName}: uncontended cold refresh DID write last_used_at`,
      lastUsedAfter !== lastUsedBefore,
      `${lastUsedBefore} -> ${lastUsedAfter} (the bounded refresh must still do its job normally)`)
  }

  // -------------------------------------------------------------------------------------------
  console.log('\n\n== 2. COLD acting session under contention — the round-2 defect ==')
  console.log('   (before the fix these tracked the holder: 12,026ms / 40,014ms / ~60s)')
  for (const holdMs of [12_000, 40_000, 60_000]) {
    for (const vectorName of Object.keys(VECTORS)) {
      rows.push(await scenario({ section: '2', name: `COLD vs ${holdMs / 1000}s holder`, vectorName, holdMs, cold: true }))
    }
  }

  // -------------------------------------------------------------------------------------------
  console.log('\n\n== 3. WARM acting session under contention — round-1 regression ==')
  console.log('   (no admission refresh is due; behaviour must be exactly what round 1 proved)')
  for (const holdMs of [12_000, 60_000]) {
    for (const vectorName of Object.keys(VECTORS)) {
      rows.push(await scenario({ section: '3', name: `WARM vs ${holdMs / 1000}s holder`, vectorName, holdMs, cold: false }))
    }
  }

  // -------------------------------------------------------------------------------------------
  console.log('\n\n== 4. BOUNDARY TIMING — release clearly before, near, and just after the deadline ==')
  console.log('   (hunting for: response/DB disagreement, partial containment, a LATE commit landing')
  console.log('    after a refusal, a token surviving a reported success, or a token dying after a')
  console.log('    reported refusal. Cold acting session throughout -- the worst case.)')
  const DEADLINE = LAST_USED_LOCK_WAIT_MS + REVOCATION_TOTAL_BUDGET_MS
  const BOUNDARIES = [
    ['clearly BEFORE the deadline', 1_000],
    ['NEAR the deadline (-400ms)', DEADLINE - 400],
    ['NEAR the deadline (-100ms)', DEADLINE - 100],
    ['AT the deadline', DEADLINE],
    ['just AFTER the deadline (+300ms)', DEADLINE + 300],
    ['clearly AFTER the deadline (+1500ms)', DEADLINE + 1_500],
  ]
  for (const [name, releaseAtMs] of BOUNDARIES) {
    for (const vectorName of Object.keys(VECTORS)) {
      rows.push(await scenario({
        section: '4', name: `release ${name}`, vectorName, holdMs: 60_000, cold: true, releaseAtMs,
      }))
    }
  }

  // -------------------------------------------------------------------------------------------
  console.log('\n\n== SUMMARY ==')
  const worst = rows.reduce((m, r) => Math.max(m, r.ms), 0)
  for (const r of rows) console.log(`  ${String(r.ms).padStart(6)}ms  http=${r.status}  outcome=${r.outcome}  ${r.label}`)
  console.log(`\n  worst observed end-to-end duration: ${worst}ms (bound ${END_TO_END_BOUND_MS}ms)`)
  console.log(`  outcomes: A=${rows.filter((r) => r.outcome === 'A').length} B=${rows.filter((r) => r.outcome === 'B').length} AMBIGUOUS=${rows.filter((r) => r.outcome === 'AMBIGUOUS').length}`)

  if (failures.length) {
    console.log('\n  FAILURES:')
    for (const f of failures) console.log(`    - ${f}`)
  }
  console.log(`\n=== SEC-F1 ROUND 2: ${pass} passed, ${fail} failed ===`)
  return fail
}

let exitCode = 1
try {
  exitCode = (await main()) === 0 ? 0 : 1
} catch (err) {
  console.error('SEC-F1 round 2 suite crashed:', err)
  exitCode = 1
} finally {
  await cleanup()
  await disconnectDb()
}
process.exit(exitCode)
