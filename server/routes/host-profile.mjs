import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { deleteHostPhoto, saveHostPhoto, signHostPhotoUrl } from '../lib/host-photo-storage.mjs'

// Airbnb-style host profile (SYBNB's own): photo, "About me", languages, city -- filled in right
// after a customer turns on hosting, and shown to guests on the host's listings.
//
//   GET   /api/host/profile           own profile (HOST/SELLER)
//   PUT   /api/host/profile           save about / city / languages (HOST/SELLER)
//   PATCH /api/host/profile/photo     upload / replace the photo (HOST/SELLER)
//   GET   /api/host-profiles/:userId  PUBLIC, guest-facing fields only, hosts only
//
// The public read exposes nothing a guest could not already see about the person they are booking
// with (display name, what the host chose to write, languages, city, a signed photo URL, the year
// they joined) -- never email, phone, ID or verification documents.

const HOST_ROLES = ['HOST', 'SELLER']
const LANGUAGE_CODES = new Set(['ar', 'en', 'fr', 'ku', 'tr', 'de', 'es', 'ru', 'fa', 'hy', 'it', 'nl', 'sv'])
const ABOUT_MAX = 1000
const CITY_MAX = 80
const LANGUAGES_MAX = 8

function badRequest(message, code) {
  const error = new Error(message)
  error.statusCode = 400
  error.code = code
  error.expose = true
  return error
}

function cleanText(value, max) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw badRequest('Invalid text field.', 'HOST_PROFILE_INVALID')
  const trimmed = value.trim()
  if (trimmed.length > max) throw badRequest(`Text is too long (max ${max} characters).`, 'HOST_PROFILE_TOO_LONG')
  return trimmed || null
}

function cleanLanguages(value) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw badRequest('Languages must be a list.', 'HOST_PROFILE_INVALID')
  const unique = Array.from(new Set(value.filter((code) => typeof code === 'string' && LANGUAGE_CODES.has(code))))
  return unique.slice(0, LANGUAGES_MAX)
}

function shape(profile, user) {
  return {
    displayName: user?.displayName ?? null,
    about: profile?.about ?? null,
    city: profile?.city ?? null,
    languages: profile?.languages ?? [],
    photoUrl: profile?.photoRef ? signHostPhotoUrl(profile.photoRef) : null,
    memberSince: user?.createdAt ? new Date(user.createdAt).getUTCFullYear() : null,
    complete: Boolean(profile?.photoRef && profile?.about),
  }
}

export async function handleHostProfile(req, res, url, context) {
  if (url.pathname === '/api/host/profile') {
    requireAuth(context, HOST_ROLES)
    const userId = context.user.id
    if (req.method === 'GET') {
      const [profile, user] = await Promise.all([
        db().hostProfile.findUnique({ where: { userId } }),
        db().user.findUnique({ where: { id: userId }, select: { displayName: true, createdAt: true } }),
      ])
      return json(res, 200, { ok: true, profile: shape(profile, user) })
    }
    if (req.method === 'PUT') {
      const body = await readJson(req)
      const data = {
        about: cleanText(body.about, ABOUT_MAX),
        city: cleanText(body.city, CITY_MAX),
        languages: cleanLanguages(body.languages),
      }
      const profile = await db().hostProfile.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data,
      })
      const user = await db().user.findUnique({ where: { id: userId }, select: { displayName: true, createdAt: true } })
      return json(res, 200, { ok: true, profile: shape(profile, user) })
    }
    return methodNotAllowed(res, ['GET', 'PUT'])
  }

  if (url.pathname === '/api/host/profile/photo') {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, HOST_ROLES)
    const userId = context.user.id
    const body = await readJson(req)
    const fileBase64 = typeof body.fileBase64 === 'string' ? body.fileBase64 : ''
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType : ''
    if (!fileBase64 || !mimeType) throw badRequest('A photo file is required.', 'HOST_PHOTO_REQUIRED')

    // Same ordering as the driver photo: write the new file, point the row at it, then remove the old.
    const storageKey = await saveHostPhoto(fileBase64, mimeType)
    const previous = await db().hostProfile.findUnique({ where: { userId }, select: { photoRef: true } })
    const profile = await db().hostProfile.upsert({
      where: { userId },
      create: { userId, photoRef: storageKey, photoMimeType: mimeType },
      update: { photoRef: storageKey, photoMimeType: mimeType },
    })
    if (previous?.photoRef && previous.photoRef !== storageKey) {
      await deleteHostPhoto(previous.photoRef).catch(() => {})
    }
    const user = await db().user.findUnique({ where: { id: userId }, select: { displayName: true, createdAt: true } })
    return json(res, 200, { ok: true, profile: shape(profile, user) })
  }

  const publicMatch = url.pathname.match(/^\/api\/host-profiles\/([0-9a-f-]{36})$/)
  if (publicMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    const userId = publicMatch[1]
    const user = await db().user.findUnique({
      where: { id: userId },
      select: { displayName: true, createdAt: true, status: true, roles: { select: { role: true } }, hostProfile: true },
    })
    const isHost = user?.status === 'ACTIVE' && user.roles.some((r) => HOST_ROLES.includes(r.role))
    if (!isHost) {
      const error = new Error('Host not found.')
      error.statusCode = 404
      error.code = 'HOST_NOT_FOUND'
      error.expose = true
      throw error
    }
    return json(res, 200, { ok: true, profile: shape(user.hostProfile, user) })
  }

  return false
}
