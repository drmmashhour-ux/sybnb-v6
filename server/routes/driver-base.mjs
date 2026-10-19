import crypto from 'node:crypto'
import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { saveIdDocument, readIdDocument, deleteIdDocument, ALLOWED_ID_DOCUMENT_TYPES } from '../lib/id-document-storage.mjs'
import { getDriverRatingSummary } from '../lib/driver-rating.mjs'

// Shared driver base (2026-10-19): the same driver account serves SR rides now and food delivery
// later. This file owns the onboarding documents, the car-care log, the admin review of both and the
// key code that opens the work screen. Nothing here is specific to rides.
const DOC_KINDS = ['LICENCE', 'REGISTRATION', 'INSURANCE', 'CRIMINAL_RECORD', 'MECHANIC_REPORT', 'EXPERIENCE',
  'CAR_PHOTO_FRONT', 'CAR_PHOTO_BACK', 'CAR_PHOTO_LEFT', 'CAR_PHOTO_RIGHT', 'CAR_PHOTO_INSIDE', 'CAR_PHOTO_BOOT']
// Documents every driver needs before approval. Photos and the mechanic report are needed for cars;
// a bike or moto courier can skip the car-only ones (see CAR_ONLY).
const REQUIRED = ['LICENCE', 'CRIMINAL_RECORD', 'REGISTRATION', 'INSURANCE', 'MECHANIC_REPORT',
  'CAR_PHOTO_FRONT', 'CAR_PHOTO_BACK', 'CAR_PHOTO_LEFT', 'CAR_PHOTO_RIGHT', 'CAR_PHOTO_INSIDE', 'CAR_PHOTO_BOOT']
const CAR_ONLY = new Set(['CAR_PHOTO_INSIDE', 'CAR_PHOTO_BOOT'])
const CLEAN_DAYS = { OUTSIDE: 1, INSIDE: 7 }
// Uber and Lyft both take a driver off the road the moment a licence, insurance or registration
// expires, so these three must carry an expiry date we can enforce. The criminal-record certificate
// must be recent (Uber accepts 90 days), so its date is also required.
const NEEDS_EXPIRY = new Set(['LICENCE', 'INSURANCE', 'REGISTRATION', 'CRIMINAL_RECORD', 'MECHANIC_REPORT'])
const EXPIRING_SOON_DAYS = 30
// Owner decision 2026-10-19: warn on an average under 4.6 (Uber-style), once there are enough ratings.
const LOW_RATING = 4.6

// Everything that stops a driver going on duty: a required document missing, still in review,
// rejected or expired. Used by the key-code step and shown on the dashboard checklist.
export async function dutyBlockers(userId, profile) {
  const docs = await db().driverDocument.findMany({ where: { userId }, select: { kind: true, status: true, expiresAt: true } })
  const have = new Map(docs.map((d) => [d.kind, d]))
  const isCar = profile?.vehicleCategory && profile.vehicleCategory !== 'BIKE'
  const now = Date.now()
  const blockers = []
  const expiringSoon = []
  for (const kind of REQUIRED.filter((k) => isCar || !CAR_ONLY.has(k))) {
    const d = have.get(kind)
    if (!d) { blockers.push({ kind, reason: 'MISSING' }); continue }
    if (d.status === 'REJECTED') { blockers.push({ kind, reason: 'REJECTED' }); continue }
    if (d.status !== 'APPROVED') { blockers.push({ kind, reason: 'IN_REVIEW' }); continue }
    if (d.expiresAt) {
      const left = new Date(d.expiresAt).getTime() - now
      if (left <= 0) blockers.push({ kind, reason: 'EXPIRED' })
      else if (left <= EXPIRING_SOON_DAYS * 86_400_000) expiringSoon.push({ kind, days: Math.ceil(left / 86_400_000) })
    }
  }
  return { blockers, expiringSoon }
}

function fail(status, code, message) {
  const error = new Error(message)
  error.statusCode = status
  error.code = code
  error.expose = true
  return error
}

// Uber and Lyft only dispatch to a driver who is online AND whose documents are all valid. Same here:
// the key code puts the driver on duty, and any rejected, missing or expired document takes them off.
export async function assertDriverOnDuty(userId) {
  const profile = await db().driverProfile.findUnique({ where: { userId } })
  if (!profile?.onDutyAt) throw fail(403, 'DRIVER_NOT_ON_DUTY', 'Enter your key code to start work.')
  const { blockers } = await dutyBlockers(userId, profile)
  if (blockers.length) throw fail(403, 'DRIVER_DOCUMENTS_BLOCK_DUTY', 'Some documents need your attention before you can take rides.')
  return profile
}

// Pure check shared by the request list and the claim gate: does the driver's car carry these bags?
export function carryBags(profile, bags) {
  const large = Math.max(0, Number(bags?.large) || 0)
  const hand = Math.max(0, Number(bags?.hand) || 0)
  if (!large && !hand) return true
  if (profile?.largeBagCapacity == null || profile?.handBagCapacity == null) return false
  return large <= profile.largeBagCapacity && hand <= profile.handBagCapacity
}

const hashKey = (code) => crypto.createHash('sha256').update(`driver-key:${code}`).digest('hex')

async function careState(userId) {
  const rows = await db().driverCarCare.findMany({ where: { userId }, orderBy: { doneAt: 'desc' }, take: 40 })
  const out = {}
  for (const kind of ['OUTSIDE', 'INSIDE']) {
    const last = rows.find((r) => r.kind === kind)?.doneAt || null
    const due = !last || Date.now() - new Date(last).getTime() > CLEAN_DAYS[kind] * 86_400_000
    out[kind] = { lastDoneAt: last, due }
  }
  return out
}

export async function handleDriverBase(req, res, url, context) {
  const p = url.pathname

  // ---- Driver: overview for the dashboard checklist --------------------------------------------
  if (p === '/api/driver/base') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['DRIVER'])
    const userId = context.user.id
    const [profile, docs, care, rating] = await Promise.all([
      db().driverProfile.findUnique({ where: { userId } }),
      db().driverDocument.findMany({ where: { userId }, select: { kind: true, status: true, adminNote: true, expiresAt: true, updatedAt: true } }),
      careState(userId),
      getDriverRatingSummary(userId),
    ])
    const { blockers, expiringSoon } = await dutyBlockers(userId, profile)
    const missing = blockers.filter((b) => b.reason === 'MISSING' || b.reason === 'REJECTED').map((b) => b.kind)
    return json(res, 200, {
      ok: true,
      vehicleStatus: profile?.vehicleStatus || null,
      hasKeyCode: Boolean(profile?.keyCodeHash),
      onDutyAt: profile?.onDutyAt || null,
      carFacts: profile ? {
        largeBagCapacity: profile.largeBagCapacity, handBagCapacity: profile.handBagCapacity, seatCount: profile.seatCount,
        smokingAllowed: profile.smokingAllowed, tyreType: profile.tyreType, tyresFittedOn: profile.tyresFittedOn,
      } : null,
      documents: docs,
      missingDocuments: missing,
      dutyBlockers: blockers,
      expiringSoon,
      carCare: care,
      rating,
    })
  }

  // ---- Driver: upload / replace one document --------------------------------------------------
  const docMatch = p.match(/^\/api\/driver\/documents\/([A-Z_]+)$/)
  if (docMatch) {
    if (req.method !== 'PUT') return methodNotAllowed(res, ['PUT'])
    requireAuth(context, ['DRIVER'])
    const kind = docMatch[1]
    if (!DOC_KINDS.includes(kind)) throw fail(400, 'DRIVER_DOC_KIND_INVALID', 'Unknown document type.')
    const body = await readJson(req)
    const fileBase64 = typeof body.fileBase64 === 'string' ? body.fileBase64 : ''
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType : ''
    if (!fileBase64 || !ALLOWED_ID_DOCUMENT_TYPES[mimeType]) throw fail(400, 'DRIVER_DOC_FILE_INVALID', 'Send a JPG, PNG or PDF file.')
    let expiresAt = null
    if (body.expiresAt) {
      const d = new Date(body.expiresAt)
      if (Number.isNaN(d.getTime())) throw fail(400, 'DRIVER_DOC_DATE_INVALID', 'expiresAt must be a valid date.')
      expiresAt = d
    }
    if (NEEDS_EXPIRY.has(kind)) {
      if (!expiresAt) throw fail(400, 'DRIVER_DOC_EXPIRY_REQUIRED', 'Enter the date this document expires.')
      if (expiresAt.getTime() <= Date.now()) throw fail(400, 'DRIVER_DOC_EXPIRED', 'This document has already expired. Upload a valid one.')
    }
    const userId = context.user.id
    const prev = await db().driverDocument.findUnique({ where: { userId_kind: { userId, kind } } })
    const storageKey = await saveIdDocument(fileBase64, mimeType)
    const doc = await db().driverDocument.upsert({
      where: { userId_kind: { userId, kind } },
      create: { userId, kind, storageKey, mimeType, expiresAt },
      update: { storageKey, mimeType, expiresAt, status: 'IN_REVIEW', adminNote: null, reviewedAt: null },
      select: { kind: true, status: true, expiresAt: true, updatedAt: true },
    })
    if (prev?.storageKey && prev.storageKey !== storageKey) await deleteIdDocument(prev.storageKey)
    return json(res, 200, { ok: true, document: doc })
  }

  // ---- Driver: car care log (outside daily, inside weekly) ------------------------------------
  if (p === '/api/driver/car-care') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['DRIVER'])
    const body = await readJson(req)
    const kind = String(body.kind || '').toUpperCase()
    if (!['OUTSIDE', 'INSIDE'].includes(kind)) throw fail(400, 'CAR_CARE_KIND_INVALID', 'kind must be OUTSIDE or INSIDE.')
    await db().driverCarCare.create({ data: { userId: context.user.id, kind } })
    return json(res, 200, { ok: true, carCare: await careState(context.user.id) })
  }

  // ---- Driver: enter the key code to start work ----------------------------------------------
  if (p === '/api/driver/key-code/verify') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['DRIVER'])
    const body = await readJson(req)
    const code = String(body.code || '').replace(/\D/g, '')
    const profile = await db().driverProfile.findUnique({ where: { userId: context.user.id }, select: { keyCodeHash: true, vehicleStatus: true, vehicleCategory: true } })
    if (!profile?.keyCodeHash) throw fail(403, 'KEY_CODE_NOT_ISSUED', 'No key code has been issued to you yet.')
    if (profile.vehicleStatus !== 'APPROVED') throw fail(403, 'DRIVER_NOT_APPROVED', 'Your application is still in review.')
    const given = Buffer.from(hashKey(code))
    const want = Buffer.from(profile.keyCodeHash)
    if (code.length !== 6 || given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
      throw fail(403, 'KEY_CODE_WRONG', 'That key code is not correct.')
    }
    // Same rule as Lyft: an expired or unapproved licence, insurance or registration keeps the
    // driver off the road until it is fixed.
    const { blockers } = await dutyBlockers(context.user.id, profile)
    if (blockers.length) {
      const error = fail(403, 'DRIVER_DOCUMENTS_BLOCK_DUTY', 'Some documents need your attention before you can start work.')
      error.details = blockers
      throw error
    }
    await db().driverProfile.update({ where: { userId: context.user.id }, data: { onDutyAt: new Date() } })
    return json(res, 200, { ok: true })
  }

  // ---- Admin: review queue (one row per driver, newest activity first) --------------------------
  if (p === '/api/admin/drivers/review-queue') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const profiles = await db().driverProfile.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        userId: true, vehicleMake: true, vehicleModel: true, vehiclePlate: true, vehicleStatus: true, vehicleCategory: true,
        vehicleYear: true, vehicleColor: true, largeBagCapacity: true, handBagCapacity: true, seatCount: true,
        smokingAllowed: true, tyreType: true, tyresFittedOn: true, keyCodeHash: true, onDutyAt: true, createdAt: true, updatedAt: true,
        user: { select: { displayName: true, email: true } },
      },
    })
    const drivers = []
    for (const pr of profiles) {
      const [{ blockers, expiringSoon }, rating, docs] = await Promise.all([
        dutyBlockers(pr.userId, pr),
        getDriverRatingSummary(pr.userId),
        db().driverDocument.groupBy({ by: ['status'], where: { userId: pr.userId }, _count: true }),
      ])
      const count = (st) => docs.find((d) => d.status === st)?._count || 0
      const { keyCodeHash, ...rest } = pr
      drivers.push({
        ...rest,
        hasKeyCode: Boolean(keyCodeHash),
        inReview: count('IN_REVIEW'),
        rejected: count('REJECTED'),
        dutyBlockers: blockers,
        expiringSoon,
        rating,
        lowRating: rating.ratingCount >= 5 && rating.averageRating !== null && rating.averageRating < LOW_RATING,
      })
    }
    return json(res, 200, { ok: true, drivers, lowRatingThreshold: LOW_RATING })
  }

  // ---- Admin: list a driver's documents ------------------------------------------------------
  const adminList = p.match(/^\/api\/admin\/drivers\/([^/]+)\/documents$/)
  if (adminList) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN'])
    const documents = await db().driverDocument.findMany({
      where: { userId: adminList[1] },
      select: { id: true, kind: true, status: true, adminNote: true, expiresAt: true, updatedAt: true },
      orderBy: { kind: 'asc' },
    })
    return json(res, 200, { ok: true, documents })
  }

  // ---- Admin: open one file ------------------------------------------------------------------
  const adminFile = p.match(/^\/api\/admin\/driver-documents\/([^/]+)\/file$/)
  if (adminFile) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN'])
    const doc = await db().driverDocument.findUnique({ where: { id: adminFile[1] } })
    if (!doc) throw fail(404, 'DRIVER_DOC_NOT_FOUND', 'Document not found.')
    const bytes = await readIdDocument(doc.storageKey)
    res.writeHead(200, { 'content-type': doc.mimeType, 'cache-control': 'private, no-store' })
    return res.end(bytes)
  }

  // ---- Admin: approve / reject one document, with a note the driver can read -------------------
  const adminReview = p.match(/^\/api\/admin\/driver-documents\/([^/]+)$/)
  if (adminReview) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const status = String(body.status || '').toUpperCase()
    if (!['APPROVED', 'REJECTED'].includes(status)) throw fail(400, 'DRIVER_DOC_STATUS_INVALID', 'status must be APPROVED or REJECTED.')
    const note = body.note ? String(body.note).slice(0, 500) : null
    if (status === 'REJECTED' && !note) throw fail(400, 'DRIVER_DOC_NOTE_REQUIRED', 'Tell the driver what to fix.')
    const doc = await db().driverDocument.update({
      where: { id: adminReview[1] },
      data: { status, adminNote: note, reviewedAt: new Date() },
      select: { id: true, userId: true, kind: true, status: true, adminNote: true },
    })
    await db().adminAuditLog.create({
      data: { actorUserId: context.user.id, action: `ADMIN_DRIVER_DOC_${status}`, entityType: 'driver_documents', entityId: doc.id, before: null, after: doc },
    })
    return json(res, 200, { ok: true, document: doc })
  }

  // ---- Admin: issue (or re-issue) a driver's key code; shown once, stored only as a hash -------
  const adminKey = p.match(/^\/api\/admin\/drivers\/([^/]+)\/key-code$/)
  if (adminKey) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['ADMIN'])
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
    const updated = await db().driverProfile.updateMany({ where: { userId: adminKey[1] }, data: { keyCodeHash: hashKey(code), onDutyAt: null } })
    if (!updated.count) throw fail(404, 'DRIVER_NOT_FOUND', 'Driver profile not found.')
    await db().adminAuditLog.create({
      data: { actorUserId: context.user.id, action: 'ADMIN_DRIVER_KEY_CODE_ISSUED', entityType: 'driver_profiles', entityId: adminKey[1], before: null, after: { issued: true } },
    })
    return json(res, 200, { ok: true, code })
  }

  return false
}
