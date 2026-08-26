import { getObjectBytes, verifySignedObject, contentTypeForKey } from '../lib/storage.mjs'
import { methodNotAllowed } from '../lib/responses.mjs'

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
