// STEP 5A (3A-4) -- role-assignment lifecycle with the high-risk activation delay.
//   non-high-risk: create -> ACTIVE
//   high-risk:     create -> PENDING_APPROVAL (REQUESTED)
//                  review  -> UNDER_REVIEW | REJECTED         (reviewer: privileged_access.review)
//                  approve -> PENDING_ACTIVATION, activation_at = approved_at + 48h   (Owner: access.approve)
//                  due     -> ACTIVE (swept) -- and the evaluator already honours activation_at itself
//   revoke / reject / security suspension: immediate, from any non-closed state.
// Separation: requester, reviewer, approver and the target must be four distinct people.
import { writeAdminAudit } from './audit.mjs'
import { recordSecurityEvent } from './security-events.mjs'
import { retentionFor } from './retention.mjs'
import { privilegeDelta } from './risk.mjs'
import { loadPolicy } from './loader.mjs'
import { assertContinuity, assertCapabilitiesRetained } from './continuity.mjs'
import { badReq, notFound, conflictErr } from './errors.mjs'
import { dbNow } from './clock.mjs'

// Interactive transactions run several statements; give them room (default 5s is too tight over a WAN link).
export const TX = Object.freeze({ maxWait: 10_000, timeout: 30_000 })
const REASON_MIN = 8
const reasonOf = (v) => {
  const r = String(v ?? '').trim()
  if (r.length < REASON_MIN) throw badReq(`A reason of at least ${REASON_MIN} characters is required.`, 'REASON_REQUIRED')
  return r
}
const INCLUDE = { scopes: true, roleVersion: { include: { role: true } } }

async function event(tx, a, eventType, actorUserId, detail, requestId) {
  const ret = await retentionFor(tx, 'PRIVILEGED_ACCESS')
  return tx.roleAssignmentEvent.create({ data: { assignmentId: a.id, eventType, actorUserId, detail, correlationId: requestId, ...ret } })
}

/** Create an assignment (or a pending request when the version carries high-risk permissions). */
export async function createAssignment(client, { actorUserId, targetUserId, roleVersionId, scopeRows, effectiveTo = null, isTemporary = false, reason, requestId = null, supersedesAssignmentId = null, now = null }) {
  const why = reasonOf(reason)
  return client.$transaction(async (tx) => {
    const t = now ?? await dbNow(tx) // one database timestamp for every comparison and write in this transaction
    const version = await tx.roleVersion.findUnique({ where: { id: roleVersionId }, include: { role: true } })
    if (!version) throw notFound('Role version not found.')
    const delta = await privilegeDelta(tx, null, roleVersionId)
    const highRisk = delta.addedHighRisk.length > 0
    const ret = await retentionFor(tx, 'PRIVILEGED_ACCESS')
    const a = await tx.roleAssignment.create({
      data: {
        userId: targetUserId, roleVersionId, status: highRisk ? 'PENDING_APPROVAL' : 'ACTIVE', effectiveFrom: t, effectiveTo, isTemporary: Boolean(isTemporary || effectiveTo),
        grantReason: why, grantedById: actorUserId, supersedesAssignmentId, scopes: { create: scopeRows }, ...ret,
      },
      include: INCLUDE,
    })
    await event(tx, a, highRisk ? 'REQUESTED' : 'GRANTED', actorUserId, { roleCode: version.role.code, versionNumber: version.versionNumber, highRiskPermissions: delta.addedHighRisk, supersedes: supersedesAssignmentId }, requestId)
    const audit = await writeAdminAudit(tx, {
      actorUserId, action: highRisk ? 'iam.role_assignment.requested' : 'iam.role_assignment.granted', entityType: 'role_assignment', entityId: a.id,
      after: { userId: targetUserId, roleCode: version.role.code, versionNumber: version.versionNumber, status: a.status, highRiskPermissions: delta.addedHighRisk }, reason: why, correlationId: requestId,
    })
    if (highRisk) {
      await recordSecurityEvent(tx, { severity: 'WARNING', eventType: 'HIGH_RISK_ACCESS_REQUESTED', actorUserId, subjectUserId: targetUserId, entityType: 'role_assignment', entityId: a.id, summary: `High-risk access requested: ${version.role.code}`, detail: { highRiskPermissions: delta.addedHighRisk }, correlationId: requestId, auditEventId: audit.id })
    } else if (supersedesAssignmentId) {
      await supersede(tx, supersedesAssignmentId, a.id, actorUserId, requestId, t)
    }
    return { assignment: a, highRisk, highRiskPermissions: delta.addedHighRisk }
  }, TX)
}

async function supersede(tx, oldId, newId, actorUserId, requestId, now) {
  const old = await tx.roleAssignment.findUnique({ where: { id: oldId } })
  if (!old || !['ACTIVE', 'PENDING_ACTIVATION'].includes(old.status)) return
  await assertContinuity(tx, { assignmentIds: [oldId], now }) // the replacement is already ACTIVE, so a clean transition passes
  await tx.roleAssignment.update({ where: { id: oldId }, data: { status: 'SUPERSEDED' } })
  await event(tx, old, 'SUPERSEDED', actorUserId, { supersededBy: newId }, requestId)
}

/** Reviewer step: privileged_access.review. */
export async function reviewAssignment(client, { actorUserId, assignmentId, decision, reason, requestId = null }) {
  const why = reasonOf(reason)
  if (!['APPROVE', 'REJECT'].includes(decision)) throw badReq('decision must be APPROVE or REJECT.', 'DECISION_INVALID')
  return client.$transaction(async (tx) => {
    const a = await tx.roleAssignment.findUnique({ where: { id: assignmentId }, include: INCLUDE })
    if (!a) throw notFound('Assignment not found.')
    if (a.status !== 'PENDING_APPROVAL') throw conflictErr('This request is not waiting for review.', 'NOT_PENDING')
    if (a.grantedById === actorUserId) throw badReq('The person who requested the grant cannot review it.', 'SELF_APPROVAL_FORBIDDEN')
    if (a.userId === actorUserId) throw badReq('You cannot review your own access.', 'SELF_ACTION_FORBIDDEN')
    const to = decision === 'APPROVE' ? 'UNDER_REVIEW' : 'REJECTED'
    await tx.roleAssignment.update({ where: { id: a.id }, data: { status: to, reviewedById: actorUserId, reviewedAt: await dbNow(tx), ...(to === 'REJECTED' ? { revokedAt: null, revokeReason: why } : {}) } })
    await event(tx, a, to === 'REJECTED' ? 'REJECTED' : 'REVIEWED', actorUserId, { reason: why }, requestId)
    await writeAdminAudit(tx, { actorUserId, action: to === 'REJECTED' ? 'iam.role_assignment.rejected' : 'iam.role_assignment.reviewed', entityType: 'role_assignment', entityId: a.id, reason: why, correlationId: requestId })
    return { status: to }
  }, TX)
}

/** Final step: access.approve (Owner). Starts the 48 hour clock. */
export async function approveAssignment(client, { actorUserId, assignmentId, decision = 'APPROVE', reason, requestId = null, now: injectedNow = null }) {
  const why = reasonOf(reason)
  return client.$transaction(async (tx) => {
    const now = injectedNow ?? await dbNow(tx) // database time: approved_at and activation_at come from the same clock the evaluator is corrected to
    const a = await tx.roleAssignment.findUnique({ where: { id: assignmentId }, include: INCLUDE })
    if (!a) throw notFound('Assignment not found.')
    if (a.status !== 'UNDER_REVIEW') throw conflictErr('This request has not been reviewed yet (or is already decided).', 'NOT_UNDER_REVIEW')
    if (a.grantedById === actorUserId) throw badReq('The person who requested the grant cannot approve it.', 'SELF_APPROVAL_FORBIDDEN')
    if (a.reviewedById === actorUserId) throw badReq('The reviewer cannot also give final approval (second approver required).', 'SAME_APPROVER_FORBIDDEN')
    if (a.userId === actorUserId) throw badReq('You cannot approve your own access.', 'SELF_ACTION_FORBIDDEN')
    if (decision === 'REJECT') {
      await tx.roleAssignment.update({ where: { id: a.id }, data: { status: 'REJECTED', revokeReason: why } })
      await event(tx, a, 'REJECTED', actorUserId, { reason: why, stage: 'APPROVAL' }, requestId)
      await writeAdminAudit(tx, { actorUserId, action: 'iam.role_assignment.rejected', entityType: 'role_assignment', entityId: a.id, reason: why, correlationId: requestId })
      return { status: 'REJECTED' }
    }
    const policy = await loadPolicy(tx, now)
    const activationAt = new Date(now.getTime() + policy.highRiskActivationDelayMs)
    await tx.roleAssignment.update({ where: { id: a.id }, data: { status: 'PENDING_ACTIVATION', approvedById: actorUserId, approvedAt: now, activationAt } })
    await event(tx, a, 'APPROVED', actorUserId, { reason: why, activationAt: activationAt.toISOString(), policyVersion: policy.version }, requestId)
    const audit = await writeAdminAudit(tx, { actorUserId, action: 'iam.role_assignment.approved', entityType: 'role_assignment', entityId: a.id, after: { status: 'PENDING_ACTIVATION', activationAt: activationAt.toISOString() }, reason: why, correlationId: requestId })
    await recordSecurityEvent(tx, { severity: 'HIGH', eventType: 'HIGH_RISK_ACCESS_APPROVED', actorUserId, subjectUserId: a.userId, entityType: 'role_assignment', entityId: a.id, summary: `High-risk access approved, active from ${activationAt.toISOString()}`, detail: { roleCode: a.roleVersion.role.code, activationAt: activationAt.toISOString() }, correlationId: requestId, auditEventId: audit.id })
    return { status: 'PENDING_ACTIVATION', activationAt }
  }, TX)
}

/** Removal is immediate from any non-closed state; there is never a delay on taking access away. */
export async function revokeAssignment(client, { actorUserId, assignmentId, reason, requestId = null }) {
  const why = reasonOf(reason)
  return client.$transaction(async (tx) => {
    const a = await tx.roleAssignment.findUnique({ where: { id: assignmentId }, include: INCLUDE })
    if (!a) throw notFound('Assignment not found.')
    if (!['ACTIVE', 'PENDING_APPROVAL', 'UNDER_REVIEW', 'PENDING_ACTIVATION', 'SUSPENDED'].includes(a.status)) throw conflictErr('This assignment is already closed.', 'NOT_REVOCABLE')
    const wasLive = ['ACTIVE', 'PENDING_ACTIVATION'].includes(a.status)
    const t = await dbNow(tx)
    if (wasLive) await assertContinuity(tx, { assignmentIds: [a.id], now: t })
    await tx.roleAssignment.update({ where: { id: a.id }, data: { status: 'REVOKED', revokedAt: t, revokedById: actorUserId, revokeReason: why } })
    await event(tx, a, 'REVOKED', actorUserId, { reason: why, from: a.status }, requestId)
    const audit = await writeAdminAudit(tx, { actorUserId, action: 'iam.role_assignment.revoked', entityType: 'role_assignment', entityId: a.id, before: { status: a.status }, after: { status: 'REVOKED' }, reason: why, correlationId: requestId })
    if (wasLive) await recordSecurityEvent(tx, { severity: 'WARNING', eventType: 'ACCESS_REVOKED', actorUserId, subjectUserId: a.userId, entityType: 'role_assignment', entityId: a.id, summary: `Access revoked: ${a.roleVersion.role.code}`, detail: { from: a.status }, correlationId: requestId, auditEventId: audit.id })
    return { status: 'REVOKED' }
  }, TX)
}

/**
 * Move a holder to another version of the same role. Never silent: it creates a NEW pinned assignment that
 * goes through the full high-risk workflow when the target version adds a high-risk permission.
 */
export async function migrateAssignment(client, { actorUserId, assignmentId, targetVersionId, reason, requestId = null }) {
  const old = await client.roleAssignment.findUnique({ where: { id: assignmentId }, include: INCLUDE })
  if (!old) throw notFound('Assignment not found.')
  if (old.status !== 'ACTIVE') throw conflictErr('Only an active assignment can be migrated.', 'NOT_ACTIVE')
  const target = await client.roleVersion.findUnique({ where: { id: targetVersionId } })
  if (!target || target.roleId !== old.roleVersion.roleId) throw badReq('The target must be a version of the same role.', 'VERSION_MISMATCH')
  if (!['EFFECTIVE', 'SUPERSEDED'].includes(target.status) || target.id === old.roleVersionId) throw badReq('The target version is not usable.', 'VERSION_NOT_USABLE')
  const scopeRows = old.scopes.map((s) => ({ kind: s.kind, organizationId: s.organizationId, legalEntityId: s.legalEntityId, businessUnitId: s.businessUnitId, platformId: s.platformId, departmentId: s.departmentId, propertyRef: s.propertyRef, vehicleRef: s.vehicleRef, projectRef: s.projectRef }))
  return createAssignment(client, { actorUserId, targetUserId: old.userId, roleVersionId: target.id, scopeRows, effectiveTo: old.effectiveTo, isTemporary: old.isTemporary, reason, requestId, supersedesAssignmentId: old.id })
}

/**
 * When a new EFFECTIVE version only REMOVES permissions, holders move to it at once (reducing access is
 * never delayed). Expanding versions never migrate anybody automatically.
 */
export async function autoMigrateIfReducing(tx, { oldVersionId, newVersionId, actorUserId, requestId = null }) {
  const d = await privilegeDelta(tx, oldVersionId, newVersionId)
  if (d.added.length) return { migrated: 0, reason: 'EXPANDING' }
  const holders = await tx.roleAssignment.findMany({ where: { roleVersionId: oldVersionId, status: { in: ['ACTIVE', 'PENDING_ACTIVATION'] } }, include: INCLUDE })
  for (const h of holders) {
    const ret = await retentionFor(tx, 'PRIVILEGED_ACCESS')
    const n = await tx.roleAssignment.create({
      data: {
        userId: h.userId, roleVersionId: newVersionId, status: h.status, effectiveFrom: h.effectiveFrom, effectiveTo: h.effectiveTo, isTemporary: h.isTemporary,
        supersedesAssignmentId: h.id, grantReason: `Automatic move to reduced role version (${h.id})`, grantedById: h.grantedById, approvedById: h.approvedById, approvedAt: h.approvedAt, activationAt: h.activationAt, platformQualifier: h.platformQualifier,
        scopes: { create: h.scopes.map((s) => ({ kind: s.kind, organizationId: s.organizationId, legalEntityId: s.legalEntityId, businessUnitId: s.businessUnitId, platformId: s.platformId, departmentId: s.departmentId, propertyRef: s.propertyRef, vehicleRef: s.vehicleRef, projectRef: s.projectRef })) }, ...ret,
      },
    })
    await tx.roleAssignment.update({ where: { id: h.id }, data: { status: 'SUPERSEDED' } })
    await event(tx, h, 'SUPERSEDED', actorUserId, { supersededBy: n.id, removed: d.removed }, requestId)
    await event(tx, n, 'GRANTED', actorUserId, { migratedFrom: h.id, removed: d.removed }, requestId)
  }
  // A reducing version must not strip the last holder of a continuity capability the old version carried.
  const orgIds = [...new Set(holders.flatMap((h) => h.scopes.filter((x) => x.kind === 'ORGANIZATION' && x.organizationId).map((x) => x.organizationId)))]
  await assertCapabilitiesRetained(tx, { organizationIds: orgIds, permissions: d.removed, now: await dbNow(tx) })
  return { migrated: holders.length, removed: d.removed }
}
