import { log, errorSummary } from './logger.mjs'
export function json(res, statusCode, body, headers = {}) {
  const payload = JSON.stringify(body, null, 2)
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(payload)
}

export function notFound(res) {
  json(res, 404, {
    ok: false,
    error: {
      code: 'NOT_FOUND',
      message: 'No V6 API route matched this request.',
    },
  })
}

export function methodNotAllowed(res, allowed) {
  json(
    res,
    405,
    {
      ok: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: `Use ${allowed.join(', ')} for this endpoint.`,
      },
    },
    { allow: allowed.join(', ') },
  )
}

// Max JSON request body. KYC/proof uploads are base64 (8MB binary ~= 11MB base64), so allow 12MB
// and reject early — an unbounded body was a memory-exhaustion (DoS) risk.
const MAX_BODY_BYTES = 12 * 1024 * 1024

export async function readJson(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large.')
      error.statusCode = 413
      error.code = 'PAYLOAD_TOO_LARGE'
      error.expose = true
      throw error
    }
    chunks.push(chunk)
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}

  try {
    return JSON.parse(raw)
  } catch {
    const error = new Error('Request body must be valid JSON.')
    error.statusCode = 400
    error.code = 'INVALID_JSON'
    throw error
  }
}

export function handleRouteError(res, error) {
  if (!error.statusCode || error.statusCode >= 500) {
    // Redacted summary only — never dump the raw error object (may carry sensitive context).
    log.error('api_error', errorSummary(error))
  }

  json(res, error.statusCode || 500, {
    ok: false,
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: error.expose ? error.message : error.statusCode ? error.message : 'Unexpected V6 API error.',
    },
  })
}

export function publicUrl(req) {
  const host = req.headers.host || '127.0.0.1'
  return new URL(req.url || '/', `http://${host}`)
}
