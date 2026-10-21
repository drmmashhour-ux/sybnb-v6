// STEP 5I -- organization / legal-entity / platform boundary (P2). REAL central evaluator + REAL org-boundary helpers; only the loading of
// assignments is a fixture. No database. The DB-backed counterpart is tests/e2e/admin2-org-boundary-p2.e2e.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { evaluateAccess, DEFAULT_POLICY } from '../../server/lib/authz/evaluate.mjs'
import { PERMISSIONS } from '../../server/lib/authz/catalogue.mjs'
import {
  candidateOrganizationIds, authorizedPlaces, callerPlaces, placeOfScopeRow, placesOfScopeRows, placesOfSubject, placeWithin, subjectTouches, subjectWithin,
  scopesWithinPlaces, expandPlaces, factsOfPlace, organizationOfRecord, soleOrganizationId, requireAtPlaces, requireAtOrganizations, organizationLevelIds,
} from '../../server/lib/authz/org-boundary.mjs'
import { CRITICAL_SECURITY_RECIPIENTS, deliverSecurityNotifications, UNATTRIBUTED_NOTIFICATION } from '../../server/lib/authz/notifications.mjs'
import { runAttribution, parseArgs } from '../../scripts/admin-attribute-legacy-records.mjs'

const NOW = new Date()
const HOUR = 3_600_000
const ago = (ms) => new Date(NOW.getTime() - ms)
const id = () => randomUUID()

// --- two organizations: A (two legal entities, three platforms) and B (one of each) --------------------------------------------------
const A = id(); const B = id()
const LE_A1 = id(); const LE_A2 = id(); const LE_B1 = id()
const BU_A1 = id(); const BU_A2 = id(); const BU_B1 = id()
const P_A1 = { id: id(), code: 'pa1', businessUnitId: BU_A1 }; const P_A2 = { id: id(), code: 'pa2', businessUnitId: BU_A1 }
const P_A3 = { id: id(), code: 'pa3', businessUnitId: BU_A2 }; const P_B1 = { id: id(), code: 'pb1', businessUnitId: BU_B1 }
const by = (rows) => new Map(rows.map((x) => [x.id, x]))
const orgIndex = {
  organizationsById: by([{ id: A, name: 'A' }, { id: B, name: 'B' }]),
  legalEntitiesById: by([{ id: LE_A1, organizationId: A }, { id: LE_A2, organizationId: A }, { id: LE_B1, organizationId: B }]),
  businessUnitsById: by([{ id: BU_A1, legalEntityId: LE_A1 }, { id: BU_A2, legalEntityId: LE_A2 }, { id: BU_B1, legalEntityId: LE_B1 }]),
  platformsById: by([P_A1, P_A2, P_A3, P_B1]),
  platformsByCode: new Map([P_A1, P_A2, P_A3, P_B1].map((p) => [p.code, p])),
}
const soleIndex = { ...orgIndex, organizationsById: by([{ id: A, name: 'A' }]) }

const PERM = new Map(PERMISSIONS.map((p) => [p.code, { code: p.code, tier: p.tier, highRisk: p.highRisk === true, deprecated: false, noSelf: p.noSelf === true }]))
const users = new Map()
function staff(label, scopes, permissions = ['user.view', 'work.view', 'access.view', 'security_event.view', 'security_event.review']) {
  const u = { id: id(), status: 'ACTIVE', email: `${label}@example.invalid` }
  u.assignments = [{
    id: id(), userId: u.id, status: 'ACTIVE', effectiveFrom: ago(30 * 24 * HOUR), effectiveTo: null, revokedAt: null, activationAt: null, approvedAt: null, platformQualifier: [],
    roleVersion: { id: id(), versionNumber: 1, status: 'EFFECTIVE', effectiveFrom: ago(60 * 24 * HOUR), platformCoverage: ['*'], role: { code: 'X', status: 'ACTIVE' }, permissionCodes: new Set(permissions) },
    scopes: scopes.map((s) => ({ id: id(), ...s })),
  }]
  u.recentAuthAt = ago(60_000)
  users.set(u.id, u)
  return u
}
let index = orgIndex
const authz = {
  async loadSnapshot(auth) { const u = users.get(auth.user.id); return { now: NOW, timeTrusted: true, assignments: u.assignments, suspensions: [], orgIndex: index, policy: { ...DEFAULT_POLICY, id: null }, auth: { recentAuthAt: u.recentAuthAt }, client: {} } },
  async decide(snap, ctx, code, resource) {
    const result = evaluateAccess({ user: { id: ctx.user.id, status: ctx.user.status }, permission: PERM.get(code) ?? null, assignments: snap.assignments, suspensions: snap.suspensions, resource, orgIndex: snap.orgIndex, policy: snap.policy, now: snap.now, timeTrusted: snap.timeTrusted, recentAuthAt: snap.auth.recentAuthAt })
    return { ...result }
  },
}
const asR = (u) => ({ auth: { user: { id: u.id, status: u.status } }, requestId: 'r', require: async (code, resource) => { const d = await authz.decide(await authz.loadSnapshot({ user: u }), { user: u }, code, resource); if (d.decision !== 'ALLOW') { const e = new Error('denied'); e.statusCode = 403; e.code = 'PERMISSION_DENIED'; throw e } } })
const allowedAt = async (u, code, facts) => (await authz.decide(await authz.loadSnapshot({ user: u }), { user: u }, code, { type: 'x', facts })).decision === 'ALLOW'

const orgAdminA = staff('org-admin-a', [{ kind: 'ORGANIZATION', organizationId: A }])
const orgAdminB = staff('org-admin-b', [{ kind: 'ORGANIZATION', organizationId: B }])
const leAdmin = staff('le-admin', [{ kind: 'LEGAL_ENTITY', legalEntityId: LE_A1 }])
const platformAdmin = staff('platform-admin', [{ kind: 'PLATFORM', platformId: P_A1.id }])

// --- the central way to place things ---------------------------------------------------------------------------------------------------
test('places: every placeable scope kind resolves to its organization through the tree; the others do not', () => {
  assert.deepEqual(placeOfScopeRow(orgIndex, { kind: 'ORGANIZATION', organizationId: A }), { organizationId: A })
  assert.deepEqual(placeOfScopeRow(orgIndex, { kind: 'LEGAL_ENTITY', legalEntityId: LE_A1 }), { organizationId: A, legalEntityId: LE_A1 })
  assert.equal(placeOfScopeRow(orgIndex, { kind: 'BUSINESS_UNIT', businessUnitId: BU_B1 }).organizationId, B)
  assert.deepEqual(placeOfScopeRow(orgIndex, { kind: 'PLATFORM', platformId: P_A3.id }), { organizationId: A, legalEntityId: LE_A2, businessUnitId: BU_A2, platformId: P_A3.id, platformCode: 'pa3' })
  for (const kind of ['DEPARTMENT', 'PROPERTY', 'VEHICLE', 'PROJECT', 'SELF']) assert.equal(placeOfScopeRow(orgIndex, { kind }), null, kind)
  assert.equal(placeOfScopeRow(orgIndex, { kind: 'LEGAL_ENTITY', legalEntityId: id() }), null, 'an unknown legal entity cannot be placed')
  assert.deepEqual(candidateOrganizationIds({ orgIndex, assignments: leAdmin.assignments }), [A], 'a legal-entity admin reaches the evaluator at its parent organization')
  assert.deepEqual(candidateOrganizationIds({ orgIndex, assignments: platformAdmin.assignments }), [A])
  assert.deepEqual(candidateOrganizationIds({ orgIndex, assignments: orgAdminB.assignments }), [B])
})

test('records: a record belongs to its platform\'s organization; with no platform only a SOLE organization can own it (never "the oldest")', () => {
  assert.equal(organizationOfRecord(orgIndex, { platformId: P_B1.id }), B)
  assert.equal(organizationOfRecord(orgIndex, { platformCode: 'pa3' }), A)
  assert.equal(organizationOfRecord(orgIndex, { platformId: id() }), null, 'an unknown platform is unattributed')
  assert.equal(organizationOfRecord(orgIndex, {}), null, 'two organizations: an org-level record belongs to nobody')
  assert.equal(organizationOfRecord(soleIndex, {}), A, 'one organization: it is the owner')
  assert.equal(soleOrganizationId(orgIndex), null); assert.equal(soleOrganizationId(soleIndex), A)
  assert.deepEqual(placesOfSubject(orgIndex, [{ kind: 'DEPARTMENT', departmentId: id() }]), [], 'multi-org: an unplaceable subject is refused')
  assert.deepEqual(placesOfSubject(soleIndex, [{ kind: 'DEPARTMENT', departmentId: id() }]), [{ organizationId: A }])
  assert.deepEqual(placesOfSubject(orgIndex, [], { hasAssignments: false }), [])
})

// --- the required behaviours -----------------------------------------------------------------------------------------------------------
test('organization admin keeps working: allowed in its organization, all of its legal entities and platforms; denied in the other organization', async () => {
  const { places } = await authorizedPlaces(asR(orgAdminA), authz, 'user.view', 'admin_user')
  assert.deepEqual(places, [{ organizationId: A }])
  for (const facts of [{ organizationId: A }, { platformCode: 'pa1' }, { platformCode: 'pa3' }, { legalEntityId: LE_A2 }]) assert.equal(await allowedAt(orgAdminA, 'work.view', facts), true, JSON.stringify(facts))
  for (const facts of [{ organizationId: B }, { platformCode: 'pb1' }, { legalEntityId: LE_B1 }]) assert.equal(await allowedAt(orgAdminA, 'work.view', facts), false, JSON.stringify(facts))
})

test('cross-organization access stays denied in BOTH directions', async () => {
  assert.equal(await allowedAt(orgAdminA, 'security_event.view', { organizationId: B }), false)
  assert.equal(await allowedAt(orgAdminB, 'security_event.view', { organizationId: A }), false)
  assert.equal(await allowedAt(orgAdminB, 'work.view', { platformCode: 'pa1' }), false)
  assert.equal(await allowedAt(leAdmin, 'work.view', { platformCode: 'pb1' }), false)
  const ok = await authorizedPlaces(asR(orgAdminB), authz, 'user.view', 'admin_user')
  assert.deepEqual(organizationLevelIds(ok.places), [B])
})

test('legal-entity admin: keeps access to its legal entity (and below), gains nothing organization-wide, nothing in another legal entity', async () => {
  assert.deepEqual(callerPlaces({ orgIndex, assignments: leAdmin.assignments }), [{ organizationId: A, legalEntityId: LE_A1 }])
  const { places } = await authorizedPlaces(asR(leAdmin), authz, 'user.view', 'admin_user')
  assert.deepEqual(places, [{ organizationId: A, legalEntityId: LE_A1 }], 'it is evaluated AT its own legal entity and allowed there')
  assert.equal(await allowedAt(leAdmin, 'work.view', { legalEntityId: LE_A1 }), true)
  assert.equal(await allowedAt(leAdmin, 'work.view', { platformCode: 'pa1' }), true, 'platforms under its legal entity')
  assert.equal(await allowedAt(leAdmin, 'work.view', { platformCode: 'pa2' }), true)
  assert.equal(await allowedAt(leAdmin, 'work.view', { organizationId: A }), false, 'a child scope does NOT grant organization-wide permissions')
  assert.equal(await allowedAt(leAdmin, 'security_event.view', { organizationId: A }), false, 'organization-level security records stay invisible to it')
  assert.equal(await allowedAt(leAdmin, 'work.view', { legalEntityId: LE_A2 }), false, 'a sibling legal entity of the same organization')
  assert.equal(await allowedAt(leAdmin, 'work.view', { platformCode: 'pa3' }), false)
  assert.equal(await allowedAt(leAdmin, 'work.view', { organizationId: A, legalEntityId: LE_A2 }), false, 'claiming the parent organization in the facts does not help')
  // what it may SEE: only scopes inside its legal entity
  const w = scopesWithinPlaces(orgIndex, places)
  const clauses = w.some.OR
  const get = (k) => clauses.find((c) => c.kind === k)
  assert.equal(get('ORGANIZATION'), undefined)
  assert.deepEqual(get('LEGAL_ENTITY').legalEntityId.in, [LE_A1])
  assert.deepEqual(get('BUSINESS_UNIT').businessUnitId.in, [BU_A1])
  assert.deepEqual(get('PLATFORM').platformId.in.sort(), [P_A1.id, P_A2.id].sort())
})

test('platform admin: sees only its platform; never another platform of the same organization, never the organization', async () => {
  const { places } = await authorizedPlaces(asR(platformAdmin), authz, 'work.view', 'work_item')
  assert.equal(places.length, 1); assert.equal(places[0].platformCode, 'pa1')
  assert.equal(await allowedAt(platformAdmin, 'work.view', { platformCode: 'pa1' }), true)
  assert.equal(await allowedAt(platformAdmin, 'work.view', { platformCode: 'pa2' }), false, 'same business unit, different platform')
  assert.equal(await allowedAt(platformAdmin, 'work.view', { platformCode: 'pa3' }), false)
  assert.equal(await allowedAt(platformAdmin, 'work.view', { platformCode: 'pb1' }), false)
  assert.equal(await allowedAt(platformAdmin, 'work.view', { organizationId: A }), false)
  assert.equal(await allowedAt(platformAdmin, 'work.view', { organizationId: A, legalEntityId: LE_A1 }), false)
  assert.deepEqual(scopesWithinPlaces(orgIndex, places).some.OR, [{ kind: 'PLATFORM', platformId: { in: [P_A1.id] } }])
  assert.deepEqual(organizationLevelIds(places), [], 'no organization-level resource is visible through a platform grant')
})

test('subjects: a user is visible when one of their places is inside the caller\'s; a multi-organization user is not fully inside one organization', () => {
  const inA = placesOfScopeRows(orgIndex, [{ kind: 'PLATFORM', platformId: P_A1.id }])
  const inB = placesOfScopeRows(orgIndex, [{ kind: 'ORGANIZATION', organizationId: B }])
  const adminA = [{ organizationId: A }]; const adminLe = [{ organizationId: A, legalEntityId: LE_A1 }]; const adminP2 = [placeOfScopeRow(orgIndex, { kind: 'PLATFORM', platformId: P_A2.id })]
  assert.equal(subjectTouches(inA, adminA), true); assert.equal(subjectTouches(inB, adminA), false)
  assert.equal(subjectTouches(inA, adminLe), true); assert.equal(subjectTouches(inA, adminP2), false, 'platform A2 admin cannot see a platform A1 user')
  assert.equal(subjectWithin([...inA, ...inB], adminA), false); assert.equal(subjectTouches([...inA, ...inB], adminA), true)
  assert.equal(placeWithin({ organizationId: A }, adminLe), false, 'a child never covers its parent')
  assert.deepEqual([...expandPlaces(orgIndex, adminLe).platforms].sort(), [P_A1.id, P_A2.id].sort())
  assert.equal(factsOfPlace(placeOfScopeRow(orgIndex, { kind: 'PLATFORM', platformId: P_A3.id })).platformCode, 'pa3')
})

test('requireAtPlaces / requireAtOrganizations: every place must authorize; an empty list is a refusal', async () => {
  const build = (facts) => ({ type: 'admin_user', facts })
  await requireAtPlaces(asR(orgAdminA), 'user.view', [{ organizationId: A }], build)
  await assert.rejects(requireAtPlaces(asR(orgAdminA), 'user.view', [{ organizationId: A }, { organizationId: B }], build), (e) => e.statusCode === 403)
  await assert.rejects(requireAtPlaces(asR(orgAdminA), 'user.view', [], build), (e) => e.statusCode === 403)
  await assert.rejects(requireAtOrganizations(asR(orgAdminA), 'user.view', [A, B], (organizationId) => ({ type: 'role', facts: { organizationId } })), (e) => e.statusCode === 403, 'a global catalogue write needs EVERY organization')
  await requireAtOrganizations(asR(orgAdminA), 'user.view', [A], (organizationId) => ({ type: 'role', facts: { organizationId } }))
  await assert.rejects(authorizedPlaces({ auth: null }, authz, 'user.view', 'x'), (e) => e.statusCode === 401)
})

// --- CRITICAL notifications -------------------------------------------------------------------------------------------------------------
test('CRITICAL notifications: an organization event reaches only that organization\'s ORGANIZATION-scoped holders; an unattributed one reaches nobody and is flagged', async () => {
  const wheres = []
  const created = []
  const tx = {
    roleAssignment: { findMany: async (a) => { wheres.push(a.where); return [{ userId: 'owner-of-a' }] } },
    adminNotification: { createMany: async ({ data }) => { created.push(...data) } },
    $executeRawUnsafe: async () => {},
  }
  const attributed = await deliverSecurityNotifications(tx, { id: 'e1', eventType: 'X', summary: 'secret of A', organizationId: A })
  assert.deepEqual(attributed.recipients, ['owner-of-a'])
  assert.deepEqual(wheres[0].scopes, { some: { kind: 'ORGANIZATION', organizationId: A } }, 'a legal-entity / platform grant is not an organization security recipient')
  assert.equal(created.length, 1)
  const before = created.length; const queries = wheres.length
  const un = await deliverSecurityNotifications(tx, { id: 'e2', eventType: 'Y', summary: 'orphan', organizationId: null })
  assert.deepEqual(un.recipients, [])
  assert.deepEqual(un.results._notification, UNATTRIBUTED_NOTIFICATION)
  assert.equal(un.results._notification.state, 'UNATTRIBUTED'); assert.equal(un.results._notification.action, 'MANUAL_OPERATOR_REVIEW')
  assert.equal(created.length, before, 'no notification row is created for anyone'); assert.equal(wheres.length, queries, 'no recipient query is even made')
  assert.deepEqual(await CRITICAL_SECURITY_RECIPIENTS.resolve(tx, { organizationId: undefined }), [])
  // the _notification marker is not a transport: the retry worker (which skips "_" keys) never re-sends it
  assert.ok(Object.keys(un.results).every((k) => k.startsWith('_')))
})

// --- legacy attribution script ----------------------------------------------------------------------------------------------------------
function fakeIo({ orgs = 1, audit = 5, security = 3, exists = true } = {}) {
  const tables = { admin_audit_logs: Array.from({ length: audit }, () => ({ id: id(), org: null })), security_events: Array.from({ length: security }, () => ({ id: id(), org: null })) }
  const calls = []; let report = null
  const io = {
    now: () => new Date(), calls, get report() { return report }, tables,
    organizationCount: async () => orgs, organizationExists: async () => exists,
    countNull: async (t) => tables[t].filter((r) => r.org === null).length,
    nullIds: async (t, n) => tables[t].filter((r) => r.org === null).slice(0, n).map((r) => r.id),
    attribute: async (t, ids, org) => { calls.push({ t, n: ids.length, org }); const out = []; for (const r of tables[t]) if (ids.includes(r.id) && r.org === null) { r.org = org; out.push(r.id) } return out },
    writeReport: (r) => { report = r },
  }
  return io
}
const ORG = id()
test('attribution script: DRY RUN is the default, prints counts, writes a report and changes nothing', async () => {
  const io = fakeIo()
  const r = await runAttribution(parseArgs([`--organization-id=${ORG}`]), io)
  assert.equal(r.status, 'DRY_RUN'); assert.equal(r.mode, 'DRY_RUN')
  assert.equal(r.tables.admin_audit_logs.unattributedBefore, 5); assert.equal(r.tables.security_events.unattributedBefore, 3)
  assert.equal(io.calls.length, 0, 'no UPDATE'); assert.ok(io.report); assert.deepEqual(r.neverTouched, ['authorization_evidence'])
  assert.equal(Object.keys(r.tables).includes('authorization_evidence'), false)
})

test('attribution script: refuses without an explicit organization, without the confirmation flag, without proof, and for evidence', async () => {
  for (const [argv, why] of [
    [[], /organization-id/], [['--organization-id=not-a-uuid'], /organization-id/],
    [[`--organization-id=${ORG}`, '--apply'], /confirm-single-organization-history/],
    [[`--organization-id=${ORG}`, '--apply', `--confirm-single-organization-history=${id()}`, '--proof-ref=T-1'], /confirm-single-organization-history/],
    [[`--organization-id=${ORG}`, '--apply', `--confirm-single-organization-history=${ORG}`], /proof-ref/],
    [[`--organization-id=${ORG}`, '--tables=evidence'], /evidence/], [[`--organization-id=${ORG}`, '--tables=authorization_evidence'], /evidence/],
    [[`--organization-id=${ORG}`, '--wat'], /unknown argument/],
  ]) {
    const io = fakeIo(); const r = await runAttribution(parseArgs(argv), io)
    assert.equal(r.status, 'REFUSED', argv.join(' ')); assert.match(r.reason, why); assert.equal(io.calls.length, 0)
  }
  const io = fakeIo({ exists: false }); assert.equal((await runAttribution(parseArgs([`--organization-id=${ORG}`]), io)).status, 'REFUSED')
})

test('attribution script: refuses when more than one organization exists unless a reviewer signs the override', async () => {
  const many = fakeIo({ orgs: 2 })
  const r = await runAttribution(parseArgs([`--organization-id=${ORG}`, '--apply', `--confirm-single-organization-history=${ORG}`, '--proof-ref=T-1']), many)
  assert.equal(r.status, 'REFUSED'); assert.match(r.reason, /2 organizations exist/); assert.equal(many.calls.length, 0)
  const dry = await runAttribution(parseArgs([`--organization-id=${ORG}`]), fakeIo({ orgs: 2 })); assert.equal(dry.status, 'REFUSED', 'even the dry run does not pretend it could be applied')
  const ok = fakeIo({ orgs: 2 })
  const done = await runAttribution(parseArgs([`--organization-id=${ORG}`, '--apply', `--confirm-single-organization-history=${ORG}`, '--proof-ref=T-1', '--allow-multiple-organizations-reviewed=reviewer-1']), ok)
  assert.equal(done.status, 'APPLIED'); assert.equal(done.reviewedOverride, 'reviewer-1')
})

test('attribution script: apply attributes audit + security rows only, reports the ids, and is idempotent', async () => {
  const io = fakeIo({ audit: 7, security: 4 })
  const args = parseArgs([`--organization-id=${ORG}`, '--apply', `--confirm-single-organization-history=${ORG}`, '--proof-ref=T-1', '--batch=3'])
  const r = await runAttribution(args, io)
  assert.equal(r.status, 'APPLIED')
  assert.equal(r.tables.admin_audit_logs.attributed, 7); assert.equal(r.tables.admin_audit_logs.ids.length, 7); assert.equal(r.tables.admin_audit_logs.unattributedAfter, 0)
  assert.equal(r.tables.security_events.attributed, 4); assert.ok(io.calls.every((c) => c.org === ORG && ['admin_audit_logs', 'security_events'].includes(c.t)))
  assert.ok(io.calls.every((c) => c.n <= 3), 'batched')
  const again = await runAttribution(args, io)
  assert.equal(again.tables.admin_audit_logs.attributed, 0); assert.equal(again.tables.security_events.attributed, 0); assert.equal(again.tables.admin_audit_logs.unattributedBefore, 0)
})

test('attribution script source: only audit + security tables, never authorization_evidence, never run on import', () => {
  const src = readFileSync(join(import.meta.dirname, '..', '..', 'scripts', 'admin-attribute-legacy-records.mjs'), 'utf8')
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  assert.doesNotMatch(code.replace(/NEVER_TOUCHED[^\n]*\n/, '').replace(/\/evidence\/i/g, '').replace(/authorization_evidence/g, ''), /evidence/i, 'the only mention of evidence is the refusal')
  assert.doesNotMatch(code, /UPDATE\s+"?authorization_evidence/i)
  assert.match(code, /WHERE organization_id IS NULL/)
})

// --- static guards (not brittle: comments stripped, whole-file patterns, no line numbers) ----------------------------------------------
const ROOT = join(import.meta.dirname, '..', '..')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
const filesIn = (dir) => readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.mjs')).map((f) => ({ file: `${dir}/${f}`, code: strip(readFileSync(join(ROOT, dir, f), 'utf8')) }))
const GUARDED = [...filesIn('server/routes/admin2'), ...filesIn('server/lib/authz')]

test('static guard: no admin2 / authz code chooses an organization by age, default or first-found', () => {
  const bad = []
  for (const { file, code } of GUARDED) {
    if (/\borganization\s*\.\s*findFirst\s*\(/.test(code)) bad.push(`${file}: organization.findFirst`)
    if (/\b(theOrg|oldestOrg\w*|defaultOrg\w*|firstOrg\w*)\b/.test(code)) bad.push(`${file}: org-picking helper`)
    if (/registryContext\(\)\s*\)?\s*\.\s*org\b/.test(code) || /\.org\b\s*\?\.id/.test(code)) bad.push(`${file}: registryContext().org`)
    if (/organization\s*\.\s*findMany\s*\(\s*\{[^}]*take\s*:\s*1/.test(code)) bad.push(`${file}: organization.findMany take 1`)
    if (/auditOrganizationId\(\s*\)/.test(code)) bad.push(`${file}: auditOrganizationId() without the record`)
  }
  assert.deepEqual(bad, [])
})

test('static guard: no raw organization override from the request reaches a decision or a write', () => {
  const bad = []
  for (const { file, code } of GUARDED) {
    if (/organizationId\s*[:=]\s*(?:String\(\s*)?(?:r\.query|r\.params|r\.req\.headers|req\.headers|b\??\.|body\??\.)/.test(code)) bad.push(`${file}: organizationId taken from the request`)
    if (/headers\s*(?:\[\s*['"`]|\.\s*)x-?organi[sz]ation/i.test(code)) bad.push(`${file}: organization header`)
    if (/(?:query|params)\s*\.\s*organi[sz]ationId/.test(code)) bad.push(`${file}: organizationId query/param`)
  }
  assert.deepEqual(bad, [])
})

test('static guard: authorization evidence is created only by the central authorizer, audit rows only through writeAdminAudit', () => {
  const bad = []
  for (const { file, code } of GUARDED) {
    if (/authorizationEvidence\s*\.\s*(create|createMany|upsert|update|delete)/.test(code) && !/authz\/(evidence|index)\.mjs$/.test(file)) bad.push(`${file}: writes authorization_evidence directly`)
    if (/adminAuditLog\s*\.\s*(create|createMany|upsert)/.test(code) && !/authz\/audit\.mjs$/.test(file)) bad.push(`${file}: writes admin_audit_logs directly`)
    if (/securityEvent\s*\.\s*create\b/.test(code) && !/authz\/security-events\.mjs$/.test(file)) bad.push(`${file}: writes security_events directly`)
  }
  assert.deepEqual(bad, [])
})

test('static guard: admin2 routes never read security / audit / evidence rows without an organization restriction (whole-file, refactor-tolerant)', () => {
  const bad = []
  for (const { file, code } of filesIn('server/routes/admin2')) {
    const re = /\b(adminAuditLog|securityEvent|authorizationEvidence)\s*\.\s*(findMany|findFirst|count|groupBy|aggregate)\s*\(/g
    let m
    while ((m = re.exec(code))) {
      const window = code.slice(m.index, m.index + 700)
      if (!/inOrganizations|auditWhere|organizationId/.test(window)) bad.push(`${file}: ${m[1]}.${m[2]} without an organization restriction`)
    }
  }
  assert.deepEqual(bad, [])
})

test('static guard: every route file declares its authorization (r.require / can / requireAnywhere / authorizedPlaces ...) -- no route reads data unguarded', () => {
  const bad = []
  for (const { file, code } of filesIn('server/routes/admin2')) {
    if (/index\.mjs$|router\.mjs$|scope\.mjs$/.test(file)) continue
    const handlers = code.split(/router\.(?:get|post|put|patch|delete)\(/).slice(1)
    for (const h of handlers) {
      const head = h.slice(0, 1500)
      if (!/r\.require|r\.can|requireAnywhere|authorizedPlaces|authorizedOrganization|visibleScope|requireRecord|canRecord|partyAccess|entityAccess|orgsFor|idsFor|requireOnUser|requireOnAssignment|requireCatalogue|requireGlobal|authorizeScopes|loadForDecision|transition\(|suspendRoute|requireEntity|authorizedPlatformsFor/.test(head)) bad.push(`${file}: ${h.slice(0, 60).replace(/\s+/g, ' ')}`)
    }
  }
  assert.deepEqual(bad, [])
})
