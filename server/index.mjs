import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { API_ENDPOINTS, PLATFORM_SECURITY_RULES } from './contracts.mjs'
import { getAuthContext } from './lib/auth-context.mjs'
import { loadEnv, validateProductionConfig } from './lib/env.mjs'
import { checkDatabase, disconnectDb } from './lib/prisma.mjs'
import { checkRateLimit, clientIp } from './lib/rate-limit.mjs'
import { handleRouteError, json, notFound, publicUrl } from './lib/responses.mjs'
import { applySecurityHeaders } from './lib/security-headers.mjs'
import { handleAccommodations } from './routes/accommodations.mjs'
import { handleAdmin } from './routes/admin.mjs'
import { handleAuth } from './routes/auth.mjs'
import { handleBookings } from './routes/bookings.mjs'
import { handleDriver } from './routes/driver.mjs'
import { handleHost } from './routes/host.mjs'
import { handleListings } from './routes/listings.mjs'
import { handleMe } from './routes/me.mjs'
import { handleMessages } from './routes/messages.mjs'
import { handlePayments } from './routes/payments.mjs'
import { handleReviews } from './routes/reviews.mjs'
import { handleSrRides } from './routes/sr-rides.mjs'
import { handleWallet } from './routes/wallet.mjs'

loadEnv()

const PORT = Number(process.env.API_PORT || 3051)
const HOST = process.env.API_HOST || '127.0.0.1'
const DEFAULT_CORS_ORIGIN = [
  'http://127.0.0.1:3050',
  'http://127.0.0.1:3053',
  'http://127.0.0.1:3055',
  'http://127.0.0.1:5180',
  'http://localhost:5180',
].join(',')
const CORS_ORIGINS = (process.env.CORS_ORIGIN || DEFAULT_CORS_ORIGIN)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

// High-risk-endpoint rate limits (security audit F-08). Central table keyed by [method, pathname
// pattern] rather than scattering limiter calls across 12 route-handler files, so the whole policy
// is reviewable in one place. Defaults are conservative starting points, not a final production
// tuning — see docs/security/SYBNB_V6_RATE_LIMIT_POLICY.md for rationale and how to override each
// one via env vars without a code change.
const RATE_LIMIT_RULES = [
  { name: 'AUTH_LOGIN', method: 'POST', pattern: /^\/api\/auth\/login$/, max: 10, windowMs: 5 * 60 * 1000, byUser: false },
  { name: 'AUTH_REGISTER', method: 'POST', pattern: /^\/api\/auth\/register$/, max: 5, windowMs: 15 * 60 * 1000, byUser: false },
  { name: 'AUTH_EMAIL_CODE_SEND', method: 'POST', pattern: /^\/api\/auth\/email-code\/send$/, max: 5, windowMs: 15 * 60 * 1000, byUser: false },
  { name: 'AUTH_EMAIL_CODE_VERIFY', method: 'POST', pattern: /^\/api\/auth\/email-code\/verify$/, max: 10, windowMs: 15 * 60 * 1000, byUser: false },
  { name: 'PUBLIC_SEARCH', method: 'GET', pattern: /^\/api\/listings$/, max: 60, windowMs: 60 * 1000, byUser: false },
  { name: 'MESSAGING', method: 'POST', pattern: /^\/api\/(listings|bookings)\/[^/]+\/thread\/messages$/, max: 20, windowMs: 60 * 1000, byUser: true },
  { name: 'BOOKING_CREATE', method: 'POST', pattern: /^\/api\/bookings$/, max: 10, windowMs: 60 * 1000, byUser: true },
  { name: 'PAYMENT_PROOF', method: 'POST', pattern: /^\/api\/payments\/(seller-plan-proof|local-wallet-proof)$/, max: 10, windowMs: 60 * 1000, byUser: true },
  { name: 'ADMIN_DECISION', method: 'PATCH', pattern: /^\/api\/admin\/review-queue\/[^/]+\/[^/]+$/, max: 60, windowMs: 60 * 1000, byUser: true },
  { name: 'DOCUMENT_ACCESS', method: 'GET', pattern: /^\/api\/(admin\/id-document|me\/id-document)\/[^/]+(\/file)?$/, max: 30, windowMs: 60 * 1000, byUser: true },
  { name: 'GEOCODING', method: 'POST', pattern: /^\/api\/sr\/(quote|rides)$/, max: 20, windowMs: 60 * 1000, byUser: true },
  { name: 'DRIVER_STATUS', method: 'PATCH', pattern: /^\/api\/(driver\/rides\/[^/]+\/status|sr\/rides\/[^/]+\/claim)$/, max: 30, windowMs: 60 * 1000, byUser: true },
]

function matchRateLimitRule(req, url) {
  return RATE_LIMIT_RULES.find((rule) => rule.method === req.method && rule.pattern.test(url.pathname))
}

// Extracted so both the local dev server below (http.createServer) and the Vercel serverless
// entry (api/[...path].mjs) run the exact same request-handling logic — no behavioral drift
// between "npm run api:dev" and production between the two entry points.
export async function handleRequest(req, res) {
  const url = publicUrl(req)

  try {
    setCors(req, res)
    applySecurityHeaders(res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      return res.end()
    }

    if (url.pathname === '/api/health') {
      const db = await databaseStatus()
      return json(res, db.ok ? 200 : 503, {
        ok: db.ok,
        service: 'sybnb-v6-api',
        database: db,
      })
    }

    if (url.pathname === '/api/contracts') {
      return json(res, 200, {
        ok: true,
        endpoints: API_ENDPOINTS,
        securityRules: PLATFORM_SECURITY_RULES,
      })
    }

    const context = await getAuthContext(req)

    const rule = matchRateLimitRule(req, url)
    if (rule) {
      // Authenticated high-risk actions are limited per-account (a shared office IP shouldn't
      // throttle every user behind it); unauthenticated ones (login, register, public search) are
      // limited per-IP, since there's no account yet to key on.
      const bucketKey = rule.byUser && context?.user ? `user:${context.user.id}` : `ip:${clientIp(req)}`
      const result = checkRateLimit({ bucketKey, name: rule.name, defaultMax: rule.max, defaultWindowMs: rule.windowMs })
      if (!result.allowed) {
        res.setHeader('retry-after', String(result.retryAfterSeconds))
        return json(res, 429, {
          ok: false,
          error: {
            code: 'RATE_LIMITED',
            message: `Too many requests. Try again in ${result.retryAfterSeconds} seconds.`,
          },
        })
      }
    }

    const handled = await dispatch(req, res, url, context)
    if (handled === false) return notFound(res)
  } catch (error) {
    handleRouteError(res, error)
  }
}

const server = createServer(handleRequest)

async function dispatch(req, res, url, context) {
  for (const handler of [
    handleAuth,
    handleAccommodations,
    handleListings,
    handleBookings,
    handlePayments,
    handleWallet,
    handleMe,
    handleHost,
    handleDriver,
    handleAdmin,
    handleSrRides,
    handleReviews,
    handleMessages,
  ]) {
    const handled = await handler(req, res, url, context)
    if (handled !== false) return handled
  }
  return false
}

async function databaseStatus() {
  if (!process.env.DATABASE_URL) {
    return {
      ok: false,
      code: 'DATABASE_URL_MISSING',
      message: 'Set DATABASE_URL before using database-backed V6 API routes.',
    }
  }

  try {
    await checkDatabase()
    return { ok: true, code: 'DATABASE_CONNECTED' }
  } catch (error) {
    return {
      ok: false,
      code: 'DATABASE_UNAVAILABLE',
      message: error.message,
    }
  }
}

function setCors(req, res) {
  const requestedOrigin = req.headers.origin
  res.setHeader('vary', 'origin')
  // Security audit finding F-14: previously fell back to the first configured allowed origin for
  // any disallowed requester. Browsers only grant page JS access to the response when the header
  // matches the *actual* requesting origin, so that was never an actual bypass — but omitting the
  // header entirely for a disallowed origin is the correct, unambiguous behavior instead of
  // returning a value that looks like a grant but isn't one.
  if (requestedOrigin && CORS_ORIGINS.includes(requestedOrigin)) {
    res.setHeader('access-control-allow-origin', requestedOrigin)
  }
  res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type,authorization')
}

// Exported (not just listened-on) so API tests can bind this same request-handling server to an
// ephemeral port via Supertest, instead of re-implementing routing or requiring a separate running
// process. Only auto-listens on the configured PORT/HOST when this file is the actual entrypoint
// (`npm run api:dev`), not when imported by a test.
export { server }

// pathToFileURL correctly percent-encodes spaces/special characters in the path (this repo lives
// under a path containing spaces) — naive `file://${process.argv[1]}` string interpolation doesn't
// match import.meta.url's encoding and silently never detects direct execution.
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  if (process.env.NODE_ENV === 'production') {
    validateProductionConfig()
  }

  server.listen(PORT, HOST, () => {
    console.log(`SYBNB V6 API listening on http://${HOST}:${PORT}`)
  })

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      await disconnectDb()
      server.close(() => process.exit(0))
    })
  }
}
