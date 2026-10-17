import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'

// Parent-child new-construction projects.
//   POST /api/host/listings/:id/units   owner only. Body { units: [{ label, priceMinor, floor?, view?, bedrooms?, sizeSqm? }] }
//        Creates one child listing per unit from the PROJECT listing (title, description, location,
//        photos, currency, expiry), varying only the unit's own parameters.
//   GET  /api/listings/:id/units        public. The approved units of a project.
//
// Review: the project itself must already be in review or approved (so the publisher ID + listing
// agreement gate was passed). Units are created PENDING_REVIEW -- a unit's price and floor are new
// content, so SYBNB still approves them, but one project submission now stands behind them all.
export const MAX_UNITS_PER_CALL = 100
export const MAX_UNITS_PER_PROJECT = 300
const STRIP_KEYS = ['advertising', 'adPlan', 'adDurationDays', 'auction', 'inventory_source', 'priceConfirmedAt', 'parentListingId', 'unit']

function fail(statusCode, code, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  return error
}

// Pure validation/normalisation (unit-testable): returns the clean unit list or throws.
export function normalizeUnits(raw) {
  if (!Array.isArray(raw) || raw.length === 0) throw fail(400, 'UNITS_REQUIRED', 'Provide at least one unit.')
  if (raw.length > MAX_UNITS_PER_CALL) throw fail(400, 'UNITS_TOO_MANY', `Up to ${MAX_UNITS_PER_CALL} units per request.`)
  const seen = new Set()
  return raw.map((u, i) => {
    const label = String(u?.label ?? '').trim().slice(0, 40)
    if (!label) throw fail(400, 'UNIT_LABEL_REQUIRED', `Unit ${i + 1}: a label is required (e.g. "3A").`)
    const key = label.toLowerCase()
    if (seen.has(key)) throw fail(400, 'UNIT_LABEL_DUPLICATE', `Unit label "${label}" is used twice.`)
    seen.add(key)
    const priceMinor = Number(u.priceMinor)
    if (!Number.isSafeInteger(priceMinor) || priceMinor <= 0) throw fail(400, 'UNIT_PRICE_INVALID', `Unit "${label}": price must be a positive whole number.`)
    const out = { label, priceMinor }
    if (u.floor != null && u.floor !== '') {
      const floor = Number(u.floor)
      if (!Number.isInteger(floor) || floor < -5 || floor > 200) throw fail(400, 'UNIT_FLOOR_INVALID', `Unit "${label}": invalid floor.`)
      out.floor = floor
    }
    if (u.view != null && String(u.view).trim()) out.view = String(u.view).trim().slice(0, 40)
    if (u.bedrooms != null && u.bedrooms !== '') {
      const bedrooms = Number(u.bedrooms)
      if (!Number.isInteger(bedrooms) || bedrooms < 0 || bedrooms > 20) throw fail(400, 'UNIT_BEDROOMS_INVALID', `Unit "${label}": invalid bedrooms.`)
      out.bedrooms = bedrooms
    }
    if (u.sizeSqm != null && u.sizeSqm !== '') {
      const sizeSqm = Number(u.sizeSqm)
      if (!Number.isFinite(sizeSqm) || sizeSqm < 10 || sizeSqm > 5000) throw fail(400, 'UNIT_SIZE_INVALID', `Unit "${label}": invalid size.`)
      out.sizeSqm = Math.round(sizeSqm * 10) / 10
    }
    return out
  })
}

export function childMetadata(parentMetadata, unit, parentId, nowIso) {
  const base = { ...(parentMetadata || {}) }
  for (const key of STRIP_KEYS) delete base[key]
  return {
    ...base,
    parentListingId: parentId,
    unit: { label: unit.label, floor: unit.floor ?? null, view: unit.view ?? null },
    ...(unit.bedrooms != null ? { bedrooms: unit.bedrooms } : {}),
    ...(unit.sizeSqm != null ? { sizeSqm: unit.sizeSqm } : {}),
    priceConfirmedAt: nowIso,
  }
}

export async function handleProjectUnits(req, res, url, context) {
  const create = url.pathname.match(/^\/api\/host\/listings\/([0-9a-f-]{36})\/units$/)
  if (create) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['SELLER', 'HOST'])
    const parent = await db().listing.findFirst({ where: { id: create[1], ownerId: context.user.id }, include: { media: true } })
    if (!parent) throw fail(404, 'LISTING_NOT_FOUND', 'Project not found for this account.')
    if (parent.division !== 'NEW_CONSTRUCTION') throw fail(400, 'NOT_A_PROJECT', 'Units can only be added to a new-construction project.')
    if (parent.metadata?.parentListingId) throw fail(400, 'UNIT_CANNOT_HAVE_UNITS', 'A unit cannot have its own units.')
    if (!['PENDING_REVIEW', 'APPROVED'].includes(parent.status)) throw fail(409, 'PROJECT_NOT_SUBMITTED', 'Submit the project for review before adding units.')

    const body = await readJson(req)
    const units = normalizeUnits(body.units)

    const existing = await db().listing.findMany({
      where: { ownerId: parent.ownerId, division: 'NEW_CONSTRUCTION', metadata: { path: ['parentListingId'], equals: parent.id } },
      select: { metadata: true },
    })
    if (existing.length + units.length > MAX_UNITS_PER_PROJECT) throw fail(400, 'UNITS_LIMIT', `A project can have at most ${MAX_UNITS_PER_PROJECT} units.`)
    const taken = new Set(existing.map((e) => String(e.metadata?.unit?.label || '').toLowerCase()))
    const clash = units.find((u) => taken.has(u.label.toLowerCase()))
    if (clash) throw fail(409, 'UNIT_LABEL_EXISTS', `Unit "${clash.label}" already exists in this project.`)

    const nowIso = new Date().toISOString()
    const created = await db().$transaction(async (tx) => {
      const out = []
      for (const unit of units) {
        const child = await tx.listing.create({
          data: {
            ownerId: parent.ownerId,
            locationId: parent.locationId,
            division: 'NEW_CONSTRUCTION',
            titleAr: `${parent.titleAr} — ${unit.label}`.slice(0, 200),
            titleEn: parent.titleEn ? `${parent.titleEn} — ${unit.label}`.slice(0, 200) : undefined,
            description: parent.description || undefined,
            status: 'PENDING_REVIEW',
            priceMinor: unit.priceMinor,
            currency: parent.currency,
            expiresAt: parent.expiresAt,
            metadata: childMetadata(parent.metadata, unit, parent.id, nowIso),
            media: parent.media.length
              ? { create: parent.media.map((m) => ({ url: m.url, kind: m.kind, sortOrder: m.sortOrder })) }
              : undefined,
          },
          select: { id: true, titleEn: true, priceMinor: true, status: true, metadata: true },
        })
        out.push(child)
      }
      await tx.adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: 'PROJECT_UNITS_CREATED',
          entityType: 'listings',
          entityId: parent.id,
          before: null,
          after: { count: out.length, labels: units.map((u) => u.label).slice(0, 100) },
        },
      })
      return out
    })
    return json(res, 201, { ok: true, created: created.length, units: created })
  }

  const list = url.pathname.match(/^\/api\/listings\/([0-9a-f-]{36})\/units$/)
  if (list) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    const children = await db().listing.findMany({
      where: { division: 'NEW_CONSTRUCTION', status: 'APPROVED', metadata: { path: ['parentListingId'], equals: list[1] } },
      select: { id: true, titleAr: true, titleEn: true, priceMinor: true, currency: true, metadata: true },
      orderBy: { createdAt: 'asc' },
      take: MAX_UNITS_PER_PROJECT,
    })
    const units = children.map((c) => ({
      id: c.id,
      titleAr: c.titleAr,
      titleEn: c.titleEn,
      priceMinor: c.priceMinor,
      currency: c.currency,
      label: c.metadata?.unit?.label || null,
      floor: c.metadata?.unit?.floor ?? null,
      view: c.metadata?.unit?.view ?? null,
      bedrooms: c.metadata?.bedrooms ?? null,
      sizeSqm: c.metadata?.sizeSqm ?? null,
    }))
    return json(res, 200, { ok: true, units })
  }
  return false
}
