// STEP 5 -- Users & Access API (/api/admin2/access/*). Every handler authorizes through the central
// can()/authorize(); nothing here decides access by role name. Tier 3/4 actions write evidence.
import { db } from '../../lib/prisma.mjs'
import { loadSnapshot } from '../../lib/authz/index.mjs'
import { holdsPermissionAnywhere } from '../../lib/authz/evaluate.mjs'
import { writeAdminAudit } from '../../lib/authz/audit.mjs'
import { roleVersionContentHash } from '../../lib/authz/catalogue.mjs'
import { badRequest, notFoundError, conflict, pageParams, sortParam, pageResult } from './router.mjs'
import { heldCodes } from './core.mjs'

const REASON_MIN = 8

let orgCache = null
async function theOrg() {
  orgCache ??= await db().organization.findFirst({ orderBy: { createdAt: 'asc' } })
  return orgCache
}
async function orgResource(type, id = undefined, extra = {}) {
  const org = await theOrg()
  return { type, id, facts: { organizationId: org?.id, ...extra } }
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
      out.push({ row: { kind, departmentId: o.id }, facts: { kind, departmentId: o.id } })
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
    where: { status: 'ACTIVE', roleVersion: { permissions: { some: { permission: { code: 'iam.role_assignment.assign' } } } }, user: { status: 'ACTIVE' } },
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
    await r.require('iam.user.read', await orgResource('admin_user'))
    const p = pageParams(r.query)
    const q = String(r.query.q ?? '').trim().slice(0, 80)
    const where = {
      AND: [
        { OR: [{ roleAssignments: { some: {} } }, { roles: { some: { role: { in: ['ADMIN', 'SUPPORT'] } } } }] },
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
    await r.require('iam.user.read', await orgResource('admin_user', r.params.id))
    const u = await db().user.findUnique({ where: { id: r.params.id }, include: { roles: true } })
    if (!u) throw notFoundError('User not found.')
    const assignments = await db().roleAssignment.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' }, include: ASSIGNMENT_INCLUDE })
    const snap = await loadSnapshot({ user: u, sessionId: null })
    const held = [...(await heldCodes(snap, { id: u.id, status: u.status }))].sort()
    const sessions = await db().userSession.findMany({ where: { userId: u.id, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, issuedAt: true, expiresAt: true, mfaMethod: true } })
    const audit = await db().adminAuditLog.findMany({ where: { OR: [{ entityType: 'user', entityId: u.id }, { actorUserId: u.id }] }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, action: true, entityType: true, entityId: true, createdAt: true, reason: true } })
    r.ok({
      user: { ...(await userRow(u)), legacyRoles: u.roles.map((x) => x.role) },
      assignments: assignments.map(assignmentView),
      effectivePermissions: held,
      sessions: { activeCount: sessions.length, mfaVerifiedCount: sessions.filter((s) => s.mfaMethod).length },
      recentAudit: audit,
    })
  })

  async function setUserStatus(r, to) {
    const body = await r.body()
    const reason = needReason(body)
    const target = await db().user.findUnique({ where: { id: r.params.id } })
    if (!target) throw notFoundError('User not found.')
    if (target.id === r.auth.user.id) throw badRequest('You cannot change your own account status.', 'SELF_ACTION_FORBIDDEN')
    await r.require('iam.user.suspend', await orgResource('admin_user', target.id, { relations: [{ relation: 'SELF_USER', userId: target.id }] }))
    if (to === 'SUSPENDED') {
      const act = await db().roleAssignment.findMany({ where: { userId: target.id, status: 'ACTIVE' }, select: { id: true } })
      for (const a of act) if (await isLastAccessAdmin(db(), a.id)) throw conflict('This is the last active access administrator; suspending them would lock everyone out.', 'LAST_ACCESS_ADMIN')
    }
    await db().$transaction(async (tx) => {
      await tx.user.update({ where: { id: target.id }, data: { status: to, ...(to === 'SUSPENDED' ? { sessionEpoch: { increment: 1 } } : {}) } })
      if (to === 'SUSPENDED') await tx.userSession.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'admin2_user_suspended' } })
      await writeAdminAudit(tx, { actorUserId: r.auth.user.id, action: to === 'SUSPENDED' ? 'iam.user.suspended' : 'iam.user.reactivated', entityType: 'user', entityId: target.id, before: { status: target.status }, after: { status: to }, reason, correlationId: r.requestId })
    })
    r.ok({ status: to })
  }
  router.post('/access/users/:id/suspend', (r) => setUserStatus(r, 'SUSPENDED'))
  router.post('/access/users/:id/reactivate', (r) => setUserStatus(r, 'ACTIVE'))

  // ---- Assignments ----------------------------------------------------------------------------
  router.get('/access/assignments', async (r) => {
    await r.require('iam.role_assignment.read', await orgResource('role_assignment'))
    const p = pageParams(r.query)
    const where = {
      ...(['PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'REVOKED', 'SUPERSEDED'].includes(r.query.status) ? { status: r.query.status } : {}),
      ...(r.query.userId ? { userId: String(r.query.userId) } : {}),
      ...(r.query.roleCode ? { roleVersion: { role: { code: String(r.query.roleCode) } } } : {}),
      ...(r.query.temporary === 'true' ? { isTemporary: true } : {}),
    }
    const [total, rows] = await Promise.all([
      db().roleAssignment.count({ where }),
      db().roleAssignment.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take, include: ASSIGNMENT_INCLUDE }),
    ])
    r.ok(pageResult(rows.map(assignmentView), total, p))
  })

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
      if (Number.isNaN(effectiveTo.getTime()) || effectiveTo <= new Date()) throw badRequest('effectiveTo must be a future date.', 'EFFECTIVE_TO_INVALID')
    }
    // 1) The grantor must be authorized to assign at EVERY scope being granted (tier 4: step-up + evidence).
    for (const s of scopes) {
      await r.require('iam.role_assignment.assign', { type: 'role_assignment', facts: { ...factsForScope({ kind: s.facts.kind, ...s.facts }), organizationId: (await theOrg())?.id, ...(s.facts.kind === 'ORGANIZATION' ? { organizationId: s.facts.organizationId } : {}), relations: [{ relation: 'SELF_USER', userId: target.id }] } })
    }
    // 2) Anti-escalation: the grantor must themselves hold every permission in the version.
    const snap = await loadSnapshot(r.auth)
    for (const rp of version.permissions) {
      const ok = holdsPermissionAnywhere({ user: { id: r.auth.user.id, status: r.auth.user.status }, permission: { code: rp.permission.code, deprecated: rp.permission.deprecated }, assignments: snap.assignments, suspensions: snap.suspensions, now: snap.now })
      if (!ok) throw badRequest('You cannot grant a role containing permissions you do not hold yourself.', 'ESCALATION_FORBIDDEN')
    }
    const highRisk = version.permissions.some((rp) => rp.permission.highRisk)
    const created = await db().$transaction(async (tx) => {
      const a = await tx.roleAssignment.create({
        data: {
          userId: target.id, roleVersionId: version.id, status: highRisk ? 'PENDING_APPROVAL' : 'ACTIVE', effectiveTo, isTemporary: Boolean(effectiveTo || body?.isTemporary),
          grantReason: reason, grantedById: r.auth.user.id, scopes: { create: scopes.map((s) => s.row) },
        },
        include: ASSIGNMENT_INCLUDE,
      })
      await tx.roleAssignmentEvent.create({ data: { assignmentId: a.id, eventType: highRisk ? 'REQUESTED' : 'GRANTED', actorUserId: r.auth.user.id, detail: { roleCode: role.code, versionNumber: version.versionNumber }, correlationId: r.requestId } })
      await writeAdminAudit(tx, { actorUserId: r.auth.user.id, action: highRisk ? 'iam.role_assignment.requested' : 'iam.role_assignment.granted', entityType: 'role_assignment', entityId: a.id, after: { userId: target.id, roleCode: role.code, versionNumber: version.versionNumber, scopes: scopes.map((s) => s.row) }, reason, correlationId: r.requestId })
      return a
    })
    r.ok({ assignment: assignmentView(created), needsSecondApproval: highRisk }, 201)
  })

  router.post('/access/assignments/:id/approve', async (r) => {
    const a = await db().roleAssignment.findUnique({ where: { id: r.params.id }, include: ASSIGNMENT_INCLUDE })
    if (!a) throw notFoundError('Assignment not found.')
    if (a.status !== 'PENDING_APPROVAL') throw conflict('This assignment is not waiting for approval.', 'NOT_PENDING')
    if (a.grantedById === r.auth.user.id) throw badRequest('The person who requested the grant cannot approve it.', 'SELF_APPROVAL_FORBIDDEN')
    if (a.userId === r.auth.user.id) throw badRequest('You cannot approve your own access.', 'SELF_ACTION_FORBIDDEN')
    for (const s of a.scopes) {
      await r.require('iam.role_assignment.assign', { type: 'role_assignment', id: a.id, facts: { ...factsForScope({ kind: s.kind, organizationId: s.organizationId, legalEntityId: s.legalEntityId, businessUnitId: s.businessUnitId, platformCode: s.platformId ? (await db().platform.findUnique({ where: { id: s.platformId } }))?.code : undefined }), organizationId: (await theOrg())?.id, relations: [{ relation: 'SELF_USER', userId: a.userId }] } }, { evidence: true })
    }
    const body = await r.body()
    const reason = needReason(body)
    await db().$transaction(async (tx) => {
      await tx.roleAssignment.update({ where: { id: a.id }, data: { status: 'ACTIVE', approvedById: r.auth.user.id } })
      await tx.roleAssignmentEvent.create({ data: { assignmentId: a.id, eventType: 'APPROVED', actorUserId: r.auth.user.id, detail: { reason }, correlationId: r.requestId } })
      await writeAdminAudit(tx, { actorUserId: r.auth.user.id, action: 'iam.role_assignment.approved', entityType: 'role_assignment', entityId: a.id, reason, correlationId: r.requestId })
    })
    r.ok({ status: 'ACTIVE' })
  })

  router.post('/access/assignments/:id/revoke', async (r) => {
    const a = await db().roleAssignment.findUnique({ where: { id: r.params.id }, include: ASSIGNMENT_INCLUDE })
    if (!a) throw notFoundError('Assignment not found.')
    if (!['ACTIVE', 'PENDING_APPROVAL', 'SUSPENDED'].includes(a.status)) throw conflict('This assignment is already closed.', 'NOT_REVOCABLE')
    const reason = needReason(await r.body())
    if (a.userId === r.auth.user.id) throw badRequest('You cannot revoke your own access.', 'SELF_ACTION_FORBIDDEN')
    await r.require('iam.role_assignment.assign', { type: 'role_assignment', id: a.id, facts: { organizationId: (await theOrg())?.id, relations: [{ relation: 'SELF_USER', userId: a.userId }] } })
    if (a.status === 'ACTIVE' && await isLastAccessAdmin(db(), a.id)) throw conflict('This is the last active access administrator assignment; it cannot be revoked.', 'LAST_ACCESS_ADMIN')
    await db().$transaction(async (tx) => {
      await tx.roleAssignment.update({ where: { id: a.id }, data: { status: 'REVOKED', revokedAt: new Date(), revokedById: r.auth.user.id, revokeReason: reason } })
      await tx.roleAssignmentEvent.create({ data: { assignmentId: a.id, eventType: 'REVOKED', actorUserId: r.auth.user.id, detail: { reason }, correlationId: r.requestId } })
      await writeAdminAudit(tx, { actorUserId: r.auth.user.id, action: 'iam.role_assignment.revoked', entityType: 'role_assignment', entityId: a.id, reason, correlationId: r.requestId })
    })
    r.ok({ status: 'REVOKED' })
  })

  router.get('/access/assignments/:id/events', async (r) => {
    await r.require('iam.role_assignment.read', await orgResource('role_assignment', r.params.id))
    const events = await db().roleAssignmentEvent.findMany({ where: { assignmentId: r.params.id }, orderBy: { createdAt: 'asc' } })
    r.ok({ events })
  })

  // ---- Roles, versions, permissions, scopes --------------------------------------------------
  router.get('/access/roles', async (r) => {
    await r.require('iam.role.read', await orgResource('role'))
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
    await r.require('iam.role.read', await orgResource('role', r.params.code))
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
    await r.require('iam.role.manage', await orgResource('role', r.params.code))
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
      await writeAdminAudit(tx, { actorUserId: r.auth.user.id, action: 'iam.role_version.drafted', entityType: 'role_version', entityId: v.id, after: { roleCode: role.code, versionNumber: v.versionNumber, classification, added: added.map((d) => d.code), removed }, reason, correlationId: r.requestId })
      return v
    })
    r.ok({ version: { id: created.id, versionNumber: created.versionNumber, status: created.status, classification } }, 201)
  })

  async function transition(r, { from, to, field, needDifferentFrom, action }) {
    const v = await db().roleVersion.findUnique({ where: { id: r.params.id }, include: { role: true } })
    if (!v) throw notFoundError('Role version not found.')
    if (v.status !== from) throw conflict(`This version is ${v.status}, not ${from}.`, 'WRONG_STATE')
    const reason = needReason(await r.body())
    await r.require('iam.role.manage', await orgResource('role_version', v.id))
    // Separation of duties: author, reviewer and approver are three different people.
    const me = r.auth.user.id
    const people = { author: v.createdById, reviewer: v.reviewedById }
    for (const k of needDifferentFrom) if (people[k] && people[k] === me) throw badRequest(`The ${k} of this version cannot perform this step.`, 'SEPARATION_OF_DUTIES')
    await db().$transaction(async (tx) => {
      const data = { status: to, ...(field ? { [field]: me } : {}) }
      if (to === 'EFFECTIVE') {
        data.effectiveFrom = new Date()
        await tx.roleVersion.updateMany({ where: { roleId: v.roleId, status: 'EFFECTIVE' }, data: { status: 'SUPERSEDED', effectiveTo: new Date() } })
      }
      await tx.roleVersion.update({ where: { id: v.id }, data })
      await writeAdminAudit(tx, { actorUserId: me, action, entityType: 'role_version', entityId: v.id, after: { roleCode: v.role.code, versionNumber: v.versionNumber, status: to }, reason, correlationId: r.requestId })
    })
    r.ok({ status: to })
  }
  router.post('/access/role-versions/:id/submit', (r) => transition(r, { from: 'DRAFT', to: 'IN_SECURITY_REVIEW', needDifferentFrom: [], action: 'iam.role_version.submitted' }))
  router.post('/access/role-versions/:id/review', (r) => transition(r, { from: 'IN_SECURITY_REVIEW', to: 'APPROVED', field: 'reviewedById', needDifferentFrom: ['author'], action: 'iam.role_version.reviewed' }))
  router.post('/access/role-versions/:id/activate', (r) => transition(r, { from: 'APPROVED', to: 'EFFECTIVE', field: 'approvedById', needDifferentFrom: ['author', 'reviewer'], action: 'iam.role_version.activated' }))
  router.post('/access/role-versions/:id/withdraw', (r) => transition(r, { from: 'DRAFT', to: 'WITHDRAWN', needDifferentFrom: [], action: 'iam.role_version.withdrawn' }))

  router.get('/access/permissions', async (r) => {
    await r.require('iam.role.read', await orgResource('permission'))
    const defs = await db().permissionDefinition.findMany({ orderBy: { code: 'asc' }, include: { versionLinks: { where: { roleVersion: { status: 'EFFECTIVE' } }, include: { roleVersion: { include: { role: true } } } } } })
    r.ok({ permissions: defs.map((d) => ({ code: d.code, area: d.area, resource: d.resource, action: d.action, tier: d.tier, highRisk: d.highRisk, deprecated: d.deprecated, description: d.description, roles: d.versionLinks.map((l) => l.roleVersion.role.code) })) })
  })

  router.get('/access/scopes', async (r) => {
    await r.require('iam.role_assignment.read', await orgResource('scope'))
    const [orgs, les, bus, platforms, departments] = await Promise.all([
      db().organization.findMany({ orderBy: { code: 'asc' } }), db().legalEntity.findMany({ orderBy: { code: 'asc' } }), db().businessUnit.findMany({ orderBy: { code: 'asc' } }),
      db().platform.findMany({ orderBy: { sortOrder: 'asc' } }), db().department.findMany({ orderBy: { code: 'asc' } }),
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
    await r.require('iam.session.read_org', await orgResource('session'), { evidence: true })
    const p = pageParams(r.query)
    const staffIds = (await db().roleAssignment.findMany({ where: { status: 'ACTIVE' }, select: { userId: true }, distinct: ['userId'] })).map((x) => x.userId)
    const where = { userId: { in: staffIds }, revokedAt: null, expiresAt: { gt: new Date() } }
    const [total, rows] = await Promise.all([db().userSession.count({ where }), db().userSession.findMany({ where, orderBy: { issuedAt: 'desc' }, skip: p.skip, take: p.take, include: { user: { select: { id: true, displayName: true, email: true } } } })])
    r.ok(pageResult(rows.map((s) => ({ id: s.id, user: s.user, issuedAt: s.issuedAt, expiresAt: s.expiresAt, lastUsedAt: s.lastUsedAt, mfaMethod: s.mfaMethod, stepUpAt: s.stepUpAt, device: (s.userAgent ?? '').slice(0, 80) })), total, p))
  })

  router.post('/access/sessions/:id/revoke', async (r) => {
    const reason = needReason(await r.body())
    const s = await db().userSession.findUnique({ where: { id: r.params.id } })
    if (!s) throw notFoundError('Session not found.')
    await r.require('iam.session.revoke_org', await orgResource('session', s.id))
    await db().$transaction(async (tx) => {
      await tx.userSession.updateMany({ where: { id: s.id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'admin2_security_revoke' } })
      await writeAdminAudit(tx, { actorUserId: r.auth.user.id, action: 'security.session_revoked_by_admin', entityType: 'user_session', entityId: s.id, reason, correlationId: r.requestId })
    })
    r.ok({ revoked: true })
  })

  router.get('/access/mfa', async (r) => {
    await r.require('sec.event.read', await orgResource('mfa_status'))
    const staff = await db().user.findMany({ where: { roleAssignments: { some: { status: 'ACTIVE' } } }, select: { id: true, displayName: true, email: true, status: true } })
    const last = await db().userSession.findMany({ where: { userId: { in: staff.map((u) => u.id) } }, orderBy: { issuedAt: 'desc' }, select: { userId: true, mfaMethod: true, issuedAt: true } })
    const lastBy = new Map(); for (const s of last) if (!lastBy.has(s.userId)) lastBy.set(s.userId, s)
    r.ok({
      note: 'Sign-in for any account with an active role assignment requires password plus a fresh emailed code. Authenticator-app / passkey enrolment is not available yet.',
      users: staff.map((u) => ({ ...u, requiredMethod: 'EMAIL_OTP', lastSignInAt: lastBy.get(u.id)?.issuedAt ?? null, lastSignInMfa: lastBy.get(u.id)?.mfaMethod ?? null, enrolled: ['EMAIL_OTP'] })),
    })
  })

  router.get('/access/service-accounts', async (r) => {
    await r.require('iam.service_account.read', await orgResource('service_account'))
    const rows = await db().serviceAccount.findMany({ orderBy: { createdAt: 'desc' } })
    // The secret itself is never stored; only an opaque reference into the secret manager.
    r.ok({ serviceAccounts: rows.map((s) => ({ id: s.id, name: s.name, description: s.description, integrationCode: s.integrationCode, status: s.status, hasSecretRef: Boolean(s.secretRef), permissionCodes: s.permissionCodes, createdAt: s.createdAt, disabledAt: s.disabledAt })) })
  })

  router.post('/access/service-accounts', async (r) => {
    const b = await r.body()
    const reason = needReason(b)
    await r.require('iam.role.manage', await orgResource('service_account'))
    const name = String(b?.name ?? '').trim()
    const secretRef = b?.secretRef == null ? null : String(b.secretRef).trim()
    if (name.length < 3 || name.length > 80) throw badRequest('Name must be 3-80 characters.', 'NAME_INVALID')
    if (secretRef && !/^[a-z][a-z0-9+.-]{1,20}:\/\/[A-Za-z0-9_./-]{3,200}$/.test(secretRef)) throw badRequest('secretRef must be a secret-manager reference such as vault://sybnb/prod/name, never the secret.', 'SECRET_REF_INVALID')
    const codes = [...new Set((b?.permissionCodes ?? []).map(String))]
    if (codes.length) {
      const n = await db().permissionDefinition.count({ where: { code: { in: codes } } })
      if (n !== codes.length) throw badRequest('Unknown permission.', 'PERMISSION_UNKNOWN')
    }
    const org = await theOrg()
    const sa = await db().$transaction(async (tx) => {
      const x = await tx.serviceAccount.create({ data: { name, description: b?.description ? String(b.description).slice(0, 300) : null, organizationId: org.id, secretRef, permissionCodes: codes, integrationCode: b?.integrationCode ? String(b.integrationCode).slice(0, 60) : null } })
      await writeAdminAudit(tx, { actorUserId: r.auth.user.id, action: 'iam.service_account.created', entityType: 'service_account', entityId: x.id, after: { name, permissionCodes: codes, hasSecretRef: Boolean(secretRef) }, reason, correlationId: r.requestId })
      return x
    })
    r.ok({ id: sa.id }, 201)
  })

  router.post('/access/service-accounts/:id/disable', async (r) => {
    const reason = needReason(await r.body())
    const sa = await db().serviceAccount.findUnique({ where: { id: r.params.id } }).catch(() => null)
    if (!sa) throw notFoundError('Service account not found.')
    await r.require('iam.service_account.disable', await orgResource('service_account', sa.id))
    await db().$transaction(async (tx) => {
      await tx.serviceAccount.update({ where: { id: sa.id }, data: { status: 'DISABLED', disabledAt: new Date(), disabledById: r.auth.user.id } })
      await writeAdminAudit(tx, { actorUserId: r.auth.user.id, action: 'iam.service_account.disabled', entityType: 'service_account', entityId: sa.id, reason, correlationId: r.requestId })
    })
    r.ok({ status: 'DISABLED' })
  })

  router.get('/access/delegations', async (r) => {
    await r.require('iam.role_assignment.read', await orgResource('delegation'))
    r.ok({ delegations: await db().adminDelegation.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }), note: 'Delegation creation is not enabled in this release.' })
  })
}
