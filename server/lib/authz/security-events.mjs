// STEP 5A/5B -- security events. NOT the same as audit events: an audit event records WHAT was done; a
// security event records that something security-relevant happened, with a severity, and drives alerts.
// CRITICAL events notify through the transport interface in notifications.mjs. The event row is written
// first and never depends on delivery succeeding.
import { retentionFor } from './retention.mjs'
import { CRITICAL_SECURITY_RECIPIENTS, deliverSecurityNotifications } from './notifications.mjs'

export const SEVERITIES = Object.freeze(['INFO', 'WARNING', 'HIGH', 'CRITICAL'])

/** Kept for callers of the 5A name; the policy itself lives in notifications.mjs. */
export const securityRecipients = (client, opts = {}) => CRITICAL_SECURITY_RECIPIENTS.resolve(client, opts)

/** Record a security event inside the caller's transaction. CRITICAL events notify. Returns the stored event. */
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
    const { recipients, results } = await deliverSecurityNotifications(tx, ev, { excludeUserId: e.subjectUserId ?? null })
    const inApp = results.in_app?.delivered ?? 0
    await tx.securityEvent.update({ where: { id: ev.id }, data: { notifiedCount: inApp, delivery: { recipients: recipients.length, ...Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v?.error ? { ...v, attempts: 1 } : v])) } } })
    ev.notifiedCount = inApp
    ev.delivery = results
  }
  return ev
}
