// Configurable, in-memory sliding-window rate limiter.
//
// Single-instance only: buckets live in this process's memory. This is documented explicitly
// (see docs/security/SYBNB_V6_RATE_LIMIT_POLICY.md) rather than silently assumed — running more
// than one API process/container behind a load balancer would let a client get a fresh limit per
// instance. A production multi-instance deployment needs a shared store (Redis or equivalent)
// instead of this module. The policy (which endpoints, what limits) carries over unchanged.
//
// Client identification: only trusts a proxy-supplied IP (X-Forwarded-For) when explicitly
// configured to via TRUST_PROXY=1, so a client can't just set that header themselves to reset
// their own limit when there's no real proxy in front of this server (e.g. local dev, or a
// direct-exposed deployment). The production origin must reject direct public traffic (only
// accept connections from the trusted proxy/load balancer) whenever TRUST_PROXY=1 is set —
// otherwise an external client could still forge X-Forwarded-For directly against the origin.

const buckets = new Map()

// Read at call time (isTrustProxyEnabled(), not a module-level const captured at import time).
// server/index.mjs calls loadEnv() to populate process.env from .env *after* its own import
// statements (including this module's) have already executed — a module-level
// `const TRUST_PROXY = process.env.TRUST_PROXY === '1'` would freeze in whatever value was
// present at import time (usually undefined/false), silently ignoring a TRUST_PROXY set only in
// .env. Reading it lazily, on every call, means it always reflects the real current environment.
function isTrustProxyEnabled() {
  return process.env.TRUST_PROXY === '1'
}

// Bounds memory growth: buckets older than this are swept periodically rather than kept forever.
const SWEEP_INTERVAL_MS = 5 * 60 * 1000
let sweepTimer = null

function startSweeper() {
  if (sweepTimer || process.env.NODE_ENV === 'test') return
  sweepTimer = setInterval(() => {
    const now = Date.now()
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt < now) buckets.delete(key)
    }
  }, SWEEP_INTERVAL_MS)
  sweepTimer.unref?.()
}

// Strips the IPv4-mapped-IPv6 prefix (::ffff:x.x.x.x -> x.x.x.x) so the same real client always
// buckets identically regardless of whether the server is bound IPv4-only or dual-stack. See
// docs/security/SYBNB_V6_RATE_LIMIT_POLICY.md's IPv4/IPv6 section for why this matters.
function normalizeIp(value) {
  if (!value) return value
  const trimmed = String(value).trim()
  if (trimmed.toLowerCase().startsWith('::ffff:')) return trimmed.slice(7)
  return trimmed
}

// Very loose shape check on a client-controlled header value before trusting it as an IP — just
// enough to reject obviously-garbage input (e.g. an empty string, or something that clearly isn't
// an IPv4/IPv6 literal), not a full RFC validator.
function isPlausibleIp(value) {
  if (!value) return false
  if (value.length > 45) return false
  return /^[0-9a-fA-F:.]+$/.test(value)
}

export function clientIp(req) {
  if (isTrustProxyEnabled()) {
    const forwardedHeader = req.headers['x-forwarded-for']
    if (forwardedHeader) {
      // X-Forwarded-For can carry a comma-separated hop list (client, proxy1, proxy2, ...); Node
      // also joins repeated header instances with ", " before exposing them here, so a single
      // split covers both shapes. The leftmost entry is the original client only under the
      // single-trusted-reverse-proxy topology this flag is designed for — exactly the deployment
      // TRUST_PROXY=1 is meant to describe.
      const first = String(forwardedHeader).split(',')[0]
      const candidate = normalizeIp(first)
      if (isPlausibleIp(candidate)) return candidate
      // Malformed/empty first hop: fall through to the raw socket address rather than trusting it.
    }
  }
  return normalizeIp(req.socket?.remoteAddress) || 'unknown'
}

// windowMs/max are read at call time (not module load time) so tests can override
// process.env.RATE_LIMIT_* per-test without needing to re-import the module.
//
// Non-numeric, zero, or negative overrides are rejected in favor of the caller's default rather
// than silently accepted — Number('') is 0, Number('abc') is NaN, and either passed straight
// through would previously have produced a limiter with max=0 (blocks every request) or max=NaN
// (every comparison against NaN is false, so the limiter would allow unlimited requests) purely
// from a typo in an environment variable.
function limitConfig(name, defaultMax, defaultWindowMs) {
  const max = safePositiveInt(process.env[`RATE_LIMIT_${name}_MAX`], defaultMax)
  const windowMs = safePositiveInt(process.env[`RATE_LIMIT_${name}_WINDOW_MS`], defaultWindowMs)
  return { max, windowMs }
}

// Exported so validateProductionConfig() (server/lib/env.mjs) can apply the exact same
// numeric-validity rule when checking every configured RATE_LIMIT_* override at startup, instead
// of duplicating a slightly different definition of "valid" in two places.
export function safePositiveInt(rawValue, fallback) {
  if (rawValue === undefined || rawValue === '') return fallback
  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) return fallback
  return parsed
}

// Returns { allowed, remaining, resetAt, retryAfterSeconds }. Does not throw — callers decide how
// to respond, matching this codebase's existing error-shape conventions instead of a middleware
// framework's throw-to-reject-request pattern.
export function checkRateLimit({ bucketKey, name, defaultMax, defaultWindowMs }) {
  if (process.env.DISABLE_RATE_LIMIT === '1') {
    return { allowed: true, remaining: Infinity, resetAt: 0, retryAfterSeconds: 0 }
  }

  startSweeper()
  const { max, windowMs } = limitConfig(name, defaultMax, defaultWindowMs)
  const now = Date.now()
  const key = `${name}:${bucketKey}`
  const existing = buckets.get(key)

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: max - 1, resetAt: now + windowMs, retryAfterSeconds: 0 }
  }

  if (existing.count >= max) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    }
  }

  existing.count += 1
  return { allowed: true, remaining: max - existing.count, resetAt: existing.resetAt, retryAfterSeconds: 0 }
}

// Test-only: clears all buckets between test cases so one test's limit exhaustion doesn't bleed
// into the next.
export function __resetRateLimitsForTests() {
  buckets.clear()
}
