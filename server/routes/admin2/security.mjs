// STEP 5 -- Security Center + Audit Center API (read-mostly). Audit data is read-only here: nothing
// in this file can create, edit or delete an audit row except the explicit "export" / "break-glass
// request" events, which append new rows.
import { db } from '../../lib/prisma.mjs'
import { trustedNow } from '../../lib/authz/clock.mjs'
import { writeAdminAudit } from '../../lib/authz/audit.mjs'
import { verifyEvidenceChain } from '../../lib/authz/evidence.mjs'
import { recordSecurityEvent, SEVERITIES } from '../../lib/authz/security-events.mjs'
import { completeOwnerBootstrap, getBootstrapState, bootstrapSecretDiagnostics, BOOTSTRAP_COMPLETED } from '../../lib/authz/bootstrap.mjs'
import { sessionAuthFacts } from '../../lib/authz/index.mjs'
import { isRateLimited, clientIp } from '../../lib/rateLimit.mjs'
import { badRequest, notFoundError, pageParams, pageResult } from './router.mjs'

let orgCache = null
async function orgResource(type, id) {
  orgCache ??= await db().organization.findFirst({ orderBy: { createdAt: 'asc' } })
  return { type, id, facts: { organizationId: orgCache?.id } }
}

const SECURITY_PREFIXES = ['security.', 'iam.']
const CRITICAL_ACTIONS = [
  'iam.user.suspended', 'iam.role_assignment.granted', 'iam.role_assignment.requested', 'iam.role_assignment.approved', 'iam.role_assignment.revoked',
  'iam.role_version.activated', 'iam.service_account.created', 'iam.service_account.disabled', 'security.session_revoked_by_admin',
  'security.step_up_failed', 'security.break_glass.requested',
]

function parseDate(v, name) {
  if (!v) return undefined
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) throw badRequest(`${name} is not a valid date.`, 'DATE_INVALID')
  return d
}

function auditWhere(q) {
  const from = parseDate(q.from, 'from'); const to = parseDate(q.to, 'to')
  const text = String(q.q ?? '').trim().slice(0, 80)
  return {
    AND: [
      q.actorUserId ? { actorUserId: String(q.actorUserId) } : {},
      q.action ? { action: { startsWith: String(q.action).slice(0, 80) } } : {},
      q.entityType ? { entityType: String(q.entityType).slice(0, 60) } : {},
      q.entityId ? { entityId: String(q.entityId).slice(0, 80) } : {},
      q.platformCode ? { platformCode: String(q.platformCode).slice(0, 40) } : {},
      q.correlationId ? { correlationId: String(q.correlationId).slice(0, 80) } : {},
      from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {},
      text ? { OR: [{ action: { contains: text, mode: 'insensitive' } }, { entityId: { contains: text } }, { reason: { contains: text, mode: 'insensitive' } }] } : {},
    ],
  }
}

function auditView(a, { detail = false } = {}) {
  return {
    id: a.id, createdAt: a.createdAt, action: a.action, entityType: a.entityType, entityId: a.entityId, reason: a.reason,
    correlationId: a.correlationId, platformCode: a.platformCode,
    actor: a.actor ? { id: a.actor.id, displayName: a.actor.displayName, email: a.actor.email } : null,
    ...(detail ? { before: a.before, after: a.after } : {}),
  }
}
const ACTOR = { select: { id: true, displayName: true, email: true } }

function csvCell(v) {
  let s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  // Spreadsheet formula injection guard.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

export function registerSecurity(router) {
  // ---- Security Center ---------------------------------------------------------------------
  router.get('/security/overview', async (r) => {
    await r.require('security_event.view', await orgResource('security_overview'))
    const day = new Date(Date.now() - 24 * 3600_000); const week = new Date(Date.now() - 7 * 24 * 3600_000)
    const [privileged, activeSessions, stepUpFailed, pending, critical, sessionsMfa] = await Promise.all([
      db().user.count({ where: { status: 'ACTIVE', roleAssignments: { some: { status: { in: ['ACTIVE', 'PENDING_ACTIVATION'] }, roleVersion: { permissions: { some: { permission: { OR: [{ tier: { gte: 3 } }, { highRisk: true }] } } } } } } } }),
      db().userSession.count({ where: { revokedAt: null, expiresAt: { gt: trustedNow() }, user: { roleAssignments: { some: { status: 'ACTIVE' } } } } }),
      db().adminAuditLog.count({ where: { action: 'security.step_up_failed', createdAt: { gte: day } } }),
      db().roleAssignment.count({ where: { status: { in: ['PENDING_APPROVAL', 'UNDER_REVIEW'] } } }),
      db().securityEvent.count({ where: { severity: 'CRITICAL', createdAt: { gte: week } } }),
      db().userSession.count({ where: { revokedAt: null, expiresAt: { gt: trustedNow() }, mfaMethod: { not: null }, user: { roleAssignments: { some: { status: 'ACTIVE' } } } } }),
    ])
    r.ok({ metrics: { privilegedUsers: privileged, activeStaffSessions: activeSessions, activeStaffSessionsWithMfa: sessionsMfa, failedStepUps24h: stepUpFailed, pendingAccessApprovals: pending, criticalEvents7d: critical } })
  })

  // Security events (severity INFO/WARNING/HIGH/CRITICAL) are their own records, separate from audit events.
  const eventView = (e) => ({ id: e.id, severity: e.severity, eventType: e.eventType, summary: e.summary, actorUserId: e.actorUserId, subjectUserId: e.subjectUserId, entityType: e.entityType, entityId: e.entityId, detail: e.detail, correlationId: e.correlationId, auditEventId: e.auditEventId, notifiedCount: e.notifiedCount, status: e.status, reviewedById: e.reviewedById, reviewedAt: e.reviewedAt, reviewNote: e.reviewNote, createdAt: e.createdAt, retainUntil: e.retainUntil })
  router.get('/security/events', async (r) => {
    await r.require('security_event.view', await orgResource('security_event'))
    const p = pageParams(r.query)
    const sev = String(r.query.severity ?? '').toUpperCase()
    const where = {
      ...(SEVERITIES.includes(sev) ? { severity: sev } : r.query.critical === 'true' ? { severity: 'CRITICAL' } : {}),
      ...(['OPEN', 'ACKNOWLEDGED', 'REVIEWED'].includes(String(r.query.status)) ? { status: String(r.query.status) } : {}),
      ...(r.query.subjectUserId ? { subjectUserId: String(r.query.subjectUserId) } : {}),
      ...(r.query.eventType ? { eventType: String(r.query.eventType).slice(0, 60) } : {}),
    }
    const [total, rows] = await Promise.all([db().securityEvent.count({ where }), db().securityEvent.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take })])
    r.ok(pageResult(rows.map(eventView), total, p))
  })
  router.get('/security/events/:id', async (r) => {
    await r.require('security_event.view', await orgResource('security_event', r.params.id))
    const e = await db().securityEvent.findUnique({ where: { id: r.params.id } }).catch(() => null)
    if (!e) throw notFoundError('Security event not found.')
    r.ok({ event: eventView(e) })
  })
  // Reviewing never edits the event (facts are immutable); it records who looked at it and what they concluded.
  router.post('/security/events/:id/review', async (r) => {
    const body = await r.body()
    const note = String(body?.note ?? '').trim()
    if (note.length < 8) throw badRequest('A review note of at least 8 characters is required.', 'REASON_REQUIRED')
    const e = await db().securityEvent.findUnique({ where: { id: r.params.id } }).catch(() => null)
    if (!e) throw notFoundError('Security event not found.')
    await r.require('security_event.review', await orgResource('security_event', e.id, { subjectUserId: e.subjectUserId ?? undefined }), { evidence: true })
    await db().$transaction(async (tx) => {
      await tx.securityEvent.update({ where: { id: e.id }, data: { status: body?.status === 'ACKNOWLEDGED' ? 'ACKNOWLEDGED' : 'REVIEWED', reviewedById: r.auth.user.id, reviewedAt: new Date(), reviewNote: note } })
      await writeAdminAudit(tx, { actorUserId: r.auth.user.id, action: 'security.event_reviewed', entityType: 'security_event', entityId: e.id, reason: note, correlationId: r.requestId })
    })
    r.ok({ reviewed: true })
  })

  // ---- One-time Owner bootstrap (STEP 5B). See server/lib/authz/bootstrap.mjs for the replay-prevention design. ----
  router.get('/security/bootstrap', async (r) => {
    await r.requireAnywhere('console.access')
    const org = await db().organization.findFirst({ orderBy: { createdAt: 'asc' } })
    r.ok({ organizationId: org?.id ?? null, ...(org ? (await getBootstrapState(db(), org.id)) ?? { state: null } : { state: null }), secret: await bootstrapSecretDiagnostics(db()) })
  })
  router.post('/security/bootstrap/owner', async (r) => {
    if (await isRateLimited(`admin2-bootstrap:${r.auth.user.id}`, 15 * 60_000, 5) || await isRateLimited(`admin2-bootstrap-ip:${clientIp(r.req)}`, 15 * 60_000, 10)) {
      const error = new Error('Too many attempts. Wait a few minutes.'); error.statusCode = 429; error.code = 'RATE_LIMITED'; error.expose = true; throw error
    }
    const org = await db().organization.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!org) throw notFoundError('Organization not found.')
    // STEP 5C: a completed bootstrap is closed before authorization, the body or the operator secret are processed.
    if ((await getBootstrapState(db(), org.id))?.state === BOOTSTRAP_COMPLETED) {
      await completeOwnerBootstrap(db(), { actorUserId: r.auth.user.id, organizationId: org.id, requestId: r.requestId }) // throws 409 BOOTSTRAP_CLOSED and records the attempt
    }
    // The caller is still on the OLD Owner version, so authorization uses a permission that version holds:
    // access.assign (tier 4: fresh step-up + evidence), ORGANIZATION-scoped.
    await r.require('access.assign', await orgResource('security_bootstrap', org.id), { evidence: true })
    const body = await r.body()
    const sessionRow = r.auth.sessionId ? await db().userSession.findUnique({ where: { id: r.auth.sessionId }, select: { issuedAt: true, stepUpAt: true, mfaMethod: true } }) : null
    const out = await completeOwnerBootstrap(db(), {
      actorUserId: r.auth.user.id, organizationId: org.id, reason: body?.reason, operatorSecret: r.req.headers['x-bootstrap-secret'],
      authStrength: sessionAuthFacts(r.auth, sessionRow).authStrength, requestId: r.requestId,
    })
    r.ok(out, 201)
  })

  router.get('/security/privileged-users', async (r) => {
    await r.require('security_event.view', await orgResource('privileged_users'))
    const users = await db().user.findMany({
      where: { roleAssignments: { some: { status: { in: ['ACTIVE', 'PENDING_APPROVAL'] }, roleVersion: { permissions: { some: { permission: { OR: [{ tier: { gte: 3 } }, { highRisk: true }] } } } } } } },
      select: { id: true, displayName: true, email: true, status: true, roleAssignments: { where: { status: { in: ['ACTIVE', 'PENDING_APPROVAL'] } }, include: { roleVersion: { include: { role: true } } } } },
      take: 200,
    })
    r.ok({ users: users.map((u) => ({ id: u.id, displayName: u.displayName, email: u.email, status: u.status, roles: u.roleAssignments.map((a) => ({ code: a.roleVersion.role.code, status: a.status, isTemporary: a.isTemporary, effectiveTo: a.effectiveTo })) })) })
  })

  router.get('/security/access-changes', async (r) => {
    await r.require('security_event.view', await orgResource('access_changes'))
    const p = pageParams(r.query)
    const where = { action: { startsWith: 'iam.role' } }
    const [total, rows] = await Promise.all([db().adminAuditLog.count({ where }), db().adminAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take, include: { actor: ACTOR } })])
    r.ok(pageResult(rows.map((a) => auditView(a)), total, p))
  })

  // Break-glass FOUNDATION: records the request as an audit event and raises a notification for
  // security administrators. It grants NOTHING; real emergency access is a later step.
  router.get('/security/break-glass', async (r) => {
    await r.require('security_event.view', await orgResource('break_glass'))
    const rows = await db().adminAuditLog.findMany({ where: { action: { startsWith: 'security.break_glass' } }, orderBy: { createdAt: 'desc' }, take: 50, include: { actor: ACTOR } })
    r.ok({ enabled: false, note: 'Break-glass is recorded only; it does not elevate access in this release.', events: rows.map((a) => auditView(a)) })
  })
  router.post('/security/break-glass/request', async (r) => {
    const reason = String((await r.body())?.reason ?? '').trim()
    if (reason.length < 20) throw badRequest('Explain the emergency in at least 20 characters.', 'REASON_REQUIRED')
    await r.require('break_glass.use', await orgResource('break_glass'), { evidence: true })
    const out = await db().$transaction(async (tx) => {
      const row = await writeAdminAudit(tx, { actorUserId: r.auth.user.id, action: 'security.break_glass.requested', entityType: 'break_glass', entityId: r.requestId ?? 'n/a', reason, correlationId: r.requestId })
      const ev = await recordSecurityEvent(tx, { severity: 'CRITICAL', eventType: 'BREAK_GLASS_REQUESTED', actorUserId: r.auth.user.id, entityType: 'break_glass', entityId: row.id, summary: 'Break-glass emergency access requested', detail: { reason, grantsAccess: false }, correlationId: r.requestId, auditEventId: row.id })
      return { row, ev }
    })
    // Foundation only: it grants nothing, and it never edits a role to bypass the 48h activation delay.
    r.ok({ recorded: true, auditEventId: out.row.id, securityEventId: out.ev.id, grantsAccess: false }, 201)
  })

  // ---- Audit Center (read-only) -----------------------------------------------------------------
  router.get('/audit/events', async (r) => {
    await r.require('audit.view', await orgResource('audit_event'))
    const p = pageParams(r.query)
    const where = auditWhere(r.query)
    const [total, rows] = await Promise.all([db().adminAuditLog.count({ where }), db().adminAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take, include: { actor: ACTOR } })])
    r.ok(pageResult(rows.map((a) => auditView(a)), total, p))
  })

  router.get('/audit/events/:id', async (r) => {
    await r.require('audit.view', await orgResource('audit_event', r.params.id))
    const a = await db().adminAuditLog.findUnique({ where: { id: r.params.id }, include: { actor: ACTOR } }).catch(() => null)
    if (!a) throw notFoundError('Audit event not found.')
    const related = a.correlationId ? await db().adminAuditLog.findMany({ where: { correlationId: a.correlationId, NOT: { id: a.id } }, orderBy: { createdAt: 'asc' }, take: 20, include: { actor: ACTOR } }) : []
    r.ok({ event: auditView(a, { detail: true }), related: related.map((x) => auditView(x)) })
  })

  // Sensitive export: separate permission (tier 3 => step-up + evidence), row-capped, and the export
  // itself is audited with the filters used.
  router.get('/audit/export', async (r) => {
    await r.require('audit.export', await orgResource('audit_export'))
    const where = auditWhere(r.query)
    const rows = await db().adminAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 5001, include: { actor: ACTOR } })
    const capped = rows.length > 5000
    const list = rows.slice(0, 5000)
    await writeAdminAudit(db(), { actorUserId: r.auth.user.id, action: 'audit.export', entityType: 'audit_export', entityId: r.requestId ?? 'n/a', after: { rows: list.length, capped, filters: Object.fromEntries(Object.entries(r.query).filter(([k]) => ['actorUserId', 'action', 'entityType', 'entityId', 'platformCode', 'from', 'to', 'q'].includes(k))) }, correlationId: r.requestId })
    const header = ['time', 'action', 'entityType', 'entityId', 'actorEmail', 'reason', 'correlationId', 'platformCode']
    const body = list.map((a) => [a.createdAt.toISOString(), a.action, a.entityType, a.entityId, a.actor?.email, a.reason, a.correlationId, a.platformCode].map(csvCell).join(','))
    r.res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="audit-export.csv"', 'cache-control': 'no-store', 'x-export-capped': String(capped) })
    r.res.end([header.join(','), ...body].join('\n'))
    return true
  })

  router.get('/audit/evidence', async (r) => {
    await r.require('audit.evidence.view', await orgResource('authorization_evidence'))
    const p = pageParams(r.query)
    const where = {
      ...(r.query.userId ? { userId: String(r.query.userId) } : {}),
      ...(r.query.permission ? { permissionCode: String(r.query.permission) } : {}),
      ...(['ALLOW', 'DENY'].includes(r.query.decision) ? { decision: r.query.decision } : {}),
    }
    const [total, rows] = await Promise.all([db().authorizationEvidence.count({ where }), db().authorizationEvidence.findMany({ where, orderBy: { sequence: 'desc' }, skip: p.skip, take: p.take })])
    r.ok(pageResult(rows.map((e) => ({ sequence: String(e.sequence), userId: e.userId, permissionCode: e.permissionCode, decision: e.decision, denyReason: e.denyReason, roleCode: e.roleCode, roleVersionNumber: e.roleVersionNumber, scopeDescription: e.scopeDescription, resourceType: e.resourceType, resourceId: e.resourceId, authStrength: e.authStrength, decidedAt: e.decidedAt, correlationId: e.correlationId, hash: e.hash })), total, p))
  })

  router.get('/audit/evidence/verify', async (r) => {
    await r.require('audit.evidence.view', await orgResource('authorization_evidence'))
    r.ok({ result: await verifyEvidenceChain(db(), { limit: 50_000 }) })
  })
}
