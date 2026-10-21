// STEP 5K -- organization boundary for access administration (grant escalation, Command Center tile, users list), over REAL HTTP
// against a real database with two organizations.
//
//   DATABASE_URL=<THROWAWAY TEST db, migrated through 083 and seeded> node tests/e2e/admin2-org-boundary-p3.e2e.mjs
//
// NOTE: creates a second ORGANIZATION that cannot be deleted afterwards. Run it only on a throwaway database.
import assert from 'node:assert/strict'
import { db } from '../../server/lib/prisma.mjs'
import { startApi, createStaffUser, loginAsStaff, assignRole, makeRunner, randomUUID, assertTestDatabase } from './helpers/admin2-harness.mjs'

assertTestDatabase()
const run = randomUUID().slice(0, 8)
const p = db()
const { t, summary } = makeRunner()

const orgA = await p.organization.findFirst({ orderBy: { createdAt: 'asc' } })
assert.ok(orgA, 'the test database must be seeded')
const orgB = await p.organization.create({ data: { code: `E2E-P3-${run}`, name: `E2E P3 organization B ${run}` } })
const A = orgA.id; const B = orgB.id
const inOrg = (id) => [{ kind: 'ORGANIZATION', organizationId: id }]

// A custom role that may administer access but holds nothing else.
const permIds = async (codes) => (await p.permissionDefinition.findMany({ where: { code: { in: codes } } })).map((x) => x.id)
const granter = await p.role.create({ data: { code: `E2E_GRANTER_${run}`, name: `E2E granter ${run}`, description: 'access administration only (test)' } })
const granterVersion = await p.roleVersion.create({
  data: { roleId: granter.id, versionNumber: 1, status: 'DRAFT', contentHash: `e2e-${run}`, changeReason: 'e2e', platformCoverage: ['*'] },
})
const granterPerms = await permIds(['access.assign', 'access.view', 'user.view', 'console.access'])
await p.roleVersionPermission.createMany({ data: granterPerms.map((permissionId) => ({ roleVersionId: granterVersion.id, permissionId })) })
await p.roleVersion.update({ where: { id: granterVersion.id }, data: { status: 'EFFECTIVE', effectiveFrom: new Date(Date.now() - 86_400_000) } })

const ownerA = await createStaffUser('ownera', run); await assignRole(ownerA, 'OWNER', inOrg(A))
const ownerB = await createStaffUser('ownerb', run); await assignRole(ownerB, 'OWNER', inOrg(B))
// G administers access in A and in B, but holds support permissions (SUPPORT_AGENT) ONLY in A.
const g = await createStaffUser('granter', run)
for (const o of [A, B]) await p.roleAssignment.create({ data: { userId: g.id, roleVersionId: granterVersion.id, grantReason: 'e2e', scopes: { create: inOrg(o) } } })
await assignRole(g, 'SUPPORT_AGENT', inOrg(A))

const api = await startApi()
const sA = await loginAsStaff(api, ownerA)
const sB = await loginAsStaff(api, ownerB)
const sG = await loginAsStaff(api, g)
const base = '/api/admin2'

await t('escalation: a role may only be granted where the caller holds all of its permissions (A: allowed, B: refused)', async () => {
  const inA = await createStaffUser('targeta', run)
  const inB = await createStaffUser('targetb', run)
  const okA = await sG.http.post(`${base}/access/assignments`, { userId: inA.id, roleCode: 'SUPPORT_AGENT', scopes: inOrg(A), reason: 'granter holds support permissions in A' })
  assert.ok([200, 201].includes(okA.status), `grant inside A should work, got ${okA.status} ${okA.text.slice(0, 200)}`)
  const badB = await sG.http.post(`${base}/access/assignments`, { userId: inB.id, roleCode: 'SUPPORT_AGENT', scopes: inOrg(B), reason: 'granter holds support permissions only in A' })
  assert.equal(badB.status, 400, badB.text.slice(0, 200))
  assert.equal(badB.json?.error?.code ?? badB.json?.code, 'ESCALATION_FORBIDDEN')
  assert.equal(await p.roleAssignment.count({ where: { userId: inB.id } }), 0, 'nothing was created in B')
})

await t('Command Center: the pending-access-approvals tile counts only the caller\'s organization', async () => {
  const read = async (s) => (await s.http.get(`${base}/command-center`)).json.tiles.pendingAccessApprovals
  const beforeA = await read(sA)
  const beforeB = await read(sB)
  const pendingUser = await createStaffUser('pendingb', run)
  await assignRole(pendingUser, 'SUPPORT_AGENT', inOrg(B), { status: 'PENDING_APPROVAL' })
  assert.equal(await read(sA), beforeA, 'A does not see B\'s pending approval')
  assert.equal(await read(sB), (beforeB ?? 0) + 1, 'B sees its own')
})

await t('users list: a user is shown to A with A\'s roles only, and B-only users are absent', async () => {
  const both = await createStaffUser('both', run)
  await assignRole(both, 'SUPPORT_AGENT', inOrg(A))
  await assignRole(both, 'SUPPORT_AGENT', inOrg(B))
  const onlyB = await createStaffUser('onlyb', run)
  await assignRole(onlyB, 'SUPPORT_AGENT', inOrg(B))
  const list = await sA.http.get(`${base}/access/users?pageSize=100&q=${run}`)
  assert.equal(list.status, 200)
  const byId = new Map(list.json.items.map((u) => [u.id, u]))
  assert.ok(byId.has(both.id) && !byId.has(onlyB.id))
  assert.equal(byId.get(both.id).roles.length, 1, 'only the grant inside A is shown')
  const listB = await sB.http.get(`${base}/access/users?pageSize=100&q=${run}`)
  const idsB = new Set(listB.json.items.map((u) => u.id))
  assert.ok(idsB.has(both.id) && idsB.has(onlyB.id))
  assert.equal(listB.json.items.find((u) => u.id === both.id).roles.length, 1)
})

api.stop()
const failed = summary()
await p.$disconnect()
process.exit(failed ? 1 : 0)
