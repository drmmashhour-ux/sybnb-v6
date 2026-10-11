// SR in-ride audio recording (2026-10-11). Lyft-parity safety feature.
//
// Model: either party (rider or driver) may record a ride. Recordings are PRIVATE to the uploader,
// stored encrypted in a signed-URL-only bucket, retained 7 days, and reachable by admin/Safety ONLY
// once the uploader attaches a recording to an Incident (safety report). They are part of the ride
// "black box" (shared rideId with RideEvent).
//
// Gating: actual audio capture + upload is gated by SR_AUDIO_RECORDING_ENABLED. When off, preferences
// and the consent framework still work, but no audio is accepted — so the feature can ship before the
// owner confirms in-ride recording is permissible where SR operates.
import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, readJson } from '../lib/responses.mjs'
import { saveRideRecording, deleteRideRecording, signRideRecordingUrl } from '../lib/ride-recording-storage.mjs'
import { log } from '../lib/logger.mjs'

const MODES = new Set(['OFF', 'ON_DEMAND', 'NIGHT_ONLY', 'EVERY_RIDE'])
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export function recordingCaptureEnabled() {
  return process.env.SR_AUDIO_RECORDING_ENABLED === 'true'
}

function bad(message, code = 'BAD_REQUEST', statusCode = 400) {
  const err = new Error(message); err.statusCode = statusCode; err.code = code; err.expose = true; return err
}

function partyRole(ride, userId) {
  if (ride.riderId === userId) return 'RIDER'
  if (ride.driverId === userId) return 'DRIVER'
  return null
}

// Purge recordings past retention, EXCEPT those on a safety hold (attached to an incident). Called
// from the server tick.
export async function purgeExpiredRecordings() {
  let purged = 0
  try {
    const due = await db().rideRecording.findMany({
      where: { status: 'STORED', attachedIncidentId: null, expiresAt: { lt: new Date() } },
      select: { id: true, storageKey: true },
      take: 50,
    })
    for (const r of due) {
      try { await deleteRideRecording(r.storageKey) } catch { /* object may already be gone */ }
      await db().rideRecording.update({ where: { id: r.id }, data: { status: 'PURGED' } }).catch(() => {})
      purged += 1
    }
  } catch (err) {
    log.warn('recording_purge_failed', { message: err?.message })
  }
  return { purged }
}

export async function handleRideRecordings(req, res, url, context) {
  const path = url.pathname

  // ---- Preference ----
  if (path === '/api/sr/recording/preference') {
    requireAuth(context)
    if (req.method === 'GET') {
      const u = await db().user.findUnique({ where: { id: context.user.id }, select: { srRecordingMode: true } })
      return json(res, 200, { ok: true, mode: u?.srRecordingMode || 'OFF', captureEnabled: recordingCaptureEnabled() })
    }
    if (req.method === 'PUT') {
      const body = await readJson(req)
      const mode = String(body.mode || '').toUpperCase()
      if (!MODES.has(mode)) throw bad('Invalid recording mode.', 'BAD_MODE')
      await db().user.update({ where: { id: context.user.id }, data: { srRecordingMode: mode } })
      return json(res, 200, { ok: true, mode, captureEnabled: recordingCaptureEnabled() })
    }
  }

  // ---- Per-ride recording context (powers the consent notice) ----
  const ctx = path.match(/^\/api\/sr\/rides\/([^/]+)\/recording-context$/)
  if (ctx && req.method === 'GET') {
    requireAuth(context)
    const ride = await db().rideRequest.findUnique({ where: { id: decodeURIComponent(ctx[1]) }, select: { id: true, riderId: true, driverId: true } })
    if (!ride) throw bad('Ride not found.', 'RIDE_NOT_FOUND', 404)
    const role = partyRole(ride, context.user.id)
    if (!role) throw bad('You are not part of this ride.', 'FORBIDDEN', 403)
    const me = await db().user.findUnique({ where: { id: context.user.id }, select: { srRecordingMode: true } })
    const counterpartyId = role === 'RIDER' ? ride.driverId : ride.riderId
    let counterpartyMayRecord = false
    if (counterpartyId) {
      const cp = await db().user.findUnique({ where: { id: counterpartyId }, select: { srRecordingMode: true } })
      counterpartyMayRecord = Boolean(cp?.srRecordingMode && cp.srRecordingMode !== 'OFF')
    }
    return json(res, 200, { ok: true, myRole: role, myMode: me?.srRecordingMode || 'OFF', captureEnabled: recordingCaptureEnabled(), counterpartyMayRecord })
  }

  // ---- Upload a recording clip ----
  const up = path.match(/^\/api\/sr\/rides\/([^/]+)\/recordings$/)
  if (up && req.method === 'POST') {
    requireAuth(context)
    if (!recordingCaptureEnabled()) throw bad('Audio recording is not enabled yet.', 'CAPTURE_DISABLED', 403)
    const rideId = decodeURIComponent(up[1])
    const ride = await db().rideRequest.findUnique({ where: { id: rideId }, select: { id: true, riderId: true, driverId: true } })
    if (!ride) throw bad('Ride not found.', 'RIDE_NOT_FOUND', 404)
    const role = partyRole(ride, context.user.id)
    if (!role) throw bad('You are not part of this ride.', 'FORBIDDEN', 403)
    const body = await readJson(req)
    const base64 = typeof body.base64 === 'string' ? body.base64 : null
    const contentType = String(body.contentType || '')
    if (!base64) throw bad('Audio data is required.', 'NO_AUDIO')
    const { storageKey, sizeBytes } = await saveRideRecording(base64, contentType)
    const durationSec = Number.isFinite(Number(body.durationSec)) ? Math.max(0, Math.round(Number(body.durationSec))) : null
    const startedAt = body.startedAt ? new Date(body.startedAt) : null
    const rec = await db().rideRecording.create({
      data: {
        rideId, uploaderId: context.user.id, role, storageKey, contentType,
        durationSec, sizeBytes,
        startedAt: startedAt && !isNaN(startedAt.getTime()) ? startedAt : null,
        expiresAt: new Date(Date.now() + RETENTION_MS),
      },
    })
    return json(res, 201, { ok: true, recording: { id: rec.id, expiresAt: rec.expiresAt, durationSec: rec.durationSec } })
  }

  // ---- List the caller's own recordings for a ride ----
  if (up && req.method === 'GET') {
    requireAuth(context)
    const rideId = decodeURIComponent(up[1])
    const rows = await db().rideRecording.findMany({
      where: { rideId, uploaderId: context.user.id, status: 'STORED' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, role: true, durationSec: true, startedAt: true, createdAt: true, expiresAt: true, attachedIncidentId: true },
    })
    return json(res, 200, { ok: true, recordings: rows })
  }

  // ---- Attach a recording to a safety report (makes it reachable by admin/Safety) ----
  const attach = path.match(/^\/api\/sr\/recordings\/([^/]+)\/attach-report$/)
  if (attach && req.method === 'POST') {
    requireAuth(context)
    const id = decodeURIComponent(attach[1])
    const rec = await db().rideRecording.findUnique({ where: { id }, select: { id: true, uploaderId: true, rideId: true, role: true, attachedIncidentId: true, status: true } })
    if (!rec) throw bad('Recording not found.', 'NOT_FOUND', 404)
    if (rec.uploaderId !== context.user.id) throw bad('Only the person who recorded can attach it to a report.', 'FORBIDDEN', 403)
    if (rec.status !== 'STORED') throw bad('This recording is no longer available.', 'GONE', 410)
    const body = await readJson(req).catch(() => ({}))
    const note = body.note ? String(body.note).slice(0, 1000) : null
    let incidentId = rec.attachedIncidentId
    if (!incidentId) {
      const incident = await db().incident.create({
        data: { rideId: rec.rideId, reporterId: context.user.id, reporterRole: rec.role, type: 'REPORT', note, meta: { recordingId: rec.id } },
      })
      incidentId = incident.id
      // Attaching puts the recording on a safety hold: it will not be auto-purged while linked.
      await db().rideRecording.update({ where: { id }, data: { attachedIncidentId: incidentId } })
    }
    return json(res, 200, { ok: true, incidentId })
  }

  // ---- Admin/Safety: fetch a recording — ONLY if it is attached to a safety report ----
  const admin = path.match(/^\/api\/admin\/recordings\/([^/]+)$/)
  if (admin && req.method === 'GET') {
    requireAuth(context, ['ADMIN'])
    const id = decodeURIComponent(admin[1])
    const rec = await db().rideRecording.findUnique({ where: { id } })
    if (!rec) throw bad('Recording not found.', 'NOT_FOUND', 404)
    if (!rec.attachedIncidentId) throw bad('This recording is private — it is only accessible once attached to a safety report.', 'RECORDING_PRIVATE', 403)
    if (rec.status !== 'STORED') throw bad('This recording is no longer available.', 'GONE', 410)
    const audioUrl = await signRideRecordingUrl(rec.storageKey, 300)
    return json(res, 200, { ok: true, recording: { id: rec.id, rideId: rec.rideId, role: rec.role, durationSec: rec.durationSec, startedAt: rec.startedAt, createdAt: rec.createdAt, incidentId: rec.attachedIncidentId, audioUrl } })
  }

  return false
}
