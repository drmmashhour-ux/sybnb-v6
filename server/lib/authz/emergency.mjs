// STEP 5A (3A-10) -- user suspension and reactivation services. The CALLER authorizes (route uses
// user.suspend_emergency / user.suspend / user.reactivate through authorize()); this module enforces the
// invariants that must hold however it is called:
//   * a reason is mandatory; you cannot suspend or reactivate yourself
//   * suspension takes effect immediately: status, session epoch, every session revoked, same transaction
//   * history is preserved: assignments, approvals, role history, evidence are NOT touched or deleted
//   * a CRITICAL (emergency) / HIGH (standard) security event + an immutable audit event are written
//   * reactivation is a separate action, never restores sessions, expired temporary or revoked roles
import { writeAdminAudit } from './audit.mjs'
import { recordSecurityEvent } from './security-events.mjs'
import { retentionFor } from './retention.mjs'
import { badReq, notFound, conflictErr } from './errors.mjs'

// Interactive transactions run several statements; give them room (default 5s is too tight over a WAN link).
export const TX = Object.freeze({ maxWait: 10_000, timeout: 30_000 })
const REASON_MIN = 8
function needReason(reason, what = 'A reason') {
  const r = String(reason ?? '').trim()
  if (r.length < REASON_MIN) throw badReq(`${what} of at least ${REASON_MIN} characters is required.`, 'REASON_REQUIRED')
  return r
}

async function lastApprovalAuthority(tx, userId) {
  const others = await tx.roleAssignment.count({
    where: {
      userId: { not: userId }, status: 'ACTIVE', user: { status: 'ACTIVE' },
      roleVersion: { permissions: { some: { permission: { code: 'access.approve' } } } },
    },
  })
  return others === 0
}

export async function suspendUser(client, { actorUserId, targetUserId, reason, kind = 'STANDARD', requestId = null }) {
  const why = needReason(reason)
  if (!['STANDARD', 'EMERGENCY'].includes(kind)) throw badReq('Unknown suspension kind.', 'KIND_INVALID')
  if (actorUserId === targetUserId) throw badReq('You cannot suspend your own account.', 'SELF_ACTION_FORBIDDEN')
  return client.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: targetUserId } })
    if (!target) throw notFound('User not found.')
    if (target.status === 'SUSPENDED') throw conflictErr('This user is already suspended.', 'ALREADY_SUSPENDED')
    const holdsApproval = await tx.roleAssignment.count({ where: { userId: target.id, status: 'ACTIVE', roleVersion: { permissions: { some: { permission: { code: 'access.approve' } } } } } })
    if (holdsApproval && await lastApprovalAuthority(tx, target.id)) {
      throw conflictErr('This is the last active approval authority (Owner); suspending them would lock everyone out.', 'LAST_OWNER')
    }
    const assignments = await tx.roleAssignment.findMany({
      where: { userId: target.id }, select: { id: true, status: true, roleVersionId: true, effectiveFrom: true, effectiveTo: true, activationAt: true },
    })
    await tx.user.update({ where: { id: target.id }, data: { status: 'SUSPENDED', sessionEpoch: { increment: 1 } } })
    const revoked = await tx.userSession.updateMany({
      where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: kind === 'EMERGENCY' ? 'emergency_suspension' : 'admin2_user_suspended' },
    })
    const audit = await writeAdminAudit(tx, {
      actorUserId, action: kind === 'EMERGENCY' ? 'iam.user.emergency_suspended' : 'iam.user.suspended', entityType: 'user', entityId: target.id,
      before: { status: target.status }, after: { status: 'SUSPENDED', kind, sessionsRevoked: revoked.count }, reason: why, correlationId: requestId,
    })
    const ev = await recordSecurityEvent(tx, {
      severity: kind === 'EMERGENCY' ? 'CRITICAL' : 'HIGH', eventType: kind === 'EMERGENCY' ? 'USER_EMERGENCY_SUSPENDED' : 'USER_SUSPENDED',
      actorUserId, subjectUserId: target.id, entityType: 'user', entityId: target.id,
      summary: `${kind === 'EMERGENCY' ? 'Emergency suspension' : 'Suspension'} of ${target.displayName || target.email || target.id}`,
      detail: { reason: why, sessionsRevoked: revoked.count, assignmentsPreserved: assignments.length }, correlationId: requestId, auditEventId: audit.id,
    })
    const ret = await retentionFor(tx, 'USER_SUSPENSION')
    const row = await tx.userSuspension.create({
      data: {
        userId: target.id, kind, reason: why, suspendedById: actorUserId, priorStatus: target.status, sessionsRevoked: revoked.count,
        assignmentsSnapshot: assignments.map((a) => ({ ...a })), securityEventId: ev.id, correlationId: requestId, ...ret,
      },
    })
    return { suspension: row, securityEvent: ev, sessionsRevoked: revoked.count }
  }, TX)
}

export async function reactivateUser(client, { actorUserId, targetUserId, reason, acknowledgeAssignmentReview, requestId = null }) {
  const why = needReason(reason)
  if (actorUserId === targetUserId) throw badReq('You cannot reactivate your own account.', 'SELF_ACTION_FORBIDDEN')
  if (acknowledgeAssignmentReview !== true) throw badReq('Reactivation requires confirming that the current assignments were reviewed.', 'REVIEW_ACK_REQUIRED')
  return client.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: targetUserId } })
    if (!target) throw notFound('User not found.')
    if (target.status !== 'SUSPENDED') throw conflictErr('This user is not suspended.', 'NOT_SUSPENDED')
    const open = await tx.userSuspension.findFirst({ where: { userId: target.id, reactivatedAt: null }, orderBy: { suspendedAt: 'desc' } })
    if (open && open.suspendedById === actorUserId) throw badReq('The person who suspended the account cannot reactivate it.', 'SAME_ACTOR_FORBIDDEN')
    // NOTE: sessions stay revoked (no un-revoke) and the session epoch is not decremented; assignment rows
    // are not modified, so revoked / expired / superseded roles remain closed.
    await tx.user.update({ where: { id: target.id }, data: { status: 'ACTIVE' } })
    const live = await tx.roleAssignment.findMany({
      where: { userId: target.id, status: { in: ['ACTIVE', 'PENDING_ACTIVATION'] } }, include: { roleVersion: { include: { role: true } } },
    })
    const audit = await writeAdminAudit(tx, {
      actorUserId, action: 'iam.user.reactivated', entityType: 'user', entityId: target.id,
      before: { status: 'SUSPENDED' }, after: { status: 'ACTIVE', sessionsRestored: 0, assignmentsReviewed: live.length }, reason: why, correlationId: requestId,
    })
    const ev = await recordSecurityEvent(tx, {
      severity: 'HIGH', eventType: 'USER_REACTIVATED', actorUserId, subjectUserId: target.id, entityType: 'user', entityId: target.id,
      summary: `Reactivation of ${target.displayName || target.email || target.id}`,
      detail: { reason: why, assignmentsReviewed: live.map((a) => ({ id: a.id, role: a.roleVersion.role.code, status: a.status })) }, correlationId: requestId, auditEventId: audit.id,
    })
    if (open) {
      await tx.userSuspension.update({ where: { id: open.id }, data: { reactivatedAt: new Date(), reactivatedById: actorUserId, reactivationReason: why, reactivationSecurityEventId: ev.id } })
    }
    return { status: 'ACTIVE', sessionsRestored: 0, assignmentsToReview: live.map((a) => ({ id: a.id, role: a.roleVersion.role.code, status: a.status })), securityEvent: ev }
  }, TX)
}
