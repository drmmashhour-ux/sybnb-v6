// STEP 5E (test DB only): the Owner bootstrap organization comes ONLY from trusted context (the caller's own Owner
// assignments). Cross-organization, no-Owner, platform-only and multi-organization cases.
process.env.ADMIN_BOOTSTRAP_SECRET = 'test-bootstrap-secret-0123456789abcdef0123'
import assert from 'node:assert/strict'
import { db } from '../../server/lib/prisma.mjs'
import { startApi, createStaffUser, loginAsStaff, assignRoleVersion, makeRunner, randomUUID } from './helpers/admin2-harness.mjs'
import { completeOwnerBootstrap, resolveBootstrapOrganization, BOOTSTRAP_COMPLETED, BOOTSTRAP_REQUIRED } from '../../server/lib/authz/bootstrap.mjs'

const run = randomUUID().slice(0, 8)
const { t, summary } = makeRunner()
const p = db()
const SECRET = process.env.ADMIN_BOOTSTRAP_SECRET
const mkOrg = (tag) => p.organization.create({ data: { code: `T5E${tag}${run}`.slice(0, 30), name: `t5e ${tag} ${run}` } })
const scope = (org) => [{ kind: 'ORGANIZATION', organizationId: org.id }]
const state = async (org) => (await p.securityBootstrap.findUnique({ where: { organizationId: org.id } })).state
const events = (org) => p.securityEvent.count({ where: { entityId: org.id, eventType: { startsWith: 'OWNER_BOOTSTRAP' } } })
const errCode = (r) => r.json?.error?.code ?? r.json?.code
const REASON = 'initial Owner security bootstrap for the organization'

await p.rateLimitBucket.deleteMany({ where: { bucketKey: { contains: 'admin2-bootstrap' } } }) // test hygiene: per-IP counters persist across runs
const api = await startApi({ ADMIN_ACTIVATION_JOB: 'off' })
try {
  await t('A: an Owner of A who names organization B (query, body, header) only ever acts on A; B is untouched', async () => {
    const A = await mkOrg('A'); const B = await mkOrg('B'); const u = await createStaffUser('ownera', run)
    await assignRoleVersion(u, 'OWNER', 1, scope(A))
    assert.deepEqual(await resolveBootstrapOrganization(p, u.id), { organizationId: A.id, reason: null })
    const s = await loginAsStaff(api, u)
    const r = await s.http.call('POST', `/api/admin2/security/bootstrap/owner?organizationId=${B.id}&organization_id=${B.id}&org=${B.id}`,
      { reason: REASON, organizationId: B.id, organization_id: B.id }, { 'x-bootstrap-secret': SECRET, 'x-organization-id': B.id, 'x-org-id': B.id })
    assert.equal(r.status, 201, r.text.slice(0, 200))
    assert.equal(r.json?.data?.organizationId ?? r.json?.organizationId, A.id, 'the response confirms organization A')
    assert.equal(await state(A), BOOTSTRAP_COMPLETED); assert.equal(await state(B), BOOTSTRAP_REQUIRED, 'B is untouched')
    assert.equal(await events(B), 0, 'no bootstrap event, denial or completion was recorded against B')
  })

  await t('B: the same holds for the read endpoint (query parameter ignored)', async () => {
    const A = await mkOrg('A2'); const B = await mkOrg('B2'); const u = await createStaffUser('ownera2', run)
    await assignRoleVersion(u, 'OWNER', 1, scope(A))
    const s = await loginAsStaff(api, u)
    const r = await s.http.get(`/api/admin2/security/bootstrap?organizationId=${B.id}`)
    assert.equal(r.status, 200)
    assert.equal((r.json?.data ?? r.json).organizationId, A.id)
  })

  await t('C: a user with no Owner assignment cannot bootstrap (plain denial, nothing recorded, nothing changed)', async () => {
    const A = await mkOrg('N'); const u = await createStaffUser('noowner', run)
    assert.equal((await resolveBootstrapOrganization(p, u.id)).reason, 'NO_OWNER_ORGANIZATION')
    const s = await loginAsStaff(api, u)
    const r = await s.http.call('POST', `/api/admin2/security/bootstrap/owner?organizationId=${A.id}`, { reason: REASON, organizationId: A.id }, { 'x-bootstrap-secret': SECRET })
    assert.equal(r.status, 403); assert.equal(errCode(r), 'PERMISSION_DENIED')
    assert.equal(await state(A), BOOTSTRAP_REQUIRED)
    // service level too: the bootstrap's own eligibility check refuses a non-Owner
    await assert.rejects(completeOwnerBootstrap(p, { actorUserId: u.id, organizationId: A.id, reason: REASON, operatorSecret: SECRET, authStrength: 'PASSWORD_PLUS_EMAIL_CODE' }), (e) => e.code === 'NOT_LEGITIMATE_OWNER')
    assert.equal(await state(A), BOOTSTRAP_REQUIRED)
  })

  await t('D: an Owner with only PLATFORM scope cannot bootstrap organization security', async () => {
    const A = await mkOrg('P'); const u = await createStaffUser('platformowner', run)
    const platform = await p.platform.findFirst()
    assert.ok(platform, 'a platform exists in the registry')
    await assignRoleVersion(u, 'OWNER', 1, [{ kind: 'PLATFORM', platformId: platform.id }])
    assert.equal((await resolveBootstrapOrganization(p, u.id)).reason, 'NO_OWNER_ORGANIZATION')
    const s = await loginAsStaff(api, u)
    const r = await s.http.call('POST', '/api/admin2/security/bootstrap/owner', { reason: REASON }, { 'x-bootstrap-secret': SECRET })
    assert.equal(r.status, 403); assert.equal(errCode(r), 'PERMISSION_DENIED')
    await assert.rejects(completeOwnerBootstrap(p, { actorUserId: u.id, organizationId: A.id, reason: REASON, operatorSecret: SECRET, authStrength: 'PASSWORD_PLUS_EMAIL_CODE' }), (e) => e.code === 'NOT_LEGITIMATE_OWNER')
    assert.equal(await state(A), BOOTSTRAP_REQUIRED)
  })

  await t('E: an Owner assignment from another organization does not satisfy eligibility (service level, even with a valid secret and strong auth)', async () => {
    const mine = await mkOrg('M'); const other = await mkOrg('O'); const u = await createStaffUser('crossorg', run)
    await assignRoleVersion(u, 'OWNER', 1, scope(mine))
    const before = await events(other)
    await assert.rejects(completeOwnerBootstrap(p, { actorUserId: u.id, organizationId: other.id, reason: REASON, operatorSecret: SECRET, authStrength: 'PASSWORD_PLUS_EMAIL_CODE' }), (e) => e.code === 'NOT_LEGITIMATE_OWNER')
    assert.equal(await state(other), BOOTSTRAP_REQUIRED); assert.equal(await state(mine), BOOTSTRAP_REQUIRED)
    assert.ok(await events(other) > before, 'the refused cross-organization attempt is recorded against the targeted organization')
  })

  await t('F: an Owner of several organizations gets ORGANIZATION_CONTEXT_REQUIRED (no selector exists); nothing changes', async () => {
    const F = await mkOrg('F'); const G = await mkOrg('G'); const u = await createStaffUser('multi', run)
    await assignRoleVersion(u, 'OWNER', 1, [...scope(F), ...scope(G)])
    assert.equal((await resolveBootstrapOrganization(p, u.id)).reason, 'ORGANIZATION_CONTEXT_REQUIRED')
    const s = await loginAsStaff(api, u)
    const r = await s.http.call('POST', `/api/admin2/security/bootstrap/owner?organizationId=${F.id}`, { reason: REASON, organizationId: F.id }, { 'x-bootstrap-secret': SECRET, 'x-organization-id': F.id })
    assert.equal(r.status, 409); assert.equal(errCode(r), 'ORGANIZATION_CONTEXT_REQUIRED')
    assert.equal(await state(F), BOOTSTRAP_REQUIRED); assert.equal(await state(G), BOOTSTRAP_REQUIRED)
  })

  await t('G: after completion the Owner of A still resolves A and is told BOOTSTRAP_CLOSED, whatever organization the request names', async () => {
    const A = await mkOrg('Z'); const B = await mkOrg('Y'); const u = await createStaffUser('closedowner', run)
    await assignRoleVersion(u, 'OWNER', 1, scope(A))
    const s = await loginAsStaff(api, u)
    assert.equal((await s.http.call('POST', '/api/admin2/security/bootstrap/owner', { reason: REASON }, { 'x-bootstrap-secret': SECRET })).status, 201)
    const r = await s.http.call('POST', `/api/admin2/security/bootstrap/owner?organizationId=${B.id}`, { reason: 'x', organizationId: B.id }, { 'x-bootstrap-secret': 'wrong', 'x-organization-id': B.id })
    assert.equal(r.status, 409); assert.equal(errCode(r), 'BOOTSTRAP_CLOSED')
    assert.equal(await state(B), BOOTSTRAP_REQUIRED); assert.equal(await events(B), 0)
  })
} finally { api.stop() }

const failed = summary()
await p.$disconnect()
process.exit(failed ? 1 : 0)
