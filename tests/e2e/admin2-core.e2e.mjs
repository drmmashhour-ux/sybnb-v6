// STEP 5 -- /api/admin2 core over real HTTP: authentication, deny by default, landing, context
// registry, step-up, sessions, and the admin sign-in code rule for assignment-only accounts.
//   DATABASE_URL=<TEST db> node tests/e2e/admin2-core.e2e.mjs
import assert from 'node:assert/strict'
import { db } from '../../server/lib/prisma.mjs'
import { startApi, client, createStaffUser, loginAsStaff, assignRole, makeRunner, randomUUID, PASSWORD } from './helpers/admin2-harness.mjs'

const run = randomUUID().slice(0, 8)
const api = await startApi()
const { t, summary } = makeRunner()
const p = db()
const org = await p.organization.findFirst()
const le = await p.legalEntity.findFirst({ where: { code: 'LE-9375-7649' } })

await t('unauthenticated request to any admin2 route is 401', async () => {
  const r = await client(api.base).get('/api/admin2/me')
  assert.equal(r.status, 401)
  assert.equal(r.json.error.code, 'AUTH_REQUIRED')
})

await t('unknown admin2 route is a JSON 404 and wrong method is 405 (nothing falls through)', async () => {
  const owner = await createStaffUser('owner0', run)
  await assignRole(owner, 'OWNER', [{ kind: 'ORGANIZATION', organizationId: org.id }])
  const s = await loginAsStaff(api, owner)
  assert.equal((await s.http.get('/api/admin2/nope')).status, 404)
  assert.equal((await s.http.post('/api/admin2/me')).status, 405)
})

await t('assignment-only account cannot sign in with a password alone (admin code rule)', async () => {
  const u = await createStaffUser('nocode', run)
  await assignRole(u, 'SUPPORT_AGENT', [{ kind: 'ORGANIZATION', organizationId: org.id }])
  const r = await client(api.base).post('/api/auth/login', { email: u.email, password: PASSWORD })
  assert.equal(r.status, 403)
  assert.equal(r.json.error.code, 'ADMIN_LOGIN_CODE_REQUIRED')
})

await t('an ordinary account with no assignment signs in but gets 403 from /me (deny by default)', async () => {
  const u = await createStaffUser('plain', run)
  const login = await client(api.base).post('/api/auth/login', { email: u.email, password: PASSWORD })
  assert.equal(login.status, 200)
  const r = await client(api.base, login.json.token).get('/api/admin2/me')
  assert.equal(r.status, 403)
  assert.equal(r.json.error.code, 'PERMISSION_DENIED')
})

await t('Owner: /me lists permissions, authorizes all platforms, lands on Command Center', async () => {
  const u = await createStaffUser('owner', run)
  await assignRole(u, 'OWNER', [{ kind: 'ORGANIZATION', organizationId: org.id }])
  const s = await loginAsStaff(api, u)
  const r = await s.http.get('/api/admin2/me')
  assert.equal(r.status, 200)
  assert.equal(r.json.landing.route, '/admin')
  assert.ok(r.json.permissions.includes('role.manage'))
  assert.equal(r.json.platforms.filter((x) => x.authorized).length >= 8, true)
  assert.equal(r.json.authentication.strength, 'PASSWORD_PLUS_EMAIL_CODE')
  assert.equal(JSON.stringify(r.json).includes(s.token), false, 'no token is ever echoed')
})

await t('STR manager: only STR is authorized, lands on the STR shell, context shows only their scope', async () => {
  const u = await createStaffUser('str', run)
  await assignRole(u, 'STR_MANAGER', [{ kind: 'LEGAL_ENTITY', legalEntityId: le.id }])
  const s = await loginAsStaff(api, u)
  const me = (await s.http.get('/api/admin2/me')).json
  assert.deepEqual(me.platforms.filter((x) => x.authorized).map((x) => x.code), ['str'])
  assert.equal(me.landing.route, '/admin/str')
  const ctx = (await s.http.get('/api/admin2/context')).json
  assert.deepEqual(ctx.platforms.map((x) => x.code), ['str'])
  assert.ok(ctx.legalEntities.some((x) => x.id === le.id))
})

await t('External accountant lands on the Accountant Center and sees no platforms', async () => {
  const u = await createStaffUser('acct', run)
  await assignRole(u, 'EXTERNAL_ACCOUNTANT', [{ kind: 'ORGANIZATION', organizationId: org.id }])
  const s = await loginAsStaff(api, u)
  const me = (await s.http.get('/api/admin2/me')).json
  assert.equal(me.landing.route, '/admin/accountant')
  assert.equal(me.platforms.filter((x) => x.authorized).length, 0)
})

await t('step-up: wrong password is 401, right password records step_up_at, audit written', async () => {
  const u = await createStaffUser('stepup', run)
  await assignRole(u, 'OWNER', [{ kind: 'ORGANIZATION', organizationId: org.id }])
  const s = await loginAsStaff(api, u)
  const bad = await s.http.post('/api/admin2/step-up', { password: 'wrong-password' })
  assert.equal(bad.status, 401)
  const good = await s.http.post('/api/admin2/step-up', { password: PASSWORD })
  assert.equal(good.status, 200)
  const row = await p.userSession.findUnique({ where: { id: s.sessionId } })
  assert.ok(row.stepUpAt)
  const audit = await p.adminAuditLog.findMany({ where: { actorUserId: u.id, action: { startsWith: 'security.step_up' } } })
  assert.deepEqual(audit.map((a) => a.action).sort(), ['security.step_up_failed', 'security.step_up_succeeded'])
  assert.ok(audit.every((a) => a.correlationId), 'correlation id recorded')
})

await t('own sessions: listed without tokens, other session revocable, current session protected', async () => {
  const u = await createStaffUser('sess', run)
  await assignRole(u, 'SUPPORT_AGENT', [{ kind: 'ORGANIZATION', organizationId: org.id }])
  const a = await loginAsStaff(api, u)
  const b = await loginAsStaff(api, u)
  const list = await a.http.get('/api/admin2/sessions')
  assert.equal(list.status, 200)
  assert.equal(list.json.sessions.length, 2)
  assert.equal(list.text.includes(a.token) || list.text.includes(b.token), false)
  assert.equal((await a.http.post(`/api/admin2/sessions/${a.sessionId}/revoke`)).status, 400)
  assert.equal((await a.http.post(`/api/admin2/sessions/${b.sessionId}/revoke`)).status, 200)
  assert.equal((await b.http.get('/api/admin2/me')).status, 401, 'revoked session is rejected immediately')
})

await t('a user cannot revoke someone else\'s session', async () => {
  const u1 = await createStaffUser('s1', run); await assignRole(u1, 'SUPPORT_AGENT', [{ kind: 'ORGANIZATION', organizationId: org.id }])
  const u2 = await createStaffUser('s2', run); await assignRole(u2, 'SUPPORT_AGENT', [{ kind: 'ORGANIZATION', organizationId: org.id }])
  const a = await loginAsStaff(api, u1); const b = await loginAsStaff(api, u2)
  assert.equal((await a.http.post(`/api/admin2/sessions/${b.sessionId}/revoke`)).status, 404)
})

await t('suspended user is refused on the next request (session epoch honoured)', async () => {
  const u = await createStaffUser('susp', run)
  await assignRole(u, 'OWNER', [{ kind: 'ORGANIZATION', organizationId: org.id }])
  const s = await loginAsStaff(api, u)
  assert.equal((await s.http.get('/api/admin2/me')).status, 200)
  await p.user.update({ where: { id: u.id }, data: { status: 'SUSPENDED', sessionEpoch: { increment: 1 } } })
  assert.equal((await s.http.get('/api/admin2/me')).status, 401)
})

await t('expired assignment: the session still works but /me is denied', async () => {
  const u = await createStaffUser('expired', run)
  await assignRole(u, 'OWNER', [{ kind: 'ORGANIZATION', organizationId: org.id }])
  const s = await loginAsStaff(api, u)
  const a = await p.roleAssignment.findFirst({ where: { userId: u.id } })
  await p.roleAssignment.update({ where: { id: a.id }, data: { status: 'EXPIRED' } })
  assert.equal((await s.http.get('/api/admin2/me')).status, 403)
})

api.stop()
const failed = summary()
await p.$disconnect()
process.exit(failed ? 1 : 0)
