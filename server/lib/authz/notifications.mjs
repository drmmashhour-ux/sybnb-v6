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
  async resolve(client, { excludeUserId = null, now = new Date() } = {}) {
    const rows = await client.roleAssignment.findMany({
      where: {
        status: 'ACTIVE', user: { status: 'ACTIVE' }, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
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
  try { recipients = await policy.resolve(tx, { excludeUserId }) } catch (e) { results._recipients = { error: String(e.message || e).slice(0, 200) } }
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
