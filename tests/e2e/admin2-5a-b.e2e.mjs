// STEP 5A (part 2) -- role versions (25), retention (26), security events; real HTTP, test DB only.
import assert from 'node:assert/strict'
import { db } from '../../server/lib/prisma.mjs'
import { runActivationCycle } from '../../server/lib/authz/activation-worker.mjs'
import { startApi, createStaffUser, loginAsStaff, assignRole, assignRoleVersion, makeRunner, randomUUID, client, PASSWORD } from './helpers/admin2-harness.mjs'

const run = randomUUID().slice(0, 8)
const api = await startApi()
const { t, summary } = makeRunner()
const p = db()
const org = await p.organization.findFirst()
const ORG = [{ kind: 'ORGANIZATION', organizationId: org.id }]
const str = await p.platform.findUnique({ where: { code: 'str' } })
const mk = async (label, role) => { const u = await createStaffUser(label, run); if (role) await assignRole(u, role, ORG); return u }
const A = '/api/admin2/access'

const [owner1, owner2, owner3, secUser, superUser] = await Promise.all([mk('o1', 'OWNER'), mk('o2', 'OWNER'), mk('o3', 'OWNER'), mk('sec', 'SECURITY_ADMIN'), mk('sup', 'SUPER_ADMIN')])
const [o1, o2, o3, sec, sup] = await Promise.all([owner1, owner2, owner3, secUser, superUser].map((u) => loginAsStaff(api, u)))

await t('25: holders stay pinned to v1; v2 expansion never migrates silently; migration goes through the high-risk workflow', async () => {
  const old = await mk('rv1')
  const pinned = await assignRoleVersion(old, 'OWNER', 1, ORG)
  const oldS = await loginAsStaff(api, old)
  const d = await o1.http.get(`${A}/users/${old.id}`)
  assert.ok(!d.json.effectivePermissions.includes('access.approve'), 'v1 holder does not receive v2 permissions')
  assert.equal((await oldS.http.post(`${A}/assignments/${pinned.id}/approve`, { reason: 'no authority to approve' })).status, 403)
  const rv = (await o1.http.get(`${A}/roles/OWNER`)).json
  assert.ok(rv.versions.some((v) => v.versionNumber === 1 && v.status === 'SUPERSEDED'), 'old version preserved and queryable')
  const v2 = rv.versions.find((v) => v.versionNumber === 2)
  const m = await o1.http.post(`${A}/assignments/${pinned.id}/migrate`, { targetVersionId: v2.id, reason: 'move owner to the new version' })
  assert.equal(m.status, 201, m.text)
  assert.equal(m.json.assignment.status, 'PENDING_APPROVAL'); assert.equal(m.json.needsSecondApproval, true)
  assert.equal((await p.roleAssignment.findUnique({ where: { id: pinned.id } })).status, 'ACTIVE', 'v1 stays in force until v2 is active')
  const nid = m.json.assignment.id
  assert.equal((await o2.http.post(`${A}/assignments/${nid}/review`, { reason: 'migration reviewed' })).status, 200)
  assert.equal((await o3.http.post(`${A}/assignments/${nid}/approve`, { reason: 'migration approved' })).status, 200)
  await p.$executeRaw`UPDATE role_assignments SET activation_at = now() - interval '1 minute' WHERE id = ${nid}::uuid`
  await runActivationCycle(p)
  assert.equal((await p.roleAssignment.findUnique({ where: { id: nid } })).status, 'ACTIVE')
  assert.equal((await p.roleAssignment.findUnique({ where: { id: pinned.id } })).status, 'SUPERSEDED')
})

await t('25: a REDUCING version moves holders at once; the old version stays queryable', async () => {
  // A throwaway role per run keeps this test repeatable (published versions can never be edited or removed).
  const code = `TST_${run}`
  const perms = await p.permissionDefinition.findMany({ where: { code: { in: ['console.access', 'work.view', 'comment.write', 'search.use'] } } })
  const role = await p.role.create({ data: { code, name: `Test ${run}`, description: 'step 5a test role' } })
  const rv1 = await p.roleVersion.create({ data: { roleId: role.id, versionNumber: 1, status: 'DRAFT', classification: 'INITIAL', platformCoverage: ['*'], contentHash: `h-${run}`, changeReason: 'test role', changeReference: 'STEP5A-TEST' } })
  await p.roleVersionPermission.createMany({ data: perms.map((x) => ({ roleVersionId: rv1.id, permissionId: x.id })) })
  await p.roleVersion.update({ where: { id: rv1.id }, data: { status: 'EFFECTIVE', effectiveFrom: new Date() } })
  const holder = await mk('red1')
  const a = await assignRole(holder, code, ORG)
  const draft = await o1.http.post(`${A}/roles/${code}/versions`, { permissions: ['console.access', 'work.view', 'search.use'], reason: 'remove internal comments' })
  assert.equal(draft.status, 201, draft.text)
  assert.equal(draft.json.version.classification, 'REDUCING')
  const id = draft.json.version.id
  assert.equal((await o1.http.post(`${A}/role-versions/${id}/submit`, { reason: 'ready for review' })).status, 200)
  assert.equal((await o2.http.post(`${A}/role-versions/${id}/review`, { reason: 'diff reviewed' })).status, 200)
  const act = await o3.http.post(`${A}/role-versions/${id}/activate`, { reason: 'independent approval' })
  assert.equal(act.status, 200, act.text)
  assert.ok(act.json.autoMigrated.migrated >= 1)
  assert.equal((await p.roleAssignment.findUnique({ where: { id: a.id } })).status, 'SUPERSEDED')
  const now = await p.roleAssignment.findFirst({ where: { userId: holder.id, status: 'ACTIVE' }, include: { roleVersion: true, scopes: true } })
  assert.equal(now.roleVersion.versionNumber, 2); assert.equal(now.scopes.length, 1)
  assert.equal((await p.roleVersion.findUnique({ where: { id: rv1.id } })).status, 'SUPERSEDED')
  // an EXPANDING version (adds a permission) does not move anyone
  const draft2 = await o1.http.post(`${A}/roles/${code}/versions`, { permissions: ['console.access', 'work.view', 'search.use', 'comment.write'], reason: 'restore internal comments' })
  assert.equal(draft2.status, 201, draft2.text)
  assert.equal(draft2.json.version.classification, 'EXPANDING_ORDINARY')
  const id2 = draft2.json.version.id
  await o1.http.post(`${A}/role-versions/${id2}/submit`, { reason: 'ready for review' })
  await o2.http.post(`${A}/role-versions/${id2}/review`, { reason: 'diff reviewed' })
  const act2 = await o3.http.post(`${A}/role-versions/${id2}/activate`, { reason: 'independent approval' })
  assert.equal(act2.status, 200, act2.text)
  assert.equal(act2.json.autoMigrated.migrated, 0)
  assert.equal((await p.roleAssignment.findUnique({ where: { id: now.id } })).status, 'ACTIVE', 'expansion never migrates holders silently')
})

await t('26: retention metadata >= 7 years everywhere; nothing can be deleted, shortened or purged; deactivation keeps evidence', async () => {
  const floor = Date.now() + (7 * 365 - 2) * 86_400_000
  for (const [name, row] of [
    ['security_events', await p.securityEvent.findFirst()], ['user_suspensions', await p.userSuspension.findFirst()],
    ['role_assignments', await p.roleAssignment.findFirst()], ['authorization_evidence', await p.authorizationEvidence.findFirst()],
    ['admin_audit_logs', await p.adminAuditLog.findFirst({ orderBy: { createdAt: 'desc' } })], ['role_versions', await p.roleVersion.findFirst()],
    ['role_assignment_events', await p.roleAssignmentEvent.findFirst()],
  ]) { assert.ok(row.retainUntil.getTime() >= floor, `${name} retain_until >= 7y`); assert.ok(row.retentionCategory) }
  const rejects = async (sql) => { await assert.rejects(p.$executeRawUnsafe(sql)) }
  await rejects(`DELETE FROM security_events`)
  await rejects(`DELETE FROM user_suspensions`)
  await rejects(`DELETE FROM authorization_evidence`)
  await rejects(`DELETE FROM admin_audit_logs`)
  await rejects(`DELETE FROM role_assignments`)
  await rejects(`DELETE FROM role_assignment_events`)
  await rejects(`UPDATE security_events SET retain_until = now()`)
  await rejects(`UPDATE role_assignments SET retain_until = now()`)
  await rejects(`UPDATE role_versions SET retain_until = now()`)
  await rejects(`UPDATE security_events SET summary = 'tampered'`)
  await rejects(`UPDATE retention_policies SET years = 1`)
  await rejects(`UPDATE retention_policies SET min_years = 1`)
  await rejects(`DELETE FROM retention_policies`)
  await rejects(`INSERT INTO retention_policies (category, min_years, years, description) VALUES ('X', 3, 3, 'short')`)
  // ordinary admins have no delete surface at all
  for (const path of ['/api/admin2/security/events/x', '/api/admin2/audit/events/x', '/api/admin2/access/assignments/x']) assert.ok([404, 405].includes((await o1.http.delete(path)).status), path)
  // deactivating a user keeps every historical row queryable
  const u = await mk('ret1', 'SUPPORT_AGENT')
  const sess = await loginAsStaff(api, u)
  await sess.http.get('/api/admin2/me')
  const cnt = async () => ({ ev: await p.authorizationEvidence.count({ where: { userId: u.id } }), as: await p.roleAssignment.count({ where: { userId: u.id } }) })
  const before = await cnt()
  assert.equal((await o1.http.post(`${A}/users/${u.id}/suspend`, { reason: 'deactivation retention test' })).status, 200)
  const after = await cnt()
  assert.deepEqual(after, before)
  assert.equal((await o1.http.get(`/api/admin2/audit/events?entityId=${u.id}`)).json.items.length >= 1, true)
})

await t('security events: severities, review, and an ordinary admin cannot read them', async () => {
  const list = await o1.http.get('/api/admin2/security/events?severity=CRITICAL')
  assert.equal(list.status, 200)
  assert.ok(list.json.items.length >= 1 && list.json.items.every((e) => e.severity === 'CRITICAL'))
  const id = list.json.items[0].id
  assert.equal((await sup.http.post(`/api/admin2/security/events/${id}/review`, { note: 'super admin has no review authority' })).status, 403)
  assert.equal((await sec.http.post(`/api/admin2/security/events/${id}/review`, { note: 'reviewed by security admin' })).status, 200)
  const e = await p.securityEvent.findUnique({ where: { id } })
  assert.equal(e.status, 'REVIEWED'); assert.equal(e.reviewedById, secUser.id)
  const bg = await o1.http.post('/api/admin2/security/break-glass/request', { reason: 'database unreachable and owner locked out' })
  assert.equal(bg.status, 201, bg.text)
  assert.equal(bg.json.grantsAccess, false)
  assert.equal((await p.securityEvent.findUnique({ where: { id: bg.json.securityEventId } })).severity, 'CRITICAL')
})

api.stop()
const failed = summary()
await p.$disconnect()
process.exit(failed ? 1 : 0)
