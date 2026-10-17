import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { isRateLimited } from '../lib/rateLimit.mjs'
import { reauthorizeAtCommit } from '../lib/commit-authorization.mjs'

// "Report this listing" (migration 069).
//   POST  /api/listings/:id/report             any signed-in user (not the listing owner)
//   GET   /api/admin/listing-reports?status=   ADMIN / SUPPORT
//   PATCH /api/admin/listing-reports/:id       ADMIN / SUPPORT  { status: RESOLVED | DISMISSED, note? }
export const LISTING_REPORT_REASONS = ['SCAM_OR_FAKE', 'WRONG_INFO', 'UNAVAILABLE_AT_CHECKIN', 'INAPPROPRIATE', 'OTHER']
const STATUSES = ['OPEN', 'RESOLVED', 'DISMISSED']
const NOTE_MAX = 1000

function fail(statusCode, code, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  return error
}

export async function handleListingReports(req, res, url, context) {
  const reportMatch = url.pathname.match(/^\/api\/listings\/([0-9a-f-]{36})\/report$/)
  if (reportMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)
    const body = await readJson(req)
    const reason = String(body.reason || '')
    if (!LISTING_REPORT_REASONS.includes(reason)) {
      throw fail(400, 'REPORT_REASON_INVALID', `reason must be one of ${LISTING_REPORT_REASONS.join(', ')}.`)
    }
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, NOTE_MAX) || null : null

    // 5 reports / hour / user, so the button cannot be used to flood the admin queue.
    const limited = await isRateLimited(`listing-report:${context.user.id}`, 3_600_000, 5).catch(() => false)
    if (limited) throw fail(429, 'REPORT_RATE_LIMITED', 'You are sending reports too quickly. Please try again later.')

    const listing = await db().listing.findUnique({ where: { id: reportMatch[1] }, select: { id: true, ownerId: true } })
    if (!listing) throw fail(404, 'LISTING_NOT_FOUND', 'Listing not found.')
    if (listing.ownerId === context.user.id) throw fail(409, 'REPORT_OWN_LISTING', 'You cannot report your own listing.')

    const existing = await db().listingReport.findFirst({
      where: { listingId: listing.id, reporterId: context.user.id, status: 'OPEN' },
      select: { id: true },
    })
    if (existing) throw fail(409, 'REPORT_ALREADY_OPEN', 'You already have an open report for this listing.')

    const report = await db().listingReport.create({
      data: { listingId: listing.id, reporterId: context.user.id, reason, note },
      select: { id: true, status: true, reason: true, createdAt: true },
    })
    return json(res, 201, { ok: true, report })
  }

  if (url.pathname === '/api/admin/listing-reports') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const status = url.searchParams.get('status') || 'OPEN'
    if (!STATUSES.includes(status)) throw fail(400, 'REPORT_STATUS_INVALID', `status must be one of ${STATUSES.join(', ')}.`)
    const reports = await db().listingReport.findMany({ where: { status }, orderBy: { createdAt: 'asc' }, take: 200 })
    const listingIds = Array.from(new Set(reports.map((r) => r.listingId)))
    const listings = listingIds.length
      ? await db().listing.findMany({ where: { id: { in: listingIds } }, select: { id: true, titleEn: true, titleAr: true, division: true, status: true } })
      : []
    const byId = new Map(listings.map((l) => [l.id, l]))
    return json(res, 200, { ok: true, count: reports.length, reports: reports.map((r) => ({ ...r, listing: byId.get(r.listingId) ?? null })) })
  }

  const decideMatch = url.pathname.match(/^\/api\/admin\/listing-reports\/([0-9a-f-]{36})$/)
  if (decideMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const body = await readJson(req)
    const status = String(body.status || '')
    if (status !== 'RESOLVED' && status !== 'DISMISSED') throw fail(400, 'REPORT_STATUS_INVALID', 'status must be RESOLVED or DISMISSED.')
    const resolutionNote = typeof body.note === 'string' ? body.note.trim().slice(0, NOTE_MAX) || null : null

    const existing = await db().listingReport.findUnique({ where: { id: decideMatch[1] } })
    if (!existing) throw fail(404, 'REPORT_NOT_FOUND', 'Report not found.')
    if (existing.status !== 'OPEN') throw fail(409, 'REPORT_ALREADY_DECIDED', 'This report was already decided.')

    const decided = await db().$transaction(async (tx) => {
      await reauthorizeAtCommit(tx, context, { action: 'ADMIN_LISTING_REPORT_DECIDED', requiredRoles: ['ADMIN', 'SUPPORT'] })
      const updated = await tx.listingReport.update({
        where: { id: existing.id },
        data: { status, resolvedAt: new Date(), resolvedById: context.user.id, resolutionNote },
      })
      await tx.adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: 'ADMIN_LISTING_REPORT_DECIDED',
          entityType: 'listing_reports',
          entityId: updated.id,
          before: existing,
          after: updated,
        },
      })
      return updated
    })
    return json(res, 200, { ok: true, report: decided })
  }

  return false
}
