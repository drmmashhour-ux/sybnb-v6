import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { legalManifest, legalDocument } from '../lib/legal.mjs'

export async function handleLegal(req, res, url, context) {
  // Public: current legal document versions + whether launch is blocked on DRAFT content.
  if (url.pathname === '/api/legal') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    return json(res, 200, { ok: true, ...legalManifest() })
  }

  if (url.pathname === '/api/legal/consent') {
    if (req.method === 'GET') {
      requireAuth(context)
      const consents = await db().legalConsent.findMany({
        where: { userId: context.user.id },
        orderBy: { acceptedAt: 'desc' },
      })
      return json(res, 200, { ok: true, consents })
    }

    if (req.method === 'POST') {
      requireAuth(context)
      const body = await readJson(req)
      const doc = legalDocument(String(body.documentKey || ''))
      if (!doc) {
        const error = new Error('Unknown legal document.')
        error.statusCode = 400
        error.code = 'LEGAL_DOCUMENT_UNKNOWN'
        error.expose = true
        throw error
      }
      // Consent must be for the CURRENT version — a stale/forged version is rejected so consent
      // genuinely reflects what the user was shown.
      if (String(body.version || '') !== doc.version) {
        const error = new Error('Legal document version mismatch. Reload and accept the current version.')
        error.statusCode = 409
        error.code = 'LEGAL_VERSION_MISMATCH'
        error.expose = true
        throw error
      }
      const consent = await db().legalConsent.upsert({
        where: { userId_documentKey_version: { userId: context.user.id, documentKey: doc.key, version: doc.version } },
        create: { userId: context.user.id, documentKey: doc.key, version: doc.version },
        update: {},
      })
      return json(res, 201, { ok: true, consent })
    }

    return methodNotAllowed(res, ['GET', 'POST'])
  }

  return false
}
