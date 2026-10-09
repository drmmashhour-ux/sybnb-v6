import { db } from '../lib/prisma.mjs'
import { hashPassword, hashPhone, hashEmail, verifyPassword } from '../lib/security.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { issueUserSession, listActiveSessions, revokeSession, revokeUserAccess, REVOCATION_REASONS } from '../lib/session-store.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { channelEnabled, defaultCurrency } from '../lib/country.mjs'
import { isRateLimited, clientIp } from '../lib/rateLimit.mjs'
import { ADMIN_LOGIN_OTP_PURPOSE, ADMIN_LOGIN_OTP_WINDOW_MS, requiresAdminLoginCode } from '../lib/admin-login.mjs'

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
          // Only an account-identity OTP may back a registration -- never a transactional one
          // (payment-proof / wallet-claim). Registration is used for every role (guest/seller/
          // staff/host), so all of their identity purposes are accepted.
          purpose: { in: ['account-verify', 'guest-login', 'seller-login', 'staff-login', 'host-login'] },
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
            // Normalize the account identity the same way hashEmail does (trim + lowercase), so a
            // later sign-in with a differently-cased spelling of the same address still matches.
            email: body.email ? String(body.email).trim().toLowerCase() : undefined,
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

  // Forgot password. Proof of control of the account email = a VERIFIED, recent, single-use
  // 'password-reset' OTP (POST /api/otp/send + /api/otp/verify). Then the new password replaces the
  // old one and EVERY existing session on the account is revoked (CREDENTIAL_RESET), so anyone
  // signed in with the old password is logged out everywhere. The same generic answer is given
  // whether or not an account exists for the email, so this does not reveal who has an account.
  if (url.pathname === '/api/auth/password-reset') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    if (await rateLimited(req, 'login')) return tooManyRequests(res)
    const body = await readJson(req)
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''
    const generic = () => {
      const error = new Error('The code is not valid or has expired. Request a new code and try again.')
      error.statusCode = 403
      error.code = 'PASSWORD_RESET_NOT_ALLOWED'
      error.expose = true
      return error
    }
    if (!email) throw generic()
    if (newPassword.length < 8) {
      const error = new Error('The new password needs at least 8 characters.')
      error.statusCode = 400
      error.code = 'PASSWORD_TOO_SHORT'
      error.expose = true
      throw error
    }
    const verified = await db().verificationCode.findFirst({
      where: {
        identifierHash: hashEmail(email),
        status: 'VERIFIED',
        purpose: 'password-reset',
        verifiedAt: { gt: new Date(Date.now() - OTP_BIND_WINDOW_MS) },
      },
      orderBy: { verifiedAt: 'desc' },
    })
    if (!verified) throw generic()
    const user = await db().user.findUnique({ where: { email }, select: { id: true, status: true } })
    if (!user || user.status !== 'ACTIVE') throw generic()

    await db().$transaction(async (tx) => {
      // Single-use: only a still-VERIFIED code flips, so a replayed request cannot reset again.
      const consumed = await tx.verificationCode.updateMany({
        where: { id: verified.id, status: 'VERIFIED' },
        data: { status: 'CANCELLED' },
      })
      if (consumed.count === 0) throw generic()
      await tx.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(newPassword) } })
      await revokeUserAccess(user.id, REVOCATION_REASONS.CREDENTIAL_RESET, { tx })
    })
    return json(res, 200, { ok: true })
  }

  if (url.pathname === '/api/auth/login') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    if (await rateLimited(req, 'login')) return tooManyRequests(res)
    const body = await readJson(req)
    const where = body.email
      ? { email: String(body.email).trim().toLowerCase() }
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

    // Owner decision 2026-10-08: an account holding ADMIN signs in with password AND a fresh email
    // code, every time. The code must be an 'admin-login' OTP for THIS account's email, verified in
    // the last ADMIN_LOGIN_OTP_WINDOW_MS (POST /api/otp/send + /api/otp/verify), and is consumed
    // single-use here -- so one verified code yields exactly one admin session. Checked only after
    // the password matched, so it reveals nothing about which accounts are admins to a stranger.
    // Roles are read live on every request, so any session for this account carries ADMIN: there
    // is no "sign in as a guest, then act as admin" path around this check.
    if (requiresAdminLoginCode(user.roles)) {
      const codeRequired = () => {
        const error = new Error('Admin sign-in needs a fresh email code. Use the admin portal: request the code, enter it, then sign in.')
        error.statusCode = 403
        error.code = 'ADMIN_LOGIN_CODE_REQUIRED'
        error.expose = true
        return error
      }
      if (!user.email) throw codeRequired()
      const verified = await db().verificationCode.findFirst({
        where: {
          identifierHash: hashEmail(user.email),
          purpose: ADMIN_LOGIN_OTP_PURPOSE,
          status: 'VERIFIED',
          verifiedAt: { gt: new Date(Date.now() - ADMIN_LOGIN_OTP_WINDOW_MS) },
        },
        orderBy: { verifiedAt: 'desc' },
      })
      if (!verified) throw codeRequired()
      // Single-use: only a still-VERIFIED row flips, so two concurrent logins cannot share one code.
      const consumed = await db().verificationCode.updateMany({
        where: { id: verified.id, status: 'VERIFIED' },
        data: { status: 'CANCELLED' },
      })
      if (consumed.count === 0) throw codeRequired()
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
