// STEP 5 -- Security Center + Audit Center API (read-mostly). Audit data is read-only here: nothing
// in this file can create, edit or delete an audit row except the explicit "export" / "break-glass
// request" events, which append new rows.
//
// STEP 5H -- ORGANIZATION BOUNDARY. Security events, audit rows and authorization evidence belong to an organization
// (migration 083). Every endpoint below
//   1. asks the CENTRAL evaluator at which organizations the caller holds the permission (org-boundary.mjs: the caller's own
//      ORGANIZATION-scoped assignments, each re-decided by decide()); no organization is ever read from the request;
//   2. restricts the query to those organizations (organizationId IN (...)); a row with no organization is visible to nobody;
//   3. for a single record, finds it only inside those organizations (anything else is a plain 404, no existence oracle)
//      and re-authorizes at the record's OWN organization.
// The previous orgResource() cached the oldest organization for every decision and the queries were global.
import { db as realDb } from '../../lib/prisma.mjs'
import { approxNow } from '../../lib/authz/clock.mjs'
import { writeAdminAudit } from '../../lib/authz/audit.mjs'
import { verifyEvidenceChainForOrganization } from '../../lib/authz/evidence.mjs'
import { recordSecurityEvent, SEVERITIES } from '../../lib/authz/security-events.mjs'
import { completeOwnerBootstrap, resolveBootstrapOrganization, getBootstrapState, bootstrapSecretDiagnostics, BOOTSTRAP_COMPLETED } from '../../lib/authz/bootstrap.mjs'
import { sessionAuthFacts, loadSnapshot, decide } from '../../lib/authz/index.mjs'
import { authError, authorizedOrganizations, authorizedOrganizationIds, inOrganizations, scopesWithinOrganizations } from '../../lib/authz/org-boundary.mjs'
import { isRateLimited, clientIp } from '../../lib/rateLimit.mjs'
import { badRequest, notFoundError, pageParams, pageResult } from './router.mjs'

// The resource an authorization decision is about. The organization is the RECORD's own organization (or, for a list, one
// candidate organization), never a cached or shared default.
const orgResource = (type, id, organizationId, extraFacts = {}) => ({ type, id, facts: { organizationId, ...extraFacts } })

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

// `organizationIds` is REQUIRED: an audit query without an organization restriction cannot be built.
function auditWhere(q, organizationIds) {
  if (!Array.isArray(organizationIds) || organizationIds.length === 0) throw authError(403, 'PERMISSION_DENIED', 'You do not have permission to do this.')
  const from = parseDate(q.from, 'from'); const to = parseDate(q.to, 'to')
  const text = String(q.q ?? '').trim().slice(0, 80)
  return {
    AND: [
      inOrganizations(organizationIds),
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
    correlationId: a.correlationId, platformCode: a.platformCode, organizationId: a.organizationId ?? null,
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

/** `deps` is a test seam: { db, authz: { loadSnapshot, decide } }. Production passes nothing. */
export function registerSecurity(router, deps = {}) {
  const db = deps.db ?? realDb
  const authz = deps.authz ?? { loadSnapshot, decide }
  const orgsFor = (r, code, type, options) => authorizedOrganizations(r, authz, code, type, options)
  const idsFor = (r, code, type, options) => authorizedOrganizationIds(r, authz, code, type, options)

  // ---- Security Center ---------------------------------------------------------------------
  router.get('/security/overview', async (r) => {
    const { ids, snap } = await orgsFor(r, 'security_event.view', 'security_overview')
    const inScope = scopesWithinOrganizations(snap.orgIndex, ids) // staff counted here are those whose access sits inside the caller's organizations
    const day = new Date(Date.now() - 24 * 3600_000); const week = new Date(Date.now() - 7 * 24 * 3600_000)
    const privilegedPermission = { permissions: { some: { permission: { OR: [{ tier: { gte: 3 } }, { highRisk: true }] } } } }
    const [privileged, activeSessions, stepUpFailed, pending, critical, sessionsMfa] = await Promise.all([
      db().user.count({ where: { status: 'ACTIVE', roleAssignments: { some: { status: { in: ['ACTIVE', 'PENDING_ACTIVATION'] }, scopes: inScope, roleVersion: privilegedPermission } } } }),
      db().userSession.count({ where: { revokedAt: null, expiresAt: { gt: approxNow() }, user: { roleAssignments: { some: { status: 'ACTIVE', scopes: inScope } } } } }),
      db().adminAuditLog.count({ where: { action: 'security.step_up_failed', createdAt: { gte: day }, ...inOrganizations(ids) } }),
      db().roleAssignment.count({ where: { status: { in: ['PENDING_APPROVAL', 'UNDER_REVIEW'] }, scopes: inScope } }),
      db().securityEvent.count({ where: { severity: 'CRITICAL', createdAt: { gte: week }, ...inOrganizations(ids) } }),
      db().userSession.count({ where: { revokedAt: null, expiresAt: { gt: approxNow() }, mfaMethod: { not: null }, user: { roleAssignments: { some: { status: 'ACTIVE', scopes: inScope } } } } }),
    ])
    r.ok({ metrics: { privilegedUsers: privileged, activeStaffSessions: activeSessions, activeStaffSessionsWithMfa: sessionsMfa, failedStepUps24h: stepUpFailed, pendingAccessApprovals: pending, criticalEvents7d: critical } })
  })

  // Security events (severity INFO/WARNING/HIGH/CRITICAL) are their own records, separate from audit events.
  const eventView = (e) => ({ id: e.id, organizationId: e.organizationId ?? null, severity: e.severity, eventType: e.eventType, summary: e.summary, actorUserId: e.actorUserId, subjectUserId: e.subjectUserId, entityType: e.entityType, entityId: e.entityId, detail: e.detail, correlationId: e.correlationId, auditEventId: e.auditEventId, notifiedCount: e.notifiedCount, status: e.status, reviewedById: e.reviewedById, reviewedAt: e.reviewedAt, reviewNote: e.reviewNote, createdAt: e.createdAt, retainUntil: e.retainUntil })
  router.get('/security/events', async (r) => {
    const ids = await idsFor(r, 'security_event.view', 'security_event')
    const p = pageParams(r.query)
    const sev = String(r.query.severity ?? '').toUpperCase()
    const where = {
      ...inOrganizations(ids),
      ...(SEVERITIES.includes(sev) ? { severity: sev } : r.query.critical === 'true' ? { severity: 'CRITICAL' } : {}),
      ...(['OPEN', 'ACKNOWLEDGED', 'REVIEWED'].includes(String(r.query.status)) ? { status: String(r.query.status) } : {}),
      ...(r.query.subjectUserId ? { subjectUserId: String(r.query.subjectUserId) } : {}),
      ...(r.query.eventType ? { eventType: String(r.query.eventType).slice(0, 60) } : {}),
    }
    const [total, rows] = await Promise.all([db().securityEvent.count({ where }), db().securityEvent.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take })])
    r.ok(pageResult(rows.map(eventView), total, p))
  })
  router.get('/security/events/:id', async (r) => {
    const ids = await idsFor(r, 'security_event.view', 'security_event')
    // Found only INSIDE the caller's organizations: another organization's (or an unattributed) event is a plain 404.
    const e = await db().securityEvent.findFirst({ where: { id: r.params.id, ...inOrganizations(ids) } }).catch(() => null)
    if (!e) throw notFoundError('Security event not found.')
    await r.require('security_event.view', orgResource('security_event', e.id, e.organizationId))
    r.ok({ event: eventView(e) })
  })
  // Reviewing never edits the event (facts are immutable); it records who looked at it and what they concluded.
  router.post('/security/events/:id/review', async (r) => {
    const body = await r.body()
    const note = String(body?.note ?? '').trim()
    if (note.length < 8) throw badRequest('A review note of at least 8 characters is required.', 'REASON_REQUIRED')
    const ids = await idsFor(r, 'security_event.review', 'security_event')
    const e = await db().securityEvent.findFirst({ where: { id: r.params.id, ...inOrganizations(ids) } }).catch(() => null)
    if (!e) throw notFoundError('Security event not found.')
    await r.require('security_event.review', orgResource('security_event', e.id, e.organizationId, { subjectUserId: e.subjectUserId ?? undefined }), { evidence: true })
    await db().$transaction(async (tx) => {
      await tx.securityEvent.update({ where: { id: e.id }, data: { status: body?.status === 'ACKNOWLEDGED' ? 'ACKNOWLEDGED' : 'REVIEWED', reviewedById: r.auth.user.id, reviewedAt: new Date(), reviewNote: note } })
      await writeAdminAudit(tx, { actorUserId: r.auth.user.id, action: 'security.event_reviewed', entityType: 'security_event', entityId: e.id, reason: note, correlationId: r.requestId, organizationId: e.organizationId })
    })
    r.ok({ reviewed: true })
  })


  // ---- One-time Owner bootstrap (STEP 5B). See the bootstrap module in server/lib/authz for the replay-prevention design. ----
  // STEP 5E: the organization is NEVER taken from the request (no query, body, header or route parameter). It is
  // resolved from the caller's own Owner assignments (see bootstrap-context.mjs); the bootstrap-specific override
  // added in 5D was removed.
  const bootstrapOrg = async (r) => {
    const ctx = await resolveBootstrapOrganization(db(), r.auth.user.id)
    if (ctx.reason === 'ORGANIZATION_CONTEXT_REQUIRED') {
      const e = new Error('Several organizations apply; the Owner bootstrap cannot choose between them.'); e.statusCode = 409; e.code = 'ORGANIZATION_CONTEXT_REQUIRED'; e.expose = true; throw e
    }
    return ctx.organizationId ? db().organization.findUnique({ where: { id: ctx.organizationId } }) : null
  }
  router.get('/security/bootstrap', async (r) => {
    await r.requireAnywhere('console.access')
    const org = await bootstrapOrg(r)
    r.ok({ organizationId: org?.id ?? null, ...(org ? (await getBootstrapState(db(), org.id)) ?? { state: null } : { state: null }), secret: await bootstrapSecretDiagnostics(db()) })
  })
  router.post('/security/bootstrap/owner', async (r) => {
    if (await isRateLimited(`admin2-bootstrap:${r.auth.user.id}`, 15 * 60_000, 5) || await isRateLimited(`admin2-bootstrap-ip:${clientIp(r.req)}`, 15 * 60_000, 10)) {
      const error = new Error('Too many attempts. Wait a few minutes.'); error.statusCode = 429; error.code = 'RATE_LIMITED'; error.expose = true; throw error
    }
    const org = await bootstrapOrg(r)
    if (!org) { const e = new Error('You do not have permission to do this.'); e.statusCode = 403; e.code = 'PERMISSION_DENIED'; e.expose = true; throw e } // no Owner organization: indistinguishable from any denial
    // STEP 5C: a completed bootstrap is closed before authorization, the body or the operator secret are processed.
    if ((await getBootstrapState(db(), org.id))?.state === BOOTSTRAP_COMPLETED) {
      await completeOwnerBootstrap(db(), { actorUserId: r.auth.user.id, organizationId: org.id, requestId: r.requestId }) // throws 409 BOOTSTRAP_CLOSED and records the attempt
    }
    // The caller is still on the OLD Owner version, so authorization uses a permission that version holds:
    // access.assign (tier 4: fresh step-up + evidence), ORGANIZATION-scoped.
    // the resource carries the RESOLVED organization (not the shared oldest-organization default), so authorization is evaluated at that organization
    await r.require('access.assign', { type: 'security_bootstrap', id: org.id, facts: { organizationId: org.id } }, { evidence: true })
    const body = await r.body()
    const sessionRow = r.auth.sessionId ? await db().userSession.findUnique({ where: { id: r.auth.sessionId }, select: { issuedAt: true, stepUpAt: true, mfaMethod: true } }) : null
    const out = await completeOwnerBootstrap(db(), {
      actorUserId: r.auth.user.id, organizationId: org.id, reason: body?.reason, operatorSecret: r.req.headers['x-bootstrap-secret'],
      authStrength: sessionAuthFacts(r.auth, sessionRow).authStrength, requestId: r.requestId,
    })
    r.ok(out, 201)
  })

  router.get('/security/privileged-users', async (r) => {
    const { ids, snap } = await orgsFor(r, 'security_event.view', 'privileged_users')
    const inScope = scopesWithinOrganizations(snap.orgIndex, ids) // only staff whose privileged access sits inside the caller's organizations, and only those assignments
    const users = await db().user.findMany({
      where: { roleAssignments: { some: { status: { in: ['ACTIVE', 'PENDING_APPROVAL'] }, scopes: inScope, roleVersion: { permissions: { some: { permission: { OR: [{ tier: { gte: 3 } }, { highRisk: true }] } } } } } } },
      select: { id: true, displayName: true, email: true, status: true, roleAssignments: { where: { status: { in: ['ACTIVE', 'PENDING_APPROVAL'] }, scopes: inScope }, include: { roleVersion: { include: { role: true } } } } },
      take: 200,
    })
    r.ok({ users: users.map((u) => ({ id: u.id, displayName: u.displayName, email: u.email, status: u.status, roles: u.roleAssignments.map((a) => ({ code: a.roleVersion.role.code, status: a.status, isTemporary: a.isTemporary, effectiveTo: a.effectiveTo })) })) })
  })

  router.get('/security/access-changes', async (r) => {
    const ids = await idsFor(r, 'security_event.view', 'access_changes')
    const p = pageParams(r.query)
    const where = { action: { startsWith: 'iam.role' }, ...inOrganizations(ids) }
    const [total, rows] = await Promise.all([db().adminAuditLog.count({ where }), db().adminAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take, include: { actor: ACTOR } })])
    r.ok(pageResult(rows.map((a) => auditView(a)), total, p))
  })

  // Break-glass FOUNDATION: records the request as an audit event and raises a notification for
  // security administrators. It grants NOTHING; real emergency access is a later step.
  router.get('/security/break-glass', async (r) => {
    const ids = await idsFor(r, 'security_event.view', 'break_glass')
    const rows = await db().adminAuditLog.findMany({ where: { action: { startsWith: 'security.break_glass' }, ...inOrganizations(ids) }, orderBy: { createdAt: 'desc' }, take: 50, include: { actor: ACTOR } })
    r.ok({ enabled: false, note: 'Break-glass is recorded only; it does not elevate access in this release.', events: rows.map((a) => auditView(a)) })
  })
  router.post('/security/break-glass/request', async (r) => {
    const reason = String((await r.body())?.reason ?? '').trim()
    if (reason.length < 20) throw badRequest('Explain the emergency in at least 20 characters.', 'REASON_REQUIRED')
    // The organization is never chosen by the caller. It is the one organization at which the caller may raise a break-glass
    // request; several candidates fail closed (same rule as the Owner bootstrap: no selector until the organization-context mechanism exists).
    const ids = await idsFor(r, 'break_glass.use', 'break_glass')
    if (ids.length > 1) throw authError(409, 'ORGANIZATION_CONTEXT_REQUIRED', 'Several organizations apply; the break-glass request cannot choose between them.')
    const organizationId = ids[0]
    await r.require('break_glass.use', orgResource('break_glass', undefined, organizationId), { evidence: true })
    const out = await db().$transaction(async (tx) => {
      const row = await writeAdminAudit(tx, { actorUserId: r.auth.user.id, action: 'security.break_glass.requested', entityType: 'break_glass', entityId: r.requestId ?? 'n/a', reason, correlationId: r.requestId, organizationId })
      const ev = await recordSecurityEvent(tx, { severity: 'CRITICAL', eventType: 'BREAK_GLASS_REQUESTED', actorUserId: r.auth.user.id, entityType: 'break_glass', entityId: row.id, summary: 'Break-glass emergency access requested', detail: { reason, grantsAccess: false }, correlationId: r.requestId, auditEventId: row.id, organizationId })
      return { row, ev }
    })
    // Foundation only: it grants nothing, and it never edits a role to bypass the 48h activation delay.
    r.ok({ recorded: true, auditEventId: out.row.id, securityEventId: out.ev.id, grantsAccess: false }, 201)
  })

  // ---- Audit Center (read-only) -----------------------------------------------------------------
  router.get('/audit/events', async (r) => {
    const ids = await idsFor(r, 'audit.view', 'audit_event')
    const p = pageParams(r.query)
    const where = auditWhere(r.query, ids)
    const [total, rows] = await Promise.all([db().adminAuditLog.count({ where }), db().adminAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take, include: { actor: ACTOR } })])
    r.ok(pageResult(rows.map((a) => auditView(a)), total, p))
  })

  router.get('/audit/events/:id', async (r) => {
    const ids = await idsFor(r, 'audit.view', 'audit_event')
    const a = await db().adminAuditLog.findFirst({ where: { id: r.params.id, ...inOrganizations(ids) }, include: { actor: ACTOR } }).catch(() => null)
    if (!a) throw notFoundError('Audit event not found.')
    await r.require('audit.view', orgResource('audit_event', a.id, a.organizationId))
    // Related rows share the correlation id AND the organization: a correlation id never reaches across organizations.
    const related = a.correlationId ? await db().adminAuditLog.findMany({ where: { correlationId: a.correlationId, NOT: { id: a.id }, ...inOrganizations([a.organizationId]) }, orderBy: { createdAt: 'asc' }, take: 20, include: { actor: ACTOR } }) : []
    r.ok({ event: auditView(a, { detail: true }), related: related.map((x) => auditView(x)) })
  })

  // Sensitive export: separate permission (tier 3 => step-up + evidence), row-capped, and the export
  // itself is audited with the filters used. Only the caller's organizations are exported, and the export is
  // recorded in EACH exported organization's own audit trail (never as an unattributed row).
  router.get('/audit/export', async (r) => {
    const ids = await idsFor(r, 'audit.export', 'audit_export')
    const where = auditWhere(r.query, ids)
    const rows = await db().adminAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 5001, include: { actor: ACTOR } })
    const capped = rows.length > 5000
    const list = rows.slice(0, 5000)
    const filters = Object.fromEntries(Object.entries(r.query).filter(([k]) => ['actorUserId', 'action', 'entityType', 'entityId', 'platformCode', 'from', 'to', 'q'].includes(k)))
    for (const organizationId of ids) {
      await writeAdminAudit(db(), { actorUserId: r.auth.user.id, action: 'audit.export', entityType: 'audit_export', entityId: r.requestId ?? 'n/a', after: { rows: list.filter((a) => a.organizationId === organizationId).length, capped, filters }, correlationId: r.requestId, organizationId })
    }
    const header = ['time', 'action', 'entityType', 'entityId', 'actorEmail', 'reason', 'correlationId', 'platformCode', 'organizationId']
    const body = list.map((a) => [a.createdAt.toISOString(), a.action, a.entityType, a.entityId, a.actor?.email, a.reason, a.correlationId, a.platformCode, a.organizationId].map(csvCell).join(','))
    r.res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="audit-export.csv"', 'cache-control': 'no-store', 'x-export-capped': String(capped) })
    r.res.end([header.join(','), ...body].join('\n'))
    return true
  })

  router.get('/audit/evidence', async (r) => {
    const ids = await idsFor(r, 'audit.evidence.view', 'authorization_evidence')
    const p = pageParams(r.query)
    const where = {
      ...inOrganizations(ids),
      ...(r.query.userId ? { userId: String(r.query.userId) } : {}),
      ...(r.query.permission ? { permissionCode: String(r.query.permission) } : {}),
      ...(['ALLOW', 'DENY'].includes(r.query.decision) ? { decision: r.query.decision } : {}),
    }
    const [total, rows] = await Promise.all([db().authorizationEvidence.count({ where }), db().authorizationEvidence.findMany({ where, orderBy: { sequence: 'desc' }, skip: p.skip, take: p.take })])
    r.ok(pageResult(rows.map((e) => ({ sequence: String(e.sequence), organizationId: e.organizationId ?? null, userId: e.userId, permissionCode: e.permissionCode, decision: e.decision, denyReason: e.denyReason, roleCode: e.roleCode, roleVersionNumber: e.roleVersionNumber, scopeDescription: e.scopeDescription, resourceType: e.resourceType, resourceId: e.resourceId, authStrength: e.authStrength, decidedAt: e.decidedAt, correlationId: e.correlationId, hash: e.hash })), total, p))
  })

  // The evidence chain is global (each row hashes its predecessor), but a caller may verify only the rows of the
  // organizations they are authorized for: other organizations' rows are never read or counted (see
  // verifyEvidenceChainForOrganization). Legacy rows written before migration 083 have no organization and are not covered.
  router.get('/audit/evidence/verify', async (r) => {
    const ids = await idsFor(r, 'audit.evidence.view', 'authorization_evidence')
    const parts = []
    for (const organizationId of ids) parts.push({ organizationId, ...(await verifyEvidenceChainForOrganization(db(), organizationId, { limit: 50_000 })) })
    const firstBroken = parts.find((x) => !x.ok)
    r.ok({ result: { ok: !firstBroken, checked: parts.reduce((n, x) => n + x.checked, 0), scope: 'ORGANIZATION', organizations: parts, ...(firstBroken ? { brokenAtSequence: firstBroken.brokenAtSequence, reason: firstBroken.reason } : {}) } })
  })
}
