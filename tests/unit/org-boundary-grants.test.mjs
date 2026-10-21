// STEP 5J -- anti-escalation at the place of the grant, per-organization last-administrator guard, and the Command Center tile.
// REAL central evaluator + REAL org-boundary helpers; assignments are fixtures. The DB-backed counterpart is
// tests/e2e/admin2-org-boundary-p3.e2e.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DEFAULT_POLICY } from '../../server/lib/authz/evaluate.mjs'
import { PERMISSIONS } from '../../server/lib/authz/catalogue.mjs'
import { callerHoldsPermissionAt } from '../../server/lib/authz/org-boundary.mjs'

const NOW = new Date(); const HOUR = 3_600_000; const ago = (ms) => new Date(NOW.getTime() - ms); const id = () => randomUUID()
const A = id(); const B = id(); const LE_A1 = id(); const LE_B1 = id(); const BU_A1 = id(); const BU_B1 = id()
const P_A1 = { id: id(), code: 'pa1', businessUnitId: BU_A1 }; const P_B1 = { id: id(), code: 'pb1', businessUnitId: BU_B1 }
const by = (rows) => new Map(rows.map((x) => [x.id, x]))
const orgIndex = {
  organizationsById: by([{ id: A }, { id: B }]),
  legalEntitiesById: by([{ id: LE_A1, organizationId: A }, { id: LE_B1, organizationId: B }]),
  businessUnitsById: by([{ id: BU_A1, legalEntityId: LE_A1 }, { id: BU_B1, legalEntityId: LE_B1 }]),
  platformsById: by([P_A1, P_B1]), platformsByCode: new Map([P_A1, P_B1].map((p) => [p.code, p])),
}
const PERM = new Map(PERMISSIONS.map((p) => [p.code, { code: p.code, tier: p.tier, highRisk: p.highRisk === true, deprecated: false, noSelf: p.noSelf === true }]))
const assignment = (userId, scopes, permissions) => ({
  id: id(), userId, status: 'ACTIVE', effectiveFrom: ago(30 * 24 * HOUR), effectiveTo: null, revokedAt: null, activationAt: null, approvedAt: null, platformQualifier: [],
  roleVersion: { id: id(), versionNumber: 1, status: 'EFFECTIVE', effectiveFrom: ago(60 * 24 * HOUR), platformCoverage: ['*'], role: { code: 'X', status: 'ACTIVE' }, permissionCodes: new Set(permissions) },
  scopes: scopes.map((s) => ({ id: id(), ...s })),
})
const snapOf = (assignments, recentAuthAt = ago(60_000)) => ({ now: NOW, timeTrusted: true, assignments, suspensions: [], orgIndex, policy: { ...DEFAULT_POLICY, id: null }, auth: { recentAuthAt } })
const ctx = (userId) => ({ user: { id: userId, status: 'ACTIVE' } })
const holds = (snap, userId, code, facts) => callerHoldsPermissionAt(snap, ctx(userId), PERM.get(code), facts)

// A grantor with access.assign at A and the high-risk role.manage ONLY at B.
const grantor = id()
const snap = snapOf([assignment(grantor, [{ kind: 'ORGANIZATION', organizationId: A }], ['access.assign', 'work.view']), assignment(grantor, [{ kind: 'ORGANIZATION', organizationId: B }], ['role.manage', 'work.view'])])

test('anti-escalation: a permission held only in organization B is NOT held in organization A (and the reverse)', () => {
  assert.equal(holds(snap, grantor, 'role.manage', { organizationId: B }), true)
  assert.equal(holds(snap, grantor, 'role.manage', { organizationId: A }), false, 'role.manage at B must not justify granting it at A')
  assert.equal(holds(snap, grantor, 'access.assign', { organizationId: A }), true)
  assert.equal(holds(snap, grantor, 'access.assign', { organizationId: B }), false)
  assert.equal(holds(snap, grantor, 'work.view', { organizationId: A }), true); assert.equal(holds(snap, grantor, 'work.view', { organizationId: B }), true)
})

test('anti-escalation: an organization-level holder covers its legal entities and platforms; a legal-entity holder covers nothing organization-wide', () => {
  const org = id(); const le = id()
  const s = snapOf([assignment(org, [{ kind: 'ORGANIZATION', organizationId: A }], ['work.view']), assignment(le, [{ kind: 'LEGAL_ENTITY', legalEntityId: LE_A1 }], ['work.view'])])
  for (const facts of [{ organizationId: A }, { legalEntityId: LE_A1 }, { platformCode: 'pa1' }]) assert.equal(holds(s, org, 'work.view', facts), true, JSON.stringify(facts))
  assert.equal(holds(s, org, 'work.view', { organizationId: B }), false)
  assert.equal(holds(s, le, 'work.view', { legalEntityId: LE_A1 }), true)
  assert.equal(holds(s, le, 'work.view', { organizationId: A }), false, 'a child scope never grants organization-wide authority')
  assert.equal(holds(s, le, 'work.view', { platformCode: 'pb1' }), false)
})

test('anti-escalation: noSelf is not applied to "do I hold it" (no subject), a stale session still HOLDS, an unknown / deprecated permission never does', () => {
  const u = id()
  const stale = snapOf([assignment(u, [{ kind: 'ORGANIZATION', organizationId: A }], ['access.assign'])], ago(3 * HOUR))
  assert.equal(holds(stale, u, 'access.assign', { organizationId: A }), true, 'tier-4: freshness is enforced where the grant is authorized, not here')
  assert.equal(callerHoldsPermissionAt(stale, ctx(u), null, { organizationId: A }), false, 'unknown permission')
  assert.equal(callerHoldsPermissionAt(stale, ctx(u), { ...PERM.get('access.assign'), deprecated: true }, { organizationId: A }), false)
  assert.equal(callerHoldsPermissionAt(stale, { user: { id: u, status: 'SUSPENDED' } }, PERM.get('access.assign'), { organizationId: A }), false)
})

// --- static guards over the handlers (the DB e2e exercises the behaviour) -------------------------------------------------------------------
const src = (f) => readFileSync(join(import.meta.dirname, '..', '..', 'server/routes/admin2', f), 'utf8')

test('static: POST /access/assignments uses the place-aware check, never holdsPermissionAnywhere', () => {
  const access = src('access.mjs')
  assert.ok(!/holdsPermissionAnywhere/.test(access), 'the "anywhere" helper must not be used for anti-escalation')
  const post = access.slice(access.indexOf("router.post('/access/assignments'"), access.indexOf('async function loadForDecision'))
  assert.match(post, /callerHoldsPermissionAt\(/); assert.match(post, /ESCALATION_FORBIDDEN/)
  assert.match(post, /for \(const sc of scopes\)[\s\S]*callerHoldsPermissionAt/, 'checked at EACH scope being granted')
})

test('static: the last-access-administrator guard is per organization and receives the assignment (with its scopes)', () => {
  const access = src('access.mjs')
  assert.match(access, /async function isLastAccessAdmin\(tx, a\)/)
  const body = access.slice(access.indexOf('async function isLastAccessAdmin'), access.indexOf('async function userRow'))
  assert.match(body, /scopesWithinPlaces\(orgIndex, \[\{ organizationId \}\]\)/, 'other organizations\' administrators never count')
  assert.match(access, /isLastAccessAdmin\(db\(\), a\)/)
})

test('static: the Command Center pending-approvals tile and the users list are bound to the caller\'s places', () => {
  const config = src('config.mjs')
  const tile = config.slice(config.indexOf("held.has('access.view')"), config.indexOf('const platforms = '))
  assert.match(tile, /authorizedPlaces\(r, \{ loadSnapshot, decide \}, 'access\.view'/); assert.match(tile, /scopesWithinPlaces\(orgIndex, places\)/)
  assert.ok(!/roleAssignment\.count\(\{ where: \{ status: 'PENDING_APPROVAL' \} \}\)/.test(config), 'no unscoped pending-approvals count')
  const access = src('access.mjs')
  assert.match(access, /roleAssignments\.filter\(\(a\) => subjectTouches\(placesOfSubject\(orgIndex/, 'users list shows only grants inside the caller\'s places')
})
