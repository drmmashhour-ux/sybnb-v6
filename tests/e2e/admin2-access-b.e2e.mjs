// STEP 5 -- Users & Access API (part 2: role versions, service accounts, catalogue) (test DB only).
import assert from 'node:assert/strict'
import { db } from '../../server/lib/prisma.mjs'
import { startApi, createStaffUser, loginAsStaff, assignRole, makeRunner, randomUUID } from './helpers/admin2-harness.mjs'

const run = randomUUID().slice(0, 8)
const api = await startApi()
const { t, summary } = makeRunner()
const p = db()
const org = await p.organization.findFirst()
const ORG = [{ kind: 'ORGANIZATION', organizationId: org.id }]
const mk = async (label, role) => { const u = await createStaffUser(label, run); if (role) await assignRole(u, role, ORG); return u }

const [owner1, owner2, owner3, secUser, supUser] = await Promise.all([mk('o1', 'OWNER'), mk('o2', 'OWNER'), mk('o3', 'OWNER'), mk('sec', 'SECURITY_ADMIN'), mk('sup', 'SUPPORT_AGENT')])
const [o1, o2, o3, sec, sup] = await Promise.all([owner1, owner2, owner3, secUser, supUser].map((u) => loginAsStaff(api, u)))

await p.$executeRawUnsafe(`UPDATE role_versions SET status = 'WITHDRAWN' WHERE status = 'DRAFT' AND role_id = (SELECT id FROM roles WHERE code = 'SUPPORT_AGENT')`) // hygiene: a previous failed run may have left a draft
await t('role version lifecycle: draft -> review -> activate with three different people; no in-place edit', async () => {
  const detail = (await o1.http.get('/api/admin2/access/roles/SUPPORT_AGENT')).json
  const eff = detail.versions.find((v) => v.status === 'EFFECTIVE')
  const codes = eff.permissions.map((x) => x.code)
  const toggle = 'party.manage'
  const next = codes.includes(toggle) ? codes.filter((c) => c !== toggle) : [...codes, toggle]
  // mixed change (add one, remove another) is refused
  const extra = (await o1.http.get('/api/admin2/access/permissions')).json.permissions.find((x) => !codes.includes(x.code) && !x.highRisk && !x.deprecated).code
  const mixed = await o1.http.post('/api/admin2/access/roles/SUPPORT_AGENT/versions', { permissions: [...codes.slice(1), extra], reason: 'mixed change attempt' })
  assert.equal(mixed.status, 400); assert.equal(mixed.json.error.code, 'MIXED_CHANGE_REJECTED')
  const draft = await o1.http.post('/api/admin2/access/roles/SUPPORT_AGENT/versions', { permissions: next, reason: 'tighten internal comments' })
  assert.equal(draft.status, 201, draft.text)
  const id = draft.json.version.id
  assert.equal((await o1.http.post('/api/admin2/access/roles/SUPPORT_AGENT/versions', { permissions: next, reason: 'second concurrent draft' })).status, 409)
  assert.equal((await o1.http.post(`/api/admin2/access/role-versions/${id}/activate`, { reason: 'skip the review steps' })).status, 409)
  assert.equal((await o1.http.post(`/api/admin2/access/role-versions/${id}/submit`, { reason: 'ready for review' })).status, 200)
  assert.equal((await o1.http.post(`/api/admin2/access/role-versions/${id}/review`, { reason: 'reviewing my own work' })).status, 400, 'author cannot review')
  assert.equal((await o2.http.post(`/api/admin2/access/role-versions/${id}/review`, { reason: 'reviewed the diff' })).status, 200)
  assert.equal((await o2.http.post(`/api/admin2/access/role-versions/${id}/activate`, { reason: 'reviewer activating' })).status, 400, 'reviewer cannot activate')
  assert.equal((await o1.http.post(`/api/admin2/access/role-versions/${id}/activate`, { reason: 'author activating' })).status, 400, 'author cannot activate')
  assert.equal((await o3.http.post(`/api/admin2/access/role-versions/${id}/activate`, { reason: 'independent approval' })).status, 200)
  const after = (await o1.http.get('/api/admin2/access/roles/SUPPORT_AGENT')).json
  assert.equal(after.versions.filter((v) => v.status === 'EFFECTIVE').length, 1)
  assert.equal(after.versions.find((v) => v.id === eff.id).status, 'SUPERSEDED')
  // existing assignments stay pinned to the version they were granted under
  const still = await p.roleAssignment.findFirst({ where: { userId: supUser.id }, orderBy: { createdAt: 'asc' }, include: { roleVersion: true } })
  assert.ok(still.roleVersion.versionNumber <= eff.versionNumber)
})

await t('service accounts: only secret REFERENCES accepted, never echoed back; disable works', async () => {
  const bad = await o1.http.post('/api/admin2/access/service-accounts', { name: 'bad-secret', secretRef: 'sk_live_abcdef1234567890', reason: 'register integration' })
  assert.equal(bad.status, 400)
  const ok = await o1.http.post('/api/admin2/access/service-accounts', { name: `svc-${run}`, secretRef: 'vault://sybnb/test/svc', permissionCodes: ['work.view'], reason: 'register integration' })
  assert.equal(ok.status, 201, ok.text)
  const list = await o1.http.get('/api/admin2/access/service-accounts')
  assert.equal(list.text.includes('vault://'), false)
  assert.equal((await o1.http.post(`/api/admin2/access/service-accounts/${ok.json.id}/disable`, { reason: 'no longer used' })).status, 200)
})

await t('permissions catalogue + scope registry load from the database', async () => {
  const perms = (await o1.http.get('/api/admin2/access/permissions')).json.permissions
  assert.ok(perms.length >= 64 && perms.every((x) => x.tier >= 1 && x.tier <= 4))
  const sc = (await o1.http.get('/api/admin2/access/scopes')).json
  assert.ok(sc.platforms.length >= 8 && sc.legalEntities.some((x) => x.code === 'LE-9375-7649'))
})

api.stop()
const failed = summary()
await p.$disconnect()
process.exit(failed ? 1 : 0)
