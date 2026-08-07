// Lightweight in-memory fixed-window rate limiter for the single-node V6 API.
// Protects the unauthenticated / abuse-prone endpoints (auth attempts and
// payment-proof submissions) from credential-stuffing and spam. For a
// multi-node deployment this must move to a shared store (Redis/Postgres).

const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_SECONDS || 60) * 1000
const AUTH_MAX = Number(process.env.RATE_LIMIT_AUTH_MAX || 10)
const PAYMENT_MAX = Number(process.env.RATE_LIMIT_PAYMENT_MAX || 20)

const buckets = new Map()

export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim()
  }
  return req.socket?.remoteAddress || 'unknown'
}

function limitForPath(pathname) {
  if (pathname === '/api/auth/login' || pathname === '/api/auth/register') {
    return { bucket: 'auth', max: AUTH_MAX }
  }
  if (pathname.startsWith('/api/payments/')) {
    return { bucket: 'payment', max: PAYMENT_MAX }
  }
  return null
}

// Returns true if the request was rate-limited (a 429 response has been sent).
export function enforceRateLimit(req, res, url) {
  if (req.method === 'OPTIONS') return false
  const limit = limitForPath(url.pathname)
  if (!limit) return false

  const key = `${limit.bucket}:${clientIp(req)}`
  const now = Date.now()
  let entry = buckets.get(key)
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + WINDOW_MS }
    buckets.set(key, entry)
  }
  entry.count += 1

  if (entry.count > limit.max) {
    const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    res.setHeader('retry-after', String(retryAfter))
    res.writeHead(429, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        ok: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
      }),
    )
    return true
  }
  return false
}

// Evict expired windows periodically so the map cannot grow unbounded.
const sweep = setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of buckets) {
    if (now >= entry.resetAt) buckets.delete(key)
  }
}, WINDOW_MS)
sweep.unref?.()
