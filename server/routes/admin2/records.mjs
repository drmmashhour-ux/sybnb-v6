// STEP 5 -- Party Center, Document Center and Support Center APIs.
import { createHash } from 'node:crypto'
import { db } from '../../lib/prisma.mjs'
import { writeAdminAudit } from '../../lib/authz/audit.mjs'
import { putObject, getObjectBytes } from '../../lib/storage.mjs'
import { badRequest, notFoundError, conflict, pageParams, sortParam, pageResult } from './router.mjs'
import { visibleScope, requireRecord, canRecord, addTimeline, validateEnum, cleanText, auditOrganizationId } from './scope.mjs'

const PARTY_KINDS = ['PERSON', 'ORGANIZATION']
const PARTY_STATUSES = ['ACTIVE', 'INACTIVE', 'BLOCKED']
const DOC_STATUSES = ['UPLOADED', 'PROCESSING', 'EXTRACTED', 'NEEDS_REVIEW', 'VERIFIED', 'REJECTED', 'ARCHIVED']
// Allowed manual status moves. Terminal-ish states only reopen through a NEW version, never by edit.
const DOC_TRANSITIONS = {
  UPLOADED: ['PROCESSING', 'NEEDS_REVIEW', 'ARCHIVED'], PROCESSING: ['EXTRACTED', 'NEEDS_REVIEW'], EXTRACTED: ['NEEDS_REVIEW'],
  NEEDS_REVIEW: ['ARCHIVED'], VERIFIED: ['ARCHIVED'], REJECTED: ['ARCHIVED'], ARCHIVED: [],
}
const REVIEWABLE = ['UPLOADED', 'EXTRACTED', 'NEEDS_REVIEW']
const CASE_STATUSES = ['OPEN', 'PENDING_CUSTOMER', 'PENDING_INTERNAL', 'RESOLVED', 'CLOSED']
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT']

const maskEmail = (e) => (e ? e.replace(/^(.).*(@.*)$/, '$1***$2') : null)
const maskPhone = (p) => (p ? `${'*'.repeat(Math.max(0, p.length - 3))}${p.slice(-3)}` : null)

// A party is organization-level, but its roles tie it to platforms: a platform-scoped user may see a party
// that holds a role on a platform they are authorized for. Same central decision, record-derived facts.
async function partyAccess(r, code, party) {
  if (await canRecord(r, code, null, 'party', party.id)) return
  for (const ro of party.roles ?? []) if (ro.platformId && ro.status === 'ACTIVE' && await canRecord(r, code, ro.platformId, 'party', party.id)) return
  await requireRecord(r, code, null, 'party', party.id) // throws the standard 403
}

function partyBase(x, sensitive) {
  return { id: x.id, kind: x.kind, displayName: x.displayName, legalName: x.legalName, status: x.status, createdAt: x.createdAt, email: sensitive ? x.email : maskEmail(x.email), phone: sensitive ? x.phone : maskPhone(x.phone), contactMasked: !sensitive }
}

export function registerRecords(router) {
  // ---- Party Center -------------------------------------------------------------------------------
  router.get('/parties', async (r) => {
    const scope = await visibleScope(r, 'party.view')
    const p = pageParams(r.query)
    const q = String(r.query.q ?? '').trim().slice(0, 80)
    const where = {
      AND: [
        scope.orgLevel ? {} : { roles: { some: { platformId: { in: scope.platformIds }, status: 'ACTIVE' } } },
        q ? { OR: [{ displayName: { contains: q, mode: 'insensitive' } }, { legalName: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] } : {},
        PARTY_KINDS.includes(r.query.kind) ? { kind: r.query.kind } : {}, PARTY_STATUSES.includes(r.query.status) ? { status: r.query.status } : {},
        r.query.roleType ? { roles: { some: { roleType: String(r.query.roleType).slice(0, 40), status: 'ACTIVE' } } } : {},
      ],
    }
    const orderBy = sortParam(r.query, ['displayName', 'createdAt', 'status'], { createdAt: 'desc' })
    const [total, rows] = await Promise.all([db().party.count({ where }), db().party.findMany({ where, orderBy, skip: p.skip, take: p.take, include: { roles: { where: { status: 'ACTIVE' } } } })])
    // Lists never carry full contact details; they are masked unless the detail view is opened by someone allowed.
    r.ok(pageResult(rows.map((x) => ({ ...partyBase(x, false), roles: x.roles.map((ro) => ro.roleType) })), total, p))
  })

  router.get('/parties/:id', async (r) => {
    const x = await db().party.findUnique({ where: { id: r.params.id }, include: { roles: true, addresses: true, userLinks: true } }).catch(() => null)
    if (!x) throw notFoundError('Party not found.')
    await partyAccess(r, 'party.view', x)
    const sensitive = await canRecord(r, 'party.contact_sensitive.view', null, 'party', x.id)
    const [docs, cases] = await Promise.all([
      db().adminDocument.findMany({ where: { partyId: x.id }, select: { id: true, title: true, documentType: true, status: true }, take: 50 }),
      db().supportCase.findMany({ where: { partyId: x.id }, select: { id: true, caseNumber: true, summary: true, status: true }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ])
    r.ok({
      party: partyBase(x, sensitive),
      // One person/company can hold several roles at once (host AND driver AND vendor ...). They are shown together.
      roles: x.roles.map((ro) => ({ id: ro.id, roleType: ro.roleType, platformId: ro.platformId, status: ro.status, effectiveFrom: ro.effectiveFrom, effectiveTo: ro.effectiveTo })),
      addresses: sensitive ? x.addresses : x.addresses.map((a) => ({ id: a.id, label: a.label, city: a.city, region: a.region, country: a.country })),
      linkedAccounts: x.userLinks.map((l) => ({ userId: l.userId, verified: Boolean(l.verifiedAt), effectiveTo: l.effectiveTo })),
      documents: docs, supportCases: cases,
    })
  })

  router.post('/parties', async (r) => {
    await requireRecord(r, 'party.manage', null, 'party')
    const b = await r.body()
    const kind = validateEnum(b?.kind, PARTY_KINDS, 'kind')
    const roleTypes = [...new Set((b?.roles ?? []).map((x) => String(x).trim().toUpperCase().slice(0, 40)).filter(Boolean))]
    const party = await db().$transaction(async (tx) => {
      const x = await tx.party.create({ data: { kind, displayName: cleanText(b?.displayName, { max: 160, name: 'Display name' }), legalName: b?.legalName ? String(b.legalName).slice(0, 200) : null, email: b?.email ? String(b.email).trim().toLowerCase().slice(0, 200) : null, phone: b?.phone ? String(b.phone).trim().slice(0, 40) : null, createdById: r.auth.user.id, roles: { create: roleTypes.map((roleType) => ({ roleType })) } } })
      await addTimeline(tx, { entityType: 'party', entityId: x.id, eventType: 'created', actorUserId: r.auth.user.id, summary: 'Party created' })
      await writeAdminAudit(tx, { organizationId: await auditOrganizationId(null), actorUserId: r.auth.user.id, action: 'party.created', entityType: 'party', entityId: x.id, after: { kind, roles: roleTypes }, correlationId: r.requestId })
      return x
    })
    r.ok({ id: party.id }, 201)
  })

  router.patch('/parties/:id', async (r) => {
    const x = await db().party.findUnique({ where: { id: r.params.id }, include: { roles: true } }).catch(() => null)
    if (!x) throw notFoundError('Party not found.')
    await partyAccess(r, 'party.manage', x)
    const b = await r.body()
    const data = {}
    if (b?.displayName) data.displayName = cleanText(b.displayName, { max: 160, name: 'Display name' })
    if (b?.status) data.status = validateEnum(b.status, PARTY_STATUSES, 'status')
    if (!Object.keys(data).length) throw badRequest('Nothing to change.', 'NO_CHANGE')
    await db().$transaction(async (tx) => {
      await tx.party.update({ where: { id: x.id }, data })
      await addTimeline(tx, { entityType: 'party', entityId: x.id, eventType: 'updated', actorUserId: r.auth.user.id, summary: `Updated: ${Object.keys(data).join(', ')}` })
      await writeAdminAudit(tx, { organizationId: await auditOrganizationId(null), actorUserId: r.auth.user.id, action: 'party.updated', entityType: 'party', entityId: x.id, before: { displayName: x.displayName, status: x.status }, after: data, reason: b?.reason ? String(b.reason).slice(0, 300) : null, correlationId: r.requestId })
    })
    r.ok({ updated: true })
  })

  router.post('/parties/:id/roles', async (r) => {
    const x = await db().party.findUnique({ where: { id: r.params.id }, include: { roles: true } }).catch(() => null)
    if (!x) throw notFoundError('Party not found.')
    await partyAccess(r, 'party.manage', x)
    const b = await r.body()
    const roleType = cleanText(b?.roleType, { max: 40, name: 'Role type' }).toUpperCase()
    const platformId = b?.platformId ? String(b.platformId) : null
    if (platformId && !(await db().platform.findUnique({ where: { id: platformId } }).catch(() => null))) throw badRequest('Unknown platform.', 'PLATFORM_UNKNOWN')
    if (await db().partyRole.findFirst({ where: { partyId: x.id, roleType, platformId, status: 'ACTIVE' } })) throw conflict('This party already holds that role.', 'ROLE_EXISTS')
    await db().$transaction(async (tx) => {
      await tx.partyRole.create({ data: { partyId: x.id, roleType, platformId } })
      await addTimeline(tx, { entityType: 'party', entityId: x.id, eventType: 'role_added', actorUserId: r.auth.user.id, summary: `Role added: ${roleType}` })
      await writeAdminAudit(tx, { organizationId: await auditOrganizationId(null), actorUserId: r.auth.user.id, action: 'party.role_added', entityType: 'party', entityId: x.id, after: { roleType, platformId }, correlationId: r.requestId })
    })
    r.ok({ added: true }, 201)
  })

  // ---- Document Center ----------------------------------------------------------------------------
  const docView = (d) => ({ id: d.id, title: d.title, documentType: d.documentType, status: d.status, platformId: d.platformId, partyId: d.partyId, currentVersionId: d.currentVersionId, uploadedById: d.uploadedById, createdAt: d.createdAt, updatedAt: d.updatedAt })

  router.get('/documents', async (r) => {
    const scope = await visibleScope(r, 'document.view')
    const p = pageParams(r.query)
    const q = String(r.query.q ?? '').trim().slice(0, 80)
    const where = { AND: [scope.where, DOC_STATUSES.includes(r.query.status) ? { status: r.query.status } : {}, r.query.documentType ? { documentType: String(r.query.documentType).slice(0, 60) } : {}, r.query.partyId ? { partyId: String(r.query.partyId) } : {}, q ? { title: { contains: q, mode: 'insensitive' } } : {}] }
    const orderBy = sortParam(r.query, ['createdAt', 'title', 'status', 'updatedAt'], { createdAt: 'desc' })
    const [total, rows] = await Promise.all([db().adminDocument.count({ where }), db().adminDocument.findMany({ where, orderBy, skip: p.skip, take: p.take })])
    r.ok(pageResult(rows.map(docView), total, p))
  })

  router.get('/documents/:id', async (r) => {
    const d = await db().adminDocument.findUnique({ where: { id: r.params.id }, include: { versions: { orderBy: { versionNumber: 'desc' } }, reviews: { orderBy: { createdAt: 'desc' } }, links: true } }).catch(() => null)
    if (!d) throw notFoundError('Document not found.')
    await requireRecord(r, 'document.view', d.platformId, 'admin_document', d.id)
    // Metadata only. The file itself is served by /download, which is a separate, higher-tier permission.
    r.ok({
      document: docView(d),
      versions: d.versions.map((v) => ({ id: v.id, versionNumber: v.versionNumber, filename: v.filename, mimeType: v.mimeType, sizeBytes: v.sizeBytes, sha256: v.sha256, uploadedById: v.uploadedById, createdAt: v.createdAt, current: v.id === d.currentVersionId })),
      reviews: d.reviews.map((x) => ({ id: x.id, versionId: x.versionId, reviewerId: x.reviewerId, decision: x.decision, reason: x.reason, createdAt: x.createdAt })),
      links: d.links.map((l) => ({ entityType: l.entityType, entityId: l.entityId })),
    })
  })

  async function storeVersion(tx, { documentId, versionNumber, file, userId, supersedes }) {
    const bytes = Buffer.from(String(file?.base64 ?? ''), 'base64')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    // putObject validates type allow-list, size and magic bytes, and generates the (unguessable) key.
    const put = await putObject('admin-documents', { base64: file.base64, contentType: String(file.contentType ?? '') })
    return tx.documentVersion.create({ data: { documentId, versionNumber, storageKey: put.key, sha256, filename: String(file.filename ?? 'document').replace(/[^\w.\- ]/g, '_').slice(0, 120), mimeType: String(file.contentType), sizeBytes: put.size, uploadedById: userId, supersedesVersionId: supersedes ?? null } })
  }

  router.post('/documents', async (r) => {
    const b = await r.body()
    const platformId = b?.platformId ? String(b.platformId) : null
    if (platformId && !(await db().platform.findUnique({ where: { id: platformId } }).catch(() => null))) throw badRequest('Unknown platform.', 'PLATFORM_UNKNOWN')
    const partyId = b?.partyId ? String(b.partyId) : null
    if (partyId && !(await db().party.findUnique({ where: { id: partyId } }).catch(() => null))) throw badRequest('Unknown party.', 'PARTY_UNKNOWN')
    await requireRecord(r, 'document.upload', platformId, 'admin_document')
    if (!b?.file?.base64) throw badRequest('A file is required.', 'FILE_REQUIRED')
    const title = cleanText(b?.title, { max: 200, name: 'Title' }); const documentType = cleanText(b?.documentType, { max: 60, name: 'Document type' })
    const out = await db().$transaction(async (tx) => {
      const d = await tx.adminDocument.create({ data: { title, documentType, platformId, partyId, uploadedById: r.auth.user.id } })
      const v = await storeVersion(tx, { documentId: d.id, versionNumber: 1, file: b.file, userId: r.auth.user.id })
      await tx.adminDocument.update({ where: { id: d.id }, data: { currentVersionId: v.id } })
      await addTimeline(tx, { entityType: 'admin_document', entityId: d.id, eventType: 'uploaded', actorUserId: r.auth.user.id, summary: `Uploaded ${v.filename}` })
      await writeAdminAudit(tx, { organizationId: await auditOrganizationId(platformId), actorUserId: r.auth.user.id, action: 'document.uploaded', entityType: 'admin_document', entityId: d.id, after: { documentType, sha256: v.sha256, sizeBytes: v.sizeBytes }, platformCode: null, correlationId: r.requestId })
      return { d, v }
    })
    r.ok({ id: out.d.id, versionId: out.v.id, sha256: out.v.sha256 }, 201)
  })

  // A correction is a NEW version. The original is never replaced or overwritten.
  router.post('/documents/:id/versions', async (r) => {
    const d = await db().adminDocument.findUnique({ where: { id: r.params.id }, include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } } }).catch(() => null)
    if (!d) throw notFoundError('Document not found.')
    await requireRecord(r, 'document.upload', d.platformId, 'admin_document', d.id)
    if (d.status === 'ARCHIVED') throw conflict('An archived document cannot receive new versions.', 'DOCUMENT_ARCHIVED')
    const b = await r.body()
    if (!b?.file?.base64) throw badRequest('A file is required.', 'FILE_REQUIRED')
    const reason = cleanText(b?.reason, { min: 5, max: 300, name: 'Reason' })
    const v = await db().$transaction(async (tx) => {
      const prev = d.versions[0]
      const nv = await storeVersion(tx, { documentId: d.id, versionNumber: (prev?.versionNumber ?? 0) + 1, file: b.file, userId: r.auth.user.id, supersedes: prev?.id })
      await tx.adminDocument.update({ where: { id: d.id }, data: { currentVersionId: nv.id, status: 'UPLOADED' } })
      await addTimeline(tx, { entityType: 'admin_document', entityId: d.id, eventType: 'new_version', actorUserId: r.auth.user.id, summary: `New version ${nv.versionNumber}: ${reason.slice(0, 100)}` })
      await writeAdminAudit(tx, { organizationId: await auditOrganizationId(d.platformId), actorUserId: r.auth.user.id, action: 'document.version_added', entityType: 'admin_document', entityId: d.id, after: { versionNumber: nv.versionNumber, sha256: nv.sha256 }, reason, correlationId: r.requestId })
      return nv
    })
    r.ok({ versionId: v.id, versionNumber: v.versionNumber }, 201)
  })

  router.post('/documents/:id/status', async (r) => {
    const d = await db().adminDocument.findUnique({ where: { id: r.params.id } }).catch(() => null)
    if (!d) throw notFoundError('Document not found.')
    await requireRecord(r, 'document.upload', d.platformId, 'admin_document', d.id)
    const b = await r.body()
    const to = validateEnum(String(b?.to ?? ''), DOC_STATUSES, 'status')
    if (!DOC_TRANSITIONS[d.status].includes(to)) throw conflict(`A ${d.status} document cannot move to ${to}.`, 'INVALID_TRANSITION')
    const reason = cleanText(b?.reason, { min: 5, max: 300, name: 'Reason' })
    await db().$transaction(async (tx) => {
      await tx.adminDocument.update({ where: { id: d.id }, data: { status: to } })
      await addTimeline(tx, { entityType: 'admin_document', entityId: d.id, eventType: 'status', actorUserId: r.auth.user.id, summary: `${d.status} -> ${to}` })
      await writeAdminAudit(tx, { organizationId: await auditOrganizationId(d.platformId), actorUserId: r.auth.user.id, action: 'document.status_changed', entityType: 'admin_document', entityId: d.id, before: { status: d.status }, after: { status: to }, reason, correlationId: r.requestId })
    })
    r.ok({ status: to })
  })

  router.post('/documents/:id/review', async (r) => {
    const d = await db().adminDocument.findUnique({ where: { id: r.params.id } }).catch(() => null)
    if (!d) throw notFoundError('Document not found.')
    const cur = d.currentVersionId ? await db().documentVersion.findUnique({ where: { id: d.currentVersionId } }) : null
    if (!cur) throw conflict('This document has no current version.', 'NO_CURRENT_VERSION')
    // Separation of duties: whoever uploaded the version under review cannot verify it.
    await requireRecord(r, 'document.review', d.platformId, 'admin_document', d.id, { facts: { subjectUserId: cur.uploadedById ?? undefined } })
    if (cur.uploadedById === r.auth.user.id) throw badRequest('You cannot review a version you uploaded.', 'SELF_REVIEW_FORBIDDEN')
    if (!REVIEWABLE.includes(d.status)) throw conflict(`A ${d.status} document is not waiting for review.`, 'NOT_REVIEWABLE')
    const b = await r.body()
    const decision = validateEnum(String(b?.decision ?? ''), ['VERIFIED', 'REJECTED'], 'decision')
    const reason = decision === 'REJECTED' ? cleanText(b?.reason, { min: 5, max: 500, name: 'Reason' }) : (b?.reason ? String(b.reason).slice(0, 500) : null)
    await db().$transaction(async (tx) => {
      await tx.documentReview.create({ data: { documentId: d.id, versionId: cur.id, reviewerId: r.auth.user.id, decision, reason } })
      await tx.adminDocument.update({ where: { id: d.id }, data: { status: decision } })
      await addTimeline(tx, { entityType: 'admin_document', entityId: d.id, eventType: decision.toLowerCase(), actorUserId: r.auth.user.id, summary: `Document ${decision.toLowerCase()}` })
      await writeAdminAudit(tx, { organizationId: await auditOrganizationId(d.platformId), actorUserId: r.auth.user.id, action: `document.${decision.toLowerCase()}`, entityType: 'admin_document', entityId: d.id, before: { status: d.status }, after: { status: decision, versionId: cur.id }, reason, correlationId: r.requestId })
    })
    r.ok({ status: decision })
  })

  // The original is streamed through the API after authorization (tier 3: step-up + evidence). There is
  // no public URL and no long-lived signed link; every download is audited.
  router.get('/documents/:id/download', async (r) => {
    const d = await db().adminDocument.findUnique({ where: { id: r.params.id } }).catch(() => null)
    if (!d) throw notFoundError('Document not found.')
    await requireRecord(r, 'document.download', d.platformId, 'admin_document', d.id)
    const versionId = r.query.versionId ? String(r.query.versionId) : d.currentVersionId
    const v = await db().documentVersion.findFirst({ where: { id: versionId ?? '', documentId: d.id } }).catch(() => null)
    if (!v) throw notFoundError('Version not found.')
    const bytes = await getObjectBytes('admin-documents', v.storageKey)
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual !== v.sha256) throw Object.assign(new Error('Stored file failed its integrity check.'), { statusCode: 500, code: 'INTEGRITY_CHECK_FAILED', expose: true })
    await writeAdminAudit(db(), { organizationId: await auditOrganizationId(d.platformId), actorUserId: r.auth.user.id, action: 'document.downloaded', entityType: 'admin_document', entityId: d.id, after: { versionId: v.id, sha256: v.sha256 }, correlationId: r.requestId })
    r.res.writeHead(200, { 'content-type': v.mimeType, 'content-length': bytes.length, 'content-disposition': `attachment; filename="${v.filename.replace(/"/g, '')}"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
    r.res.end(bytes)
    return true
  })

  // ---- Support Center -------------------------------------------------------------------------------
  const caseView = (c) => ({ id: c.id, caseNumber: c.caseNumber, platformId: c.platformId, type: c.type, priority: c.priority, status: c.status, partyId: c.partyId, assignedUserId: c.assignedUserId, summary: c.summary, createdAt: c.createdAt, updatedAt: c.updatedAt, closedAt: c.closedAt })

  router.get('/support/cases', async (r) => {
    const scope = await visibleScope(r, 'support.view')
    const p = pageParams(r.query)
    const q = String(r.query.q ?? '').trim().slice(0, 80)
    const where = { AND: [scope.where, CASE_STATUSES.includes(r.query.status) ? { status: r.query.status } : {}, PRIORITIES.includes(r.query.priority) ? { priority: r.query.priority } : {}, r.query.assignedToMe === 'true' ? { assignedUserId: r.auth.user.id } : {}, q ? { summary: { contains: q, mode: 'insensitive' } } : {}] }
    const orderBy = sortParam(r.query, ['createdAt', 'updatedAt', 'priority', 'status', 'caseNumber'], { updatedAt: 'desc' })
    const [total, rows] = await Promise.all([db().supportCase.count({ where }), db().supportCase.findMany({ where, orderBy, skip: p.skip, take: p.take })])
    r.ok(pageResult(rows.map(caseView), total, p))
  })

  router.get('/support/cases/:id', async (r) => {
    const c = await db().supportCase.findUnique({ where: { id: r.params.id }, include: { messages: { orderBy: { createdAt: 'asc' } } } }).catch(() => null)
    if (!c) throw notFoundError('Case not found.')
    await requireRecord(r, 'support.view', c.platformId, 'support_case', c.id)
    // Customer-visible messages and internal notes are different tables and different permissions.
    const canNotes = await canRecord(r, 'support.note_internal', c.platformId, 'support_case', c.id)
    const notes = canNotes ? await db().adminComment.findMany({ where: { entityType: 'support_case', entityId: c.id }, orderBy: { createdAt: 'asc' }, take: 200 }) : null
    r.ok({
      case: caseView(c),
      messages: c.messages.map((m) => ({ id: m.id, direction: m.direction, authorId: m.authorId, body: m.body, createdAt: m.createdAt })),
      internalNotes: notes && notes.map((n) => ({ id: n.id, authorId: n.authorId, body: n.body, createdAt: n.createdAt })),
      internalNotesVisible: canNotes,
    })
  })

  router.post('/support/cases', async (r) => {
    const b = await r.body()
    const platformId = b?.platformId ? String(b.platformId) : null
    if (platformId && !(await db().platform.findUnique({ where: { id: platformId } }).catch(() => null))) throw badRequest('Unknown platform.', 'PLATFORM_UNKNOWN')
    await requireRecord(r, 'support.manage', platformId, 'support_case')
    const partyId = b?.partyId ? String(b.partyId) : null
    if (partyId && !(await db().party.findUnique({ where: { id: partyId } }).catch(() => null))) throw badRequest('Unknown party.', 'PARTY_UNKNOWN')
    const priority = b?.priority ? validateEnum(b.priority, PRIORITIES, 'priority') : 'NORMAL'
    const c = await db().$transaction(async (tx) => {
      const x = await tx.supportCase.create({ data: { platformId, partyId, type: cleanText(b?.type, { max: 60, name: 'Type' }), priority, summary: cleanText(b?.summary, { max: 300, name: 'Summary' }), createdById: r.auth.user.id, linkedEntityType: b?.linkedEntityType ? String(b.linkedEntityType).slice(0, 60) : null, linkedEntityId: b?.linkedEntityId ? String(b.linkedEntityId).slice(0, 80) : null } })
      await addTimeline(tx, { entityType: 'support_case', entityId: x.id, eventType: 'opened', actorUserId: r.auth.user.id, summary: 'Case opened' })
      await writeAdminAudit(tx, { organizationId: await auditOrganizationId(platformId), actorUserId: r.auth.user.id, action: 'support.case_opened', entityType: 'support_case', entityId: x.id, correlationId: r.requestId })
      return x
    })
    r.ok({ id: c.id, caseNumber: c.caseNumber }, 201)
  })

  router.patch('/support/cases/:id', async (r) => {
    const c = await db().supportCase.findUnique({ where: { id: r.params.id } }).catch(() => null)
    if (!c) throw notFoundError('Case not found.')
    await requireRecord(r, 'support.manage', c.platformId, 'support_case', c.id)
    const b = await r.body()
    const data = {}
    if (b?.status) { data.status = validateEnum(b.status, CASE_STATUSES, 'status'); data.closedAt = ['RESOLVED', 'CLOSED'].includes(data.status) ? new Date() : null }
    if (b?.priority) data.priority = validateEnum(b.priority, PRIORITIES, 'priority')
    if ('assignedUserId' in (b ?? {})) {
      if (b.assignedUserId) { const u = await db().user.findUnique({ where: { id: String(b.assignedUserId) } }).catch(() => null); if (!u || u.status !== 'ACTIVE') throw badRequest('Assignee must be an active user.', 'ASSIGNEE_INVALID') }
      data.assignedUserId = b.assignedUserId ? String(b.assignedUserId) : null
    }
    if (!Object.keys(data).length) throw badRequest('Nothing to change.', 'NO_CHANGE')
    await db().$transaction(async (tx) => {
      await tx.supportCase.update({ where: { id: c.id }, data })
      await addTimeline(tx, { entityType: 'support_case', entityId: c.id, eventType: 'updated', actorUserId: r.auth.user.id, summary: `Updated: ${Object.keys(data).filter((k) => k !== 'closedAt').join(', ')}` })
      await writeAdminAudit(tx, { organizationId: await auditOrganizationId(c.platformId), actorUserId: r.auth.user.id, action: 'support.case_updated', entityType: 'support_case', entityId: c.id, before: { status: c.status, priority: c.priority, assignedUserId: c.assignedUserId }, after: data, correlationId: r.requestId })
    })
    r.ok({ updated: true })
  })

  // Customer-facing message (OUTBOUND) or a recorded customer message (INBOUND). Never an internal note.
  router.post('/support/cases/:id/messages', async (r) => {
    const c = await db().supportCase.findUnique({ where: { id: r.params.id } }).catch(() => null)
    if (!c) throw notFoundError('Case not found.')
    await requireRecord(r, 'support.manage', c.platformId, 'support_case', c.id)
    if (c.status === 'CLOSED') throw conflict('This case is closed.', 'CASE_CLOSED')
    const b = await r.body()
    const direction = validateEnum(String(b?.direction ?? 'OUTBOUND'), ['INBOUND', 'OUTBOUND'], 'direction')
    const msg = await db().$transaction(async (tx) => {
      const m = await tx.supportMessage.create({ data: { caseId: c.id, direction, authorId: r.auth.user.id, body: cleanText(b?.body, { max: 4000, name: 'Message' }) } })
      await tx.supportCase.update({ where: { id: c.id }, data: { status: direction === 'OUTBOUND' ? 'PENDING_CUSTOMER' : 'OPEN' } })
      await addTimeline(tx, { entityType: 'support_case', entityId: c.id, eventType: direction === 'OUTBOUND' ? 'reply_sent' : 'customer_message', actorUserId: r.auth.user.id, summary: direction === 'OUTBOUND' ? 'Reply recorded for the customer' : 'Customer message recorded' })
      return m
    })
    // Delivery to the customer is NOT performed in this step (no outbound channel is wired yet).
    r.ok({ id: msg.id, delivered: false }, 201)
  })

  router.post('/support/cases/:id/notes', async (r) => {
    const c = await db().supportCase.findUnique({ where: { id: r.params.id } }).catch(() => null)
    if (!c) throw notFoundError('Case not found.')
    await requireRecord(r, 'support.note_internal', c.platformId, 'support_case', c.id)
    const body = cleanText((await r.body())?.body, { max: 4000, name: 'Note' })
    const n = await db().$transaction(async (tx) => {
      const x = await tx.adminComment.create({ data: { entityType: 'support_case', entityId: c.id, authorId: r.auth.user.id, body } })
      await addTimeline(tx, { entityType: 'support_case', entityId: c.id, eventType: 'internal_note', actorUserId: r.auth.user.id, summary: 'Internal note added' })
      return x
    })
    r.ok({ id: n.id }, 201)
  })
}
