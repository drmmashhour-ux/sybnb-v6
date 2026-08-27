import { createServer } from 'node:http'
import { API_ENDPOINTS, PLATFORM_SECURITY_RULES } from './contracts.mjs'
import { isAccessGateBypassed, isPublicAccessOpen } from './lib/access-gate.mjs'
import { getAuthContext } from './lib/auth-context.mjs'
import { loadEnv, validateEnv } from './lib/env.mjs'
import { checkDatabase, disconnectDb } from './lib/prisma.mjs'
import { handleRouteError, json, notFound, publicUrl } from './lib/responses.mjs'
import { log, logRequest, newRequestId } from './lib/logger.mjs'
import { handleAdmin } from './routes/admin.mjs'
import { handleAuth } from './routes/auth.mjs'
import { handleWebhooks } from './routes/webhooks.mjs'
import { handleBookings } from './routes/bookings.mjs'
import { handleDriver } from './routes/driver.mjs'
import { handleHost } from './routes/host.mjs'
import { handleListings } from './routes/listings.mjs'
import { handleMe } from './routes/me.mjs'
import { handleMessages } from './routes/messages.mjs'
import { handlePush } from './routes/push.mjs'
import { handleBusiness } from './routes/business.mjs'
import { handleOtp } from './routes/otp.mjs'
import { handleStorage } from './routes/storage.mjs'
import { handleLegal } from './routes/legal.mjs'
import { handlePaymentIntents } from './routes/payment-intents.mjs'
import { handlePayments } from './routes/payments.mjs'
import { handleReviews } from './routes/reviews.mjs'
import { handleSrRides } from './routes/sr-rides.mjs'
import { handleWallet } from './routes/wallet.mjs'

loadEnv()

// Fail closed on missing required configuration before accepting traffic.
const envProblems = validateEnv()
if (envProblems.length) {
  log.error('env_validation_failed', { problems: envProblems })
  process.exit(1)
}

// Port: honor an explicit API_PORT, else the host-injected PORT (Render/Cloud Run/etc.), else dev default.
const PORT = Number(process.env.API_PORT || process.env.PORT || 3051)
// Host: bind all interfaces in production (containers must accept external traffic); keep loopback in
// dev/test unless API_HOST is set explicitly.
const HOST = process.env.API_HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1')
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
// Routes that must stay reachable even while gates.publicAccess is closed -- see the check below.
const PUBLIC_ACCESS_EXEMPT_PREFIXES = ['/api/auth', '/api/otp', '/api/webhooks', '/api/legal']
// A security audit found the payment webhook intake routes live under /api/payments/, not
// /api/webhooks/ -- so they were NOT actually covered by the prefix list above, despite this
// file's own comment claiming durable webhook intake stays reachable "the same way payment
// webhooks" do. If gates.publicAccess is ever closed in production, a real Stripe delivery
// (payment success/failure/refund) would have hit a 503 instead of being processed, silently
// desyncing local state from what the provider believes happened. Exact paths, not a prefix --
// unlike the webhook routes, sibling paths under /api/payments/ (e.g. seller-plan-proof,
// local-wallet-proof) are real money-adjacent actions that must stay gated.
const PUBLIC_ACCESS_EXEMPT_PATHS = new Set(['/api/payments/webhook', '/api/payments/stripe/webhook'])

const server = createServer(async (req, res) => {
  const url = publicUrl(req)
  const requestId = req.headers['x-request-id'] || newRequestId()
  const startedAt = Date.now()
  res.setHeader('x-request-id', requestId)
  res.on('finish', () => logRequest({ requestId, method: req.method, path: url.pathname, status: res.statusCode, durationMs: Date.now() - startedAt }))

  try {
    setCors(req, res)
    setSecurityHeaders(res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      return res.end()
    }

    // Liveness: process is up (no dependency check). Readiness: dependencies (DB) are usable.
    if (url.pathname === '/api/health/live') {
      return json(res, 200, { ok: true, status: 'alive' })
    }
    if (url.pathname === '/api/health' || url.pathname === '/api/health/ready') {
      const db = await databaseStatus()
      return json(res, db.ok ? 200 : 503, {
        ok: db.ok,
        service: 'sybnb-v6-api',
        status: db.ok ? 'ready' : 'not-ready',
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

    // gates.publicAccess backstop. Auth/OTP must stay reachable so an admin (or anyone finishing
    // pre-launch setup) can actually sign in; webhooks must stay reachable so provider deliveries
    // are never dropped (the same durable-intake reasoning already applied to payment webhooks);
    // legal text is informational, not product access. Everything else refuses while closed,
    // unless the caller is already authenticated as ADMIN.
    if (
      !isPublicAccessOpen() &&
      !isAccessGateBypassed(context) &&
      !PUBLIC_ACCESS_EXEMPT_PREFIXES.some((prefix) => url.pathname.startsWith(prefix)) &&
      !PUBLIC_ACCESS_EXEMPT_PATHS.has(url.pathname)
    ) {
      return json(res, 503, {
        ok: false,
        code: 'PUBLIC_ACCESS_CLOSED',
        message: 'SYBNB is not yet open to the public.',
      })
    }

    const handled = await dispatch(req, res, url, context)
    if (handled === false) return notFound(res)
  } catch (error) {
    handleRouteError(res, error)
  }
})

async function dispatch(req, res, url, context) {
  for (const handler of [
    handleWebhooks,
    handleAuth,
    handleOtp,
    handleStorage,
    handleLegal,
    handlePaymentIntents,
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
    handlePush,
    handleBusiness,
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
  const origin = requestedOrigin && CORS_ORIGINS.includes(requestedOrigin)
    ? requestedOrigin
    : CORS_ORIGINS[0] || DEFAULT_CORS_ORIGIN
  res.setHeader('access-control-allow-origin', origin)
  res.setHeader('vary', 'origin')
  res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type,authorization')
}

function setSecurityHeaders(res) {
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('x-frame-options', 'DENY')
  res.setHeader('referrer-policy', 'no-referrer')
  res.setHeader('cross-origin-resource-policy', 'same-origin')
  // API responses are JSON and must never be treated as active content.
  res.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'")
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains')
  }
}

// Resource-exhaustion / slowloris protection: bound how long a client may take to send request
// headers and the full request, and cap idle keep-alive and header count. Sized for a JSON API
// behind a reverse proxy. requestTimeout must be >= headersTimeout.
server.headersTimeout = 15_000
server.requestTimeout = 30_000
server.keepAliveTimeout = 10_000
server.maxHeadersCount = 100

server.listen(PORT, HOST, () => {
  log.info('server_listening', { host: HOST, port: PORT, env: process.env.NODE_ENV || 'development' })
})

let shuttingDown = false
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (shuttingDown) return
    shuttingDown = true
    log.info('server_shutdown', { signal })
    // Stop accepting new connections, drain, release the DB, then exit. Hard-timeout so a hung
    // connection can't block shutdown indefinitely.
    const timer = setTimeout(() => process.exit(0), 10_000)
    server.close(async () => {
      await disconnectDb().catch(() => {})
      clearTimeout(timer)
      process.exit(0)
    })
  })
}
