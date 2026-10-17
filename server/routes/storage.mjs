import { getObjectBytes, verifySignedObject, contentTypeForKey } from '../lib/storage.mjs'
import { methodNotAllowed } from '../lib/responses.mjs'
import { db } from '../lib/prisma.mjs'
import { createHash } from 'node:crypto'

// Security audit trail for forged/expired signed links. Only attempts that CARRY a signature are
// logged (an unsigned probe is noise), and writes are capped per minute so an anonymous attacker
// cannot turn this into a database-flooding vector.
let auditWindowStart = 0
let auditWindowCount = 0
const AUDIT_MAX_PER_MINUTE = 30
async function auditInvalidSignature(req, bucket, key, exp) {
  try {
    const now = Date.now()
    if (now - auditWindowStart > 60_000) { auditWindowStart = now; auditWindowCount = 0 }
    if (auditWindowCount >= AUDIT_MAX_PER_MINUTE) return
    auditWindowCount += 1
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim()
    await db().adminAuditLog.create({
      data: {
        action: 'STORAGE_SIGNATURE_INVALID',
        entityType: 'storage_object',
        entityId: `${bucket}/${key}`.slice(0, 200),
        after: { exp: exp ? String(exp).slice(0, 20) : null },
        ipHash: ip ? createHash('sha256').update(ip).digest('hex').slice(0, 32) : null,
      },
    })
  } catch {
    // Auditing must never turn a refusal into a 500.
  }
}

// Signed, time-limited retrieval for private objects. The signature (minted only by the server via
// signObjectUrl) is the capability — an unsigned or expired request is rejected. Keys are validated
// against a strict shape upstream, so no path traversal is possible.
export async function handleStorage(req, res, url, _context) {
  const match = url.pathname.match(/^\/api\/storage\/([^/]+)\/([^/]+)$/)
  if (!match) return false
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])

  const [bucket, key] = match.slice(1)
  const exp = url.searchParams.get('exp')
  const sig = url.searchParams.get('sig')

  if (!verifySignedObject(bucket, key, exp, sig)) {
    if (sig) void auditInvalidSignature(req, bucket, key, exp)
    res.writeHead(403, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: { code: 'STORAGE_SIGNATURE_INVALID', message: 'This link is invalid or has expired.' } }))
    return true
  }

  try {
    const bytes = await getObjectBytes(bucket, key)
    res.writeHead(200, {
      'content-type': contentTypeForKey(key),
      'content-length': bytes.length,
      // Private object: never sniff, never cache in shared caches.
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
      // Overrides the global 'same-origin' default (server/index.mjs) set for the JSON API. This
      // endpoint's entire purpose is embeddable content behind a signed, time-limited, unguessable
      // URL -- the signature itself is the access control, not same-origin. Without this override,
      // any legitimate cross-origin <img>/<a> embed (the frontend and API are on different
      // origins/ports in dev, and different domains in production) is silently blocked by the
      // browser's Cross-Origin-Resource-Policy enforcement, even though the request itself
      // succeeds server-side (a real, previously-undiscovered bug found while adding the first
      // plain <img src> consumer of this route).
      'cross-origin-resource-policy': 'cross-origin',
    })
    res.end(bytes)
  } catch (error) {
    const status = error?.statusCode || 404
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: { code: error?.code || 'STORAGE_NOT_FOUND', message: 'Object not found.' } }))
  }
  return true
}
