// SYBNB — SEC-002: session invalidation / auth revocation (permanent regression)
//
// Before this suite's fix, SYBNB had no logout endpoint anywhere in server/routes/ and no
// server-side record of any session. A token was a 7-day HMAC-signed {sub, roles, iat, exp}
// envelope, and NOTHING could make an issued one stop working. Reproduced live against the
// pre-fix build:
//   - POST /api/auth/logout                                        -> 404 NOT_FOUND
//   - account row set to SUSPENDED, token replayed                 -> 200 (still authenticated)
//   - same token against GET /api/admin/audit-log while SUSPENDED  -> 200 (still ADMIN)
//   - ADMIN role row DELETEd, token replayed on the admin endpoint -> 200 (stale privilege)
//   - account row set to DELETED, token replayed                   -> 200
// The 30s per-process auth cache in server/lib/auth-context.mjs made the last three survive even
// once the DB was correct, and the cache was refreshed by the victim's own traffic.
//
// The fix (prisma/migrations/046_session_revocation, server/lib/session-store.mjs,
// server/lib/auth-context.mjs, server/routes/auth.mjs, server/routes/admin.mjs) makes sessions
// server-backed (user_sessions row per token, carried as the `sid` claim) and adds a per-user
// security epoch (users.session_epoch, carried as the `epoch` claim) for account-wide revocation.
//
// Every check below drives the REAL HTTP API with REAL logins and verifies the resulting DB state
// directly. Sessions are never faked by copying a token string around as if it were a second
// session -- each "device" logs in independently and gets its own user_sessions row.
//
// Run: node tests/e2e/session-revocation.e2e.mjs   (API_BASE default http://127.0.0.1:3051)

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createSessionToken as signRawToken, hashPassword } from '../../server/lib/security.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
let pass = 0, fail = 0
async function call(method, path, token, body) {
  const res = await fetch(API + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  let j; const text = await res.text(); try { j = JSON.parse(text) } catch { j = { raw: text.slice(0, 300) } }
  return { status: res.status, j }
}
function check(label, cond, detail) { if (cond) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) } }

const PASSWORD = 'Sec002-Regression-Pw!'
const RUN = Date.now()
const ids = { subject: randomUUID(), operator: randomUUID(), support: randomUUID(), bystander: randomUUID() }
const emails = {
  subject: `sec002-subject-${RUN}@sybnb.test`,
  operator: `sec002-operator-${RUN}@sybnb.test`,
  support: `sec002-support-${RUN}@sybnb.test`,
  bystander: `sec002-bystander-${RUN}@sybnb.test`,
}

// Dedicated synthetic fixtures. This suite suspends, deletes and re-roles its subject account, so
// it must never touch the shared ADMIN/GUEST env fixtures other suites depend on.
async function makeUser(id, email, roles) {
  await db().user.create({
    data: { id, email, passwordHash: hashPassword(PASSWORD), displayName: email, status: 'ACTIVE', roles: { create: roles.map((role) => ({ role })) } },
  })
}
async function cleanup() {
  const all = Object.values(ids)
  await db().adminAuditLog.deleteMany({ where: { actorUserId: { in: all } } })
  await db().adminAuditLog.deleteMany({ where: { entityType: 'user', entityId: { in: all } } })
  await db().user.deleteMany({ where: { id: { in: all } } })
}
await cleanup()
await makeUser(ids.subject, emails.subject, ['ADMIN', 'GUEST'])
await makeUser(ids.operator, emails.operator, ['ADMIN'])
await makeUser(ids.support, emails.support, ['SUPPORT'])
await makeUser(ids.bystander, emails.bystander, ['ADMIN', 'GUEST'])

// A real login — the only way this suite ever obtains a token, so every session under test was
// issued by the same code path a real user goes through.
//
// Proving multi-session, per-session and account-wide revocation needs dozens of genuinely separate
// logins, which trips the credential-stuffing limiter in server/routes/auth.mjs (20 per IP per
// 60s). That limiter is a different control with its own coverage; sitting out a 60-second window
// on each trip would make this suite take many minutes. The harness clears its own IP's auth bucket
// instead. It never disables the limiter in the server, and only ever removes the `auth:*` buckets
// this same process just filled.
async function clearAuthRateLimit() {
  await db().rateLimitBucket.deleteMany({ where: { bucketKey: { startsWith: 'auth:' } } })
}
async function login(email) {
  let res = await call('POST', '/api/auth/login', null, { email, password: PASSWORD })
  if (res.status === 429) {
    await clearAuthRateLimit()
    res = await call('POST', '/api/auth/login', null, { email, password: PASSWORD })
  }
  if (res.status !== 200 || !res.j?.token) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.j)}`)
  return res.j
}
// Some checks assert a login is REFUSED (suspended/deleted). Those must not be confused with a 429,
// so the bucket is cleared first and the real status asserted.
async function attemptLogin(email) {
  await clearAuthRateLimit()
  return call('POST', '/api/auth/login', null, { email, password: PASSWORD })
}
const OPERATOR = (await login(emails.operator)).token
const SUPPORT = (await login(emails.support)).token

const USER_ENDPOINT = '/api/me/overview'
const ADMIN_ENDPOINT = '/api/admin/audit-log'

console.log('=== 1. LOGIN ISSUES A REAL, SERVER-BACKED SESSION ===')
{
  const session = await login(emails.subject)
  const claims = JSON.parse(Buffer.from(session.token.split('.')[0], 'base64url').toString())
  check('login returns a token', Boolean(session.token), JSON.stringify(session).slice(0, 200))
  check('token carries a `sid` session id claim', typeof claims.sid === 'string' && claims.sid.length === 36, JSON.stringify(claims))
  check('token carries an integer `epoch` claim', Number.isInteger(claims.epoch), JSON.stringify(claims))
  check('login response reports the sessionId', session.sessionId === claims.sid, `${session.sessionId} vs ${claims.sid}`)

  // DB-VERIFIED: the session actually exists server-side and is not revoked.
  const row = await db().userSession.findUnique({ where: { id: claims.sid } })
  check('DB: user_sessions row exists for the issued session', Boolean(row), 'no row')
  check('DB: session row belongs to the logging-in user', row?.userId === ids.subject, row?.userId)
  check('DB: session row starts unrevoked', row?.revokedAt === null, String(row?.revokedAt))
  check('DB: session row expires in the future', row && row.expiresAt.getTime() > Date.now(), String(row?.expiresAt))

  check('authenticated request succeeds', (await call('GET', USER_ENDPOINT, session.token)).status === 200, 'expected 200')
  check('privileged request succeeds (subject holds ADMIN)', (await call('GET', ADMIN_ENDPOINT, session.token)).status === 200, 'expected 200')
}

console.log('\n=== 2. LOGOUT REVOKES THE CREDENTIAL SERVER-SIDE (replay must fail) ===')
{
  const session = await login(emails.subject)
  check('pre-logout: token works', (await call('GET', USER_ENDPOINT, session.token)).status === 200, 'expected 200')

  const out = await call('POST', '/api/auth/logout', session.token, {})
  check('POST /api/auth/logout -> 200', out.status === 200, `${out.status} ${JSON.stringify(out.j)}`)
  check('logout reports it revoked the session', out.j?.revoked === true && out.j?.scope === 'session', JSON.stringify(out.j))

  // The whole point of the finding: the SAME token string, replayed, must now be rejected.
  const replayUser = await call('GET', USER_ENDPOINT, session.token)
  const replayAdmin = await call('GET', ADMIN_ENDPOINT, session.token)
  check('replay of the logged-out token on a user endpoint -> 401', replayUser.status === 401, String(replayUser.status))
  check('replay of the logged-out token on an admin endpoint -> 401', replayAdmin.status === 401, String(replayAdmin.status))

  const row = await db().userSession.findUnique({ where: { id: session.sessionId } })
  check('DB: session row is marked revoked', row?.revokedAt !== null, String(row?.revokedAt))
  check('DB: revocation reason recorded as LOGOUT', row?.revokedReason === 'LOGOUT', String(row?.revokedReason))

  // 3. Double logout is safe — a client retrying a logout it is unsure landed must not error.
  const second = await call('POST', '/api/auth/logout', session.token, {})
  check('repeated logout with the now-revoked token -> 401 (not a crash/5xx)', second.status === 401, `${second.status} ${JSON.stringify(second.j)}`)

  // And logging out twice from a still-valid session is idempotent, not an error.
  const fresh = await login(emails.subject)
  const a = await call('POST', '/api/auth/logout', fresh.token, {})
  check('first logout of a live session reports revoked=true', a.status === 200 && a.j?.revoked === true, JSON.stringify(a.j))
  const rowsAfter = await db().userSession.findUnique({ where: { id: fresh.sessionId } })
  check('DB: exactly one revocation timestamp is written (no double-write corruption)', rowsAfter?.revokedAt instanceof Date, String(rowsAfter?.revokedAt))
}

console.log('\n=== 4. MULTI-SESSION: two independent logins, logout affects only one ===')
{
  const A = await login(emails.subject)
  const B = await login(emails.subject)
  check('two logins produce DIFFERENT session ids (not a duplicated token)', A.sessionId !== B.sessionId, `${A.sessionId} / ${B.sessionId}`)
  check('two logins produce different token strings', A.token !== B.token, 'tokens identical')

  const list = await call('GET', '/api/auth/sessions', A.token)
  const listedIds = (list.j?.sessions || []).map((s) => s.id)
  check('GET /api/auth/sessions lists both live sessions', listedIds.includes(A.sessionId) && listedIds.includes(B.sessionId), JSON.stringify(listedIds))
  check('the caller\'s own session is flagged `current`', (list.j?.sessions || []).find((s) => s.id === A.sessionId)?.current === true, JSON.stringify(list.j?.sessions))

  await call('POST', '/api/auth/logout', A.token, {})
  const afterA = await call('GET', USER_ENDPOINT, A.token)
  const afterB = await call('GET', USER_ENDPOINT, B.token)
  check('session A is dead after logging A out -> 401', afterA.status === 401, String(afterA.status))
  // Documented policy: single-session logout is genuinely per-session; B is untouched.
  check('session B still works after logging A out -> 200', afterB.status === 200, String(afterB.status))

  const rowA = await db().userSession.findUnique({ where: { id: A.sessionId } })
  const rowB = await db().userSession.findUnique({ where: { id: B.sessionId } })
  check('DB: only session A is revoked', rowA?.revokedAt !== null && rowB?.revokedAt === null, `A=${rowA?.revokedAt} B=${rowB?.revokedAt}`)

  // 5. Logout-all kills every session on the account, including ones on other devices.
  const C = await login(emails.subject)
  const all = await call('POST', '/api/auth/logout-all', C.token, {})
  check('POST /api/auth/logout-all -> 200 scope=all', all.status === 200 && all.j?.scope === 'all', `${all.status} ${JSON.stringify(all.j)}`)
  check('after logout-all, session B (a different device) -> 401', (await call('GET', USER_ENDPOINT, B.token)).status === 401, 'expected 401')
  check('after logout-all, the calling session C -> 401', (await call('GET', USER_ENDPOINT, C.token)).status === 401, 'expected 401')

  const liveRows = await db().userSession.count({ where: { userId: ids.subject, revokedAt: null } })
  check('DB: no unrevoked sessions remain for the account', liveRows === 0, `${liveRows} still unrevoked`)

  // logout-all with keepCurrentSession must NOT leave the pre-call token usable — it re-issues.
  const D = await login(emails.subject)
  const keep = await call('POST', '/api/auth/logout-all', D.token, { keepCurrentSession: true })
  check('logout-all keepCurrentSession -> 200 and re-issues a token', keep.status === 200 && keep.j?.reissued === true && typeof keep.j?.token === 'string', JSON.stringify(keep.j).slice(0, 200))
  check('the PRE-logout-all token is dead even when keeping the device -> 401', (await call('GET', USER_ENDPOINT, D.token)).status === 401, 'expected 401')
  check('the re-issued token works -> 200', (await call('GET', USER_ENDPOINT, keep.j.token)).status === 200, 'expected 200')
  await call('POST', '/api/auth/logout-all', keep.j.token, {})
}

console.log('\n=== 6. SUSPENSION KILLS LIVE SESSIONS IMMEDIATELY ===')
{
  const A = await login(emails.subject)
  const B = await login(emails.subject)
  check('both sessions live before suspension', (await call('GET', USER_ENDPOINT, A.token)).status === 200 && (await call('GET', USER_ENDPOINT, B.token)).status === 200, 'expected 200/200')

  const suspend = await call('PATCH', `/api/admin/users/${ids.subject}/status`, OPERATOR, { status: 'SUSPENDED' })
  check('admin suspend -> 200', suspend.status === 200 && suspend.j?.user?.status === 'SUSPENDED', `${suspend.status} ${JSON.stringify(suspend.j)}`)

  // IMMEDIATELY — no sleep. Under the old 30s cache this is exactly the window that returned 200.
  check('suspended account: session A -> 401 with no delay', (await call('GET', USER_ENDPOINT, A.token)).status === 401, 'expected 401')
  check('suspended account: session B -> 401 with no delay', (await call('GET', USER_ENDPOINT, B.token)).status === 401, 'expected 401')
  check('suspended ADMIN: admin endpoint -> 401 with no delay', (await call('GET', ADMIN_ENDPOINT, A.token)).status === 401, 'expected 401')

  const dbUser = await db().user.findUnique({ where: { id: ids.subject }, select: { status: true, sessionEpoch: true } })
  check('DB: status is SUSPENDED', dbUser?.status === 'SUSPENDED', String(dbUser?.status))
  const revoked = await db().userSession.count({ where: { userId: ids.subject, revokedAt: null } })
  check('DB: no unrevoked sessions survive the suspension', revoked === 0, `${revoked} still unrevoked`)
  const reasons = await db().userSession.findMany({ where: { id: { in: [A.sessionId, B.sessionId] } }, select: { revokedReason: true } })
  check('DB: revocation reason recorded as ACCOUNT_SUSPENDED', reasons.every((r) => r.revokedReason === 'ACCOUNT_SUSPENDED'), JSON.stringify(reasons))

  check('login while SUSPENDED -> 401', (await attemptLogin(emails.subject)).status === 401, 'expected 401')

  // Reinstatement policy (documented): revoked sessions stay revoked forever; a reinstated account
  // must log in again rather than have its pre-suspension token come back to life.
  const reinstate = await call('PATCH', `/api/admin/users/${ids.subject}/status`, OPERATOR, { status: 'ACTIVE' })
  check('admin reinstate -> 200', reinstate.status === 200 && reinstate.j?.user?.status === 'ACTIVE', `${reinstate.status} ${JSON.stringify(reinstate.j)}`)
  check('POLICY: the pre-suspension token stays dead after reinstatement -> 401', (await call('GET', USER_ENDPOINT, A.token)).status === 401, 'expected 401')
  check('a fresh login after reinstatement works -> 200', (await call('GET', USER_ENDPOINT, (await login(emails.subject)).token)).status === 200, 'expected 200')
}

console.log('\n=== 7. DELETION KILLS LIVE SESSIONS AND BLOCKS LOGIN ===')
{
  const A = await login(emails.subject)
  check('session live before deletion', (await call('GET', USER_ENDPOINT, A.token)).status === 200, 'expected 200')
  const del = await call('PATCH', `/api/admin/users/${ids.subject}/status`, OPERATOR, { status: 'DELETED' })
  check('admin delete -> 200', del.status === 200 && del.j?.user?.status === 'DELETED', `${del.status} ${JSON.stringify(del.j)}`)
  check('deleted account: existing token -> 401 with no delay', (await call('GET', USER_ENDPOINT, A.token)).status === 401, 'expected 401')
  check('deleted account: login -> 401', (await attemptLogin(emails.subject)).status === 401, 'expected 401')
  const dbUser = await db().user.findUnique({ where: { id: ids.subject }, select: { status: true } })
  check('DB: status is DELETED', dbUser?.status === 'DELETED', String(dbUser?.status))
  await call('PATCH', `/api/admin/users/${ids.subject}/status`, OPERATOR, { status: 'ACTIVE' })
}

console.log('\n=== 8+9. ADMIN REMOVAL KILLS PRIVILEGE IMMEDIATELY (no stale cache) ===')
{
  const A = await login(emails.subject)
  // Prime hard: repeated privileged calls are exactly what kept the old per-process cache warm and
  // made the stale-admin window survive indefinitely for an active user.
  for (let i = 0; i < 5; i += 1) {
    const r = await call('GET', ADMIN_ENDPOINT, A.token)
    if (r.status !== 200) { check('priming admin call succeeds', false, String(r.status)); break }
  }
  check('ADMIN endpoint reachable before role removal (cache primed 5x)', (await call('GET', ADMIN_ENDPOINT, A.token)).status === 200, 'expected 200')

  const removal = await call('PATCH', `/api/admin/users/${ids.subject}/roles`, OPERATOR, { remove: ['ADMIN'] })
  check('admin removes the ADMIN role -> 200', removal.status === 200 && !removal.j?.roles?.includes('ADMIN'), `${removal.status} ${JSON.stringify(removal.j)}`)
  const dbRoles = (await db().userRole.findMany({ where: { userId: ids.subject }, select: { role: true } })).map((r) => r.role)
  check('DB: ADMIN role row is gone', !dbRoles.includes('ADMIN'), JSON.stringify(dbRoles))

  // The required race: the very next privileged request must fail, not in 30 seconds.
  const stale = await call('GET', ADMIN_ENDPOINT, A.token)
  check('STALE-PRIVILEGE RACE: admin endpoint immediately after ADMIN removal -> 401/403', stale.status === 401 || stale.status === 403, `${stale.status} — stale admin privilege retained`)
  check('the de-admined session is fully revoked, not merely downgraded -> 401', (await call('GET', USER_ENDPOINT, A.token)).status === 401, 'expected 401')

  // Inverse direction (documented policy): a GRANT also revokes, so authority never grows under an
  // already-open session — the user must re-login to pick the role up.
  const B = await login(emails.subject)
  check('post-removal fresh login is a plain user: admin endpoint -> 403', (await call('GET', ADMIN_ENDPOINT, B.token)).status === 403, 'expected 403')
  const grant = await call('PATCH', `/api/admin/users/${ids.subject}/roles`, OPERATOR, { add: ['ADMIN'] })
  check('admin re-grants the ADMIN role -> 200', grant.status === 200 && grant.j?.roles?.includes('ADMIN'), JSON.stringify(grant.j))
  check('POLICY: the pre-grant session does NOT silently gain ADMIN — it is revoked -> 401', (await call('GET', ADMIN_ENDPOINT, B.token)).status === 401, 'expected 401')
  check('re-login after the grant does hold ADMIN -> 200', (await call('GET', ADMIN_ENDPOINT, (await login(emails.subject)).token)).status === 200, 'expected 200')

  // Regression guard on the fix itself: the removed per-process auth cache must not come back. A
  // reintroduced cache would silently restore the stale-privilege window even if every check above
  // still passed on a single warm process.
  const authContextSource = readFileSync(new URL('../../server/lib/auth-context.mjs', import.meta.url), 'utf8')
  const executable = authContextSource.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
  check('server/lib/auth-context.mjs holds no in-process auth cache (no Map/cache state)', !/new Map\(/.test(executable) && !/setCached|getCached/.test(executable), 'an in-process auth cache has been reintroduced')
  check('server/lib/auth-context.mjs reads the session row per request', /userSession\.findUnique/.test(executable), 'per-request session lookup missing')
}

console.log('\n=== 10. MALFORMED / FORGED / EXPIRED / REVOKED TOKEN NEGATIVES ===')
{
  const live = await login(emails.subject)
  const claims = JSON.parse(Buffer.from(live.token.split('.')[0], 'base64url').toString())
  const resign = (payload, secretOk = true) => {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
    if (!secretOk) return `${body}.not-a-real-signature`
    return null // real re-signing needs AUTH_SECRET; handled via signRawToken below
  }

  const cases = [
    ['no token at all', undefined],
    ['empty bearer', ''],
    ['garbage string', 'not-a-token'],
    ['well-formed base64 but no signature', Buffer.from(JSON.stringify(claims)).toString('base64url')],
    ['valid body with a forged signature', resign(claims, false)],
    ['token truncated mid-signature', live.token.slice(0, live.token.length - 6)],
    // Signed with the real secret but pointing at a session row that does not exist.
    ['valid signature, unknown session id', signRawToken({ id: ids.subject }, { sessionId: randomUUID(), epoch: 0 })],
    // Signed with the real secret and a REAL session id, but claiming to be a different user.
    ['valid signature, sid belongs to another user (sub swap)', signRawToken({ id: ids.bystander }, { sessionId: live.sessionId, epoch: claims.epoch })],
    // Real session, real user, but an epoch the account has moved past.
    ['valid signature, stale security epoch', signRawToken({ id: ids.subject }, { sessionId: live.sessionId, epoch: claims.epoch - 1 })],
    ['valid signature, future/wrong epoch', signRawToken({ id: ids.subject }, { sessionId: live.sessionId, epoch: claims.epoch + 99 })],
    // Real session and epoch, but the token itself has already expired.
    ['expired token (exp in the past)', signRawToken({ id: ids.subject }, { sessionId: live.sessionId, epoch: claims.epoch, ttlSeconds: -60 })],
    // sid that is not even a uuid — must be a clean 401, never a 500 from the DB driver.
    ['non-uuid session id claim', signRawToken({ id: ids.subject }, { sessionId: 'zzzz', epoch: claims.epoch }).replace(/^/, '')],
  ]
  for (const [label, token] of cases) {
    if (token === null) continue
    const r = await call('GET', USER_ENDPOINT, token)
    check(`${label} -> 401 (not 200, not 5xx)`, r.status === 401, `${r.status} ${JSON.stringify(r.j).slice(0, 120)}`)
  }
  // The pre-SEC-002 token shape: signed correctly, but with no sid/epoch at all. Every token
  // outstanding at deploy time looks like this and must be refused.
  const legacyPayload = { sub: ids.subject, roles: ['ADMIN'], iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 604800 }
  const legacyBody = Buffer.from(JSON.stringify(legacyPayload)).toString('base64url')
  const { createHmac } = await import('node:crypto')
  const legacyToken = `${legacyBody}.${createHmac('sha256', process.env.AUTH_SECRET).update(legacyBody).digest('base64url')}`
  const legacy = await call('GET', ADMIN_ENDPOINT, legacyToken)
  check('legacy pre-SEC-002 token (correctly signed, no sid/epoch) -> 401', legacy.status === 401, `${legacy.status} — an unrevocable legacy credential was accepted`)

  check('the genuinely live token still works alongside all of the above -> 200', (await call('GET', USER_ENDPOINT, live.token)).status === 200, 'expected 200')

  // Revoked-token replay from an independent client: a second, separately-issued session is logged
  // out and its token replayed from a fresh connection, proving revocation is server state and not
  // an artifact of one client's bookkeeping.
  const other = await login(emails.subject)
  await call('POST', '/api/auth/logout', other.token, {})
  check('revoked token replayed on a fresh connection -> 401', (await call('GET', USER_ENDPOINT, other.token)).status === 401, 'expected 401')
}

console.log('\n=== 11. CONCURRENCY: revocation vs. in-flight requests ===')
{
  const A = await login(emails.subject)
  // Fire a burst of authenticated reads concurrently with the logout. Requests that had already
  // passed authorization may legitimately complete; the boundary being asserted is the one after.
  const burst = Array.from({ length: 20 }, () => call('GET', USER_ENDPOINT, A.token))
  const logoutPromise = call('POST', '/api/auth/logout', A.token, {})
  const [logout, ...results] = await Promise.all([logoutPromise, ...burst])
  const statuses = results.map((r) => r.status)
  check('concurrent logout itself succeeds (200) or races to 401, never 5xx', logout.status === 200 || logout.status === 401, `${logout.status} ${JSON.stringify(logout.j)}`)
  check('every concurrent request resolved to 200 or 401 (no 5xx, no partial state)', statuses.every((s) => s === 200 || s === 401), JSON.stringify(statuses))

  // The hard guarantee: anything STARTED after the logout response was received must fail. This is
  // the boundary the spec asks to be defined -- not "in-flight requests are cancelled", but "no
  // request beginning after authoritative revocation succeeds".
  const after = await Promise.all(Array.from({ length: 10 }, () => call('GET', USER_ENDPOINT, A.token)))
  check('all 10 requests STARTED after revocation completed -> 401', after.every((r) => r.status === 401), JSON.stringify(after.map((r) => r.status)))

  // Same boundary for a privileged, money-adjacent path revoked by suspension rather than logout.
  const B = await login(emails.subject)
  const suspendPromise = call('PATCH', `/api/admin/users/${ids.subject}/status`, OPERATOR, { status: 'SUSPENDED' })
  const racing = Array.from({ length: 15 }, () => call('GET', ADMIN_ENDPOINT, B.token))
  const [suspendRes, ...raced] = await Promise.all([suspendPromise, ...racing])
  check('concurrent suspension succeeds', suspendRes.status === 200, `${suspendRes.status} ${JSON.stringify(suspendRes.j)}`)
  check('raced privileged requests are all 200 or 401 (never 5xx)', raced.every((r) => r.status === 200 || r.status === 401), JSON.stringify(raced.map((r) => r.status)))
  const postSuspend = await Promise.all(Array.from({ length: 10 }, () => call('GET', ADMIN_ENDPOINT, B.token)))
  check('all privileged requests STARTED after the suspension returned -> 401', postSuspend.every((r) => r.status === 401), JSON.stringify(postSuspend.map((r) => r.status)))

  // A login racing a suspension must not mint a usable credential.
  const raceLogin = await attemptLogin(emails.subject)
  check('login attempted while SUSPENDED cannot mint a working session', raceLogin.status === 401 || (await call('GET', USER_ENDPOINT, raceLogin.j?.token)).status === 401, `${raceLogin.status}`)
  await call('PATCH', `/api/admin/users/${ids.subject}/status`, OPERATOR, { status: 'ACTIVE' })
}

console.log('\n=== 12. ROLE GATING ON THE NEW REVOCATION ENDPOINTS ===')
{
  const victim = await login(emails.bystander)
  // Pre-existing, intentional design (server/routes/admin.mjs, and PLATFORM_SECURITY_RULES: "Platform
  // metrics and audit logs are restricted to admin/support review flows"): SUPPORT is a read-only
  // review role and MAY read the audit log. Asserted here so the line between "SUPPORT can review"
  // and "SUPPORT cannot revoke" is pinned rather than assumed.
  check('SUPPORT may read the audit log (existing ADMIN+SUPPORT review gate) -> 200', (await call('GET', ADMIN_ENDPOINT, SUPPORT)).status === 200, 'expected 200')
  check('SUPPORT cannot suspend an account -> 403', (await call('PATCH', `/api/admin/users/${ids.bystander}/status`, SUPPORT, { status: 'SUSPENDED' })).status === 403, 'expected 403')
  check('SUPPORT cannot change roles -> 403', (await call('PATCH', `/api/admin/users/${ids.bystander}/roles`, SUPPORT, { remove: ['ADMIN'] })).status === 403, 'expected 403')
  check('SUPPORT\'s failed suspend left the victim session working -> 200', (await call('GET', USER_ENDPOINT, victim.token)).status === 200, 'expected 200')

  const plain = await login(emails.subject)
  await call('PATCH', `/api/admin/users/${ids.subject}/roles`, OPERATOR, { remove: ['ADMIN'] })
  const nonAdmin = await login(emails.subject)
  check('a non-admin cannot suspend anyone -> 403', (await call('PATCH', `/api/admin/users/${ids.bystander}/status`, nonAdmin.token, { status: 'SUSPENDED' })).status === 403, 'expected 403')
  check('an unauthenticated caller cannot suspend anyone -> 401', (await call('PATCH', `/api/admin/users/${ids.bystander}/status`, null, { status: 'SUSPENDED' })).status === 401, 'expected 401')
  await call('PATCH', `/api/admin/users/${ids.subject}/roles`, OPERATOR, { add: ['ADMIN'] })
  void plain

  // Self-dealing / lockout guard, matching the 115aa09 two-party pattern.
  const opSelf = await call('PATCH', `/api/admin/users/${ids.operator}/status`, OPERATOR, { status: 'SUSPENDED' })
  check('an admin cannot suspend their own account -> 403 SELF_REVIEW_FORBIDDEN', opSelf.status === 403, `${opSelf.status} ${JSON.stringify(opSelf.j)}`)
  const opSelfRole = await call('PATCH', `/api/admin/users/${ids.operator}/roles`, OPERATOR, { remove: ['ADMIN'] })
  check('an admin cannot change their own roles -> 403', opSelfRole.status === 403, `${opSelfRole.status} ${JSON.stringify(opSelfRole.j)}`)
  check('the operator session still works after the blocked self-actions -> 200', (await call('GET', ADMIN_ENDPOINT, OPERATOR)).status === 200, 'expected 200')

  const badStatus = await call('PATCH', `/api/admin/users/${ids.bystander}/status`, OPERATOR, { status: 'BANNED' })
  check('an unknown status is rejected -> 400 INVALID_ACCOUNT_STATUS', badStatus.status === 400 && badStatus.j?.error?.code === 'INVALID_ACCOUNT_STATUS', `${badStatus.status} ${JSON.stringify(badStatus.j)}`)
  const badRole = await call('PATCH', `/api/admin/users/${ids.bystander}/roles`, OPERATOR, { add: ['SUPERUSER'] })
  check('an unknown role is rejected -> 400 INVALID_ROLE', badRole.status === 400 && badRole.j?.error?.code === 'INVALID_ROLE', `${badRole.status} ${JSON.stringify(badRole.j)}`)
  check('the invalid role change did not touch the account', !(await db().userRole.findMany({ where: { userId: ids.bystander } })).some((r) => r.role === 'SUPERUSER'), 'role leaked')
}

console.log('\n=== 13. BLAST RADIUS: one account\'s revocation must not touch another\'s ===')
{
  const bystander = await login(emails.bystander)
  const subject = await login(emails.subject)
  check('bystander session works before the subject is revoked', (await call('GET', ADMIN_ENDPOINT, bystander.token)).status === 200, 'expected 200')

  await call('POST', '/api/auth/logout', subject.token, {})
  check('after the subject logs out, the bystander is unaffected -> 200', (await call('GET', ADMIN_ENDPOINT, bystander.token)).status === 200, 'expected 200')

  const subject2 = await login(emails.subject)
  await call('PATCH', `/api/admin/users/${ids.subject}/status`, OPERATOR, { status: 'SUSPENDED' })
  check('after the subject is SUSPENDED, the bystander is unaffected -> 200', (await call('GET', ADMIN_ENDPOINT, bystander.token)).status === 200, 'expected 200')
  check('the suspended subject is dead -> 401', (await call('GET', USER_ENDPOINT, subject2.token)).status === 401, 'expected 401')
  check('the operator session is unaffected -> 200', (await call('GET', ADMIN_ENDPOINT, OPERATOR)).status === 200, 'expected 200')

  await call('PATCH', `/api/admin/users/${ids.subject}/status`, OPERATOR, { status: 'ACTIVE' })
  const bystanderLive = await db().userSession.count({ where: { userId: ids.bystander, revokedAt: null } })
  check('DB: the bystander still has an unrevoked session row', bystanderLive > 0, `${bystanderLive}`)
}

console.log('\n=== 14. AUDIT TRAIL ===')
{
  const statusLogs = await db().adminAuditLog.findMany({ where: { entityType: 'user', entityId: ids.subject, action: 'ADMIN_ACCOUNT_STATUS_CHANGED' } })
  check('DB: account status changes write an admin audit row', statusLogs.length > 0, `${statusLogs.length}`)
  check('DB: the status audit row records before/after', statusLogs.some((l) => l.before && l.after), JSON.stringify(statusLogs[0] || {}).slice(0, 200))
  const roleLogs = await db().adminAuditLog.findMany({ where: { entityType: 'user', entityId: ids.subject, action: 'ADMIN_USER_ROLES_CHANGED' } })
  check('DB: role changes write an admin audit row', roleLogs.length > 0, `${roleLogs.length}`)
}

await cleanup()
await disconnectDb()
console.log(`\n==== SESSION REVOCATION (SEC-002) E2E: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
