// STEP 5 -- module APIs part 2 (test DB only): security/audit, config, shells, command center.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { db } from '../../server/lib/prisma.mjs'
import { startApi, createStaffUser, loginAsStaff, assignRole, makeRunner, randomUUID } from './helpers/admin2-harness.mjs'

const run = randomUUID().slice(0, 8)
const api = await startApi()
const { t, summary } = makeRunner()
const p = db()
const org = await p.organization.findFirst()
const le = await p.legalEntity.findFirst({ where: { code: 'LE-9375-7649' } })
const ORG = [{ kind: 'ORGANIZATION', organizationId: org.id }]
const LE = [{ kind: 'LEGAL_ENTITY', legalEntityId: le.id }]
const plat = Object.fromEntries((await p.platform.findMany()).map((x) => [x.code, x]))
const mk = async (label, role, scopes = ORG) => { const u = await createStaffUser(label, run); await assignRole(u, role, scopes); return { u, s: await loginAsStaff(api, u) } }

const [o1, o2, str, sup, acct, rest, secu, fin] = await Promise.all([
  mk('o1', 'OWNER'), mk('o2', 'OWNER'), mk('str', 'STR_MANAGER', LE), mk('sup', 'SUPPORT_AGENT'), mk('acct', 'EXTERNAL_ACCOUNTANT'),
  mk('rest', 'RESTAURANT_OPS', LE), mk('secu', 'SECURITY_ADMIN'), mk('fin', 'FINANCE_VIEWER'),
])
const H = (x) => x.s.http

await t('security + audit: overview for security admin; denied for support; export is audited and formula-safe', async () => {
  assert.equal((await H(secu).get('/api/admin2/security/overview')).status, 200)
  assert.equal((await H(sup).get('/api/admin2/security/overview')).status, 403)
  assert.equal((await H(secu).get('/api/admin2/audit/export')).status, 403, 'read is not export')
  await H(o1).put(`/api/admin2/config/settings/general/export_probe`, { value: { a: 1 }, reason: '=1+1 formula probe' })
  const res = await fetch(`${api.base}/api/admin2/audit/export?action=config.setting_changed`, { headers: { authorization: `Bearer ${o1.s.token}` } })
  assert.equal(res.status, 200)
  const csv = await res.text()
  assert.ok(csv.includes(`"'=1+1 formula probe"`), 'formula-looking cell is neutralised')
  assert.ok(await p.adminAuditLog.findFirst({ where: { action: 'audit.export', actorUserId: o1.u.id } }))
  const ev = (await H(o1).get('/api/admin2/audit/evidence/verify')).json
  assert.equal(ev.result.ok, true, JSON.stringify(ev))
})

await t('configuration continued: optimistic version check and unknown category', async () => {
  const a = await H(o1).put(`/api/admin2/config/settings/general/probe2_${run}`, { value: { n: 1 }, reason: 'first value set' })
  assert.equal(a.status, 200); assert.equal(a.json.version, 1)
  const b = await H(o1).put(`/api/admin2/config/settings/general/probe2_${run}`, { value: { n: 2 }, reason: 'second value set', expectedVersion: 1 })
  assert.equal(b.json.version, 2)
  assert.equal((await H(o1).put(`/api/admin2/config/settings/general/probe2_${run}`, { value: { n: 3 }, reason: 'stale write try', expectedVersion: 1 })).status, 409)
  assert.equal((await H(o1).put(`/api/admin2/config/settings/nope/probe2_${run}`, { value: 1, reason: 'unknown category' })).status, 400)
  assert.equal((await H(o1).put(`/api/admin2/config/settings/general/probe2_${run}`, { value: 1, reason: 'x' })).status, 400, 'reason required')
  assert.equal((await H(sup).put(`/api/admin2/config/settings/general/probe2_${run}`, { value: 1, reason: 'support tries it' })).status, 403)
  const f = await H(o1).put('/api/admin2/config/feature-flags', { key: 'str.enabled', scopeKind: 'ORGANIZATION', enabled: true, reason: 'enable flag for test' })
  assert.equal(f.status, 200)
  // A flag cannot open a door: the accountant still cannot open the STR shell.
  assert.equal((await H(acct).get('/api/admin2/platforms/str')).status, 403)
})

await t('platform shells, health and registry: scoped, honest, audited', async () => {
  assert.equal((await H(str).get('/api/admin2/platforms/str')).status, 200)
  assert.equal((await H(str).get('/api/admin2/platforms/sr_ride')).status, 403)
  assert.equal((await H(str).get('/api/admin2/platforms/does_not_exist')).status, 404)
  const h = (await H(o1).get('/api/admin2/health')).json
  assert.equal(h.system.database.status, 'UP')
  assert.ok(h.platforms.every((x) => x.health === 'NOT_CONFIGURED' && x.dataSource === null))
  assert.equal((await H(str).patch('/api/admin2/platforms/str', { status: 'ACTIVE', reason: 'trying to self-activate' })).status, 403)
  assert.equal((await H(o1).patch('/api/admin2/platforms/cars', { status: 'NO_DATA', reason: 'no data source yet' })).status, 200)
  await H(o1).patch('/api/admin2/platforms/cars', { status: 'SETUP', reason: 'restore test state' })
})

await t('finance / tax / accountant / reports / AI shells honour their permissions and show no data', async () => {
  assert.equal((await H(fin).get('/api/admin2/finance')).json.status, 'NOT_CONFIGURED')
  assert.equal((await H(acct).get('/api/admin2/finance')).status, 403)
  assert.equal((await H(acct).get('/api/admin2/accountant')).status, 200)
  assert.equal((await H(sup).get('/api/admin2/accountant')).status, 403)
  assert.equal((await H(o1).get('/api/admin2/reports')).json.status, 'COMING_LATER')
  assert.equal((await H(sup).get('/api/admin2/ai')).status, 403)
  assert.match((await H(o1).get('/api/admin2/ai')).json.label, /HUMAN REVIEW REQUIRED/)
})

await t('command center: real counts only, tiles follow permissions, finance is NOT_AVAILABLE', async () => {
  const o = (await H(o1).get('/api/admin2/command-center')).json
  assert.ok(Number.isInteger(o.tiles.myOpenWork) && Number.isInteger(o.tiles.pendingApprovals) && Number.isInteger(o.tiles.openSupportCases))
  assert.equal(o.finance.status, 'NOT_AVAILABLE')
  const a = (await H(acct).get('/api/admin2/command-center')).json
  assert.deepEqual(Object.keys(a.tiles), [], 'accountant sees no operational tiles')
  const s = (await H(str).get('/api/admin2/command-center')).json
  assert.equal('pendingAccessApprovals' in s.tiles, false); assert.deepEqual(s.platforms.map((x) => x.code), ['str'])
})

api.stop()
const failed = summary()
await p.$disconnect()
process.exit(failed ? 1 : 0)
