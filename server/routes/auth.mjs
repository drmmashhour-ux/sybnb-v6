import { db } from '../lib/prisma.mjs'
import { hashPassword, hashPhone, hashEmail, verifyPassword } from '../lib/security.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { issueUserSession, listActiveSessions, revokeSession, revokeUserAccess, REVOCATION_REASONS } from '../lib/session-store.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { channelEnabled, defaultCurrency } from '../lib/country.mjs'
import { isRateLimited, clientIp } from '../lib/rateLimit.mjs'

// DRIVER is intentionally NOT self-registerable: an unvetted self-registered driver could claim
// live rides and harvest rider pickup/dropoff + identity. Drivers (like ADMIN/SUPPORT) are
// provisioned by an operator via scripts/bootstrap-admin.mjs, matching the admin-controlled ride
// assignment model.
const PUBLIC_REGISTER_ROLES = new Set(['GUEST', 'HOST', 'SELLER'])

// Fixed-window rate limiter for credential endpoints (login/register), keyed by client IP;
// guards against credential stuffing and registration/proof spam. Backed by Postgres (see
// rateLimit.mjs) so the limit holds across multiple server instances, not just within one.
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 20
// A verified OTP must be recent to bind to a registration.
const OTP_BIND_WINDOW_MS = 30 * 60_000
function rateLimited(req, bucketKey) {
  return isRateLimited(`auth:${bucketKey}:${clientIp(req)}`, RATE_WINDOW_MS, RATE_MAX)
}
function tooManyRequests(res) {
  return json(res, 429, { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a minute and try again.' } })
}

export async function handleAuth(req, res, url, context) {
  // SEC-002 — real, server-side logout. Before this existed the only "logout" in the product was the
  // frontend deleting its own sessionStorage keys, which does not touch the credential: anyone who
  // had copied the token still held a working session for the remaining seven days. Revoking the
  // session row here is what actually ends it.
  if (url.pathname === '/api/auth/logout') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)
    const result = await revokeSession(context.sessionId, REVOCATION_REASONS.LOGOUT)
    // `revoked` distinguishes "this call ended the session" from "it was already revoked". Both are
    // successes -- a client retrying a logout it is not sure landed must not be told it failed --
    // but the flag lets a caller tell the two apart without a second request.
    return json(res, 200, { ok: true, revoked: result.revoked, scope: 'session' })
  }

  // Logout everywhere. Bumps the account's security epoch, so every token for this user dies at
  // once, including sessions on devices the user no longer has access to. This is the control a
  // person reaches for after "someone else may have my password".
  if (url.pathname === '/api/auth/logout-all') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)
    const body = await readJson(req)
    const keepCurrent = body.keepCurrentSession === true

    // No exceptSessionId: every session including the caller's own is revoked. "Keep this device"
    // is honoured by issuing a BRAND NEW session afterwards, never by sparing the old one -- the
    // epoch bump would have invalidated a spared session's token anyway, and sparing it would leave
    // a pre-logout-all credential alive, which is the exact thing this endpoint exists to prevent.
    await revokeUserAccess(context.user.id, REVOCATION_REASONS.LOGOUT_ALL)

    if (keepCurrent) {
      const user = await db().user.findUnique({ where: { id: context.user.id }, include: { roles: true } })
      const reissued = await issueUserSession(user, req)
      return json(res, 200, { ok: true, scope: 'all', reissued: true, token: reissued.token, sessionId: reissued.sessionId, user: publicUser(user) })
    }

    return json(res, 200, { ok: true, scope: 'all', reissued: false })
  }

  // A person's own active sessions. Read-only and strictly self-scoped -- it never accepts a user
  // id, so it cannot be turned into a way to enumerate someone else's devices.
  if (url.pathname === '/api/auth/sessions') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)
    const sessions = await listActiveSessions(context.user.id)
    return json(res, 200, {
      ok: true,
      sessions: sessions.map((session) => ({ ...session, current: session.id === context.sessionId })),
    })
  }

  if (url.pathname === '/api/auth/register') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    if (await rateLimited(req, 'register')) return tooManyRequests(res)
    const body = await readJson(req)
    const role = body.role || 'GUEST'
    if (!PUBLIC_REGISTER_ROLES.has(role)) {
      const error = new Error('This role cannot be self-registered.')
      error.statusCode = 403
      error.code = 'ROLE_REGISTRATION_FORBIDDEN'
      error.expose = true
      throw error
    }

    if (!body.email && !body.phone) {
      const error = new Error('email or phone is required.')
      error.statusCode = 400
      error.code = 'REGISTER_IDENTIFIER_REQUIRED'
      error.expose = true
      throw error
    }

    const phoneHash = body.phone ? hashPhone(body.phone) : undefined
    const passwordHash = hashPassword(body.password)

    // Registration MUST be backed by a server-side VERIFIED, unexpired OTP for the account's
    // verification identifier, consumed single-use so it cannot be replayed to create another account.
    // EMAIL is the authentication identifier. PHONE is optional CONTACT data and is NEVER an auth
    // requirement; it binds an OTP only if the active country explicitly enables the SMS channel
    // (email-only countries like Syria never do). Under an email-only country an account MUST have a
    // verified email — a phone-only signup is refused (fail-closed, no unverified account).
    const smsEnabled = channelEnabled('sms')
    const otpIdentifierHash = body.email ? hashEmail(body.email) : (smsEnabled && phoneHash ? phoneHash : undefined)
    if (!body.email && !smsEnabled) {
      const error = new Error('An email is required to create an account.')
      error.statusCode = 400
      error.code = 'REGISTRATION_EMAIL_REQUIRED'
      error.expose = true
      throw error
    }
    let otpToConsume = null
    if (otpIdentifierHash) {
      const verified = await db().verificationCode.findFirst({
        where: {
          identifierHash: otpIdentifierHash,
          status: 'VERIFIED',
          verifiedAt: { gt: new Date(Date.now() - OTP_BIND_WINDOW_MS) },
        },
        orderBy: { verifiedAt: 'desc' },
      })
      if (!verified) {
        const error = new Error('Verification is required before creating this account.')
        error.statusCode = 403
        error.code = 'REGISTRATION_OTP_REQUIRED'
        error.expose = true
        throw error
      }
      otpToConsume = verified
    }

    try {
      const user = await db().$transaction(async (tx) => {
        if (otpToConsume) {
          // Consume atomically: only a still-VERIFIED code flips to CANCELLED, so two concurrent
          // registrations can't both bind the same code (cross-account replay).
          const consumed = await tx.verificationCode.updateMany({
            where: { id: otpToConsume.id, status: 'VERIFIED' },
            data: { status: 'CANCELLED' },
          })
          if (consumed.count === 0) {
            const error = new Error('Verification is required before creating this account.')
            error.statusCode = 403
            error.code = 'REGISTRATION_OTP_REQUIRED'
            error.expose = true
            throw error
          }
        }
        return tx.user.create({
          data: {
            email: body.email || undefined,
            phoneHash,
            passwordHash,
            displayName: body.displayName || body.email || 'SYBNB User',
            roles: { create: { role } },
            wallets: { create: { currency: defaultCurrency() } },
          },
          include: { roles: true },
        })
      })

      const session = await issueUserSession(user, req)
      return json(res, 201, {
        ok: true,
        user: publicUser(user),
        token: session.token,
        sessionId: session.sessionId,
        expiresAt: session.expiresAt,
      })
    } catch (error) {
      if (error?.code === 'P2002') {
        const conflict = new Error('An account with this email or phone already exists.')
        conflict.statusCode = 409
        conflict.code = 'ACCOUNT_ALREADY_EXISTS'
        conflict.expose = true
        throw conflict
      }
      throw error
    }
  }

  if (url.pathname === '/api/auth/login') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    if (await rateLimited(req, 'login')) return tooManyRequests(res)
    const body = await readJson(req)
    const where = body.email
      ? { email: body.email }
      : body.phone
        ? { phoneHash: hashPhone(body.phone) }
        : undefined

    if (!where) {
      const error = new Error('email or phone is required.')
      error.statusCode = 400
      error.code = 'LOGIN_IDENTIFIER_REQUIRED'
      error.expose = true
      throw error
    }

    const user = await db().user.findUnique({ where, include: { roles: true } })
    if (!user || user.status !== 'ACTIVE' || !verifyPassword(body.password, user.passwordHash)) {
      const error = new Error('Invalid login credentials.')
      error.statusCode = 401
      error.code = 'INVALID_CREDENTIALS'
      error.expose = true
      throw error
    }

    // Each login issues its OWN session row, so two devices signing into the same account get two
    // independently revocable sessions rather than two copies of one indistinguishable credential.
    const session = await issueUserSession(user, req)
    return json(res, 200, {
      ok: true,
      user: publicUser(user),
      token: session.token,
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
    })
  }

  return false
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    locale: user.locale,
    status: user.status,
    roles: user.roles.map((item) => item.role),
  }
}
