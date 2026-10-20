// STEP 5B (3A-4) -- activation worker: STATE MAINTENANCE for approved high-risk grants.
//
// The authorization evaluator is the security boundary: it independently refuses a grant before activation_at and
// accepts a due PENDING_ACTIVATION grant even if this worker has not run (evaluate.isAssignmentActiveAt). This worker
// only normalizes state (PENDING_ACTIVATION -> ACTIVE), supersedes the replaced assignment, and emits the audit trail
// and security event. It is safe to run repeatedly and from several processes at once:
//   * candidates are found without locks, then each one is claimed with SELECT ... FOR UPDATE SKIP LOCKED inside
//     its own transaction; a concurrent worker either skips the locked row or finds it no longer PENDING_ACTIVATION
//   * the transition is a conditional UPDATE ... WHERE status = 'PENDING_ACTIVATION' and the events are written only
//     when exactly one row changed
// Scheduling: server/index.mjs starts runActivationCycle on an interval (ADMIN_ACTIVATION_INTERVAL_MS, default 60s,
// ADMIN_ACTIVATION_JOB=off disables). Multi-replica and external schedulers can call scripts/admin-activation-run.mjs.
import { writeAdminAudit } from './audit.mjs'
import { recordSecurityEvent } from './security-events.mjs'
import { retentionFor } from './retention.mjs'
import { assertContinuity } from './continuity.mjs'
import { dbNow } from './clock.mjs'
import { retryFailedDeliveries } from './notifications.mjs'

const TX = { maxWait: 10_000, timeout: 30_000 }

/** Why this due assignment must NOT be activated right now (null = fine). Pure reads inside the claim transaction. */
export async function activationBlocker(tx, a, now) {
  if (a.revokedAt != null) return 'REVOKED'
  if (a.approvedAt == null || a.reviewedById == null || a.approvedById == null) return 'NOT_APPROVED'
  const rv = a.roleVersion
  if (!rv || !['EFFECTIVE', 'SUPERSEDED'].includes(rv.status) || rv.role.status !== 'ACTIVE') return 'ROLE_VERSION_NOT_VALID'
  if (rv.effectiveFrom == null || rv.effectiveFrom > now) return 'ROLE_VERSION_NOT_VALID'
  if (a.effectiveTo != null && a.effectiveTo <= now) return 'EXPIRED'
  const user = await tx.user.findUnique({ where: { id: a.userId }, select: { status: true } })
  if (!user || user.status !== 'ACTIVE') return 'TARGET_NOT_ACTIVE'
  const open = await tx.userSuspension.count({ where: { userId: a.userId, reactivatedAt: null } })
  if (open > 0) return 'TARGET_SUSPENDED'
  if (!a.scopes.length) return 'SCOPE_INVALID'
  for (const s of a.scopes) {
    const checks = {
      ORGANIZATION: () => s.organizationId && tx.organization.count({ where: { id: s.organizationId } }),
      LEGAL_ENTITY: () => s.legalEntityId && tx.legalEntity.count({ where: { id: s.legalEntityId } }),
      BUSINESS_UNIT: () => s.businessUnitId && tx.businessUnit.count({ where: { id: s.businessUnitId } }),
      PLATFORM: () => s.platformId && tx.platform.count({ where: { id: s.platformId } }),
      DEPARTMENT: () => s.departmentId && tx.department.count({ where: { id: s.departmentId } }),
      PROPERTY: () => s.propertyRef && 1, VEHICLE: () => s.vehicleRef && 1, PROJECT: () => s.projectRef && 1,
    }
    const check = checks[s.kind]
    if (!check || !(await check())) return 'SCOPE_INVALID'
  }
  return null
}

async function activateOne(client, id, injectedNow) {
  return client.$transaction(async (tx) => {
    const now = injectedNow ?? await dbNow(tx) // database clock: the same one that stamped activation_at
    const claimed = await tx.$queryRaw`SELECT id::text FROM role_assignments WHERE id = ${id}::uuid AND status = 'PENDING_ACTIVATION' AND activation_at <= ${now} FOR UPDATE SKIP LOCKED`
    if (!claimed.length) return 'SKIPPED'
    const a = await tx.roleAssignment.findUnique({ where: { id }, include: { scopes: true, roleVersion: { include: { role: true } } } })
    const blocker = await activationBlocker(tx, a, now)
    if (blocker) {
      // Record a block once per reason; the grant stays PENDING_ACTIVATION (and the evaluator still denies a suspended user).
      const seen = await tx.roleAssignmentEvent.findFirst({ where: { assignmentId: id, eventType: 'ACTIVATION_BLOCKED', detail: { path: ['reason'], equals: blocker } } })
      if (!seen) {
        const ret = await retentionFor(tx, 'PRIVILEGED_ACCESS')
        await tx.roleAssignmentEvent.create({ data: { assignmentId: id, eventType: 'ACTIVATION_BLOCKED', actorUserId: null, detail: { reason: blocker }, ...ret } })
        await recordSecurityEvent(tx, { severity: 'WARNING', eventType: 'HIGH_RISK_ACTIVATION_BLOCKED', subjectUserId: a.userId, entityType: 'role_assignment', entityId: id, summary: `High-risk activation blocked (${blocker}): ${a.roleVersion.role.code}`, detail: { reason: blocker } })
      }
      return `BLOCKED:${blocker}`
    }
    const res = await tx.roleAssignment.updateMany({ where: { id, status: 'PENDING_ACTIVATION' }, data: { status: 'ACTIVE' } })
    if (res.count !== 1) return 'SKIPPED'
    const ret = await retentionFor(tx, 'PRIVILEGED_ACCESS')
    await tx.roleAssignmentEvent.create({ data: { assignmentId: id, eventType: 'ACTIVATED', actorUserId: null, detail: { activationAt: a.activationAt.toISOString(), by: 'activation_worker' }, ...ret } })
    const audit = await writeAdminAudit(tx, { actorUserId: null, action: 'iam.role_assignment.activated', entityType: 'role_assignment', entityId: id, before: { status: 'PENDING_ACTIVATION' }, after: { status: 'ACTIVE' }, reason: 'High-risk activation delay elapsed' })
    await recordSecurityEvent(tx, { severity: 'HIGH', eventType: 'HIGH_RISK_ACCESS_ACTIVATED', subjectUserId: a.userId, entityType: 'role_assignment', entityId: id, summary: `High-risk access active: ${a.roleVersion.role.code}`, detail: { activationAt: a.activationAt.toISOString() }, auditEventId: audit.id })
    if (a.supersedesAssignmentId) {
      const old = await tx.roleAssignment.findUnique({ where: { id: a.supersedesAssignmentId } })
      if (old && ['ACTIVE', 'PENDING_ACTIVATION'].includes(old.status)) {
        await assertContinuity(tx, { assignmentIds: [old.id], now })
        await tx.roleAssignment.update({ where: { id: old.id }, data: { status: 'SUPERSEDED' } })
        await tx.roleAssignmentEvent.create({ data: { assignmentId: old.id, eventType: 'SUPERSEDED', actorUserId: null, detail: { supersededBy: id }, ...ret } })
      }
    }
    return 'ACTIVATED'
  }, TX)
}

/** One pass. Returns { scanned, activated, blocked, skipped }. Never throws for a single bad row. */
export async function runActivationCycle(client, { now = null, batch = 100 } = {}) {
  const scanAt = now ?? await dbNow(client)
  const due = await client.roleAssignment.findMany({
    where: { status: 'PENDING_ACTIVATION', activationAt: { lte: scanAt }, revokedAt: null }, orderBy: { activationAt: 'asc' }, take: batch, select: { id: true },
  })
  const out = { scanned: due.length, activated: 0, blocked: 0, skipped: 0, errors: 0 }
  for (const { id } of due) {
    try {
      const r = await activateOne(client, id, now)
      if (r === 'ACTIVATED') out.activated += 1
      else if (r.startsWith('BLOCKED')) out.blocked += 1
      else out.skipped += 1
    } catch (e) {
      out.errors += 1
      console.error(JSON.stringify({ level: 'error', event: 'activation_failed', assignmentId: id, message: String(e.message || e).slice(0, 200) }))
    }
  }
  return out
}

/** Back-compat name used by 5A callers/tests: number of assignments activated. */
export async function activateDueAssignments(client, now = null) {
  return (await runActivationCycle(client, { now })).activated
}

// Deployment mode (STEP 5C). Row locking keeps every mode correct; the mode only decides WHO runs the schedule.
//   IN_PROCESS  -- this API process runs the interval (single instance / development)
//   EXTERNAL    -- the API starts NOTHING; an external cron runs `node scripts/admin-activation-run.mjs` (multi-replica production)
//   DISABLED    -- nothing runs; the evaluator still enforces activation_at, grants just are not normalized to ACTIVE
export const ACTIVATION_MODES = Object.freeze(['IN_PROCESS', 'EXTERNAL', 'DISABLED'])
export function resolveActivationMode(env = process.env) {
  const raw = String(env.ADMIN_ACTIVATION_MODE ?? '').trim().toUpperCase()
  if (raw) {
    if (!ACTIVATION_MODES.includes(raw)) return { mode: 'DISABLED', source: 'ADMIN_ACTIVATION_MODE', warning: `Unknown ADMIN_ACTIVATION_MODE "${raw.slice(0, 20)}"; activation scheduling is DISABLED until it is IN_PROCESS, EXTERNAL or DISABLED.` }
    return { mode: raw, source: 'ADMIN_ACTIVATION_MODE', warning: null }
  }
  if (String(env.ADMIN_ACTIVATION_JOB ?? '').toLowerCase() === 'off') return { mode: 'DISABLED', source: 'ADMIN_ACTIVATION_JOB(legacy)', warning: null }
  const prod = env.NODE_ENV === 'production'
  return { mode: 'IN_PROCESS', source: 'default', warning: prod ? 'ADMIN_ACTIVATION_MODE is not set in production: running IN_PROCESS on every replica. Set ADMIN_ACTIVATION_MODE=EXTERNAL and schedule scripts/admin-activation-run.mjs for multi-replica deployments.' : null }
}

let running = false
/** In-process scheduler hook. Overlap-safe; unref'd so it never keeps the process alive. */
const consoleLog = { info: (e, f) => console.log(JSON.stringify({ event: e, ...f })), error: (e, f) => console.error(JSON.stringify({ event: e, ...f })) }
export function startActivationScheduler(client, { intervalMs = 60_000, log = consoleLog } = {}) {
  const tick = async () => {
    if (running) return
    running = true
    try {
      const r = await runActivationCycle(client)
      if (r.activated || r.blocked || r.errors) log.info('activation_cycle', r)
      const d = await retryFailedDeliveries(client)
      if (d.recovered || d.stillFailing) log.info('security_notification_retry', d)
    } catch (e) {
      log.error('activation_cycle_failed', { message: String(e.message || e).slice(0, 200) })
    } finally { running = false }
  }
  const timer = setInterval(tick, intervalMs)
  timer.unref()
  return { stop: () => clearInterval(timer), tick }
}
