// STEP 5 -- Command Center, platform registry + health, configuration, feature flags, global search,
// and the Reports / AI / Finance / Tax / Accountant SHELLS. Real counts only; no invented numbers.
import { db } from '../../lib/prisma.mjs'
import { bootstrapSecretDiagnostics } from '../../lib/authz/bootstrap.mjs'
import { resolveActivationMode } from '../../lib/authz/activation-worker.mjs'
import { clockStatus } from '../../lib/authz/clock.mjs'
import { storageStatus } from '../../lib/storage.mjs'
import { writeAdminAudit } from '../../lib/authz/audit.mjs'
import { badRequest, notFoundError, conflict } from './router.mjs'
import { visibleScope, requireRecord, registryContext, validateEnum, cleanText, auditOrganizationId, requireGlobalView, requireGlobalWrite, auditGlobal } from './scope.mjs'
import { authorizedPlatformsFor, heldCodes } from './core.mjs'
import { loadSnapshot, decide } from '../../lib/authz/index.mjs'
import { authorizedOrganizationIds, inOrganizations, authorizedPlaces, scopesWithinPlaces } from '../../lib/authz/org-boundary.mjs'

const PLATFORM_STATUSES = ['ACTIVE', 'SETUP', 'DEGRADED', 'DISABLED', 'NO_DATA']
// Setting categories are a closed list. Security-category writes need the higher-tier security permission.
const SETTING_CATEGORIES = ['general', 'landing', 'notifications', 'documents', 'retention', 'support', 'security', 'platform_registry']
const SETTING_MAX_BYTES = 4096

const REPORT_DIRECTORY = [
  { key: 'platform-activity', name: 'Platform activity', area: 'Operations' },
  { key: 'support-sla', name: 'Support response times', area: 'Support' },
  { key: 'document-throughput', name: 'Document review throughput', area: 'Compliance' },
  { key: 'access-review', name: 'Access review', area: 'Security' },
  { key: 'financial-summary', name: 'Financial summary', area: 'Finance' },
  { key: 'tax-summary', name: 'Tax summary', area: 'Tax' },
]

const shellBody = (title, sections) => ({ title, status: 'NOT_CONFIGURED', message: 'Navigation shell only. No calculations or financial data exist in this release.', sections })

export function registerConfig(router) {
  // ---- Command Center -------------------------------------------------------------------------------
  router.get('/command-center', async (r) => {
    await r.requireAnywhere('console.access')
    const me = r.auth.user.id; const now = new Date()
    const open = { status: { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED'] } }
    const tiles = {}
    // Scope-aware counts: each uses the same scope filter as the module's own list endpoint.
    const scoped = async (code, model, extra) => {
      try { const s = await visibleScope(r, code); return await db()[model].count({ where: { AND: [s.where, extra] } }) } catch (e) { if (e.statusCode === 403) return undefined; throw e }
    }
    tiles.myOpenWork = await scoped('work.view', 'workItem', { assignedUserId: me, ...open })
    tiles.overdueWork = await scoped('work.view', 'workItem', { dueAt: { lt: now }, ...open })
    tiles.pendingApprovals = await scoped('approval.view', 'approvalRequest', { status: 'PENDING', requesterUserId: { not: me } })
    tiles.documentsNeedingReview = await scoped('document.view', 'adminDocument', { status: { in: ['UPLOADED', 'EXTRACTED', 'NEEDS_REVIEW'] } })
    tiles.openSupportCases = await scoped('support.view', 'supportCase', { status: { in: ['OPEN', 'PENDING_INTERNAL'] } })
    const snap = await loadSnapshot(r.auth)
    const held = await heldCodes(snap, { id: r.auth.user.id, status: r.auth.user.status })
    if (held.has('access.view')) tiles.pendingAccessApprovals = await db().roleAssignment.count({ where: { status: 'PENDING_APPROVAL' } })
    if (held.has('security_event.view')) {
      // Organization-bound like /security/overview: only organizations where the caller is centrally allowed; else no tile.
      try {
        const orgIds = await authorizedOrganizationIds(r, { loadSnapshot, decide }, 'security_event.view', 'security_event')
        tiles.securityEvents7d = await db().adminAuditLog.count({ where: { ...inOrganizations(orgIds), action: { startsWith: 'security.' }, createdAt: { gte: new Date(Date.now() - 7 * 86400_000) } } })
      } catch (e) { if (e.statusCode !== 403) throw e }
    }
    const platforms = (await authorizedPlatformsFor(snap, r.auth, r.requestId)).filter((p) => p.authorized)
    r.ok({
      tiles: Object.fromEntries(Object.entries(tiles).filter(([, v]) => v !== undefined)),
      platforms: platforms.map((p) => ({ code: p.code, displayName: p.displayName, route: p.route, status: p.status })),
      // Honest placeholders: finance/tax are not wired, so no figure is ever shown.
      finance: { status: 'NOT_AVAILABLE', message: 'Financial figures appear here once the accounting engine exists (a later step).' },
    })
  })

  // ---- Platform registry + shell + health ------------------------------------------------------------
  router.get('/platforms/:code', async (r) => {
    const { platforms } = await registryContext()
    const p = platforms.find((x) => x.code === r.params.code)
    if (!p) throw notFoundError('Platform not found.')
    await requireRecord(r, 'platform.view', p.id, 'platform_shell', p.code)
    const c = (model, extra) => db()[model].count({ where: { platformId: p.id, ...extra } })
    const [work, cases, docs, approvals] = await Promise.all([
      c('workItem', { status: { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED'] } }), c('supportCase', { status: { in: ['OPEN', 'PENDING_INTERNAL'] } }),
      c('adminDocument', { status: { in: ['UPLOADED', 'EXTRACTED', 'NEEDS_REVIEW'] } }), c('approvalRequest', { status: 'PENDING' }),
    ])
    r.ok({
      platform: { id: p.id, code: p.code, displayName: p.displayName, status: p.status, route: p.route, featureFlagKey: p.featureFlagKey },
      counts: { openWork: work, openSupportCases: cases, documentsNeedingReview: docs, pendingApprovals: approvals },
      // Operational modules for each platform are separate later steps; this shell links only what exists.
      modules: [],
      note: p.status === 'SETUP' ? 'This platform is in SETUP: its operations module has not been built yet.' : null,
    })
  })

  router.patch('/platforms/:code', async (r) => {
    const p = await db().platform.findUnique({ where: { code: r.params.code } })
    if (!p) throw notFoundError('Platform not found.')
    await requireRecord(r, 'platform.manage', p.id, 'platform', p.code)
    const b = await r.body()
    const status = validateEnum(String(b?.status ?? ''), PLATFORM_STATUSES, 'status')
    const reason = cleanText(b?.reason, { min: 8, max: 300, name: 'Reason' })
    if (status === p.status) throw badRequest('No change.', 'NO_CHANGE')
    await db().$transaction(async (tx) => {
      await tx.platform.update({ where: { id: p.id }, data: { status } })
      await writeAdminAudit(tx, { organizationId: await auditOrganizationId(p.id), actorUserId: r.auth.user.id, action: 'platform.status_changed', entityType: 'platform', entityId: p.id, before: { status: p.status }, after: { status }, reason, platformCode: p.code, correlationId: r.requestId })
    })
    r.ok({ status })
  })

  router.get('/health', async (r) => {
    await r.requireAnywhere('platform_health.view')
    const t0 = Date.now()
    let database = { status: 'UP' }
    try { await db().$queryRaw`SELECT 1` ; database.latencyMs = Date.now() - t0 } catch { database = { status: 'DOWN' } }
    const storage = storageStatus()
    const snap = await loadSnapshot(r.auth)
    const platforms = (await authorizedPlatformsFor(snap, r.auth, r.requestId)).filter((p) => p.authorized)
    r.ok({
      system: { api: { status: 'UP', uptimeSeconds: Math.round(process.uptime()) }, database, storage: { provider: storage.provider, status: storage.configured ? 'CONFIGURED' : 'NOT_CONFIGURED', durable: storage.durable } },
      // No platform reports health to this console yet: say so instead of showing a fake green light.
      platforms: platforms.map((p) => ({ code: p.code, displayName: p.displayName, registryStatus: p.status, health: 'NOT_CONFIGURED', dataSource: null })),
      integrations: { status: 'NOT_CONFIGURED', message: 'No integration health feeds are connected yet.' },
      // STEP 5C diagnostics (never values): bootstrap secret lifecycle, activation scheduler mode, trusted-time corrector.
      securityFoundation: { bootstrap: await bootstrapSecretDiagnostics(db()), activation: { mode: resolveActivationMode(process.env).mode }, clock: clockStatus() },
    })
  })

  // ---- Configuration + feature flags -----------------------------------------------------------------
  router.get('/config/settings', async (r) => {
    await requireGlobalView(r, 'config.view', 'setting')
    const rows = await db().adminSetting.findMany({ orderBy: [{ category: 'asc' }, { key: 'asc' }] })
    r.ok({ categories: SETTING_CATEGORIES, settings: rows.map((s) => ({ category: s.category, key: s.key, value: s.value, version: s.version, updatedAt: s.updatedAt, updatedById: s.updatedById })) })
  })

  router.put('/config/settings/:category/:key', async (r) => {
    const { category, key } = r.params
    if (!SETTING_CATEGORIES.includes(category)) throw badRequest('Unknown category.', 'CATEGORY_UNKNOWN')
    if (!/^[a-z][a-z0-9_.]{1,60}$/.test(key)) throw badRequest('Invalid key.', 'KEY_INVALID')
    const orgIds = await requireGlobalWrite(r, category === 'security' ? 'security.manage' : 'config.manage', 'setting', `${category}.${key}`)
    const b = await r.body()
    const reason = cleanText(b?.reason, { min: 8, max: 300, name: 'Reason' })
    if (b?.value === undefined) throw badRequest('A value is required.', 'VALUE_REQUIRED')
    if (Buffer.byteLength(JSON.stringify(b.value)) > SETTING_MAX_BYTES) throw badRequest('Value is too large.', 'VALUE_TOO_LARGE')
    const existing = await db().adminSetting.findUnique({ where: { category_key: { category, key } } })
    if (existing && b?.expectedVersion != null && Number(b.expectedVersion) !== existing.version) throw conflict('This setting changed since you loaded it. Reload and try again.', 'VERSION_CONFLICT')
    const saved = await db().$transaction(async (tx) => {
      const s = existing
        ? await tx.adminSetting.update({ where: { id: existing.id }, data: { value: b.value, version: { increment: 1 }, updatedById: r.auth.user.id, updatedAt: new Date() } })
        : await tx.adminSetting.create({ data: { category, key, value: b.value, updatedById: r.auth.user.id } })
      await auditGlobal(tx, orgIds, { actorUserId: r.auth.user.id, action: 'config.setting_changed', entityType: 'admin_setting', entityId: s.id, before: existing ? { value: existing.value, version: existing.version } : null, after: { category, key, value: b.value, version: s.version }, reason, correlationId: r.requestId }, writeAdminAudit)
      return s
    })
    r.ok({ version: saved.version })
  })

  router.get('/config/feature-flags', async (r) => {
    await requireGlobalView(r, 'config.view', 'feature_flag')
    const flags = await db().featureFlag.findMany({ orderBy: [{ key: 'asc' }, { scopeKind: 'asc' }] })
    // Flags control visibility/rollout only. They are never consulted for authorization decisions.
    r.ok({ note: 'Feature flags never grant access.', flags: flags.map((f) => ({ key: f.key, scopeKind: f.scopeKind, scopeRef: f.scopeRef, enabled: f.enabled, description: f.description, updatedAt: f.updatedAt })) })
  })

  router.put('/config/feature-flags', async (r) => {
    const orgIds = await requireGlobalWrite(r, 'config.manage', 'feature_flag')
    const b = await r.body()
    const key = String(b?.key ?? ''); if (!/^[a-z][a-z0-9_.]{1,60}$/.test(key)) throw badRequest('Invalid key.', 'KEY_INVALID')
    const scopeKind = validateEnum(String(b?.scopeKind ?? 'ORGANIZATION'), ['ORGANIZATION', 'LEGAL_ENTITY', 'PLATFORM'], 'scopeKind')
    const scopeRef = String(b?.scopeRef ?? '').slice(0, 80)
    if (typeof b?.enabled !== 'boolean') throw badRequest('enabled must be true or false.', 'VALIDATION_ERROR')
    const reason = cleanText(b?.reason, { min: 8, max: 300, name: 'Reason' })
    const where = { key_scopeKind_scopeRef: { key, scopeKind, scopeRef } }
    const prev = await db().featureFlag.findUnique({ where })
    const saved = await db().$transaction(async (tx) => {
      const f = prev ? await tx.featureFlag.update({ where, data: { enabled: b.enabled, updatedById: r.auth.user.id, updatedAt: new Date() } }) : await tx.featureFlag.create({ data: { key, scopeKind, scopeRef, enabled: b.enabled, description: b?.description ? String(b.description).slice(0, 200) : null, updatedById: r.auth.user.id } })
      await auditGlobal(tx, orgIds, { actorUserId: r.auth.user.id, action: 'config.feature_flag_changed', entityType: 'feature_flag', entityId: f.id, before: prev ? { enabled: prev.enabled } : null, after: { key, scopeKind, scopeRef, enabled: b.enabled }, reason, correlationId: r.requestId }, writeAdminAudit)
      return f
    })
    r.ok({ enabled: saved.enabled })
  })

  // ---- Global search (every section is filtered by the SAME authorization as its own module) ---------
  router.get('/search', async (r) => {
    await r.requireAnywhere('search.use')
    const q = String(r.query.q ?? '').trim().slice(0, 80)
    if (q.length < 2) throw badRequest('Type at least 2 characters.', 'QUERY_TOO_SHORT')
    const section = async (code, run) => { try { return await run(await visibleScope(r, code)) } catch (e) { if (e.statusCode === 403) return undefined; throw e } }
    const ci = (field) => ({ [field]: { contains: q, mode: 'insensitive' } })
    const out = {}
    out.parties = await section('party.view', async (s) => {
      const rows = await db().party.findMany({ where: { AND: [s.orgLevel ? {} : { roles: { some: { platformId: { in: s.platformIds } } } }, { OR: [ci('displayName'), ci('legalName')] }] }, take: 5, select: { id: true, displayName: true, kind: true } })
      return rows.map((x) => ({ id: x.id, title: x.displayName, subtitle: x.kind, route: `/admin/parties?open=${x.id}` }))
    })
    out.documents = await section('document.view', async (s) => (await db().adminDocument.findMany({ where: { AND: [s.where, ci('title')] }, take: 5, select: { id: true, title: true, status: true } })).map((x) => ({ id: x.id, title: x.title, subtitle: x.status, route: `/admin/documents?open=${x.id}` })))
    out.supportCases = await section('support.view', async (s) => (await db().supportCase.findMany({ where: { AND: [s.where, ci('summary')] }, take: 5, select: { id: true, caseNumber: true, summary: true } })).map((x) => ({ id: x.id, title: `#${x.caseNumber} ${x.summary}`, subtitle: 'Support case', route: `/admin/support?open=${x.id}` })))
    out.workItems = await section('work.view', async (s) => (await db().workItem.findMany({ where: { AND: [s.where, ci('title')] }, take: 5, select: { id: true, title: true, status: true } })).map((x) => ({ id: x.id, title: x.title, subtitle: x.status, route: `/admin/work?open=${x.id}` })))
    const snap = await loadSnapshot(r.auth)
    const held = await heldCodes(snap, { id: r.auth.user.id, status: r.auth.user.status })
    if (held.has('user.view')) {
      try {
        const { places } = await authorizedPlaces(r, { loadSnapshot, decide }, 'user.view', 'admin_user')
        const { orgIndex } = await registryContext()
        out.users = (await db().user.findMany({ where: { AND: [{ roleAssignments: { some: { scopes: scopesWithinPlaces(orgIndex, places) } } }, { OR: [ci('displayName'), ci('email')] }] }, take: 5, select: { id: true, displayName: true, email: true } })).map((x) => ({ id: x.id, title: x.displayName, subtitle: x.email, route: `/admin/users?open=${x.id}` }))
      } catch (e) { if (e.statusCode !== 403) throw e }
    }
    r.ok({ query: q, results: Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) })
  })

  // ---- Shells: Reports, AI Controller, Finance, Tax, Accountant ------------------------------------------
  router.get('/reports', async (r) => {
    await r.requireAnywhere('report.view')
    r.ok({ status: 'COMING_LATER', message: 'Reports are not available yet. This directory shows what is planned.', reports: REPORT_DIRECTORY.map((x) => ({ ...x, status: 'COMING_LATER' })) })
  })
  router.get('/ai', async (r) => {
    await r.requireAnywhere('ai.view')
    r.ok({ status: 'NOT_CONFIGURED', label: 'AI SUGGESTION / HUMAN REVIEW REQUIRED', message: 'No AI suggestions exist yet. Anything the AI Controller proposes later will be labelled as a suggestion and needs a person to approve it. It cannot change money, access or documents on its own.', suggestions: [] })
  })
  router.get('/finance', async (r) => { await r.requireAnywhere('finance.view'); r.ok(shellBody('Finance', ['Overview', 'Receivables', 'Payables', 'Payouts', 'Reconciliation'])) })
  router.get('/tax', async (r) => { await r.requireAnywhere('tax.view'); r.ok(shellBody('Tax', ['GST / QST', 'Lodging tax', 'Filings', 'Rates'])) })
  router.get('/accountant', async (r) => { await r.requireAnywhere('accountant.view'); r.ok(shellBody('Accountant Center', ['Documents for review', 'Period close', 'Exports', 'Questions'])) })
}
