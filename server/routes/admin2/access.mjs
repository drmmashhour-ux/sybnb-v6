// STEP 5 -- Users & Access API (/api/admin2/access/*). Every handler authorizes through the central
// can()/authorize(); nothing here decides access by role name. Tier 3/4 actions write evidence.
import { db } from '../../lib/prisma.mjs'
import { dbNow, approxNow } from '../../lib/authz/clock.mjs'
import { loadSnapshot } from '../../lib/authz/index.mjs'
import { holdsPermissionAnywhere } from '../../lib/authz/evaluate.mjs'
import { writeAdminAudit } from '../../lib/authz/audit.mjs'
import { roleVersionContentHash } from '../../lib/authz/catalogue.mjs'
import { badRequest, notFoundError, conflict, pageParams, sortParam, pageResult } from './router.mjs'
import { heldCodes } from './core.mjs'
import {
  authError, authorizedOrganizationIds, inOrganizations, authorizedPlaces, requireAtPlaces, requireAtOrganizations, placesOfSubject, placeOfScopeRow, placeWithin,
  subjectTouches, scopesWithinPlaces, expandPlaces, factsOfPlace, organizationLevelIds, soleOrganizationId,
} from '../../lib/authz/org-boundary.mjs'
import { registryContext } from './scope.mjs'
import { decide } from '../../lib/authz/index.mjs'
import { suspendUser, reactivateUser } from '../../lib/authz/emergency.mjs'
import { createAssignment, reviewAssignment, approveAssignment, revokeAssignment, migrateAssignment, autoMigrateIfReducing, TX } from '../../lib/authz/assignment-workflow.mjs'

const REASON_MIN = 8

// STEP 5I -- no helper here picks "the" organization. Every decision is made AT THE PLACE (organization / legal entity / business unit /
// platform) of the thing being acted on, derived from the registry tree and the stored rows, never from the request:
//   * a user / assignment / session -> the places of the user's assignment scopes (all of them must authorize a change);
//   * a service account            -> its own organization_id;
//   * the role CATALOGUE (global: roles have no organization) -> view: allowed at any place the caller sits at;
//                                     manage / publish: allowed at EVERY organization of the registry (documented limitation).
const authz = { loadSnapshot, decide }
const LIVE_ASSIGNMENT = ['ACTIVE', 'PENDING_APPROVAL', 'UNDER_REVIEW', 'PENDING_ACTIVATION', 'SUSPENDED']

async function placesOfUser(userId) {
  const { orgIndex } = await registryContext()
  const rows = await db().roleAssignment.findMany({ where: { userId, status: { in: LIVE_ASSIGNMENT } }, select: { scopes: true } })
  return placesOfSubject(orgIndex, rows.flatMap((a) => a.scopes), { hasAssignments: true })
}
async function placesOfAssignment(a) {
  const { orgIndex } = await registryContext()
  return placesOfSubject(orgIndex, a.scopes ?? [], { hasAssignments: true })
}
/** Authorize `code` at every place of a user (SoD facts included). Returns the places. */
async function requireOnUser(r, code, target, type, id, options = {}) {
  const places = await placesOfUser(target.id)
  return requireAtPlaces(r, code, places, (facts) => ({ type, id, facts: { ...facts, subjectUserId: target.id } }), options)
}
async function requireOnAssignment(r, code, a, options = {}) {
  const places = await placesOfAssignment(a)
  return requireAtPlaces(r, code, places, (facts) => ({ type: 'role_assignment', id: a.id, facts: { ...facts, subjectUserId: a.userId } }), options)
}
/** Gate for a global catalogue READ: the central evaluator must allow it at some place the caller sits at. */
const requireCatalogueView = (r, code, type) => authorizedPlaces(r, authz, code, type)
/** Gate for a global catalogue WRITE: allowed at EVERY organization of the registry. Returns the organization ids. */
async function requireCatalogueWrite(r, code, type, id, options = {}) {
  const { orgIndex } = await registryContext()
  const ids = [...orgIndex.organizationsById.keys()].sort()
  await requireAtOrganizations(r, code, ids, (organizationId) => ({ type, id, facts: { organizationId } }), options)
  return ids
}
/** A change to a global record is recorded in EVERY organization it affects, so each organization's auditors can see it. */
async function auditEach(tx, organizationIds, row) {
  for (const organizationId of organizationIds?.length ? organizationIds : [null]) await writeAdminAudit(tx, { ...row, organizationId })
}
const organizationsOfPlaces = (places) => [...new Set(places.map((p) => p.organizationId))].sort()
/** Users whose assignments lie inside the allowed places. */
async function visibleUserIds(r, places) {
  const { orgIndex } = await registryContext()
  return (await db().user.findMany({ where: { roleAssignments: { some: { status: { in: LIVE_ASSIGNMENT }, scopes: scopesWithinPlaces(orgIndex, places) } } }, select: { id: true } })).map((u) => u.id)
}

function needReason(body) {
  const reason = String(body?.reason ?? '').trim()
  if (reason.length < REASON_MIN) throw badRequest(`A reason of at least ${REASON_MIN} characters is required.`, 'REASON_REQUIRED')
  return reason
}

// The facts that make an assignment scope "the same place" for authorization of the grant itself.
function factsForScope(scope) {
  switch (scope.kind) {
    case 'ORGANIZATION': return { organizationId: scope.organizationId }
    case 'LEGAL_ENTITY': return { legalEntityId: scope.legalEntityId }
    case 'BUSINESS_UNIT': return { businessUnitId: scope.businessUnitId }
    case 'PLATFORM': return { platformCode: scope.platformCode }
    case 'DEPARTMENT': return { departmentId: scope.departmentId }
    case 'PROPERTY': return { propertyRef: [scope.propertyRef] }
    case 'VEHICLE': return { vehicleRef: [scope.vehicleRef] }
    case 'PROJECT': return { projectRef: [scope.projectRef] }
    default: return {}
  }
}

/** Validate scopes against the registry and return rows ready for assignment_scopes. */
async function resolveScopes(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > 20) throw badRequest('At least one scope is required (at most 20).', 'SCOPES_REQUIRED')
  const p = db()
  const out = []
  for (const s of input) {
    const kind = String(s?.kind ?? '')
    if (kind === 'SELF') throw badRequest('A SELF scope cannot be granted to a staff role from this screen.', 'SCOPE_NOT_ALLOWED')
    if (kind === 'ORGANIZATION') {
      const o = await p.organization.findUnique({ where: { id: String(s.organizationId ?? '') } }).catch(() => null)
      if (!o) throw badRequest('Unknown organization.', 'SCOPE_TARGET_UNKNOWN')
      out.push({ row: { kind, organizationId: o.id }, facts: { kind, organizationId: o.id } })
    } else if (kind === 'LEGAL_ENTITY') {
      const o = await p.legalEntity.findUnique({ where: { id: String(s.legalEntityId ?? '') } }).catch(() => null)
      if (!o) throw badRequest('Unknown legal entity.', 'SCOPE_TARGET_UNKNOWN')
      out.push({ row: { kind, legalEntityId: o.id }, facts: { kind, legalEntityId: o.id } })
    } else if (kind === 'BUSINESS_UNIT') {
      const o = await p.businessUnit.findUnique({ where: { id: String(s.businessUnitId ?? '') } }).catch(() => null)
      if (!o) throw badRequest('Unknown business unit.', 'SCOPE_TARGET_UNKNOWN')
      out.push({ row: { kind, businessUnitId: o.id }, facts: { kind, businessUnitId: o.id } })
    } else if (kind === 'PLATFORM') {
      const o = await p.platform.findUnique({ where: { id: String(s.platformId ?? '') } }).catch(() => null)
      if (!o) throw badRequest('Unknown platform.', 'SCOPE_TARGET_UNKNOWN')
      out.push({ row: { kind, platformId: o.id }, facts: { kind, platformCode: o.code } })
    } else if (kind === 'DEPARTMENT') {
      const o = await p.department.findUnique({ where: { id: String(s.departmentId ?? '') } }).catch(() => null)
      if (!o) throw badRequest('Unknown department.', 'SCOPE_TARGET_UNKNOWN')
      out.push({ row: { kind, departmentId: o.id }, facts: { kind, departmentId: o.id }, organizationId: o.organizationId })
    } else if (['PROPERTY', 'VEHICLE', 'PROJECT'].includes(kind)) {
      const field = { PROPERTY: 'propertyRef', VEHICLE: 'vehicleRef', PROJECT: 'projectRef' }[kind]
      const ref = String(s[field] ?? '').trim()
      if (!ref || ref.length > 120) throw badRequest(`${field} is required.`, 'SCOPE_TARGET_UNKNOWN')
      out.push({ row: { kind, [field]: ref }, facts: { kind, [field]: ref } })
    } else {
      throw badRequest('Unknown scope kind.', 'SCOPE_KIND_UNKNOWN')
    }
  }
  return out
}

function assignmentView(a) {
  return {
    id: a.id, status: a.status, effectiveFrom: a.effectiveFrom, effectiveTo: a.effectiveTo, isTemporary: a.isTemporary,
    grantReason: a.grantReason, grantedById: a.grantedById, approvedById: a.approvedById, revokedAt: a.revokedAt, revokeReason: a.revokeReason,
    platformQualifier: a.platformQualifier,
    user: a.user ? { id: a.user.id, displayName: a.user.displayName, email: a.user.email } : undefined,
    role: a.roleVersion ? { code: a.roleVersion.role.code, name: a.roleVersion.role.name, versionNumber: a.roleVersion.versionNumber, versionStatus: a.roleVersion.status, versionId: a.roleVersion.id } : undefined,
    scopes: (a.scopes ?? []).map((s) => ({ id: s.id, kind: s.kind, organizationId: s.organizationId, legalEntityId: s.legalEntityId, businessUnitId: s.businessUnitId, platformId: s.platformId, departmentId: s.departmentId, propertyRef: s.propertyRef, vehicleRef: s.vehicleRef, projectRef: s.projectRef })),
  }
}
const ASSIGNMENT_INCLUDE = { user: { select: { id: true, displayName: true, email: true } }, scopes: true, roleVersion: { include: { role: true } } }

// Protects against locking the company out: the last ACTIVE assignment of a role that holds
// iam.role_assignment.assign + iam.role.manage cannot be revoked/suspended away.
async function isLastAccessAdmin(tx, assignmentId) {
  const holders = await tx.roleAssignment.findMany({
    where: { status: { in: ['ACTIVE', 'PENDING_ACTIVATION'] }, roleVersion: { permissions: { some: { permission: { code: 'access.assign' } } } }, user: { status: 'ACTIVE' } },
    select: { id: true, userId: true },
  })
  return holders.length > 0 && holders.every((h) => h.id === assignmentId)
}

async function userRow(u) {
  return { id: u.id, displayName: u.displayName, email: u.email, status: u.status, createdAt: u.createdAt }
}

export function registerAccess(router) {
  // ---- Users --------------------------------------------------------------------------------
  router.get('/access/users', async (r) => {
    const { places } = await authorizedPlaces(r, authz, 'user.view', 'admin_user')
    const { orgIndex } = await registryContext()
    const sole = soleOrganizationId(orgIndex)
    // Legacy ADMIN / SUPPORT accounts without any assignment have no organization of their own: visible only to an organization-level
    // grant in a registry that has exactly one organization.
    const legacyVisible = Boolean(sole) && organizationLevelIds(places).includes(sole)
    const p = pageParams(r.query)
    const q = String(r.query.q ?? '').trim().slice(0, 80)
    const where = {
      AND: [
        { OR: [{ roleAssignments: { some: { scopes: scopesWithinPlaces(orgIndex, places) } } }, ...(legacyVisible ? [{ roles: { some: { role: { in: ['ADMIN', 'SUPPORT'] } } } }] : [])] },
        q ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }] } : {},
        ['ACTIVE', 'SUSPENDED', 'DISABLED'].includes(r.query.status) ? { status: r.query.status } : {},
      ],
    }
    const orderBy = sortParam(r.query, ['displayName', 'email', 'createdAt', 'status'], { createdAt: 'desc' })
    const [total, rows] = await Promise.all([
      db().user.count({ where }),
      db().user.findMany({ where, orderBy, skip: p.skip, take: p.take, include: { roleAssignments: { where: { status: { in: ['ACTIVE', 'PENDING_APPROVAL'] } }, include: { roleVersion: { include: { role: true } } } }, roles: true } }),
    ])
    const lastSessions = await db().userSession.groupBy({ by: ['userId'], where: { userId: { in: rows.map((u) => u.id) } }, _max: { issuedAt: true } })
    const lastBy = new Map(lastSessions.map((s) => [s.userId, s._max.issuedAt]))
    r.ok(pageResult(rows.map((u) => ({
      ...(u && { id: u.id, displayName: u.displayName, email: u.email, status: u.status }),
      roles: u.roleAssignments.map((a) => ({ assignmentId: a.id, code: a.roleVersion.role.code, name: a.roleVersion.role.name, status: a.status })),
      legacyRoles: u.roles.map((x) => x.role),
      lastSignInAt: lastBy.get(u.id) ?? null,
    })), total, p))
  })

  router.get('/access/users/:id', async (r) => {
    const { places } = await authorizedPlaces(r, authz, 'user.view', 'admin_user')
    const u = await db().user.findUnique({ where: { id: r.params.id }, include: { roles: true } })
    if (!u) throw notFoundError('User not found.')
    // The subject must sit inside a place the caller is authorized at; a user of another organization (or another platform) is refused.
    if (!subjectTouches(await placesOfUser(u.id), places)) throw authError(403, 'PERMISSION_DENIED', 'You do not have permission to do this.')
    const { orgIndex } = await registryContext()
    const inside = (a) => subjectTouches(placesOfSubject(orgIndex, a.scopes ?? [], { hasAssignments: true }), places)
    const assignments = (await db().roleAssignment.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' }, include: ASSIGNMENT_INCLUDE })).filter(inside)
    const targetSnap = await loadSnapshot({ user: u, sessionId: null })
    // Effective permissions are shown only from the assignments inside the caller's places (another organization's grants stay private).
    const held = [...(await heldCodes({ ...targetSnap, assignments: targetSnap.assignments.filter(inside) }, { id: u.id, status: u.status }))].sort()
    const sessions = await db().userSession.findMany({ where: { userId: u.id, revokedAt: null, expiresAt: { gt: approxNow() } }, select: { id: true, issuedAt: true, expiresAt: true, mfaMethod: true } })
    // Audit history is organization-bound: only rows attributed to an organization where the CALLER holds user.view
    // (centrally decided). Unattributed rows, other organizations' rows, and callers with no organization-level grant: nothing.
    let auditOrgIds = []
    try { auditOrgIds = await authorizedOrganizationIds(r, { loadSnapshot, decide }, 'user.view', 'admin_user') } catch (e) { if (e.statusCode !== 403) throw e }
    const audit = !auditOrgIds.length ? [] : await db().adminAuditLog.findMany({ where: { AND: [inOrganizations(auditOrgIds), { OR: [{ entityType: 'user', entityId: u.id }, { actorUserId: u.id }] }] }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, action: true, entityType: true, entityId: true, createdAt: true, reason: true } })
    r.ok({
      user: { ...(await userRow(u)), legacyRoles: u.roles.map((x) => x.role) },
      assignments: assignments.map(assignmentView),
      effectivePermissions: held,
      sessions: { activeCount: sessions.length, mfaVerifiedCount: sessions.filter((s) => s.mfaMethod).length },
      recentAudit: audit,
    })
  })

  // ---- User suspension (standard, emergency) and reactivation --------------------------------------
  // The service enforces the invariants; the route authorizes through the central evaluator with the
  // subject user in the facts so noSelf permissions (SoD) are checked by the evaluator, not here.
  async function suspendRoute(r, kind) {
    const body = await r.body()
    const reason = needReason(body)
    const target = await db().user.findUnique({ where: { id: r.params.id } })
    if (!target) throw notFoundError('User not found.')
    if (target.id === r.auth.user.id) throw badRequest('You cannot change your own account status.', 'SELF_ACTION_FORBIDDEN')
    const places = await requireOnUser(r, kind === 'EMERGENCY' ? 'user.suspend_emergency' : 'user.suspend', target, 'admin_user', target.id, { evidence: true })
    // The event is attributed to the target's organization (the first one, sorted, when the target spans several: the actor was authorized at all of them).
    const out = await suspendUser(db(), { actorUserId: r.auth.user.id, targetUserId: target.id, reason, kind, requestId: r.requestId, organizationId: organizationsOfPlaces(places)[0] ?? null })
    r.ok({ status: 'SUSPENDED', kind, sessionsRevoked: out.sessionsRevoked, securityEventId: out.securityEvent.id, severity: out.securityEvent.severity })
  }
  router.post('/access/users/:id/suspend', (r) => suspendRoute(r, 'STANDARD'))
  router.post('/access/users/:id/emergency-suspend', (r) => suspendRoute(r, 'EMERGENCY'))
  router.post('/access/users/:id/reactivate', async (r) => {
    const body = await r.body()
    const reason = needReason(body)
    const target = await db().user.findUnique({ where: { id: r.params.id } })
    if (!target) throw notFoundError('User not found.')
    const places = await requireOnUser(r, 'user.reactivate', target, 'admin_user', target.id, { evidence: true })
    r.ok(await reactivateUser(db(), { actorUserId: r.auth.user.id, targetUserId: target.id, reason, acknowledgeAssignmentReview: body?.acknowledgeAssignmentReview === true, requestId: r.requestId, organizationId: organizationsOfPlaces(places)[0] ?? null }))
  })

  // ---- Assignments ----------------------------------------------------------------------------
  router.get('/access/assignments', async (r) => {
    const { places } = await authorizedPlaces(r, authz, 'access.view', 'role_assignment')
    const { orgIndex } = await registryContext()
    const p = pageParams(r.query)
    const where = {
      scopes: scopesWithinPlaces(orgIndex, places),
      ...(['PENDING_APPROVAL', 'UNDER_REVIEW', 'PENDING_ACTIVATION', 'REJECTED', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'REVOKED', 'SUPERSEDED'].includes(r.query.status) ? { status: r.query.status } : {}),
      ...(r.query.userId ? { userId: String(r.query.userId) } : {}),
      ...(r.query.roleCode ? { roleVersion: { role: { code: String(r.query.roleCode) } } } : {}),
      ...(r.query.temporary === 'true' ? { isTemporary: true } : {}),
    }
    const [total, rows] = await Promise.all([
      db().roleAssignment.count({ where }),
      db().roleAssignment.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take, include: ASSIGNMENT_INCLUDE }),
    ])
    // A multi-organization assignment shows only the scopes inside the caller's places.
    const limit = (v) => ({ ...v, scopes: (v.scopes ?? []).filter((s) => { const pl = placeOfScopeRow(orgIndex, s); return pl ? placeWithin(pl, places) : false }) })
    r.ok(pageResult(rows.map((x) => limit(assignmentView(x))), total, p))
  })

  // Each scope being granted is authorized AT ITS OWN place (derived from the registry), never at a default organization.
  // Scopes that sit in no organization of their own: a department belongs to its organization; property / vehicle / project refs fall back to
  // the registry's sole organization and are refused when the registry has several (they cannot be attributed).
  async function authorizeScopes(r, permission, scopes, target, extra = {}, options = {}) {
    const { orgIndex } = await registryContext()
    const sole = soleOrganizationId(orgIndex)
    for (const sc of scopes) {
      const place = placeOfScopeRow(orgIndex, sc.row)
      const organizationId = place ? null : (sc.organizationId ?? sole)
      if (!place && !organizationId) throw authError(403, 'PERMISSION_DENIED', 'You do not have permission to do this.')
      await r.require(permission, { type: 'role_assignment', ...extra, facts: { ...factsForScope(sc.facts), ...(place ? factsOfPlace(place) : { organizationId }), subjectUserId: target.id } }, options)
    }
  }

  router.post('/access/assignments', async (r) => {
    const body = await r.body()
    const reason = needReason(body)
    const target = await db().user.findUnique({ where: { id: String(body?.userId ?? '') } }).catch(() => null)
    if (!target || target.status !== 'ACTIVE') throw badRequest('The user must exist and be active.', 'TARGET_USER_INVALID')
    if (target.id === r.auth.user.id) throw badRequest('You cannot grant yourself a role.', 'SELF_ACTION_FORBIDDEN')
    const role = await db().role.findUnique({ where: { code: String(body?.roleCode ?? '') } })
    if (!role || role.status !== 'ACTIVE') throw badRequest('Unknown or inactive role.', 'ROLE_UNKNOWN')
    const version = await db().roleVersion.findFirst({ where: { roleId: role.id, status: 'EFFECTIVE' }, include: { permissions: { include: { permission: true } } } })
    if (!version) throw badRequest('This role has no effective version.', 'ROLE_NO_EFFECTIVE_VERSION')
    const scopes = await resolveScopes(body?.scopes)
    let effectiveTo = null
    if (body?.effectiveTo) {
      effectiveTo = new Date(body.effectiveTo)
      if (Number.isNaN(effectiveTo.getTime()) || effectiveTo <= approxNow()) throw badRequest('effectiveTo must be a future date.', 'EFFECTIVE_TO_INVALID')
    }
    // 1) The grantor must be authorized to assign at EVERY scope being granted (tier 4: step-up + evidence).
    await authorizeScopes(r, 'access.assign', scopes, target)
    // 2) Anti-escalation: the grantor must themselves hold every permission in the version.
    const snap = await loadSnapshot(r.auth)
    for (const rp of version.permissions) {
      const ok = holdsPermissionAnywhere({ user: { id: r.auth.user.id, status: r.auth.user.status }, permission: { code: rp.permission.code, deprecated: rp.permission.deprecated }, assignments: snap.assignments, suspensions: snap.suspensions, now: snap.now })
      if (!ok) throw badRequest('You cannot grant a role containing permissions you do not hold yourself.', 'ESCALATION_FORBIDDEN')
    }
    const out = await createAssignment(db(), { actorUserId: r.auth.user.id, targetUserId: target.id, roleVersionId: version.id, scopeRows: scopes.map((s) => s.row), effectiveTo, isTemporary: Boolean(body?.isTemporary), reason, requestId: r.requestId })
    r.ok({ assignment: assignmentView(out.assignment), needsSecondApproval: out.highRisk, highRiskPermissions: out.highRiskPermissions }, 201)
  })

  async function loadForDecision(r) {
    const a = await db().roleAssignment.findUnique({ where: { id: r.params.id }, include: ASSIGNMENT_INCLUDE })
    if (!a) throw notFoundError('Assignment not found.')
    return a
  }

  // Step 1 of a high-risk grant: security review (privileged_access.review). Reviewer is neither requester nor target.
  router.post('/access/assignments/:id/review', async (r) => {
    const a = await loadForDecision(r)
    const body = await r.body()
    await requireOnAssignment(r, 'privileged_access.review', a, { evidence: true })
    const out = await reviewAssignment(db(), { actorUserId: r.auth.user.id, assignmentId: a.id, decision: String(body?.decision ?? 'APPROVE').toUpperCase(), reason: body?.reason, requestId: r.requestId })
    r.ok(out)
  })

  // Step 2: Owner approval (access.approve). Starts the 48 hour clock; the grant is NOT usable before activation_at.
  router.post('/access/assignments/:id/approve', async (r) => {
    const a = await loadForDecision(r)
    const body = await r.body()
    await requireOnAssignment(r, 'access.approve', a, { evidence: true })
    const out = await approveAssignment(db(), { actorUserId: r.auth.user.id, assignmentId: a.id, decision: String(body?.decision ?? 'APPROVE').toUpperCase(), reason: body?.reason, requestId: r.requestId })
    r.ok(out)
  })

  router.post('/access/assignments/:id/reject', async (r) => {
    const a = await loadForDecision(r)
    const body = await r.body()
    if (a.status === 'PENDING_APPROVAL') {
      await requireOnAssignment(r, 'privileged_access.review', a, { evidence: true })
      return r.ok(await reviewAssignment(db(), { actorUserId: r.auth.user.id, assignmentId: a.id, decision: 'REJECT', reason: body?.reason, requestId: r.requestId }))
    }
    await requireOnAssignment(r, 'access.approve', a, { evidence: true })
    r.ok(await approveAssignment(db(), { actorUserId: r.auth.user.id, assignmentId: a.id, decision: 'REJECT', reason: body?.reason, requestId: r.requestId }))
  })

  // Removal is immediate. No delay, no second approver.
  router.post('/access/assignments/:id/revoke', async (r) => {
    const a = await loadForDecision(r)
    const body = await r.body()
    needReason(body)
    if (a.userId === r.auth.user.id) throw badRequest('You cannot revoke your own access.', 'SELF_ACTION_FORBIDDEN')
    await requireOnAssignment(r, 'access.assign', a)
    if (['ACTIVE', 'PENDING_ACTIVATION'].includes(a.status) && await isLastAccessAdmin(db(), a.id)) throw conflict('This is the last active access administrator assignment; it cannot be revoked.', 'LAST_ACCESS_ADMIN')
    r.ok(await revokeAssignment(db(), { actorUserId: r.auth.user.id, assignmentId: a.id, reason: body.reason, requestId: r.requestId }))
  })

  // Move a holder to another version of the same role. Expanding with high-risk permissions goes through the full workflow.
  router.post('/access/assignments/:id/migrate', async (r) => {
    const a = await loadForDecision(r)
    const body = await r.body()
    needReason(body)
    if (a.userId === r.auth.user.id) throw badRequest('You cannot change your own access.', 'SELF_ACTION_FORBIDDEN')
    await requireOnAssignment(r, 'access.assign', a)
    const out = await migrateAssignment(db(), { actorUserId: r.auth.user.id, assignmentId: a.id, targetVersionId: String(body?.targetVersionId ?? ''), reason: body.reason, requestId: r.requestId })
    r.ok({ assignment: assignmentView(out.assignment), needsSecondApproval: out.highRisk, highRiskPermissions: out.highRiskPermissions }, 201)
  })

  router.get('/access/assignments/:id/events', async (r) => {
    const a = await loadForDecision(r)
    await requireOnAssignment(r, 'access.view', a)
    const events = await db().roleAssignmentEvent.findMany({ where: { assignmentId: r.params.id }, orderBy: { createdAt: 'asc' } })
    r.ok({ events })
  })

  // ---- Roles, versions, permissions, scopes --------------------------------------------------
  router.get('/access/roles', async (r) => {
    await requireCatalogueView(r, 'role.view', 'role')
    const roles = await db().role.findMany({ orderBy: { code: 'asc' }, include: { versions: { orderBy: { versionNumber: 'desc' }, include: { _count: { select: { permissions: true, assignments: true } } } } } })
    r.ok({
      roles: roles.map((x) => {
        const eff = x.versions.find((v) => v.status === 'EFFECTIVE') ?? null
        return {
          code: x.code, name: x.name, description: x.description, status: x.status,
          effectiveVersion: eff && { id: eff.id, versionNumber: eff.versionNumber, permissionCount: eff._count.permissions, platformCoverage: eff.platformCoverage },
          versionCount: x.versions.length, assignmentCount: x.versions.reduce((n, v) => n + v._count.assignments, 0),
        }
      }),
    })
  })

  router.get('/access/roles/:code', async (r) => {
    await requireCatalogueView(r, 'role.view', 'role')
    const role = await db().role.findUnique({ where: { code: r.params.code }, include: { versions: { orderBy: { versionNumber: 'desc' }, include: { permissions: { include: { permission: true } }, _count: { select: { assignments: true } } } } } })
    if (!role) throw notFoundError('Role not found.')
    r.ok({
      role: { code: role.code, name: role.name, description: role.description, status: role.status },
      versions: role.versions.map((v) => ({
        id: v.id, versionNumber: v.versionNumber, status: v.status, classification: v.classification, platformCoverage: v.platformCoverage, changeReason: v.changeReason,
        createdById: v.createdById, reviewedById: v.reviewedById, approvedById: v.approvedById, effectiveFrom: v.effectiveFrom, assignmentCount: v._count.assignments,
        permissions: v.permissions.map((p) => ({ code: p.permission.code, tier: p.permission.tier, highRisk: p.permission.highRisk })).sort((a, b) => a.code.localeCompare(b.code)),
      })),
    })
  })

  // Create a DRAFT successor version. No in-place edit of an EFFECTIVE version ever happens.
  router.post('/access/roles/:code/versions', async (r) => {
    const body = await r.body()
    const reason = needReason(body)
    const orgIds = await requireCatalogueWrite(r, 'role.manage', 'role', r.params.code)
    const role = await db().role.findUnique({ where: { code: r.params.code }, include: { versions: { orderBy: { versionNumber: 'desc' }, include: { permissions: { include: { permission: true } } } } } })
    if (!role) throw notFoundError('Role not found.')
    const base = role.versions.find((v) => v.status === 'EFFECTIVE')
    if (!base) throw badRequest('This role has no effective version to build on.', 'ROLE_NO_EFFECTIVE_VERSION')
    if (role.versions.some((v) => ['DRAFT', 'IN_SECURITY_REVIEW', 'APPROVED'].includes(v.status))) throw conflict('Another version of this role is already in progress.', 'VERSION_IN_PROGRESS')
    const codes = [...new Set((body?.permissions ?? []).map(String))]
    if (codes.length === 0 || codes.length > 200) throw badRequest('A permission list is required.', 'PERMISSIONS_REQUIRED')
    const defs = await db().permissionDefinition.findMany({ where: { code: { in: codes } } })
    if (defs.length !== codes.length || defs.some((d) => d.deprecated)) throw badRequest('Unknown or deprecated permission in the list.', 'PERMISSION_UNKNOWN')
    const before = new Set(base.permissions.map((p) => p.permission.code))
    const added = defs.filter((d) => !before.has(d.code))
    const removed = [...before].filter((c) => !codes.includes(c))
    if (added.length && removed.length) throw badRequest('A version may expand or reduce access, not both. Split it into two versions.', 'MIXED_CHANGE_REJECTED')
    if (!added.length && !removed.length) throw badRequest('No change from the current version.', 'NO_CHANGE')
    const classification = removed.length ? 'REDUCING' : added.some((d) => d.highRisk) ? 'EXPANDING_HIGH_RISK' : 'EXPANDING_ORDINARY'
    const coverage = Array.isArray(body?.platformCoverage) && body.platformCoverage.length ? body.platformCoverage.map(String) : base.platformCoverage
    if (JSON.stringify([...coverage].sort()) !== JSON.stringify([...base.platformCoverage].sort())) throw badRequest('Change platform coverage in its own version request (not supported in this release).', 'COVERAGE_CHANGE_UNSUPPORTED')
    const created = await db().$transaction(async (tx) => {
      const v = await tx.roleVersion.create({ data: { roleId: role.id, versionNumber: Math.max(...role.versions.map((x) => x.versionNumber)) + 1, status: 'DRAFT', classification, platformCoverage: coverage, contentHash: roleVersionContentHash({ roleCode: role.code, versionNumber: Math.max(...role.versions.map((x) => x.versionNumber)) + 1, coverage, permissions: codes }), changeReason: reason, createdById: r.auth.user.id } })
      await tx.roleVersionPermission.createMany({ data: defs.map((d) => ({ roleVersionId: v.id, permissionId: d.id })) })
      await auditEach(tx, orgIds, { actorUserId: r.auth.user.id, action: 'iam.role_version.drafted', entityType: 'role_version', entityId: v.id, after: { roleCode: role.code, versionNumber: v.versionNumber, classification, added: added.map((d) => d.code), removed }, reason, correlationId: r.requestId })
      return v
    })
    r.ok({ version: { id: created.id, versionNumber: created.versionNumber, status: created.status, classification } }, 201)
  })

  async function transition(r, { from, to, field, needDifferentFrom, action, permission = 'role.manage' }) {
    const v = await db().roleVersion.findUnique({ where: { id: r.params.id }, include: { role: true } })
    if (!v) throw notFoundError('Role version not found.')
    if (v.status !== from) throw conflict(`This version is ${v.status}, not ${from}.`, 'WRONG_STATE')
    const reason = needReason(await r.body())
    const orgIds = await requireCatalogueWrite(r, permission, 'role_version', v.id, to === 'EFFECTIVE' ? { evidence: true } : {})
    // Separation of duties: author, reviewer and approver are three different people.
    const me = r.auth.user.id
    const people = { author: v.createdById, reviewer: v.reviewedById }
    for (const k of needDifferentFrom) if (people[k] && people[k] === me) throw badRequest(`The ${k} of this version cannot perform this step.`, 'SEPARATION_OF_DUTIES')
    let prior = null
    let migrated = null
    await db().$transaction(async (tx) => {
      const now = await dbNow(tx) // database clock: one timestamp for the whole version switch
      const data = { status: to, ...(field ? { [field]: me } : {}) }
      if (to === 'EFFECTIVE') {
        data.effectiveFrom = now
        prior = await tx.roleVersion.findFirst({ where: { roleId: v.roleId, status: 'EFFECTIVE' } })
        await tx.roleVersion.updateMany({ where: { roleId: v.roleId, status: 'EFFECTIVE' }, data: { status: 'SUPERSEDED', effectiveTo: now } })
      }
      await tx.roleVersion.update({ where: { id: v.id }, data })
      if (prior) migrated = await autoMigrateIfReducing(tx, { oldVersionId: prior.id, newVersionId: v.id, actorUserId: me, requestId: r.requestId })
      await auditEach(tx, orgIds, { actorUserId: me, action, entityType: 'role_version', entityId: v.id, after: { roleCode: v.role.code, versionNumber: v.versionNumber, status: to, autoMigrated: migrated }, reason, correlationId: r.requestId })
    }, to === 'EFFECTIVE' ? { maxWait: 10_000, timeout: 120_000 } : TX) // activation may auto-migrate every holder of a reduced version, one round of statements each
    r.ok({ status: to, autoMigrated: migrated })
  }
  router.post('/access/role-versions/:id/submit', (r) => transition(r, { from: 'DRAFT', to: 'IN_SECURITY_REVIEW', needDifferentFrom: [], action: 'iam.role_version.submitted' }))
  router.post('/access/role-versions/:id/review', (r) => transition(r, { from: 'IN_SECURITY_REVIEW', to: 'APPROVED', field: 'reviewedById', needDifferentFrom: ['author'], action: 'iam.role_version.reviewed' }))
  router.post('/access/role-versions/:id/activate', (r) => transition(r, { from: 'APPROVED', to: 'EFFECTIVE', field: 'approvedById', needDifferentFrom: ['author', 'reviewer'], action: 'iam.role_version.activated', permission: 'role.publish' }))
  router.post('/access/role-versions/:id/withdraw', (r) => transition(r, { from: 'DRAFT', to: 'WITHDRAWN', needDifferentFrom: [], action: 'iam.role_version.withdrawn' }))

  router.get('/access/permissions', async (r) => {
    await requireCatalogueView(r, 'role.view', 'permission')
    const defs = await db().permissionDefinition.findMany({ orderBy: { code: 'asc' }, include: { versionLinks: { where: { roleVersion: { status: 'EFFECTIVE' } }, include: { roleVersion: { include: { role: true } } } } } })
    r.ok({ permissions: defs.map((d) => ({ code: d.code, area: d.area, resource: d.resource, action: d.action, tier: d.tier, highRisk: d.highRisk, deprecated: d.deprecated, description: d.description, roles: d.versionLinks.map((l) => l.roleVersion.role.code) })) })
  })

  router.get('/access/scopes', async (r) => {
    const { places, snap } = await authorizedPlaces(r, authz, 'access.view', 'scope')
    const x = expandPlaces(snap.orgIndex, places)
    const orgIds = new Set(places.map((p) => p.organizationId))
    const [orgs, les, bus, platforms, departments] = await Promise.all([
      db().organization.findMany({ where: { id: { in: [...orgIds] } }, orderBy: { code: 'asc' } }),
      db().legalEntity.findMany({ where: { id: { in: [...x.les] } }, orderBy: { code: 'asc' } }),
      db().businessUnit.findMany({ where: { id: { in: [...x.bus] } }, orderBy: { code: 'asc' } }),
      db().platform.findMany({ where: { id: { in: [...x.platforms] } }, orderBy: { sortOrder: 'asc' } }),
      db().department.findMany({ where: { organizationId: { in: organizationLevelIds(places) } }, orderBy: { code: 'asc' } }),
    ])
    r.ok({
      scopeKinds: ['ORGANIZATION', 'LEGAL_ENTITY', 'BUSINESS_UNIT', 'PLATFORM', 'DEPARTMENT', 'PROPERTY', 'VEHICLE', 'PROJECT'],
      organizations: orgs.map((o) => ({ id: o.id, code: o.code, name: o.name })),
      legalEntities: les.map((o) => ({ id: o.id, code: o.code, name: o.legalName, organizationId: o.organizationId })),
      businessUnits: bus.map((o) => ({ id: o.id, code: o.code, name: o.name, legalEntityId: o.legalEntityId })),
      platforms: platforms.map((o) => ({ id: o.id, code: o.code, name: o.displayName, businessUnitId: o.businessUnitId })),
      departments: departments.map((o) => ({ id: o.id, code: o.code, name: o.name })),
    })
  })

  // ---- Sessions (org-wide), MFA, service accounts, delegations -------------------------------
  router.get('/access/sessions', async (r) => {
    const { places } = await authorizedPlaces(r, authz, 'session.view', 'session')
    await requireAtPlaces(r, 'session.view', places, (facts) => ({ type: 'session', facts }), { evidence: true }) // evidence is written for each place actually read
    const p = pageParams(r.query)
    const staffIds = await visibleUserIds(r, places)
    const where = { userId: { in: staffIds }, revokedAt: null, expiresAt: { gt: approxNow() } }
    const [total, rows] = await Promise.all([db().userSession.count({ where }), db().userSession.findMany({ where, orderBy: { issuedAt: 'desc' }, skip: p.skip, take: p.take, include: { user: { select: { id: true, displayName: true, email: true } } } })])
    r.ok(pageResult(rows.map((s) => ({ id: s.id, user: s.user, issuedAt: s.issuedAt, expiresAt: s.expiresAt, lastUsedAt: s.lastUsedAt, mfaMethod: s.mfaMethod, stepUpAt: s.stepUpAt, device: (s.userAgent ?? '').slice(0, 80) })), total, p))
  })

  router.post('/access/sessions/:id/revoke', async (r) => {
    const reason = needReason(await r.body())
    const s = await db().userSession.findUnique({ where: { id: r.params.id } })
    if (!s) throw notFoundError('Session not found.')
    const places = await requireOnUser(r, 'session.revoke', { id: s.userId }, 'session', s.id)
    await db().$transaction(async (tx) => {
      await tx.userSession.updateMany({ where: { id: s.id, revokedAt: null }, data: { revokedAt: approxNow(), revokedReason: 'admin2_security_revoke' } })
      await auditEach(tx, organizationsOfPlaces(places), { actorUserId: r.auth.user.id, action: 'security.session_revoked_by_admin', entityType: 'user_session', entityId: s.id, reason, correlationId: r.requestId })
    })
    r.ok({ revoked: true })
  })

  router.get('/access/mfa', async (r) => {
    const { places } = await authorizedPlaces(r, authz, 'security_event.view', 'mfa_status')
    const { orgIndex } = await registryContext()
    const staff = await db().user.findMany({ where: { roleAssignments: { some: { status: 'ACTIVE', scopes: scopesWithinPlaces(orgIndex, places) } } }, select: { id: true, displayName: true, email: true, status: true } })
    const last = await db().userSession.findMany({ where: { userId: { in: staff.map((u) => u.id) } }, orderBy: { issuedAt: 'desc' }, select: { userId: true, mfaMethod: true, issuedAt: true } })
    const lastBy = new Map(); for (const s of last) if (!lastBy.has(s.userId)) lastBy.set(s.userId, s)
    r.ok({
      note: 'Sign-in for any account with an active role assignment requires password plus a fresh emailed code. Authenticator-app / passkey enrolment is not available yet.',
      users: staff.map((u) => ({ ...u, requiredMethod: 'EMAIL_OTP', lastSignInAt: lastBy.get(u.id)?.issuedAt ?? null, lastSignInMfa: lastBy.get(u.id)?.mfaMethod ?? null, enrolled: ['EMAIL_OTP'] })),
    })
  })

  router.get('/access/service-accounts', async (r) => {
    const orgIds = await authorizedOrganizationIds(r, authz, 'service_account.view', 'service_account')
    const rows = await db().serviceAccount.findMany({ where: inOrganizations(orgIds), orderBy: { createdAt: 'desc' } })
    // The secret itself is never stored; only an opaque reference into the secret manager.
    r.ok({ serviceAccounts: rows.map((s) => ({ id: s.id, name: s.name, description: s.description, integrationCode: s.integrationCode, status: s.status, hasSecretRef: Boolean(s.secretRef), permissionCodes: s.permissionCodes, createdAt: s.createdAt, disabledAt: s.disabledAt })) })
  })

  router.post('/access/service-accounts', async (r) => {
    const b = await r.body()
    const reason = needReason(b)
    // The organization of a new service account is the one the caller is authorized at: their only one, or (when they administer several)
    // the one they name, which must be among those the central evaluator allowed. It is never defaulted.
    const allowedOrgs = await authorizedOrganizationIds(r, authz, 'role.manage', 'service_account')
    const requested = b?.organizationId ? String(b.organizationId) : null
    const organizationId = allowedOrgs.length === 1 && (!requested || requested === allowedOrgs[0]) ? allowedOrgs[0] : (requested && allowedOrgs.includes(requested) ? requested : null)
    if (!organizationId) throw badRequest('organizationId is required and must be an organization you administer.', 'ORGANIZATION_REQUIRED')
    await r.require('role.manage', { type: 'service_account', facts: { organizationId } })
    const name = String(b?.name ?? '').trim()
    const secretRef = b?.secretRef == null ? null : String(b.secretRef).trim()
    if (name.length < 3 || name.length > 80) throw badRequest('Name must be 3-80 characters.', 'NAME_INVALID')
    if (secretRef && !/^[a-z][a-z0-9+.-]{1,20}:\/\/[A-Za-z0-9_./-]{3,200}$/.test(secretRef)) throw badRequest('secretRef must be a secret-manager reference such as vault://sybnb/prod/name, never the secret.', 'SECRET_REF_INVALID')
    const codes = [...new Set((b?.permissionCodes ?? []).map(String))]
    if (codes.length) {
      const n = await db().permissionDefinition.count({ where: { code: { in: codes } } })
      if (n !== codes.length) throw badRequest('Unknown permission.', 'PERMISSION_UNKNOWN')
    }
    const sa = await db().$transaction(async (tx) => {
      const x = await tx.serviceAccount.create({ data: { name, description: b?.description ? String(b.description).slice(0, 300) : null, organizationId, secretRef, permissionCodes: codes, integrationCode: b?.integrationCode ? String(b.integrationCode).slice(0, 60) : null } })
      await writeAdminAudit(tx, { organizationId, actorUserId: r.auth.user.id, action: 'iam.service_account.created', entityType: 'service_account', entityId: x.id, after: { name, permissionCodes: codes, hasSecretRef: Boolean(secretRef) }, reason, correlationId: r.requestId })
      return x
    })
    r.ok({ id: sa.id }, 201)
  })

  router.post('/access/service-accounts/:id/disable', async (r) => {
    const reason = needReason(await r.body())
    const sa = await db().serviceAccount.findUnique({ where: { id: r.params.id } }).catch(() => null)
    if (!sa) throw notFoundError('Service account not found.')
    await r.require('service_account.disable', { type: 'service_account', id: sa.id, facts: { organizationId: sa.organizationId } })
    await db().$transaction(async (tx) => {
      await tx.serviceAccount.update({ where: { id: sa.id }, data: { status: 'DISABLED', disabledAt: new Date(), disabledById: r.auth.user.id } })
      await writeAdminAudit(tx, { organizationId: sa.organizationId, actorUserId: r.auth.user.id, action: 'iam.service_account.disabled', entityType: 'service_account', entityId: sa.id, reason, correlationId: r.requestId })
    })
    r.ok({ status: 'DISABLED' })
  })

  router.get('/access/delegations', async (r) => {
    const { places } = await authorizedPlaces(r, authz, 'access.view', 'delegation')
    const ids = await visibleUserIds(r, places) // a delegation is visible when both its parties are inside the caller's places
    r.ok({ delegations: await db().adminDelegation.findMany({ where: { delegatorUserId: { in: ids }, delegateUserId: { in: ids } }, orderBy: { createdAt: 'desc' }, take: 100 }), note: 'Delegation creation is not enabled in this release.' })
  })
}
