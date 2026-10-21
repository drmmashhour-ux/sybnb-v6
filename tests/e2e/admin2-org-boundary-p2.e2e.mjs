// STEP 5I -- P2 organization boundary over REAL HTTP against a real database: two organizations (A has two legal entities), an organization
// administrator in each, a legal-entity administrator, platform administrators, and the records of each. Proves that no admin2 module
// resolves "the" organization any more: Work Queue, support cases, users & access, sessions, roles, service accounts, configuration,
// platform registry, search and CRITICAL notifications are all decided at the place of the thing acted on -- A vs B in both directions.
//
//   DATABASE_URL=<THROWAWAY TEST db, migrated through 083 and seeded> node tests/e2e/admin2-org-boundary-p2.e2e.mjs
//
// NOTE: creates a second ORGANIZATION (cannot be deleted afterwards). Throwaway database only.
import assert from 'node:assert/strict'
import { db } from '../../server/lib/prisma.mjs'
import { recordSecurityEvent } from '../../server/lib/authz/security-events.mjs'
import { startApi, createStaffUser, loginAsStaff, assignRole, makeRunner, randomUUID, assertTestDatabase } from './helpers/admin2-harness.mjs'

assertTestDatabase()
const run = randomUUID().slice(0, 8)
const p = db()
const runner = makeRunner()
const { summary } = runner
// P2_PART=1|2 splits the suite into two halves for hosts with a per-command time limit (each half builds its own fixtures); default: everything.
const PART = process.env.P2_PART ? Number(process.env.P2_PART) : 0
let n = 0
const t = (name, fn) => { n += 1; return (!PART || (PART === 1 ? n <= 5 : n > 5)) ? runner.t(name, fn) : undefined }
const base = '/api/admin2'

// --- registry: org A (existing, one legal entity LE_A1 holding the seeded platforms) + new legal entity LE_A2; org B with its own tree -----
const orgA = await p.organization.findFirst({ orderBy: { createdAt: 'asc' } })
assert.ok(orgA, 'seed the test database first (node scripts/admin-foundation-seed.mjs)')
const A = orgA.id
const orgB = await p.organization.create({ data: { code: `P2-B-${run}`, name: `P2 organization B ${run}` } })
const B = orgB.id
const leA1 = await p.legalEntity.findFirst({ where: { organizationId: A }, orderBy: { createdAt: 'asc' } })
const leA2 = await p.legalEntity.create({ data: { organizationId: A, code: `P2-LEA2-${run}`, legalName: `P2 legal entity A2 ${run}` } })
const buA2 = await p.businessUnit.create({ data: { legalEntityId: leA2.id, code: `P2-BUA2-${run}`, name: `P2 BU A2 ${run}` } })
const leB = await p.legalEntity.create({ data: { organizationId: B, code: `P2-LEB-${run}`, legalName: `P2 legal entity B ${run}` } })
const buB = await p.businessUnit.create({ data: { legalEntityId: leB.id, code: `P2-BUB-${run}`, name: `P2 BU B ${run}` } })
const mkPlatform = (code, businessUnitId) => p.platform.create({ data: { code, displayName: code, businessUnitId, route: `/p2/${code}` } })
const pA2 = await mkPlatform(`p2a2${run}`, buA2.id)
const pB = await mkPlatform(`p2b${run}`, buB.id)
const pStr = await p.platform.findUnique({ where: { code: 'str' } })
const pSr = await p.platform.findUnique({ where: { code: 'sr_ride' } })
assert.ok(pStr && pSr, 'seeded platforms')

// --- people ----------------------------------------------------------------------------------------------------------------------------
const mk = async (label, roleCode, scopes) => { const u = await createStaffUser(label, run); await assignRole(u, roleCode, scopes); return u }
const ownerA = await mk('ownera', 'OWNER', [{ kind: 'ORGANIZATION', organizationId: A }])
const ownerB = await mk('ownerb', 'OWNER', [{ kind: 'ORGANIZATION', organizationId: B }])
const leAdmin = await mk('leadmin', 'SUPER_ADMIN', [{ kind: 'LEGAL_ENTITY', legalEntityId: leA1.id }])        // legal entity A1 only
const leA2Admin = await mk('lea2admin', 'SUPER_ADMIN', [{ kind: 'LEGAL_ENTITY', legalEntityId: leA2.id }])    // legal entity A2 only
const platStr = await mk('platstr', 'SUPPORT_AGENT', [{ kind: 'PLATFORM', platformId: pStr.id }])             // platform "str" only
const platSr = await mk('platsr', 'SUPPORT_AGENT', [{ kind: 'PLATFORM', platformId: pSr.id }])               // platform "sr_ride" only (same legal entity!)
const uStr = await mk('ustr', 'SUPPORT_AGENT', [{ kind: 'PLATFORM', platformId: pStr.id }])                   // subjects to look at
const uSr = await mk('usr', 'SUPPORT_AGENT', [{ kind: 'PLATFORM', platformId: pSr.id }])
const uA2 = await mk('ua2', 'SUPPORT_AGENT', [{ kind: 'PLATFORM', platformId: pA2.id }])
const uB = await mk('ub', 'SUPPORT_AGENT', [{ kind: 'PLATFORM', platformId: pB.id }])

// --- records of every place --------------------------------------------------------------------------------------------------------------
const tag = (k) => `p2.${run}.${k}`
const mkWork = (k, platformId) => p.workItem.create({ data: { type: 'PLATFORM_SETUP', title: tag(k), platformId, status: 'OPEN' } })
const wStr = await mkWork('w-str', pStr.id); const wSr = await mkWork('w-sr', pSr.id); const wA2 = await mkWork('w-a2', pA2.id); const wB = await mkWork('w-b', pB.id)
const wOrgLevel = await mkWork('w-orglevel', null) // no platform, no organization column: with TWO organizations it belongs to nobody

const api = await startApi()
const S = {}
for (const [k, u] of Object.entries({ ownerA, ownerB, leAdmin, leA2Admin, platStr, platSr })) S[k] = await loginAsStaff(api, u)
const titles = (res) => (res.json?.items ?? []).map((x) => x.title ?? x.summary)
const ids = (res) => (res.json?.items ?? []).map((x) => x.id)

await t('Work Queue: each administrator sees exactly its own place; the organization-level item (two organizations) is nobody\'s', async () => {
  const w = async (s) => titles(await s.http.get(`${base}/work/items?view=all&pageSize=200`)).filter((x) => x.startsWith(`p2.${run}.`)).sort()
  assert.deepEqual(await w(S.ownerA), [tag('w-a2'), tag('w-sr'), tag('w-str')].sort(), 'org A admin: every platform of A, nothing of B, not the orphan')
  assert.deepEqual(await w(S.ownerB), [tag('w-b')], 'org B admin: only B (the other direction)')
  assert.deepEqual(await w(S.leAdmin), [tag('w-sr'), tag('w-str')].sort(), 'legal entity A1: its platforms only, not legal entity A2')
  assert.deepEqual(await w(S.leA2Admin), [tag('w-a2')])
  assert.deepEqual(await w(S.platStr), [tag('w-str')], 'platform admin: its platform only')
  assert.deepEqual(await w(S.platSr), [tag('w-sr')], 'a platform admin never gains the sibling platform of the same legal entity')
})

await t('Work Queue write: creating an item on another organization\'s / platform\'s place is refused; on your own place it works', async () => {
  const body = (platformId, k) => ({ type: 'PLATFORM_SETUP', title: tag(k), platformId })
  assert.equal((await S.ownerA.http.post(`${base}/work/items`, body(pB.id, 'x-a-on-b'))).status, 403)
  assert.equal((await S.ownerB.http.post(`${base}/work/items`, body(pStr.id, 'x-b-on-a'))).status, 403)
  assert.equal((await S.platStr.http.post(`${base}/work/items`, body(pSr.id, 'x-str-on-sr'))).status, 403, 'sibling platform')
  assert.equal((await S.leAdmin.http.post(`${base}/work/items`, body(pA2.id, 'x-le1-on-le2'))).status, 403, 'sibling legal entity')
  assert.equal((await S.ownerA.http.post(`${base}/work/items`, body(pStr.id, 'ok-a'))).status, 201)
  assert.equal((await S.ownerB.http.post(`${base}/work/items`, body(pB.id, 'ok-b'))).status, 201)
  assert.equal((await S.leAdmin.http.post(`${base}/work/items`, body(pStr.id, 'ok-le'))).status, 201)
  assert.equal((await S.platStr.http.post(`${base}/work/items`, body(pStr.id, 'ok-plat'))).status, 201)
  assert.equal((await S.ownerA.http.post(`${base}/work/items`, { type: 'PLATFORM_SETUP', title: tag('x-orglevel'), platformId: null })).status, 403, 'two organizations: an org-level record cannot be created or attributed')
  // the audit rows carry the record's OWN organization
  const rows = await p.adminAuditLog.findMany({ where: { action: 'work.item.created', actorUserId: { in: [ownerA.id, ownerB.id, leAdmin.id, platStr.id] } } })
  const orgOf = new Map(rows.map((r) => [r.actorUserId, new Set()]))
  for (const r of rows) orgOf.get(r.actorUserId).add(r.organizationId)
  assert.deepEqual([...orgOf.get(ownerA.id)], [A]); assert.deepEqual([...orgOf.get(ownerB.id)], [B]); assert.deepEqual([...orgOf.get(leAdmin.id)], [A]); assert.deepEqual([...orgOf.get(platStr.id)], [A])
})

await t('records (support cases): A and B cannot read or change each other\'s; legal-entity and platform scopes are respected', async () => {
  const open = (s, platformId, k) => s.http.post(`${base}/support/cases`, { platformId, type: 'GENERAL', summary: tag(k) })
  const cA = await open(S.ownerA, pStr.id, 'c-a'); const cB = await open(S.ownerB, pB.id, 'c-b'); const cA2 = await open(S.ownerA, pA2.id, 'c-a2')
  for (const c of [cA, cB, cA2]) assert.equal(c.status, 201)
  assert.equal((await open(S.ownerA, pB.id, 'c-a-on-b')).status, 403); assert.equal((await open(S.ownerB, pStr.id, 'c-b-on-a')).status, 403)
  const list = async (s) => titles(await s.http.get(`${base}/support/cases?pageSize=200`)).filter((x) => x?.startsWith(`p2.${run}.`)).sort()
  assert.deepEqual(await list(S.ownerA), [tag('c-a'), tag('c-a2')].sort()); assert.deepEqual(await list(S.ownerB), [tag('c-b')])
  assert.deepEqual(await list(S.leAdmin), [tag('c-a')], 'legal entity A1 does not see the case on a platform of A2')
  assert.equal((await S.ownerA.http.get(`${base}/support/cases/${cB.json.id}`)).status, 403)
  assert.equal((await S.ownerB.http.get(`${base}/support/cases/${cA.json.id}`)).status, 403)
  assert.equal((await S.leAdmin.http.get(`${base}/support/cases/${cA2.json.id}`)).status, 403)
  assert.equal((await S.ownerA.http.patch(`${base}/support/cases/${cB.json.id}`, { priority: 'HIGH' })).status, 403)
  assert.equal((await S.ownerB.http.patch(`${base}/support/cases/${cB.json.id}`, { priority: 'HIGH' })).status, 200)
})

await t('users & access: user list and user detail are bounded by place (A / B both directions, legal entity, platform)', async () => {
  const users = async (s) => ids(await s.http.get(`${base}/access/users?pageSize=200`))
  const mine = [ownerA, ownerB, leAdmin, leA2Admin, platStr, platSr, uStr, uSr, uA2, uB].map((u) => u.id)
  const seen = async (s) => (await users(s)).filter((i) => mine.includes(i)).sort()
  const want = (...us) => us.map((u) => u.id).sort()
  assert.deepEqual(await seen(S.ownerA), want(ownerA, leAdmin, leA2Admin, platStr, platSr, uStr, uSr, uA2))
  assert.deepEqual(await seen(S.ownerB), want(ownerB, uB))
  assert.deepEqual(await seen(S.leAdmin), want(leAdmin, platStr, platSr, uStr, uSr), 'legal entity A1: users inside it, not A2, not the org-level owner')
  assert.deepEqual(await seen(S.leA2Admin), want(leA2Admin, uA2))
  // detail
  assert.equal((await S.ownerA.http.get(`${base}/access/users/${uStr.id}`)).status, 200)
  assert.equal((await S.ownerA.http.get(`${base}/access/users/${uB.id}`)).status, 403); assert.equal((await S.ownerB.http.get(`${base}/access/users/${uStr.id}`)).status, 403)
  assert.equal((await S.leAdmin.http.get(`${base}/access/users/${uStr.id}`)).status, 200)
  assert.equal((await S.leAdmin.http.get(`${base}/access/users/${uA2.id}`)).status, 403)
  assert.equal((await S.leAdmin.http.get(`${base}/access/users/${ownerA.id}`)).status, 403, 'an organization-wide owner is not inside a legal entity')
  const d = await S.leAdmin.http.get(`${base}/access/users/${uStr.id}`)
  assert.ok(d.json.assignments.every((a) => a.scopes.every((s) => s.platformId === pStr.id)), 'only scopes inside the caller\'s place are shown')
})

await t('assignments list, scopes list, sessions, MFA: bounded the same way', async () => {
  const aUsers = async (s) => new Set((await s.http.get(`${base}/access/assignments?pageSize=200`)).json.items.map((a) => a.userId ?? a.user?.id))
  const sa = await aUsers(S.ownerA); const sb = await aUsers(S.ownerB)
  assert.ok(sa.has(uStr.id) && !sa.has(uB.id)); assert.ok(sb.has(uB.id) && !sb.has(uStr.id))
  const sc = async (s) => (await s.http.get(`${base}/access/scopes`)).json
  const scA = await sc(S.ownerA); const scB = await sc(S.ownerB); const scLe = await sc(S.leAdmin)
  assert.ok(scA.platforms.some((x) => x.code === 'str') && !scA.platforms.some((x) => x.id === pB.id) && !scA.organizations.some((o) => o.id === B))
  assert.deepEqual(scB.platforms.map((x) => x.id), [pB.id]); assert.deepEqual(scB.organizations.map((o) => o.id), [B])
  assert.ok(scLe.platforms.some((x) => x.code === 'str') && !scLe.platforms.some((x) => x.id === pA2.id), 'legal entity A1 does not list A2\'s platform')
  // sessions: give uStr and uB each a live session, then list
  await loginAsStaff(api, uStr); const sessB = await loginAsStaff(api, uB)
  const ses = async (s) => (await s.http.get(`${base}/access/sessions?pageSize=200`)).json.items.map((x) => x.user.id)
  assert.ok((await ses(S.ownerA)).includes(uStr.id) && !(await ses(S.ownerA)).includes(uB.id))
  assert.ok((await ses(S.ownerB)).includes(uB.id) && !(await ses(S.ownerB)).includes(uStr.id))
  assert.equal((await S.ownerA.http.post(`${base}/access/sessions/${sessB.sessionId}/revoke`, { reason: 'cross organization attempt' })).status, 403, 'A cannot revoke B\'s session')
  const mfa = async (s) => (await s.http.get(`${base}/access/mfa`)).json.users.map((u) => u.id)
  assert.ok(!(await mfa(S.ownerA)).includes(uB.id) && (await mfa(S.ownerB)).includes(uB.id))
})

await t('suspend / reactivate: A cannot touch B\'s user (nothing changes), nor a user outside a legal entity; own place works and is attributed to it', async () => {
  const reason = 'organization boundary e2e check'
  assert.equal((await S.ownerA.http.post(`${base}/access/users/${uB.id}/suspend`, { reason })).status, 403)
  assert.equal((await S.ownerB.http.post(`${base}/access/users/${uStr.id}/suspend`, { reason })).status, 403)
  assert.equal((await S.leAdmin.http.post(`${base}/access/users/${uA2.id}/suspend`, { reason })).status, 403)
  for (const u of [uB, uStr, uA2]) assert.equal((await p.user.findUnique({ where: { id: u.id } })).status, 'ACTIVE', 'untouched')
  const ok = await S.ownerB.http.post(`${base}/access/users/${uB.id}/suspend`, { reason })
  assert.equal(ok.status, 200, JSON.stringify(ok.json))
  const ev = await p.securityEvent.findUnique({ where: { id: ok.json.securityEventId } })
  assert.equal(ev.organizationId, B, 'the event belongs to the target\'s organization')
})

await t('role catalogue (global): readable at any place; changing it needs EVERY organization, so one organization\'s owner cannot', async () => {
  assert.equal((await S.ownerA.http.get(`${base}/access/roles`)).status, 200); assert.equal((await S.ownerB.http.get(`${base}/access/roles`)).status, 200)
  assert.equal((await S.leAdmin.http.get(`${base}/access/roles`)).status, 200)
  const draft = await S.ownerA.http.post(`${base}/access/roles/STR_MANAGER/versions`, { reason: 'organization boundary e2e', permissions: ['work.view'] })
  assert.equal(draft.status, 403, 'A alone cannot change what B also uses')
  assert.equal((await S.ownerA.http.get(`${base}/access/permissions`)).status, 200)
})

await t('service accounts: listed and created per organization; the other organization\'s are invisible and cannot be disabled', async () => {
  const mkSa = (s, name) => s.http.post(`${base}/access/service-accounts`, { name, reason: 'organization boundary e2e', permissionCodes: [] })
  const a = await mkSa(S.ownerA, `p2-sa-a-${run}`); const b = await mkSa(S.ownerB, `p2-sa-b-${run}`)
  assert.equal(a.status, 201, JSON.stringify(a.json)); assert.equal(b.status, 201)
  assert.equal((await p.serviceAccount.findUnique({ where: { id: a.json.id } })).organizationId, A); assert.equal((await p.serviceAccount.findUnique({ where: { id: b.json.id } })).organizationId, B)
  const names = async (s) => (await s.http.get(`${base}/access/service-accounts`)).json.serviceAccounts.map((x) => x.name).filter((n) => n.includes(run))
  assert.deepEqual(await names(S.ownerA), [`p2-sa-a-${run}`]); assert.deepEqual(await names(S.ownerB), [`p2-sa-b-${run}`])
  assert.equal((await S.ownerA.http.post(`${base}/access/service-accounts/${b.json.id}/disable`, { reason: 'cross organization attempt' })).status, 403)
  assert.equal((await p.serviceAccount.findUnique({ where: { id: b.json.id } })).status, 'ACTIVE')
  const named = await S.ownerA.http.post(`${base}/access/service-accounts`, { name: `p2-sa-x-${run}`, reason: 'organization boundary e2e', organizationId: B })
  assert.notEqual(named.status, 201, 'naming another organization does not let A create into it')
})

await t('configuration & platform registry: global config needs every organization to change; a platform of B cannot be changed by A', async () => {
  assert.equal((await S.ownerA.http.get(`${base}/config/settings`)).status, 200); assert.equal((await S.ownerB.http.get(`${base}/config/settings`)).status, 200)
  assert.equal((await S.ownerA.http.put(`${base}/config/settings/general/p2_${run}`, { value: 1, reason: 'organization boundary e2e' })).status, 403)
  assert.equal((await S.ownerA.http.put(`${base}/config/feature-flags`, { key: `p2_${run}`, scopeKind: 'ORGANIZATION', scopeRef: A, enabled: true, reason: 'organization boundary e2e' })).status, 403)
  assert.equal((await S.ownerA.http.patch(`${base}/platforms/${pB.code}`, { status: 'DISABLED', reason: 'organization boundary e2e' })).status, 403)
  assert.equal((await S.ownerB.http.patch(`${base}/platforms/str`, { status: 'DISABLED', reason: 'organization boundary e2e' })).status, 403)
  assert.equal((await p.platform.findUnique({ where: { id: pB.id } })).status, 'SETUP')
  assert.equal((await S.ownerB.http.patch(`${base}/platforms/${pB.code}`, { status: 'ACTIVE', reason: 'organization boundary e2e' })).status, 200)
})

await t('global search: results are filtered by place (work, users)', async () => {
  const s = async (sess, q) => (await sess.http.get(`${base}/search?q=${encodeURIComponent(q)}`)).json.results ?? {}
  const a = await s(S.ownerA, `p2.${run}.w-`); const b = await s(S.ownerB, `p2.${run}.w-`)
  assert.ok((a.workItems ?? []).every((x) => x.title !== tag('w-b'))); assert.ok((b.workItems ?? []).every((x) => x.title === tag('w-b')))
  const ua = await s(S.ownerA, `S5 ub`); const ub = await s(S.ownerB, `S5 ub`)
  assert.ok(!(ua.users ?? []).some((x) => x.id === uB.id)); assert.ok((ub.users ?? []).some((x) => x.id === uB.id))
})

await t('CRITICAL notifications: an organization event alerts only that organization\'s security holders; an unattributed event alerts nobody and is flagged', async () => {
  const mkEv = (organizationId, k) => p.$transaction((tx) => recordSecurityEvent(tx, { severity: 'CRITICAL', eventType: 'p2.e2e', summary: tag(k), organizationId }))
  const evA = await mkEv(A, 'crit-a'); const evB = await mkEv(B, 'crit-b'); const evX = await mkEv(null, 'crit-null')
  const got = async (u) => (await p.adminNotification.findMany({ where: { userId: u.id, type: 'SECURITY' } })).map((n) => n.title)
  const gA = await got(ownerA); const gB = await got(ownerB)
  assert.ok(gA.includes(`CRITICAL: ${tag('crit-a')}`) && !gA.includes(`CRITICAL: ${tag('crit-b')}`) && !gA.includes(`CRITICAL: ${tag('crit-null')}`), 'A: its own only')
  assert.ok(gB.includes(`CRITICAL: ${tag('crit-b')}`) && !gB.includes(`CRITICAL: ${tag('crit-a')}`) && !gB.includes(`CRITICAL: ${tag('crit-null')}`), 'B: its own only')
  for (const u of [leAdmin, platStr, leA2Admin]) assert.deepEqual((await got(u)).filter((x) => x.includes(`p2.${run}.`)), [], 'a legal-entity / platform administrator is not an organization security recipient')
  const x = await p.securityEvent.findUnique({ where: { id: evX.id } })
  assert.equal(x.notifiedCount, 0); assert.equal(x.delivery._notification.state, 'UNATTRIBUTED'); assert.equal(x.delivery._notification.action, 'MANUAL_OPERATOR_REVIEW')
  assert.equal(await p.adminNotification.count({ where: { title: `CRITICAL: ${tag('crit-null')}` } }), 0, 'nobody at all was told')
  assert.equal(evA.notifiedCount >= 1, true); assert.equal(evB.notifiedCount >= 1, true)
  // and the unattributed event is invisible to every organization-scoped admin through the API
  for (const s of [S.ownerA, S.ownerB]) assert.equal((await s.http.get(`${base}/security/events/${evX.id}`)).status, 404)
})

await t('anonymous and no-assignment callers get nothing', async () => {
  const anon = await fetch(`${api.base}${base}/access/users`)
  assert.equal(anon.status, 401)
  const nobody = await createStaffUser('nobody', run); const sN = await loginAsStaff(api, nobody)
  for (const path of ['/access/users', '/access/assignments', '/access/scopes', '/work/items', '/access/service-accounts']) assert.ok([401, 403].includes((await sN.http.get(`${base}${path}`)).status), path)
})

const apiLogs = api.logs()
api.stop()
const failed = summary()
if (failed) console.log('--- API log tail ---\n' + apiLogs.split('\n').filter((l) => /"level":"error"|"status":500|Error/.test(l)).slice(-12).join('\n').slice(-5000))
process.exit(failed ? 1 : 0)
