// STEP 5 -- My Work, notifications, approvals (non-financial only), comments and timeline.
import { createHash } from 'node:crypto'
import { db } from '../../lib/prisma.mjs'
import { writeAdminAudit } from '../../lib/authz/audit.mjs'
import { badRequest, notFoundError, conflict, pageParams, sortParam, pageResult } from './router.mjs'
import { visibleScope, requireRecord, canRecord, addTimeline, validateEnum, cleanText, recordFacts } from './scope.mjs'

const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT']
const WORK_TYPES = ['DOCUMENT_REVIEW', 'ACCESS_REQUEST', 'SECURITY_REVIEW', 'APPROVAL', 'SUPPORT_ESCALATION', 'PLATFORM_SETUP']
const WORK_STATUSES = ['OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED']
const RISKS = ['NONE', 'LOW', 'MEDIUM', 'HIGH']
const PRIORITY_RANK = { URGENT: 4, HIGH: 3, NORMAL: 2, LOW: 1 }

function workView(w) {
  return { id: w.id, type: w.type, title: w.title, platformId: w.platformId, priority: w.priority, status: w.status, assignedUserId: w.assignedUserId, assignedTeam: w.assignedTeam, dueAt: w.dueAt, overdue: Boolean(w.dueAt && w.dueAt < new Date() && !['DONE', 'CANCELLED'].includes(w.status)), linkedEntityType: w.linkedEntityType, linkedEntityId: w.linkedEntityId, risk: w.risk, createdAt: w.createdAt, completedAt: w.completedAt }
}

// Stable hash of a subject's decision-relevant content, used for the material-change check.
export function hashSnapshot(snapshot) {
  const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v)
  return createHash('sha256').update(JSON.stringify(canon(snapshot))).digest('hex')
}

// Only non-financial subjects exist in this step. Financial approvals are refused outright.
async function snapshotSubject(subjectType, subjectId) {
  if (subjectType === 'role_assignment') {
    const a = await db().roleAssignment.findUnique({ where: { id: subjectId }, include: { scopes: true, roleVersion: { include: { role: true } } } }).catch(() => null)
    if (!a) return null
    return { platformId: null, snapshot: { userId: a.userId, roleCode: a.roleVersion.role.code, versionId: a.roleVersionId, effectiveTo: a.effectiveTo, scopes: a.scopes.map((s) => ({ kind: s.kind, organizationId: s.organizationId, legalEntityId: s.legalEntityId, businessUnitId: s.businessUnitId, platformId: s.platformId })) } }
  }
  if (subjectType === 'admin_document') {
    const d = await db().adminDocument.findUnique({ where: { id: subjectId }, include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } } }).catch(() => null)
    if (!d) return null
    return { platformId: d.platformId, snapshot: { title: d.title, documentType: d.documentType, partyId: d.partyId, currentVersionId: d.currentVersionId, sha256: d.versions[0]?.sha256 ?? null } }
  }
  if (subjectType === 'platform') {
    const p = await db().platform.findUnique({ where: { id: subjectId } }).catch(() => null)
    if (!p) return null
    return { platformId: p.id, snapshot: { code: p.code, status: p.status, displayName: p.displayName } }
  }
  return null
}

const APPROVAL_KIND_FOR = { role_assignment: 'ACCESS', admin_document: 'DOCUMENT', platform: 'PLATFORM' }

// Which entity types may carry comments/timeline, and which permission reads them.
const ENTITY_ACCESS = {
  party: { read: 'party.view', load: (id) => db().party.findUnique({ where: { id } }).then((x) => x && { platformId: null }) },
  admin_document: { read: 'document.view', load: (id) => db().adminDocument.findUnique({ where: { id } }).then((x) => x && { platformId: x.platformId }) },
  support_case: { read: 'support.note_internal', load: (id) => db().supportCase.findUnique({ where: { id } }).then((x) => x && { platformId: x.platformId }) },
  work_item: { read: 'work.view', load: (id) => db().workItem.findUnique({ where: { id } }).then((x) => x && { platformId: x.platformId }) },
  approval_request: { read: 'approval.view', load: (id) => db().approvalRequest.findUnique({ where: { id } }).then((x) => x && { platformId: x.platformId }) },
}
async function entityAccess(type, id) {
  const spec = ENTITY_ACCESS[type]
  if (!spec || !/^[0-9a-f-]{36}$/i.test(String(id))) throw badRequest('Unsupported entity.', 'ENTITY_UNSUPPORTED')
  const rec = await spec.load(id).catch(() => null)
  if (!rec) throw notFoundError('Record not found.')
  return { spec, platformId: rec.platformId }
}

export function registerWork(router) {
  // ---- My Work ---------------------------------------------------------------------------------
  router.get('/work/items', async (r) => {
    const scope = await visibleScope(r, 'work.view')
    const p = pageParams(r.query)
    const me = r.auth.user.id
    const view = String(r.query.view ?? 'mine')
    const now = new Date()
    const open = { status: { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED'] } }
    const viewWhere = {
      mine: { assignedUserId: me, ...open }, unassigned: { assignedUserId: null, ...open }, team: { assignedUserId: { not: me }, ...open },
      overdue: { dueAt: { lt: now }, ...open }, blocked: { status: 'BLOCKED' }, done: { status: 'DONE' }, all: {},
    }[view]
    if (!viewWhere) throw badRequest('Unknown view.', 'VIEW_UNKNOWN')
    const where = {
      AND: [
        scope.where, viewWhere,
        WORK_TYPES.includes(r.query.type) ? { type: r.query.type } : {}, PRIORITIES.includes(r.query.priority) ? { priority: r.query.priority } : {},
        WORK_STATUSES.includes(r.query.status) ? { status: r.query.status } : {}, RISKS.includes(r.query.risk) ? { risk: r.query.risk } : {},
        r.query.platformId ? { platformId: String(r.query.platformId) } : {},
      ],
    }
    const orderBy = sortParam(r.query, ['dueAt', 'createdAt', 'priority', 'status'], { createdAt: 'desc' })
    const [total, rows] = await Promise.all([db().workItem.count({ where }), db().workItem.findMany({ where, orderBy, skip: p.skip, take: p.take })])
    r.ok(pageResult(rows.map(workView), total, p))
  })

  router.get('/work/summary', async (r) => {
    const scope = await visibleScope(r, 'work.view')
    const me = r.auth.user.id; const now = new Date()
    const open = { status: { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED'] } }
    const c = (extra) => db().workItem.count({ where: { AND: [scope.where, open, extra] } })
    const [mine, unassigned, overdue, blocked, urgent] = await Promise.all([c({ assignedUserId: me }), c({ assignedUserId: null }), c({ dueAt: { lt: now } }), db().workItem.count({ where: { AND: [scope.where, { status: 'BLOCKED' }] } }), c({ priority: 'URGENT' })])
    r.ok({ mine, unassigned, overdue, blocked, urgent })
  })

  router.post('/work/items', async (r) => {
    const b = await r.body()
    const type = validateEnum(b?.type, WORK_TYPES, 'type')
    const priority = b?.priority ? validateEnum(b.priority, PRIORITIES, 'priority') : 'NORMAL'
    const risk = b?.risk ? validateEnum(b.risk, RISKS, 'risk') : 'NONE'
    const platformId = b?.platformId ? String(b.platformId) : null
    if (platformId && !(await db().platform.findUnique({ where: { id: platformId } }).catch(() => null))) throw badRequest('Unknown platform.', 'PLATFORM_UNKNOWN')
    await requireRecord(r, 'work.manage', platformId, 'work_item')
    let dueAt = null
    if (b?.dueAt) { dueAt = new Date(b.dueAt); if (Number.isNaN(dueAt.getTime())) throw badRequest('dueAt is not a valid date.', 'DATE_INVALID') }
    const item = await db().$transaction(async (tx) => {
      const w = await tx.workItem.create({ data: { type, title: cleanText(b?.title, { max: 200, name: 'Title' }), platformId, priority, risk, dueAt, assignedUserId: b?.assignedUserId ? String(b.assignedUserId) : null, assignedTeam: b?.assignedTeam ? String(b.assignedTeam).slice(0, 60) : null, linkedEntityType: b?.linkedEntityType ? String(b.linkedEntityType).slice(0, 60) : null, linkedEntityId: b?.linkedEntityId ? String(b.linkedEntityId).slice(0, 80) : null, createdById: r.auth.user.id } })
      await addTimeline(tx, { entityType: 'work_item', entityId: w.id, eventType: 'created', actorUserId: r.auth.user.id, summary: 'Work item created' })
      await writeAdminAudit(tx, { actorUserId: r.auth.user.id, action: 'work.item.created', entityType: 'work_item', entityId: w.id, after: { type, priority, platformId }, correlationId: r.requestId })
      return w
    })
    r.ok({ item: workView(item) }, 201)
  })

  router.patch('/work/items/:id', async (r) => {
    const w = await db().workItem.findUnique({ where: { id: r.params.id } }).catch(() => null)
    if (!w) throw notFoundError('Work item not found.')
    await requireRecord(r, 'work.manage', w.platformId, 'work_item', w.id)
    const b = await r.body()
    const data = {}
    if (b?.status) { data.status = validateEnum(b.status, WORK_STATUSES, 'status'); data.completedAt = data.status === 'DONE' ? new Date() : null }
    if (b?.priority) data.priority = validateEnum(b.priority, PRIORITIES, 'priority')
    if ('assignedUserId' in (b ?? {})) {
      if (b.assignedUserId) { const u = await db().user.findUnique({ where: { id: String(b.assignedUserId) } }).catch(() => null); if (!u || u.status !== 'ACTIVE') throw badRequest('Assignee must be an active user.', 'ASSIGNEE_INVALID') }
      data.assignedUserId = b.assignedUserId ? String(b.assignedUserId) : null
    }
    if (!Object.keys(data).length) throw badRequest('Nothing to change.', 'NO_CHANGE')
    const updated = await db().$transaction(async (tx) => {
      const x = await tx.workItem.update({ where: { id: w.id }, data })
      await addTimeline(tx, { entityType: 'work_item', entityId: w.id, eventType: 'updated', actorUserId: r.auth.user.id, summary: `Updated: ${Object.keys(data).filter((k) => k !== 'completedAt').join(', ')}`, detail: { from: { status: w.status, priority: w.priority, assignedUserId: w.assignedUserId }, to: data } })
      if (data.assignedUserId && data.assignedUserId !== r.auth.user.id) await tx.adminNotification.create({ data: { userId: data.assignedUserId, type: 'TASK', title: 'A work item was assigned to you', body: w.title.slice(0, 200), link: '/admin/work', priority: w.priority } })
      return x
    })
    r.ok({ item: workView(updated) })
  })

  router.get('/work/views', async (r) => {
    await r.requireAnywhere('work.view')
    r.ok({ views: await db().adminSavedView.findMany({ where: { userId: r.auth.user.id, viewKey: 'work' }, orderBy: { createdAt: 'asc' } }) })
  })
  router.post('/work/views', async (r) => {
    await r.requireAnywhere('work.view')
    const b = await r.body()
    const filters = {}
    for (const k of ['view', 'type', 'priority', 'status', 'risk', 'platformId']) if (b?.filters?.[k]) filters[k] = String(b.filters[k]).slice(0, 60)
    const v = await db().adminSavedView.create({ data: { userId: r.auth.user.id, viewKey: 'work', name: cleanText(b?.name, { max: 60, name: 'Name' }), filters } })
    r.ok({ view: v }, 201)
  })

  // ---- Notifications (own only) ----------------------------------------------------------------
  router.get('/notifications', async (r) => {
    await r.requireAnywhere('notification.view_own')
    const p = pageParams(r.query, { defaultPageSize: 20 })
    const where = { userId: r.auth.user.id, ...(r.query.unread === 'true' ? { readAt: null } : {}) }
    const [total, unread, rows] = await Promise.all([db().adminNotification.count({ where }), db().adminNotification.count({ where: { userId: r.auth.user.id, readAt: null } }), db().adminNotification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take })])
    r.ok({ ...pageResult(rows, total, p), unread })
  })
  router.post('/notifications/:id/read', async (r) => {
    await r.requireAnywhere('notification.view_own')
    const n = await db().adminNotification.updateMany({ where: { id: r.params.id, userId: r.auth.user.id, readAt: null }, data: { readAt: new Date() } })
    r.ok({ updated: n.count })
  })
  router.post('/notifications/read-all', async (r) => {
    await r.requireAnywhere('notification.view_own')
    const n = await db().adminNotification.updateMany({ where: { userId: r.auth.user.id, readAt: null }, data: { readAt: new Date() } })
    r.ok({ updated: n.count })
  })

  // ---- Approval Center (non-financial) -----------------------------------------------------------
  router.get('/approvals', async (r) => {
    const scope = await visibleScope(r, 'approval.view')
    const p = pageParams(r.query)
    const me = r.auth.user.id
    const view = String(r.query.view ?? 'pending')
    const viewWhere = { pending: { status: 'PENDING', requesterUserId: { not: me } }, mine: { requesterUserId: me }, decided: { status: { in: ['APPROVED', 'REJECTED', 'WITHDRAWN', 'INVALIDATED'] } }, all: {} }[view]
    if (!viewWhere) throw badRequest('Unknown view.', 'VIEW_UNKNOWN')
    const where = { AND: [scope.where, viewWhere, ['ACCESS', 'DOCUMENT', 'PLATFORM'].includes(r.query.kind) ? { kind: r.query.kind } : {}] }
    const [total, rows] = await Promise.all([db().approvalRequest.count({ where }), db().approvalRequest.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take })])
    r.ok(pageResult(rows.map((a) => ({ id: a.id, kind: a.kind, title: a.title, status: a.status, subjectType: a.subjectType, subjectId: a.subjectId, requesterUserId: a.requesterUserId, platformId: a.platformId, requiredApprovals: a.requiredApprovals, createdAt: a.createdAt, decidedAt: a.decidedAt })), total, p))
  })

  router.get('/approvals/:id', async (r) => {
    const a = await db().approvalRequest.findUnique({ where: { id: r.params.id }, include: { steps: { orderBy: { createdAt: 'asc' } } } }).catch(() => null)
    if (!a) throw notFoundError('Approval not found.')
    await requireRecord(r, 'approval.view', a.platformId, 'approval_request', a.id)
    const live = await snapshotSubject(a.subjectType, a.subjectId)
    const currentHash = live ? hashSnapshot(live.snapshot) : null
    r.ok({
      approval: { id: a.id, kind: a.kind, title: a.title, status: a.status, subjectType: a.subjectType, subjectId: a.subjectId, requesterUserId: a.requesterUserId, requiredApprovals: a.requiredApprovals, createdAt: a.createdAt, decidedAt: a.decidedAt },
      snapshot: a.subjectSnapshot,
      materialChange: a.status === 'PENDING' ? { changed: currentHash !== a.snapshotHash, subjectMissing: !live, current: live?.snapshot ?? null } : null,
      steps: a.steps.map((s) => ({ id: s.id, approverUserId: s.approverUserId, decision: s.decision, reason: s.reason, decidedAt: s.decidedAt })),
    })
  })

  router.post('/approvals', async (r) => {
    const b = await r.body()
    const subjectType = String(b?.subjectType ?? '')
    if (b?.kind === 'FINANCIAL' || !APPROVAL_KIND_FOR[subjectType]) throw badRequest('This subject cannot be approved here. Financial approvals are not available in this release.', 'APPROVAL_SUBJECT_UNSUPPORTED')
    const subject = await snapshotSubject(subjectType, String(b?.subjectId ?? ''))
    if (!subject) throw notFoundError('Subject not found.')
    await requireRecord(r, 'work.manage', subject.platformId, 'approval_request')
    const dup = await db().approvalRequest.findFirst({ where: { subjectType, subjectId: String(b.subjectId), status: 'PENDING' } })
    if (dup) throw conflict('An approval is already pending for this subject.', 'APPROVAL_ALREADY_PENDING')
    const created = await db().$transaction(async (tx) => {
      const a = await tx.approvalRequest.create({ data: { kind: APPROVAL_KIND_FOR[subjectType], subjectType, subjectId: String(b.subjectId), title: cleanText(b?.title, { max: 200, name: 'Title' }), requesterUserId: r.auth.user.id, platformId: subject.platformId, subjectSnapshot: subject.snapshot, snapshotHash: hashSnapshot(subject.snapshot), requiredApprovals: 1 } })
      await addTimeline(tx, { entityType: 'approval_request', entityId: a.id, eventType: 'requested', actorUserId: r.auth.user.id, summary: 'Approval requested' })
      await writeAdminAudit(tx, { actorUserId: r.auth.user.id, action: 'approval.requested', entityType: 'approval_request', entityId: a.id, after: { subjectType, subjectId: b.subjectId }, correlationId: r.requestId })
      return a
    })
    r.ok({ id: created.id }, 201)
  })

  router.post('/approvals/:id/decide', async (r) => {
    const a = await db().approvalRequest.findUnique({ where: { id: r.params.id }, include: { steps: true } }).catch(() => null)
    if (!a) throw notFoundError('Approval not found.')
    if (a.status !== 'PENDING') throw conflict('This approval is already decided.', 'ALREADY_DECIDED')
    if (a.requesterUserId === r.auth.user.id) throw badRequest('You cannot decide a request you made.', 'SELF_APPROVAL_FORBIDDEN')
    if (a.steps.some((s) => s.approverUserId === r.auth.user.id)) throw conflict('You have already decided this request.', 'ALREADY_DECIDED')
    await requireRecord(r, 'approval.decide', a.platformId, 'approval_request', a.id, { facts: { subjectUserId: a.requesterUserId } })
    const b = await r.body()
    const decision = validateEnum(String(b?.decision ?? ''), ['APPROVE', 'REJECT'], 'decision')
    const reason = cleanText(b?.reason, { min: 5, max: 500, name: 'Reason' })
    // Material change: if the subject no longer matches what was put up for approval, the request is
    // invalidated instead of approved (the approver is told, nothing is applied).
    const live = await snapshotSubject(a.subjectType, a.subjectId)
    const changed = !live || hashSnapshot(live.snapshot) !== a.snapshotHash
    if (changed && decision === 'APPROVE') {
      await db().$transaction(async (tx) => {
        await tx.approvalRequest.update({ where: { id: a.id }, data: { status: 'INVALIDATED', decidedAt: new Date() } })
        await addTimeline(tx, { entityType: 'approval_request', entityId: a.id, eventType: 'invalidated', actorUserId: r.auth.user.id, summary: 'Invalidated: the subject changed after approval was requested' })
        await writeAdminAudit(tx, { actorUserId: r.auth.user.id, action: 'approval.invalidated', entityType: 'approval_request', entityId: a.id, reason, correlationId: r.requestId })
      })
      throw conflict('The subject changed after this approval was requested. The request was invalidated; ask for a new one.', 'MATERIAL_CHANGE')
    }
    const status = await db().$transaction(async (tx) => {
      await tx.approvalStep.create({ data: { requestId: a.id, approverUserId: r.auth.user.id, decision, reason, decidedAt: new Date() } })
      const approvals = a.steps.filter((s) => s.decision === 'APPROVE').length + (decision === 'APPROVE' ? 1 : 0)
      const next = decision === 'REJECT' ? 'REJECTED' : approvals >= a.requiredApprovals ? 'APPROVED' : 'PENDING'
      if (next !== 'PENDING') await tx.approvalRequest.update({ where: { id: a.id }, data: { status: next, decidedAt: new Date() } })
      await addTimeline(tx, { entityType: 'approval_request', entityId: a.id, eventType: decision === 'APPROVE' ? 'approved' : 'rejected', actorUserId: r.auth.user.id, summary: `${decision === 'APPROVE' ? 'Approved' : 'Rejected'}: ${reason.slice(0, 120)}` })
      await writeAdminAudit(tx, { actorUserId: r.auth.user.id, action: decision === 'APPROVE' ? 'approval.approved' : 'approval.rejected', entityType: 'approval_request', entityId: a.id, reason, correlationId: r.requestId })
      await tx.adminNotification.create({ data: { userId: a.requesterUserId, type: 'APPROVAL', title: `Your approval request was ${decision === 'APPROVE' ? 'approved' : 'rejected'}`, body: a.title.slice(0, 200), link: '/admin/approvals' } })
      return next
    })
    r.ok({ status })
  })

  router.post('/approvals/:id/withdraw', async (r) => {
    const a = await db().approvalRequest.findUnique({ where: { id: r.params.id } }).catch(() => null)
    if (!a) throw notFoundError('Approval not found.')
    if (a.requesterUserId !== r.auth.user.id) throw notFoundError('Approval not found.')
    if (a.status !== 'PENDING') throw conflict('Only a pending request can be withdrawn.', 'NOT_PENDING')
    await requireRecord(r, 'approval.view', a.platformId, 'approval_request', a.id)
    await db().$transaction(async (tx) => {
      await tx.approvalRequest.update({ where: { id: a.id }, data: { status: 'WITHDRAWN', decidedAt: new Date() } })
      await addTimeline(tx, { entityType: 'approval_request', entityId: a.id, eventType: 'withdrawn', actorUserId: r.auth.user.id, summary: 'Withdrawn by requester' })
      await writeAdminAudit(tx, { actorUserId: r.auth.user.id, action: 'approval.withdrawn', entityType: 'approval_request', entityId: a.id, correlationId: r.requestId })
    })
    r.ok({ status: 'WITHDRAWN' })
  })

  // ---- Comments and timeline (separate concepts; neither is the audit log) -------------------------
  router.get('/comments', async (r) => {
    const { spec, platformId } = await entityAccess(String(r.query.entityType ?? ''), String(r.query.entityId ?? ''))
    await requireRecord(r, spec.read, platformId, String(r.query.entityType), String(r.query.entityId))
    const rows = await db().adminComment.findMany({ where: { entityType: String(r.query.entityType), entityId: String(r.query.entityId) }, orderBy: { createdAt: 'asc' }, take: 200 })
    const authors = await db().user.findMany({ where: { id: { in: [...new Set(rows.map((c) => c.authorId))] } }, select: { id: true, displayName: true } })
    const nameBy = new Map(authors.map((u) => [u.id, u.displayName]))
    r.ok({ comments: rows.map((c) => ({ id: c.id, authorId: c.authorId, authorName: nameBy.get(c.authorId) ?? null, body: c.body, createdAt: c.createdAt, resolvedAt: c.resolvedAt })) })
  })

  router.post('/comments', async (r) => {
    const b = await r.body()
    const entityType = String(b?.entityType ?? ''); const entityId = String(b?.entityId ?? '')
    const { spec, platformId } = await entityAccess(entityType, entityId)
    await requireRecord(r, spec.read, platformId, entityType, entityId)
    await requireRecord(r, 'comment.write', platformId, entityType, entityId)
    const body = cleanText(b?.body, { max: 4000, name: 'Comment' })
    const c = await db().$transaction(async (tx) => {
      const x = await tx.adminComment.create({ data: { entityType, entityId, authorId: r.auth.user.id, body } })
      await addTimeline(tx, { entityType, entityId, eventType: 'comment', actorUserId: r.auth.user.id, summary: 'Internal comment added' })
      return x
    })
    r.ok({ id: c.id }, 201)
  })

  router.get('/timeline', async (r) => {
    const { spec, platformId } = await entityAccess(String(r.query.entityType ?? ''), String(r.query.entityId ?? ''))
    await requireRecord(r, spec.read, platformId, String(r.query.entityType), String(r.query.entityId))
    const rows = await db().timelineEvent.findMany({ where: { entityType: String(r.query.entityType), entityId: String(r.query.entityId) }, orderBy: { createdAt: 'desc' }, take: 100 })
    r.ok({ events: rows.map((e) => ({ id: e.id, eventType: e.eventType, summary: e.summary, actorUserId: e.actorUserId, createdAt: e.createdAt })) })
  })
}

export { canRecord, recordFacts }
