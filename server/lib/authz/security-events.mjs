// STEP 5A -- security events. NOT the same as audit events: an audit event records WHAT was done; a
// security event records that something security-relevant happened, with a severity, and drives alerts.
// CRITICAL events create in-app notification records (no external transport in this step).
import { retentionFor } from './retention.mjs'

export const SEVERITIES = Object.freeze(['INFO', 'WARNING', 'HIGH', 'CRITICAL'])

/** Active staff who must be told about a security event: holders of security_event.review, plus Owners. */
export async function securityRecipients(client, { excludeUserId = null } = {}) {
  const now = new Date()
  const rows = await client.roleAssignment.findMany({
    where: {
      status: 'ACTIVE', user: { status: 'ACTIVE' },
      effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      roleVersion: { OR: [
        { permissions: { some: { permission: { code: 'security_event.review' } } } },
        { role: { code: 'OWNER' } },
      ] },
    },
    select: { userId: true },
  })
  return [...new Set(rows.map((r) => r.userId))].filter((id) => id !== excludeUserId)
}

/**
 * Record a security event inside the caller's transaction. CRITICAL events also notify.
 * Returns the stored event.
 */
export async function recordSecurityEvent(tx, e) {
  const ret = await retentionFor(tx, 'SECURITY_EVENT')
  const ev = await tx.securityEvent.create({
    data: {
      severity: e.severity, eventType: e.eventType, actorUserId: e.actorUserId ?? null, subjectUserId: e.subjectUserId ?? null,
      entityType: e.entityType ?? null, entityId: e.entityId == null ? null : String(e.entityId), summary: e.summary,
      detail: e.detail ?? {}, correlationId: e.correlationId ?? null, auditEventId: e.auditEventId ?? null, ...ret,
    },
  })
  if (e.severity === 'CRITICAL') {
    const recipients = await securityRecipients(tx, { excludeUserId: e.subjectUserId ?? null })
    if (recipients.length) {
      await tx.adminNotification.createMany({
        data: recipients.map((userId) => ({
          userId, type: 'SECURITY', priority: 'URGENT', title: `CRITICAL: ${e.summary}`.slice(0, 200),
          body: `Security event ${ev.id} (${e.eventType}). Review it in Security.`, link: `/admin/security/events/${ev.id}`,
        })),
      })
      await tx.securityEvent.update({ where: { id: ev.id }, data: { notifiedCount: recipients.length } })
      ev.notifiedCount = recipients.length
    }
  }
  return ev
}
