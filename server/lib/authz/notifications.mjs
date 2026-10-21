import { approxNow } from './clock.mjs'
// STEP 5B -- notification policy and transport interface for security alerts.
//
// This is NOTIFICATION policy, not authorization. Being named here (for example as an active Owner) lets a
// person RECEIVE an alert; it grants no permission and no evaluator decision ever reads it.
//
// Transport interface: { name, async deliver({ tx, event, recipients }) -> { delivered: number } }.
// In-app is the only transport today. Email / push / SMS are added later with registerTransport() and
// the security-event generation code does not change. A failing transport can never roll back or block the
// security event: every transport runs inside its own SAVEPOINT and its failure is only recorded.
export const OWNER_NOTIFICATION_ROLE_CODES = Object.freeze(['OWNER'])
export const SECURITY_REVIEW_PERMISSION = 'security_event.review'

export const CRITICAL_SECURITY_RECIPIENTS = Object.freeze({
  name: 'CRITICAL_SECURITY_RECIPIENTS',
  description: 'Active holders of an Owner role plus active holders of security_event.review. Notification only; grants nothing.',
  // STEP 5H: for an event that belongs to an organization, only holders whose assignment is ORGANIZATION-scoped to THAT
  // organization are notified (an alert's title carries the event summary, so it must not reach another organization's staff).
  // STEP 5I: an UNATTRIBUTED event (organizationId null) has NO recipients. There is no global / unscoped fallback list: telling every
  // tenant's Owners about an event that belongs to nobody would leak it across organizations. See UNATTRIBUTED_NOTIFICATION below.
  async resolve(client, { excludeUserId = null, now = approxNow(), organizationId = null } = {}) {
    if (!organizationId) return []
    const rows = await client.roleAssignment.findMany({
      where: {
        status: 'ACTIVE', user: { status: 'ACTIVE' }, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        scopes: { some: { kind: 'ORGANIZATION', organizationId } },
        roleVersion: { OR: [
          { permissions: { some: { permission: { code: SECURITY_REVIEW_PERMISSION } } } },
          { role: { code: { in: [...OWNER_NOTIFICATION_ROLE_CODES] } } },
        ] },
      },
      select: { userId: true },
    })
    return [...new Set(rows.map((r) => r.userId))].filter((id) => id !== excludeUserId)
  },
})

/**
 * What a CRITICAL event with no organization gets instead of a recipient list. The event itself IS persisted (the row is written first
 * and never depends on delivery); it is flagged for a human operator and shown to nobody through an organization-scoped route.
 * The operator channel is deliberately OUTSIDE admin2 / tenant scope (see docs/admin/STEP5I_MULTI_ORG_BOUNDARY.md): a database query
 * by the platform operator, never a tenant notification.
 */
export const UNATTRIBUTED_NOTIFICATION = Object.freeze({ state: 'UNATTRIBUTED', action: 'MANUAL_OPERATOR_REVIEW', reason: 'NO_ORGANIZATION' })

export const inAppTransport = {
  name: 'in_app',
  async deliver({ tx, event, recipients }) {
    if (!recipients.length) return { delivered: 0 }
    await tx.adminNotification.createMany({
      data: recipients.map((userId) => ({
        userId, type: 'SECURITY', priority: 'URGENT', title: `CRITICAL: ${event.summary}`.slice(0, 200),
        body: `Security event ${event.id} (${event.eventType}). Review it in Security.`, link: `/admin/security/events/${event.id}`,
      })),
    })
    return { delivered: recipients.length }
  },
}

const transports = [inAppTransport]
export function registerTransport(t) {
  if (!t || typeof t.name !== 'string' || typeof t.deliver !== 'function') throw new Error('invalid notification transport')
  if (!transports.some((x) => x.name === t.name)) transports.push(t)
}
export function unregisterTransport(name) {
  const i = transports.findIndex((x) => x.name === name)
  if (i > 0 || (i === 0 && name !== 'in_app')) transports.splice(i, 1)
}
export const listTransports = () => transports.map((t) => t.name)

let spCounter = 0
/** Deliver through every transport. Never throws: failures are returned in `results`. Returns { recipients, results }. */
export async function deliverSecurityNotifications(tx, event, { policy = CRITICAL_SECURITY_RECIPIENTS, excludeUserId = null } = {}) {
  const results = {}
  let recipients = []
  if (!event.organizationId) {
    results._notification = { ...UNATTRIBUTED_NOTIFICATION }
    // Identifiers only: no summary or detail is written to a log that is not organization-scoped.
    try { console.error(`[security] CRITICAL event ${event.id} (${event.eventType}) has no organization: manual operator review required`) } catch { /* logging must never fail the event */ }
    return { recipients, results }
  }
  try { recipients = await policy.resolve(tx, { excludeUserId, organizationId: event.organizationId ?? null }) } catch (e) { results._recipients = { error: String(e.message || e).slice(0, 200) } }
  for (const t of [...transports]) {
    const sp = `sec_notify_${++spCounter}`
    try {
      await tx.$executeRawUnsafe(`SAVEPOINT ${sp}`)
      const r = await t.deliver({ tx, event, recipients })
      await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${sp}`)
      results[t.name] = { delivered: r?.delivered ?? 0 }
    } catch (e) {
      try { await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${sp}`) } catch { /* connection already unusable */ }
      results[t.name] = { error: String(e.message || e).slice(0, 200) }
    }
  }
  return { recipients, results }
}

export const MAX_DELIVERY_ATTEMPTS = 10

/**
 * STEP 5C -- retry transports that failed for CRITICAL events. Delivery failure never rolled anything back; the
 * failure is recorded in security_events.delivery[transport] = { error, attempts, lastAttemptAt }. This function
 * (called from the activation worker cycle, or by an operator via scripts/admin-activation-run.mjs) re-sends ONLY
 * the failed transports, to the recipients the policy resolves now, and records success or the next failure.
 * Each event is claimed with FOR UPDATE SKIP LOCKED, so concurrent retriers never double-send.
 */
export async function retryFailedDeliveries(client, { limit = 25 } = {}) {
  const candidates = await client.$queryRaw`
    SELECT id::text AS id FROM security_events
    WHERE severity = 'CRITICAL' AND EXISTS (SELECT 1 FROM jsonb_each(delivery) e WHERE jsonb_typeof(e.value) = 'object' AND jsonb_exists(e.value, 'error') AND NOT jsonb_exists(e.value, 'abandoned') AND COALESCE((e.value->>'attempts')::int, 1) < ${MAX_DELIVERY_ATTEMPTS})
    ORDER BY created_at LIMIT ${limit}`
  const out = { examined: candidates.length, recovered: 0, stillFailing: 0, skipped: 0 }
  for (const { id } of candidates) {
    try {
      const r = await client.$transaction(async (tx) => {
        const claimed = await tx.$queryRaw`SELECT id::text FROM security_events WHERE id = ${id}::uuid FOR UPDATE SKIP LOCKED`
        if (!claimed.length) return 'SKIPPED'
        const ev = await tx.securityEvent.findUnique({ where: { id } })
        if (!ev.organizationId) return 'SKIPPED' // unattributed: never re-sent, never given a recipient list
        const delivery = { ...(ev.delivery || {}) }
        const recipients = await CRITICAL_SECURITY_RECIPIENTS.resolve(tx, { excludeUserId: ev.subjectUserId ?? null, organizationId: ev.organizationId ?? null })
        let changed = false; let failing = 0
        for (const [name, st] of Object.entries(delivery)) {
          if (!st || typeof st !== 'object' || !st.error || name.startsWith('_') || (st.attempts ?? 1) >= MAX_DELIVERY_ATTEMPTS) { if (st?.error) failing += 1; continue }
          const t = transports.find((x) => x.name === name)
          if (!t) { delivery[name] = { ...st, abandoned: 'TRANSPORT_NOT_REGISTERED' }; changed = true; continue } // not configured on this deployment: stop re-examining it
          const sp = `sec_retry_${++spCounter}`
          const attempts = (st.attempts ?? 1) + 1
          try {
            await tx.$executeRawUnsafe(`SAVEPOINT ${sp}`)
            const res = await t.deliver({ tx, event: ev, recipients })
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${sp}`)
            delivery[name] = { delivered: res?.delivered ?? 0, attempts, recoveredAt: approxNow().toISOString() }
          } catch (e) {
            try { await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${sp}`) } catch { /* ignore */ }
            delivery[name] = { error: String(e.message || e).slice(0, 200), attempts, lastAttemptAt: approxNow().toISOString() }
            failing += 1
          }
          changed = true
        }
        if (changed) await tx.securityEvent.update({ where: { id }, data: { delivery } })
        return failing ? 'STILL_FAILING' : 'RECOVERED'
      }, { maxWait: 10_000, timeout: 30_000 })
      if (r === 'RECOVERED') out.recovered += 1; else if (r === 'STILL_FAILING') out.stillFailing += 1; else out.skipped += 1
    } catch { out.skipped += 1 }
  }
  return out
}
