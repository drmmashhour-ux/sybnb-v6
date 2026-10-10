import { createServer } from 'node:http'
import { API_ENDPOINTS, PLATFORM_SECURITY_RULES } from './contracts.mjs'
import { isAccessGateBypassed, isPublicAccessOpen } from './lib/access-gate.mjs'
import { getAuthContext } from './lib/auth-context.mjs'
import { isRateLimited } from './lib/rateLimit.mjs'
import { loadEnv, validateEnv } from './lib/env.mjs'
import { checkDatabase, disconnectDb } from './lib/prisma.mjs'
import { pruneExpiredOtps } from './lib/otp-retention.mjs'
import { expireUnpaidBookings } from './lib/booking-lifecycle.mjs'
import { sweepIntervalMinutes } from './lib/booking-policy.mjs'
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
import { handleHostProfile } from './routes/host-profile.mjs'
import { handleHostVerification } from './routes/host-verification.mjs'
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
import { activateScheduledRides } from './lib/ride-schedule.mjs'
import { runDispatchSweep } from './lib/ride-dispatch.mjs'

loadEnv()

// Fail closed on missing required configuration before accepting traffic.
const envProblems = validateEnv()
if (envProblems.length) {
  log.error('env_validation_failed', { problems: envProblems })
  process.exit(1)
}

// Scale-readiness follow-up (docs/launch/SCALE_READINESS_1M.md #1 blocker): a bare DATABASE_URL
// leaves Prisma's pool uncapped (CPUs*2+1) with no upper bound and no pooler in front of Postgres --
// fine on one small replica today, a hard ceiling the moment there's more than one. A WARNING, not
// a boot-blocking validateEnv() failure: production is deployed right now without this set, and
// failing closed here would take down the currently-working service on its next deploy rather than
// degrade gracefully like the rest of this file's design. Fix is an env change on the connection
// string itself (?connection_limit=N&pool_timeout=20), not a code change -- Prisma reads it
// natively -- so this only logs, it never blocks startup.
if (process.env.NODE_ENV === 'production' && !/[?&]connection_limit=/.test(process.env.DATABASE_URL || '')) {
  log.error('scale_warning_no_connection_limit', {
    message: 'DATABASE_URL has no connection_limit set — Prisma pool is uncapped. Add ?connection_limit=N&pool_timeout=20 to DATABASE_URL before running more than one replica.',
  })
}

// Revenue-integrity guard (owner decision 2026-10-09): all platform revenue (ride commission,
// booking commission, seller-plan/advertising fees) routes to PLATFORM_ACCOUNT_ID — the single
// house account. If it is unset in production, commission would either fall back to the approving
// admin's personal wallet (booking/seller paths) or silently not be booked at all (prepaid rides) —
// a revenue-capture hole. Per the owner's explicit decision this is now a HARD boot failure in
// production (not merely a warning like the connection_limit guard), so a misconfigured deploy can
// never silently drop the platform's cut: fail closed and refuse to start until it is set.
if (process.env.NODE_ENV === 'production' && !process.env.PLATFORM_ACCOUNT_ID) {
  log.error('revenue_fatal_no_platform_account', {
    message: 'PLATFORM_ACCOUNT_ID is unset in production — refusing to start. Set it to the house account user id so platform commission/fees are always booked to the house account.',
  })
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

// A security audit found NO rate limiting on any admin-mutating route -- confirmed both real
// incidents in this codebase's history (294 real backlog decisions in ~10 minutes, then a smaller
// repeat) were structurally able to happen exactly because nothing slowed a single valid admin
// token processing hundreds of real actions back to back. This is a floor, not a full fix -- a
// determined script still gets through, just slower, and it doesn't replace the deeper
// recommendation (a hard circuit-breaker requiring a second admin to clear, and a two-person rule
// specifically on refund/payout/ID-document decisions) which is real product work, not a
// same-day fix. Placeholder threshold like every other undecided business number in this
// codebase (SHARE_DISCOUNT_PERCENT, cancellationAdminFee) -- tune via env once there's a real
// sense of genuine admin review pace; the point today is "not unlimited," not "the right number."
// Every admin route in this codebase lives under /api/admin/ (confirmed via grep across
// admin.mjs and sr-rides.mjs) -- checking the path prefix here, once, covers every current route
// AND any future one added under the same convention, instead of threading a check through each
// individual handler one at a time (exactly the kind of per-route gap the same audit found for
// admin audit-logging).
// The audit's own suggested floor (20-30/60s) turned out to be well below what this repo's OWN
// canonical e2e regression legitimately does with the same shared ADMIN account -- measured
// directly against a real run: 142 real admin actions in a single minute, twice in a row, with
// zero abuse involved. A limit low enough to meaningfully slow a 294-in-10-minutes-style incident
// is, structurally, indistinguishable from this repo's own normal automated-test velocity on the
// same shared account -- a single global per-account number can't cleanly separate them. Set with
// real headroom above the measured legitimate peak so this doesn't turn into permanent test
// flakiness; the deeper fix this doesn't replace (a hard circuit-breaker, and a two-person rule
// specifically on refund/payout/ID-document decisions -- the three action types that caused
// irreversible harm both times) needs a real service-account distinction between "automation" and
// "an interactive session," which is genuine follow-up work, not a same-day tuning exercise.
const ADMIN_ACTION_RATE_WINDOW_MS = 60_000
const ADMIN_ACTION_RATE_MAX = Number(process.env.ADMIN_ACTION_RATE_MAX || 250)

// Scheduler tick: dispatch escalation + scheduled-ride activation fire on a timer (an external cron
// POSTs here), not only when a driver happens to load the pending list. PUBLIC and no-auth by design
// -- it exposes NO sensitive data (only counts), is side-effect-idempotent, and self-throttles: if
// called within TICK_MIN_INTERVAL_MS of the last ACTUAL run it skips the work (prevents abuse / DB
// hammering). Everything is wrapped so it always returns 200 {ok:true} and never leaks an error/stack.
const TICK_MIN_INTERVAL_MS = 15_000
let tickLastRunAt = 0

async function handleInternalTick(res) {
  try {
    const now = Date.now()
    if (now - tickLastRunAt < TICK_MIN_INTERVAL_MS) {
      return json(res, 200, { ok: true, skipped: true })
    }
    tickLastRunAt = now
    const activated = await activateScheduledRides()
    const sweep = await runDispatchSweep()
    return json(res, 200, { ok: true, activated, expired: sweep.expired, opened: sweep.opened })
  } catch {
    // never leak errors/stack; the tick is best-effort
    return json(res, 200, { ok: true })
  }
}

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

    // Public scheduler tick (no auth, registered BEFORE getAuthContext and every gate/role check).
    if (url.pathname === '/internal/tick' && (req.method === 'POST' || req.method === 'GET')) {
      return handleInternalTick(res)
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
      // A satisfaction audit found this used a flat {ok,code,message} shape instead of this
      // codebase's actual established error convention ({ok,error:{code,message}} -- see
      // responses.mjs's notFound/methodNotAllowed/handleRouteError, which every other error path
      // in this API follows). The frontend's apiRequest() only ever reads payload.error?.message,
      // so this real, well-worded message was silently discarded and replaced with a generic
      // "request failed" fallback -- the bug survived because this file's own e2e suite asserted
      // the same wrong flat shape it implemented, never the shape the real frontend consumes.
      return json(res, 503, {
        ok: false,
        error: {
          code: 'PUBLIC_ACCESS_CLOSED',
          message: 'SYBNB is not yet open to the public.',
        },
      })
    }

    // Admin-action velocity floor (see ADMIN_ACTION_RATE_MAX's own comment above). Scoped to
    // mutating requests only -- an admin reading the review queue repeatedly isn't the risk this
    // closes. Keyed per admin account (never per IP), so it can't be defeated by rotating source
    // IPs the way an IP-keyed limit could, and one over-eager admin can't exhaust another's quota.
    if (req.method !== 'GET' && url.pathname.startsWith('/api/admin/') && context?.roles?.includes('ADMIN')) {
      if (await isRateLimited(`admin-action:${context.user.id}`, ADMIN_ACTION_RATE_WINDOW_MS, ADMIN_ACTION_RATE_MAX)) {
        return json(res, 429, {
          ok: false,
          error: {
            code: 'ADMIN_ACTION_RATE_LIMITED',
            message: 'Too many admin actions in a short window. Wait a moment before continuing.',
          },
        })
      }
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
    handleHostProfile,
    handleHostVerification,
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
  res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
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

// Scale-readiness follow-up: this job existed as a standalone script (scripts/prune-expired-otps.mjs)
// but was never actually scheduled anywhere -- verification_codes grew unbounded. This codebase has
// no separate worker/cron infrastructure, so an in-process interval is the pragmatic fix for the
// current single-replica deployment (not correct once there are multiple replicas -- each would
// prune independently, which is harmless here since the delete is idempotent by date, just
// redundant work; a real cron/queue is the fix if that ever matters). Runs once on boot, then on
// the configured interval.
const OTP_PRUNE_INTERVAL_MS = Number(process.env.OTP_PRUNE_INTERVAL_HOURS || 24) * 3600 * 1000
async function runOtpPrune() {
  try {
    const result = await pruneExpiredOtps()
    log.info('otp_prune_ran', result)
  } catch (error) {
    log.error('otp_prune_failed', { error: error instanceof Error ? error.message : String(error) })
  }
}
void runOtpPrune()
const otpPruneTimer = setInterval(runOtpPrune, OTP_PRUNE_INTERVAL_MS)
otpPruneTimer.unref() // never keep the process alive on its own (tests/scripts that import this file)

// Money-flow decision 6 (2026-10-08): unpaid PAYMENT_PENDING requests past the country's payment
// window (Syria: 48h) with no live proof are cancelled (EXPIRED_UNPAID) and their dates released.
// The same sweep also runs opportunistically from the booking read paths (completeExpiredBookings),
// and date-overlap checks already ignore such requests before either runs; this light interval only
// makes the CANCELLED status + guest email timely when nobody is browsing. Idempotent per row (each
// cancel is a conditional update), so multiple replicas sweeping is harmless.
// Falls back to 15 unless BOOKING_EXPIRY_SWEEP_MINUTES is a positive finite number; floor of 1 min
// (a NaN/0/negative value would otherwise reach setInterval as NaN and spin).
const BOOKING_EXPIRY_SWEEP_INTERVAL_MS = sweepIntervalMinutes(process.env.BOOKING_EXPIRY_SWEEP_MINUTES) * 60 * 1000
async function runBookingExpirySweep() {
  try {
    await expireUnpaidBookings()
  } catch (error) {
    log.error('booking_expiry_sweep_failed', { error: error instanceof Error ? error.message : String(error) })
  }
}
const bookingExpiryTimer = setInterval(runBookingExpirySweep, BOOKING_EXPIRY_SWEEP_INTERVAL_MS)
bookingExpiryTimer.unref()

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
