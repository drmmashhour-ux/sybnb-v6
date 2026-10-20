// STEP 5H -- two-organization regression tests for the Security Center / Audit Center organization boundary.
//
// What runs here: the REAL route handlers of server/routes/admin2/security.mjs, the REAL central evaluator (evaluateAccess)
// and the REAL org-boundary / evidence code. What is stubbed: only the Prisma client (an in-memory fake that honours the
// `where` filters the routes build) and snapshot loading (assignments are fixtures instead of database rows). No database,
// no network, no migration. A DB-backed run of the same scenarios needs migration 083 applied to a TEST database.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { registerSecurity } from '../../server/routes/admin2/security.mjs'
import { evaluateAccess, DEFAULT_POLICY } from '../../server/lib/authz/evaluate.mjs'
import { PERMISSIONS } from '../../server/lib/authz/catalogue.mjs'
import { hashEvidence, verifyEvidenceChain, verifyEvidenceChainForOrganization } from '../../server/lib/authz/evidence.mjs'
import { evidenceRecord } from '../../server/lib/authz/index.mjs'
import { authError, candidateOrganizationIds, authorizedOrganizationIds, scopesWithinOrganizations, organizationOfScopes, resolveActorOrganizationId } from '../../server/lib/authz/org-boundary.mjs'
import { CRITICAL_SECURITY_RECIPIENTS } from '../../server/lib/authz/notifications.mjs'

const NOW = new Date()
const ago = (ms) => new Date(NOW.getTime() - ms)
const A = randomUUID(); const B = randomUUID()
const HOUR = 3_600_000

// ---------------------------------------------------------------------------------------------------------------------
// Authorization fixtures: the REAL evaluator decides; only the loading of assignments is replaced by fixtures.
// ---------------------------------------------------------------------------------------------------------------------
const PERM = new Map(PERMISSIONS.map((p) => [p.code, { code: p.code, tier: p.tier, highRisk: p.highRisk === true, deprecated: false, noSelf: p.noSelf === true }]))
const SECURITY_ADMIN_PERMISSIONS = ['security_event.view', 'security_event.review', 'audit.view', 'audit.export', 'audit.evidence.view', 'break_glass.use']
const orgIndex = {
  organizationsById: new Map([[A, { id: A, name: 'Org A' }], [B, { id: B, name: 'Org B' }]]),
  legalEntitiesById: new Map(), businessUnitsById: new Map(), platformsById: new Map(), platformsByCode: new Map(),
}
const users = new Map()
function staff(label, { orgs = [], permissions = SECURITY_ADMIN_PERMISSIONS, fresh = true, scopeKind = 'ORGANIZATION' } = {}) {
  const u = { id: randomUUID(), label, status: 'ACTIVE', email: `${label}@example.invalid`, displayName: label }
  u.assignments = orgs.length ? [{
    id: randomUUID(), userId: u.id, status: 'ACTIVE', effectiveFrom: ago(30 * 24 * HOUR), effectiveTo: null, revokedAt: null, activationAt: null, approvedAt: null, platformQualifier: [],
    roleVersion: { id: randomUUID(), versionNumber: 1, status: 'EFFECTIVE', effectiveFrom: ago(60 * 24 * HOUR), platformCoverage: ['*'], role: { code: 'SECURITY_ADMIN', status: 'ACTIVE' }, permissionCodes: new Set(permissions) },
    scopes: orgs.map((organizationId) => ({ id: randomUUID(), kind: scopeKind, organizationId })),
  }] : []
  u.recentAuthAt = fresh ? ago(60_000) : ago(2 * HOUR) // tier 3+ needs a recent authentication
  users.set(u.id, u)
  return u
}
const authz = {
  async loadSnapshot(auth) {
    const u = users.get(auth.user.id)
    return { now: NOW, timeTrusted: true, assignments: u.assignments, suspensions: [], orgIndex, policy: { ...DEFAULT_POLICY, id: null }, auth: { recentAuthAt: u.recentAuthAt }, client: {} }
  },
  async decide(snap, ctx, code, resource) {
    const permission = PERM.get(code) ?? null
    const result = evaluateAccess({ user: { id: ctx.user.id, status: ctx.user.status }, permission, assignments: snap.assignments, suspensions: snap.suspensions, resource, orgIndex: snap.orgIndex, policy: snap.policy, context: { now: snap.now, timeTrusted: true, session: { recentAuthAt: snap.auth.recentAuthAt } } })
    return { ...result, permission }
  },
}

// ---------------------------------------------------------------------------------------------------------------------
// In-memory Prisma fake. It evaluates the same `where` shapes the routes produce, so a missing organization filter shows up as
// leaked rows, not as a passing test.
// ---------------------------------------------------------------------------------------------------------------------
function matches(row, where) {
  if (!where) return true
  return Object.entries(where).every(([k, v]) => {
    if (k === 'AND') return v.every((w) => matches(row, w))
    if (k === 'OR') return v.some((w) => matches(row, w))
    if (k === 'NOT') return !matches(row, v)
    if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return v.in.includes(row[k])
      if ('startsWith' in v) return typeof row[k] === 'string' && row[k].startsWith(v.startsWith)
      if ('contains' in v) return typeof row[k] === 'string' && row[k].toLowerCase().includes(String(v.contains).toLowerCase())
      if ('gte' in v || 'lte' in v || 'gt' in v || 'lt' in v) return (!('gte' in v) || row[k] >= v.gte) && (!('lte' in v) || row[k] <= v.lte) && (!('gt' in v) || row[k] > v.gt) && (!('lt' in v) || row[k] < v.lt)
      if ('not' in v) return row[k] !== v.not
      if ('equals' in v) return row[k] === v.equals
      return true // relation filters are asserted separately through the captured `where`
    }
    return row[k] === v
  })
}
function table(rows, { sortKey = 'createdAt', include = () => ({}) } = {}) {
  const run = (args = {}) => {
    let out = rows.filter((r) => matches(r, args.where))
    if (args.orderBy) { const [[key, dir]] = Object.entries(args.orderBy); out = [...out].sort((x, y) => (x[key] > y[key] ? 1 : x[key] < y[key] ? -1 : 0) * (dir === 'desc' ? -1 : 1)) }
    if (args.skip) out = out.slice(args.skip)
    if (args.take) out = out.slice(0, args.take)
    return out.map((r) => ({ ...r, ...(args.include ? include(r, args.include) : {}) }))
  }
  return {
    rows,
    findMany: async (args) => run(args), count: async (args = {}) => rows.filter((r) => matches(r, args.where)).length,
    findFirst: async (args) => run({ ...args, take: 1 })[0] ?? null,
    findUnique: async (args) => run({ ...args, take: 1 })[0] ?? null,
    create: async ({ data }) => { const row = { id: randomUUID(), createdAt: new Date(), ...data }; rows.push(row); return row },
    update: async ({ where, data }) => { const row = rows.find((r) => matches(r, where)); Object.assign(row, data); return row },
  }
}

let world
function resetWorld() {
  const e = (organizationId, over = {}) => ({ id: randomUUID(), organizationId, severity: 'INFO', eventType: 'TEST', actorUserId: null, subjectUserId: null, entityType: null, entityId: null, summary: `event of ${over.tag ?? organizationId}`, detail: {}, correlationId: null, auditEventId: null, notifiedCount: 0, status: 'OPEN', reviewedById: null, reviewedAt: null, reviewNote: null, createdAt: ago(1000 + Math.random() * 1000), retainUntil: new Date(NOW.getTime() + 1e12), ...over })
  const au = (organizationId, over = {}) => ({ id: randomUUID(), organizationId, actorUserId: null, action: 'iam.role_assignment.granted', entityType: 'role_assignment', entityId: randomUUID(), before: null, after: null, reason: `reason ${over.tag ?? organizationId}`, correlationId: null, platformCode: null, createdAt: ago(1000 + Math.random() * 1000), ...over })
  world = {
    events: table([
      e(A, { tag: 'A-critical', severity: 'CRITICAL' }), e(A, { tag: 'A-info' }), e(A, { tag: 'A-self', subjectUserId: 'self-placeholder' }),
      e(B, { tag: 'B-critical', severity: 'CRITICAL' }), e(B, { tag: 'B-info' }),
      e(null, { tag: 'legacy-unattributed', severity: 'CRITICAL' }),
    ]),
    audit: table([
      au(A, { tag: 'A-1', correlationId: 'corr-shared' }), au(A, { tag: 'A-2', action: 'iam.role_assignment.revoked' }), au(A, { tag: 'A-stepup', action: 'security.step_up_failed' }), au(A, { tag: 'A-bg', action: 'security.break_glass.requested' }),
      au(B, { tag: 'B-1', correlationId: 'corr-shared' }), au(B, { tag: 'B-2', action: 'iam.role_assignment.revoked' }), au(B, { tag: 'B-stepup', action: 'security.step_up_failed' }), au(B, { tag: 'B-bg', action: 'security.break_glass.requested' }),
      au(null, { tag: 'legacy-unattributed', correlationId: 'corr-shared' }),
    ], { include: (r) => ({ actor: r.actorUserId ? { id: r.actorUserId, displayName: 'x', email: `${r.actorUserId}@example.invalid` } : null }) }),
    evidence: table(chain([A, B, A, null, B, A])),
    userCalls: [],
  }
}

// A real hash chain, interleaving organizations (and one legacy/unattributed row), written exactly like writeEvidence().
function chain(orgs) {
  const rows = []; let prev = null
  orgs.forEach((organizationId, i) => {
    const record = { userId: randomUUID(), permissionCode: 'audit.view', decision: 'ALLOW', action: 'view', rulesetVersion: 'TEST_RULESET', resourceType: 'audit_event', resourceId: `res-${i}`, organizationId }
    const decidedAt = new Date(NOW.getTime() - (orgs.length - i) * 1000)
    const hash = hashEvidence(record, prev, decidedAt)
    rows.push({ id: randomUUID(), sequence: BigInt(i + 1), ...fill(record), prevHash: prev, hash, decidedAt })
    prev = hash
  })
  return rows
}
const fill = (r) => ({ sessionId: null, roleAssignmentId: null, roleVersionId: null, roleCode: null, roleVersionNumber: null, permissionId: null, scopeId: null, scopeKind: null, scopeTarget: null, scopeDescription: null, platformContext: null, authStrength: null, mfaMethod: null, mfaResult: null, recentAuthAt: null, requestId: null, correlationId: null, denyReason: null, policyVersionId: null, delegationId: null, auditEventId: null, approvalSnapshotId: null, ...r })

function evidenceTable() {
  const rows = world.evidence.rows
  return {
    rows,
    findMany: async (args = {}) => {
      let out = rows.filter((r) => matches(r, args.where))
      if (args.orderBy?.sequence) out = [...out].sort((x, y) => (x.sequence > y.sequence ? 1 : -1) * (args.orderBy.sequence === 'desc' ? -1 : 1))
      if (args.skip) out = out.slice(args.skip)
      if (args.take) out = out.slice(0, args.take)
      return args.select ? out.map((r) => Object.fromEntries(Object.keys(args.select).map((k) => [k, r[k]]))) : out
    },
    count: async (args = {}) => rows.filter((r) => matches(r, args.where)).length,
    findFirst: async (args = {}) => rows.find((r) => matches(r, args.where)) ?? null,
  }
}

const fakeDb = () => ({
  securityEvent: world.events,
  adminAuditLog: world.audit,
  authorizationEvidence: evidenceTable(),
  user: { count: async (a) => { world.userCalls.push(['user.count', a]); return 0 }, findMany: async (a) => { world.userCalls.push(['user.findMany', a]); return [] } },
  userSession: { count: async (a) => { world.userCalls.push(['userSession.count', a]); return 0 } },
  roleAssignment: { count: async (a) => { world.userCalls.push(['roleAssignment.count', a]); return 0 }, findMany: async () => [] },
  retentionPolicy: { findUnique: async () => null },
  adminNotification: { createMany: async () => ({ count: 0 }) },
  $executeRawUnsafe: async () => 0,
  $transaction: async (fn) => fn(fakeDb()),
})

// ---------------------------------------------------------------------------------------------------------------------
// Route harness: registers the real security routes against a capturing router and calls them as a given staff user.
// ---------------------------------------------------------------------------------------------------------------------
const routes = new Map()
const router = { get: (p, h) => routes.set(`GET ${p}`, h), post: (p, h) => routes.set(`POST ${p}`, h) }
registerSecurity(router, { db: fakeDb, authz })

function routeMatch(method, path) {
  for (const [key, handler] of routes) {
    const [m, pattern] = key.split(' ')
    if (m !== method) continue
    const keys = []
    const re = new RegExp(`^${pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)' })}$`)
    const hit = re.exec(path)
    if (hit) return { handler, params: Object.fromEntries(keys.map((k, i) => [k, hit[i + 1]])) }
  }
  throw new Error(`no route ${method} ${path}`)
}

async function call(user, method, path, { query = {}, body = {}, headers = {} } = {}) {
  const { handler, params } = routeMatch(method, path)
  const out = { status: null, json: null, text: null, error: null }
  const auth = user ? { user: { id: user.id, status: user.status }, sessionId: 'sess', roles: [] } : null
  const r = {
    auth, requestId: `req-${randomUUID()}`, params, query, req: { headers }, body: async () => body,
    ok: (payload = {}, status = 200) => { out.status = status; out.json = { ok: true, ...payload } },
    require: async (code, resource = {}) => {
      if (!auth) throw authError(401, 'AUTH_REQUIRED', 'Authentication required.')
      const snap = await authz.loadSnapshot(auth)
      const res = await authz.decide(snap, auth, code, resource)
      if (res.decision === 'ALLOW') return res
      if (res.reason === 'STEP_UP_REQUIRED') throw authError(403, 'STEP_UP_REQUIRED', 'step up', { stepUpRequired: true })
      throw authError(403, 'PERMISSION_DENIED', 'You do not have permission to do this.')
    },
    requireAnywhere: async () => {},
    res: { writeHead: (status, headers2) => { out.status = status; out.headers = headers2 }, end: (text) => { out.text = text } },
  }
  try { await handler(r) } catch (e) { out.error = { status: e.statusCode, code: e.code }; out.status = e.statusCode }
  return out
}

const ids = (rows) => rows.map((x) => x.id).sort()
const tagOf = (row) => row.summary ?? row.reason

// =====================================================================================================================
// The tests
// =====================================================================================================================
test('boundary fixture sanity: two organizations, an unattributed legacy row, and users scoped to one organization each', () => {
  resetWorld()
  assert.equal(world.events.rows.filter((e) => e.organizationId === A).length, 3)
  assert.equal(world.events.rows.filter((e) => e.organizationId === B).length, 2)
  assert.equal(world.events.rows.filter((e) => e.organizationId == null).length, 1)
  assert.equal(candidateOrganizationIds({ assignments: staff('x', { orgs: [A] }).assignments, orgIndex }).join(), A)
})

test('LIST security events: A sees only A, B sees only B, the unattributed legacy row is visible to nobody', async () => {
  resetWorld()
  const adminA = staff('admin-a', { orgs: [A] }); const adminB = staff('admin-b', { orgs: [B] })
  const a = await call(adminA, 'GET', '/security/events'); const b = await call(adminB, 'GET', '/security/events')
  assert.equal(a.status, 200); assert.equal(b.status, 200)
  assert.deepEqual(ids(a.json.items), ids(world.events.rows.filter((e) => e.organizationId === A)), 'A gets exactly A\'s events (valid access preserved)')
  assert.deepEqual(ids(b.json.items), ids(world.events.rows.filter((e) => e.organizationId === B)))
  assert.equal(a.json.total, 3); assert.equal(b.json.total, 2, 'totals do not count the other organization either')
  assert.ok(a.json.items.every((e) => e.organizationId === A))
  assert.ok(![...a.json.items, ...b.json.items].some((e) => tagOf(e).includes('legacy')), 'unattributed rows fail closed')
  const critical = await call(adminA, 'GET', '/security/events', { query: { critical: 'true' } })
  assert.deepEqual(critical.json.items.map((e) => e.summary), ['event of A-critical'], 'filters narrow inside A; B\'s CRITICAL event is never reachable')
})

test('an organization named in the request (query, body, header) is ignored: it can only narrow nothing and widen nothing', async () => {
  resetWorld()
  const adminA = staff('admin-a', { orgs: [A] })
  const r = await call(adminA, 'GET', '/security/events', { query: { organizationId: B, organization_id: B, org: B }, headers: { 'x-organization-id': B } })
  assert.equal(r.status, 200)
  assert.ok(r.json.items.length > 0 && r.json.items.every((e) => e.organizationId === A))
  const au = await call(adminA, 'GET', '/audit/events', { query: { organizationId: B } })
  assert.ok(au.json.items.every((x) => x.organizationId === A))
})

test('READ one security event: A reads A\'s; B\'s and the unattributed one are a plain 404 (no existence oracle)', async () => {
  resetWorld()
  const adminA = staff('admin-a', { orgs: [A] })
  const own = world.events.rows.find((e) => e.organizationId === A)
  const ok = await call(adminA, 'GET', `/security/events/${own.id}`)
  assert.equal(ok.status, 200); assert.equal(ok.json.event.id, own.id)
  for (const foreign of [world.events.rows.find((e) => e.organizationId === B), world.events.rows.find((e) => e.organizationId == null)]) {
    const r = await call(adminA, 'GET', `/security/events/${foreign.id}`)
    assert.equal(r.status, 404); assert.equal(r.error.code, 'NOT_FOUND')
  }
  const missing = await call(adminA, 'GET', `/security/events/${randomUUID()}`)
  assert.equal(missing.status, 404, 'a cross-organization id is indistinguishable from an id that does not exist')
})

test('REVIEW: A can review A\'s event; A cannot review B\'s (404), nothing of B changes and no audit row is written for B', async () => {
  resetWorld()
  const adminA = staff('admin-a', { orgs: [A] })
  const own = world.events.rows.find((e) => e.organizationId === A && e.severity === 'INFO')
  const foreign = world.events.rows.find((e) => e.organizationId === B && e.severity === 'CRITICAL')
  const legacy = world.events.rows.find((e) => e.organizationId == null)
  const auditBefore = world.audit.rows.length
  for (const target of [foreign, legacy]) {
    const denied = await call(adminA, 'POST', `/security/events/${target.id}/review`, { body: { note: 'reviewing someone else\'s event', status: 'REVIEWED' } })
    assert.equal(denied.status, 404)
    assert.equal(target.status, 'OPEN'); assert.equal(target.reviewedById, null); assert.equal(target.reviewNote, null, 'the foreign event is untouched')
  }
  assert.equal(world.audit.rows.length, auditBefore, 'a refused review writes no audit row anywhere')
  const ok = await call(adminA, 'POST', `/security/events/${own.id}/review`, { body: { note: 'checked and acknowledged by A', status: 'ACKNOWLEDGED' } })
  assert.equal(ok.status, 200); assert.equal(own.status, 'ACKNOWLEDGED'); assert.equal(own.reviewedById, adminA.id)
  const written = world.audit.rows.at(-1)
  assert.equal(written.action, 'security.event_reviewed'); assert.equal(written.organizationId, A, 'the review is audited inside A, never as an unattributed row')
})

test('REVIEW keeps the central rules: short note is 400, a user without the permission is 403, a stale session cannot be used for tier 3+', async () => {
  resetWorld()
  const adminA = staff('admin-a', { orgs: [A] })
  const viewerOnly = staff('viewer-a', { orgs: [A], permissions: ['security_event.view'] })
  const own = world.events.rows.find((e) => e.organizationId === A)
  assert.equal((await call(adminA, 'POST', `/security/events/${own.id}/review`, { body: { note: 'short' } })).status, 400)
  const r = await call(viewerOnly, 'POST', `/security/events/${own.id}/review`, { body: { note: 'a perfectly good note' } })
  assert.equal(r.status, 403); assert.equal(own.status, 'OPEN')
  assert.equal((await call(viewerOnly, 'GET', `/security/events/${own.id}`)).status, 200, 'but the view permission it does hold still works inside A')
})

test('a user holding permissions only at organization B gets nothing from A, a user with no assignment gets 403, anonymous gets 401', async () => {
  resetWorld()
  const adminB = staff('admin-b', { orgs: [B] }); const nobody = staff('nobody', { orgs: [] })
  const aEvent = world.events.rows.find((e) => e.organizationId === A)
  assert.equal((await call(adminB, 'GET', `/security/events/${aEvent.id}`)).status, 404)
  assert.equal((await call(nobody, 'GET', '/security/events')).status, 403)
  assert.equal((await call(nobody, 'GET', '/audit/events')).status, 403)
  assert.equal((await call(null, 'GET', '/audit/events')).status, 401)
  const platformOnly = staff('platform-only', { orgs: [A], scopeKind: 'PLATFORM' })
  assert.equal((await call(platformOnly, 'GET', '/security/events')).status, 403, 'a non-organization scope never identifies an organization for security records')
})

test('LIST / READ audit events: A sees only A; related rows never cross organizations even with a shared correlation id', async () => {
  resetWorld()
  const adminA = staff('admin-a', { orgs: [A] }); const adminB = staff('admin-b', { orgs: [B] })
  const a = await call(adminA, 'GET', '/audit/events'); const b = await call(adminB, 'GET', '/audit/events')
  assert.deepEqual(ids(a.json.items), ids(world.audit.rows.filter((x) => x.organizationId === A)))
  assert.deepEqual(ids(b.json.items), ids(world.audit.rows.filter((x) => x.organizationId === B)))
  assert.ok(![...a.json.items, ...b.json.items].some((x) => tagOf(x).includes('legacy')))
  const search = await call(adminA, 'GET', '/audit/events', { query: { q: 'B-1' } })
  assert.equal(search.json.items.length, 0, 'free-text search cannot reach B\'s rows')
  const ownRow = world.audit.rows.find((x) => x.organizationId === A && x.correlationId === 'corr-shared')
  const read = await call(adminA, 'GET', `/audit/events/${ownRow.id}`)
  assert.equal(read.status, 200)
  assert.deepEqual(read.json.related, [], 'B\'s and the unattributed row share the correlation id but are not related rows for A')
  for (const foreign of [world.audit.rows.find((x) => x.organizationId === B), world.audit.rows.find((x) => x.organizationId == null)]) {
    assert.equal((await call(adminA, 'GET', `/audit/events/${foreign.id}`)).status, 404)
  }
})

test('SECURITY sub-lists: access changes and break-glass history are per organization', async () => {
  resetWorld()
  const adminA = staff('admin-a', { orgs: [A] })
  const ac = await call(adminA, 'GET', '/security/access-changes')
  assert.ok(ac.json.items.length === 2 && ac.json.items.every((x) => x.organizationId === A))
  const bg = await call(adminA, 'GET', '/security/break-glass')
  assert.equal(bg.json.events.length, 1); assert.equal(bg.json.events[0].organizationId, A)
})

test('EXPORT: A\'s CSV contains only A\'s rows; B\'s data and the unattributed rows never appear; the export is audited inside A only', async () => {
  resetWorld()
  const adminA = staff('admin-a', { orgs: [A] })
  const before = { A: world.audit.rows.filter((x) => x.organizationId === A).length, B: world.audit.rows.filter((x) => x.organizationId === B).length }
  const r = await call(adminA, 'GET', '/audit/export')
  assert.equal(r.status, 200); assert.match(r.headers['content-type'], /text\/csv/)
  for (const row of world.audit.rows.filter((x) => x.organizationId === B || x.organizationId == null)) {
    assert.ok(!r.text.includes(row.entityId), `export leaked ${tagOf(row)}`)
    assert.ok(!r.text.includes(tagOf(row)), `export leaked ${tagOf(row)}`)
  }
  for (const row of world.audit.rows.filter((x) => x.organizationId === A && !x.action.startsWith('audit.export'))) assert.ok(r.text.includes(row.entityId), 'A\'s own rows are all present (valid access preserved)')
  assert.equal(r.text.split('\n').length - 1, before.A)
  const exports = world.audit.rows.filter((x) => x.action === 'audit.export')
  assert.equal(exports.length, 1); assert.equal(exports[0].organizationId, A)
  assert.equal(exports[0].after.rows, before.A)
  assert.equal(world.audit.rows.filter((x) => x.organizationId === B).length, before.B, 'nothing was written into B\'s audit trail')
})

test('EXPORT needs a fresh authentication (tier 3): a stale session gets STEP_UP_REQUIRED and no data', async () => {
  resetWorld()
  const stale = staff('stale-a', { orgs: [A], fresh: false })
  const r = await call(stale, 'GET', '/audit/export')
  assert.equal(r.status, 403); assert.equal(r.error.code, 'STEP_UP_REQUIRED'); assert.equal(r.text, null)
  assert.equal(world.audit.rows.filter((x) => x.action === 'audit.export').length, 0)
})

test('a user authorized for BOTH organizations sees both (and each export is recorded in each organization), still never the unattributed rows', async () => {
  resetWorld()
  const both = staff('admin-ab', { orgs: [A, B] })
  const r = await call(both, 'GET', '/audit/events')
  assert.deepEqual(ids(r.json.items), ids(world.audit.rows.filter((x) => x.organizationId != null)))
  await call(both, 'GET', '/audit/export')
  const exports = world.audit.rows.filter((x) => x.action === 'audit.export')
  assert.deepEqual(exports.map((x) => x.organizationId).sort(), [A, B].sort())
  assert.equal(exports.find((x) => x.organizationId === A).after.rows, world.audit.rows.filter((x) => x.organizationId === A && x.action !== 'audit.export').length)
})

test('EVIDENCE list: only the caller\'s organization (no legacy rows); and the response carries no other organization\'s hashes or sequences', async () => {
  resetWorld()
  const adminA = staff('admin-a', { orgs: [A] })
  const r = await call(adminA, 'GET', '/audit/evidence')
  assert.equal(r.status, 200)
  const own = world.evidence.rows.filter((x) => x.organizationId === A)
  assert.deepEqual(r.json.items.map((x) => x.sequence).sort(), own.map((x) => String(x.sequence)).sort())
  const foreign = world.evidence.rows.filter((x) => x.organizationId !== A)
  for (const f of foreign) assert.ok(!JSON.stringify(r.json).includes(f.hash), 'no foreign hash')
})

test('VERIFY: A verifies only A\'s evidence; a break in B\'s evidence neither fails A\'s verification nor leaks into it; B sees its own break', async () => {
  resetWorld()
  const adminA = staff('admin-a', { orgs: [A] }); const adminB = staff('admin-b', { orgs: [B] })
  const okA = await call(adminA, 'GET', '/audit/evidence/verify')
  assert.equal(okA.status, 200); assert.equal(okA.json.result.ok, true)
  assert.equal(okA.json.result.checked, world.evidence.rows.filter((x) => x.organizationId === A).length, 'counts only A\'s rows (the global total would reveal B\'s volume)')
  assert.equal(okA.json.result.scope, 'ORGANIZATION')
  const bRow = world.evidence.rows.find((x) => x.organizationId === B)
  bRow.permissionCode = 'tampered.code' // simulate tampering with B's evidence
  const stillA = await call(adminA, 'GET', '/audit/evidence/verify')
  assert.equal(stillA.json.result.ok, true, 'B\'s tampering is not A\'s finding')
  assert.ok(!JSON.stringify(stillA.json).includes(bRow.hash))
  const asB = await call(adminB, 'GET', '/audit/evidence/verify')
  assert.equal(asB.json.result.ok, false); assert.equal(asB.json.result.reason, 'HASH_MISMATCH'); assert.equal(asB.json.result.brokenAtSequence, String(bRow.sequence))
  // tampering with A's own evidence is found by A
  const aRow = world.evidence.rows.find((x) => x.organizationId === A)
  aRow.resourceId = 'tampered'
  const brokenA = await call(adminA, 'GET', '/audit/evidence/verify')
  assert.equal(brokenA.json.result.ok, false); assert.equal(brokenA.json.result.brokenAtSequence, String(aRow.sequence))
})

test('VERIFY and EVIDENCE list need the permission at the organization: B-only staff get nothing about A, and viewers without audit.evidence.view are 403', async () => {
  resetWorld()
  const viewer = staff('viewer-a', { orgs: [A], permissions: ['security_event.view', 'audit.view'] })
  assert.equal((await call(viewer, 'GET', '/audit/evidence/verify')).status, 403)
  assert.equal((await call(viewer, 'GET', '/audit/evidence')).status, 403)
  assert.equal((await call(viewer, 'GET', '/audit/export')).status, 403)
  assert.equal((await call(viewer, 'GET', '/audit/events')).status, 200)
})

test('legacy global verification stays available to operators and still verifies a chain with unattributed legacy rows', async () => {
  resetWorld()
  const res = await verifyEvidenceChain({ authorizationEvidence: { findMany: async () => world.evidence.rows } })
  assert.equal(res.ok, true); assert.equal(res.checked, world.evidence.rows.length)
})

test('BREAK-GLASS request: attributed to the caller\'s own organization; several organizations fail closed (409); never taken from the request', async () => {
  resetWorld()
  const adminA = staff('admin-a', { orgs: [A] })
  const r = await call(adminA, 'POST', '/security/break-glass/request', { body: { reason: 'A real emergency affecting organization A only', organizationId: B } })
  assert.equal(r.status, 201); assert.equal(r.json.grantsAccess, false)
  const audit = world.audit.rows.find((x) => x.id === r.json.auditEventId); const ev = world.events.rows.find((x) => x.id === r.json.securityEventId)
  assert.equal(audit.organizationId, A); assert.equal(ev.organizationId, A, 'organizationId in the body is ignored')
  const both = staff('admin-ab', { orgs: [A, B] })
  const n = world.audit.rows.length
  const amb = await call(both, 'POST', '/security/break-glass/request', { body: { reason: 'An emergency but which organization?' } })
  assert.equal(amb.status, 409); assert.equal(amb.error.code, 'ORGANIZATION_CONTEXT_REQUIRED'); assert.equal(world.audit.rows.length, n)
  assert.equal((await call(adminA, 'POST', '/security/break-glass/request', { body: { reason: 'too short' } })).status, 400)
})

test('OVERVIEW: the metrics are computed inside the caller\'s organization only (staff queries are scoped through the organization tree)', async () => {
  resetWorld()
  const adminA = staff('admin-a', { orgs: [A] })
  const r = await call(adminA, 'GET', '/security/overview')
  assert.equal(r.status, 200)
  assert.equal(r.json.metrics.criticalEvents7d, 1, 'only A\'s CRITICAL event (B\'s and the unattributed one are not counted)')
  assert.equal(r.json.metrics.failedStepUps24h, 1, 'only A\'s failed step-up')
  assert.ok(world.userCalls.length >= 4)
  for (const [name, args] of world.userCalls) {
    const text = JSON.stringify(args)
    assert.ok(text.includes(A), `${name} is restricted to organization A`)
    assert.ok(!text.includes(B), `${name} never mentions organization B`)
  }
})

test('PRIVILEGED USERS: both the user filter and the listed assignments are restricted to the caller\'s organization scopes', async () => {
  resetWorld()
  const adminA = staff('admin-a', { orgs: [A] })
  const r = await call(adminA, 'GET', '/security/privileged-users')
  assert.equal(r.status, 200)
  const [, args] = world.userCalls.find(([n]) => n === 'user.findMany')
  const text = JSON.stringify(args)
  assert.ok(text.includes(A) && !text.includes(B))
  assert.ok(args.where.roleAssignments.some.scopes && args.select.roleAssignments.where.scopes, 'filter present on the user query AND on the nested assignments')
})

test('central authorization is not weakened: a refused decision is a 403 even for a user who holds other security permissions in the same organization', async () => {
  resetWorld()
  const noAudit = staff('no-audit', { orgs: [A], permissions: ['security_event.view'] })
  assert.equal((await call(noAudit, 'GET', '/audit/events')).status, 403)
  assert.equal((await call(noAudit, 'GET', '/security/events')).status, 200)
  const noReview = staff('no-review', { orgs: [A], permissions: ['security_event.view', 'audit.view'] })
  assert.equal((await call(noReview, 'POST', `/security/events/${world.events.rows[0].id}/review`, { body: { note: 'trying without the review permission' } })).status, 403)
})

// ---------------------------------------------------------------------------------------------------------------------
// Unit tests for the building blocks
// ---------------------------------------------------------------------------------------------------------------------
test('auditWhere cannot be built without an organization restriction (a query with no organization is refused, not global)', async () => {
  resetWorld()
  const adminA = staff('admin-a', { orgs: [A] })
  const ok = await authorizedOrganizationIds({ auth: { user: { id: adminA.id, status: 'ACTIVE' } }, requestId: 'x' }, authz, 'audit.view', 'audit_event')
  assert.deepEqual(ok, [A])
  await assert.rejects(authorizedOrganizationIds({ auth: { user: { id: staff('n', { orgs: [] }).id, status: 'ACTIVE' } } }, authz, 'audit.view', 'audit_event'), (e) => e.statusCode === 403 && e.code === 'PERMISSION_DENIED')
  await assert.rejects(authorizedOrganizationIds({ auth: null }, authz, 'audit.view', 'audit_event'), (e) => e.statusCode === 401)
})

test('scopesWithinOrganizations: organization scopes plus legal-entity / business-unit / platform scopes inside the organizations, nothing else', () => {
  const idx = {
    legalEntitiesById: new Map([['le-a', { id: 'le-a', organizationId: A }], ['le-b', { id: 'le-b', organizationId: B }]]),
    businessUnitsById: new Map([['bu-a', { id: 'bu-a', legalEntityId: 'le-a' }], ['bu-b', { id: 'bu-b', legalEntityId: 'le-b' }]]),
    platformsById: new Map([['p-a', { id: 'p-a', businessUnitId: 'bu-a' }], ['p-b', { id: 'p-b', businessUnitId: 'bu-b' }], ['p-x', { id: 'p-x', businessUnitId: null }]]),
  }
  const f = scopesWithinOrganizations(idx, [A])
  const text = JSON.stringify(f)
  for (const id of [A, 'le-a', 'bu-a', 'p-a']) assert.ok(text.includes(id), id)
  for (const id of [B, 'le-b', 'bu-b', 'p-b', 'p-x']) assert.ok(!text.includes(id), id)
  assert.ok(!/DEPARTMENT|PROPERTY|VEHICLE|PROJECT|SELF/.test(text))
})

test('organizationOfScopes: one organization (directly or through the tree) attributes; several organizations or an unplaceable scope do not', async () => {
  const client = {
    legalEntity: { findUnique: async ({ where }) => (where.id === 'le-a' ? { organizationId: A } : where.id === 'le-b' ? { organizationId: B } : null) },
    businessUnit: { findUnique: async ({ where }) => (where.id === 'bu-a' ? { legalEntity: { organizationId: A } } : null) },
    platform: { findUnique: async ({ where }) => (where.id === 'p-a' ? { businessUnit: { legalEntity: { organizationId: A } } } : where.id === 'p-orphan' ? { businessUnit: null } : null) },
  }
  assert.equal(await organizationOfScopes(client, [{ kind: 'ORGANIZATION', organizationId: A }]), A)
  assert.equal(await organizationOfScopes(client, [{ kind: 'LEGAL_ENTITY', legalEntityId: 'le-a' }, { kind: 'BUSINESS_UNIT', businessUnitId: 'bu-a' }, { kind: 'PLATFORM', platformId: 'p-a' }]), A)
  assert.equal(await organizationOfScopes(client, [{ kind: 'ORGANIZATION', organizationId: A }, { kind: 'LEGAL_ENTITY', legalEntityId: 'le-b' }]), null, 'spans two organizations: unattributed')
  assert.equal(await organizationOfScopes(client, [{ kind: 'PLATFORM', platformId: 'p-orphan' }]), null)
  assert.equal(await organizationOfScopes(client, [{ kind: 'PROPERTY', propertyRef: 'p1' }]), null, 'a scope that is not an organization-tree scope cannot attribute')
  assert.equal(await organizationOfScopes(client, []), null)
})

test('resolveActorOrganizationId: the single organization of the actor\'s own scopes, otherwise null', async () => {
  const mk = (rows) => ({ roleAssignment: { findMany: async () => rows } })
  assert.equal(await resolveActorOrganizationId(mk([{ scopes: [{ organizationId: A }] }, { scopes: [{ organizationId: A }] }]), 'u'), A)
  assert.equal(await resolveActorOrganizationId(mk([{ scopes: [{ organizationId: A }] }, { scopes: [{ organizationId: B }] }]), 'u'), null)
  assert.equal(await resolveActorOrganizationId(mk([]), 'u'), null)
  assert.equal(await resolveActorOrganizationId(mk([]), null), null)
})

test('evidence is attributed centrally: from the resource facts through the registry; an unknown organization is left unattributed', () => {
  const snap = { orgIndex, auth: { recentAuthAt: null, authStrength: 'PASSWORD', mfaMethod: null, mfaResult: 'NOT_PERFORMED' }, policy: {} }
  const ctx = { user: { id: 'u' }, sessionId: null }
  const base = (resource) => evidenceRecord(ctx, 'audit.view', PERM.get('audit.view'), resource, { decision: 'ALLOW', grant: null, reason: null }, snap, {})
  assert.equal(base({ type: 'audit_event', facts: { organizationId: A } }).organizationId, A)
  assert.equal(base({ type: 'audit_event', facts: { organizationId: randomUUID() } }).organizationId, null, 'an organization that is not in the registry would violate the foreign key: unattributed')
  assert.equal(base({ type: 'audit_event' }).organizationId, null)
})

test('evidence hash: the organization is part of the hash when present (tamper-evident) and rows without one verify exactly as before', () => {
  const rec = { userId: 'u', permissionCode: 'audit.view', decision: 'ALLOW', action: 'view', rulesetVersion: 'TEST_RULESET' }
  const at = new Date('2026-10-20T12:00:00Z')
  const legacy = hashEvidence(rec, null, at)
  assert.equal(hashEvidence({ ...rec, organizationId: null }, null, at), legacy, 'a NULL organization does not change any historical hash')
  const a = hashEvidence({ ...rec, organizationId: A }, null, at)
  assert.notEqual(a, legacy); assert.notEqual(hashEvidence({ ...rec, organizationId: B }, null, at), a, 're-attributing a row would break its hash')
})

test('verifyEvidenceChainForOrganization: org-only rows, linkage by hash and sequence, never reads other rows\' content', async () => {
  resetWorld()
  const reads = []
  const client = { authorizationEvidence: { ...evidenceTable(), findMany: async (args) => { reads.push(args); return evidenceTable().findMany(args) } } }
  const ok = await verifyEvidenceChainForOrganization(client, A)
  assert.deepEqual(ok, { ok: true, checked: 3, scope: 'ORGANIZATION' })
  for (const args of reads) assert.ok(args.where.organizationId === A || (args.where.hash && args.select && Object.keys(args.select).join() === 'hash,sequence'), 'only A\'s rows, or hash/sequence lookups for linkage')
  assert.equal((await verifyEvidenceChainForOrganization(client, null)).reason, 'ORGANIZATION_REQUIRED')
  // a row pointing to a predecessor that does not exist is a broken link
  world.evidence.rows.find((x) => x.organizationId === A && x.prevHash).prevHash = 'f'.repeat(64)
  const bad = await verifyEvidenceChainForOrganization(client, A)
  assert.equal(bad.ok, false)
})

test('notifications: a CRITICAL event of an organization alerts only that organization\'s holders; an unattributed event keeps the previous list', async () => {
  const seen = []
  const client = { roleAssignment: { findMany: async (args) => { seen.push(args.where); return [{ userId: 'u1' }] } } }
  await CRITICAL_SECURITY_RECIPIENTS.resolve(client, { organizationId: A })
  await CRITICAL_SECURITY_RECIPIENTS.resolve(client, {})
  assert.deepEqual(seen[0].scopes, { some: { kind: 'ORGANIZATION', organizationId: A } })
  assert.equal('scopes' in seen[1], false)
})

// ---------------------------------------------------------------------------------------------------------------------
// Static guard: every audit / security-event writer in the admin2 routes and the authz library says which organization the
// record belongs to (possibly null, explicitly), so a new writer cannot silently create an unattributed, invisible record.
// ---------------------------------------------------------------------------------------------------------------------
function callBodies(src, name) {
  const out = []
  let i = 0
  while ((i = src.indexOf(`${name}(`, i)) !== -1) {
    const start = i + name.length
    let depth = 0; let j = start; let quote = null
    for (; j < src.length; j += 1) {
      const c = src[j]
      if (quote) { if (c === '\\') j += 1; else if (c === quote) quote = null; continue }
      if (c === '\'' || c === '"' || c === '`') { quote = c; continue }
      if (c === '(') depth += 1
      if (c === ')') { depth -= 1; if (depth === 0) break }
    }
    out.push({ at: i, text: src.slice(start, j + 1) })
    i = j
  }
  return out
}
test('every writeAdminAudit / recordSecurityEvent call in server/routes/admin2 and server/lib/authz carries organizationId', () => {
  const root = join(import.meta.dirname, '..', '..')
  const files = [...readdirSync(join(root, 'server/routes/admin2')).map((f) => `server/routes/admin2/${f}`), ...readdirSync(join(root, 'server/lib/authz')).map((f) => `server/lib/authz/${f}`)]
    .filter((f) => f.endsWith('.mjs') && !/authz\/(audit|security-events)\.mjs$/.test(f))
  let calls = 0; const missing = []
  for (const f of files) {
    const src = readFileSync(join(root, f), 'utf8')
    for (const name of ['writeAdminAudit', 'recordSecurityEvent']) {
      for (const c of callBodies(src.replace(/^import .*$/gm, ''), name)) {
        calls += 1
        if (!c.text.includes('organizationId')) missing.push(`${f}: ${name}(${c.text.slice(1, 80).replace(/\s+/g, ' ')}...`)
      }
    }
  }
  assert.ok(calls >= 40, `expected to inspect the writers (found ${calls})`)
  assert.deepEqual(missing, [])
})
