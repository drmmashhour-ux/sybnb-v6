import { db } from '../lib/prisma.mjs'
import { createSessionToken, hashPassword, hashPhone, verifyPassword } from '../lib/security.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { assertBoundedString, assertNoUnknownFields, assertValidEmail, assertValidPassword, assertValidPhone } from '../lib/validate.mjs'
import { consumeEmailVerificationCode, hasRecentlyVerifiedEmail, sendEmailVerificationCode } from '../lib/email-verification.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { attachReferralOnRegister, generateUniqueReferralCode } from '../lib/referrals.mjs'

const NAME_FIELD_MAX_LENGTH = 120

const PUBLIC_REGISTER_ROLES = new Set(['GUEST', 'HOST', 'SELLER', 'DRIVER'])

// 'guest-signup' gates the Rentals/Buy/Stays open-account flow (unchanged). 'staff-login' gates
// sign-in for roles that reach admin/host/driver dashboards -- previously "verified" only by a
// client-side-only code box (src/engines/security/verificationCodeEngine.ts) that the server never
// checked at all, so it provided zero real protection. 'password-reset' gates the new
// forgot-password endpoint below.
const ALLOWED_EMAIL_CODE_PURPOSES = new Set(['guest-signup', 'staff-login', 'password-reset'])
const STAFF_ROLES_REQUIRING_OTP = new Set(['ADMIN', 'HOST', 'DRIVER'])

function resolveEmailCodePurpose(value) {
  return ALLOWED_EMAIL_CODE_PURPOSES.has(value) ? value : 'guest-signup'
}

// A hash of a value nobody will ever type as a real password — used only to give the "no such
// account" path the same scrypt cost as the "wrong password" path (security audit finding F-03).
// Without this, verifyPassword() is skipped entirely when no user matches, making that response
// measurably faster and letting an attacker enumerate registered accounts via response timing
// even though the error message is identical either way.
const DUMMY_PASSWORD_HASH = hashPassword('not-a-real-password-timing-decoy')

export async function handleAuth(req, res, url, context) {
  // Real server-side logout (security audit finding F-02). Bumping sessionVersion makes every
  // previously-issued token for this user fail the check in getAuthContext (auth-context.mjs),
  // even though its signature and exp are still technically valid -- a stateless signed token has
  // no other way to be revoked before it naturally expires. Coarse-grained by design (revokes
  // every device's session, not just the caller's) since there's no per-session store.
  if (url.pathname === '/api/auth/logout') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)
    await db().user.update({
      where: { id: context.user.id },
      data: { sessionVersion: { increment: 1 } },
    })
    return json(res, 200, { ok: true })
  }

  // Real email OTP for guest self-registration (Rentals/Buy/Stays "open account" gate). Chosen
  // over SMS: no per-message carrier cost, no SMS-gateway account needed. Pre-signup, so these
  // two endpoints intentionally take no auth token.
  if (url.pathname === '/api/auth/email-code/send') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    const body = await readJson(req)
    assertNoUnknownFields(body, ['email', 'purpose'], 'email-code send body')
    const validEmail = assertValidEmail(body.email)
    const purpose = resolveEmailCodePurpose(body.purpose)
    const result = await sendEmailVerificationCode(validEmail, purpose)
    return json(res, 200, result)
  }

  if (url.pathname === '/api/auth/email-code/verify') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    const body = await readJson(req)
    assertNoUnknownFields(body, ['email', 'code', 'purpose'], 'email-code verify body')
    const validEmail = assertValidEmail(body.email)
    const code = assertBoundedString(body.code, { fieldName: 'code', maxLength: 12, required: true })
    const purpose = resolveEmailCodePurpose(body.purpose)
    const result = await consumeEmailVerificationCode(validEmail, code, purpose)
    if (!result.ok) {
      const error = new Error('The verification code is invalid or expired.')
      error.statusCode = 400
      error.code = result.reason
      error.expose = true
      throw error
    }
    return json(res, 200, { ok: true })
  }

  // Real forgot-password flow (security audit finding F-01). The client must first send + verify
  // an email code with purpose='password-reset' via the two endpoints above, then call this one --
  // never trusts a client-supplied "I verified it" boolean, same pattern as guest registration's
  // hasRecentlyVerifiedEmail check below. Always returns ok:true regardless of whether the email
  // matches an account, so this endpoint can't be used to enumerate registered accounts.
  if (url.pathname === '/api/auth/password-reset') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    const body = await readJson(req)
    assertNoUnknownFields(body, ['email', 'newPassword'], 'password-reset body')
    const validEmail = assertValidEmail(body.email)
    const validPassword = assertValidPassword(body.newPassword)

    const verified = await hasRecentlyVerifiedEmail(validEmail, 'password-reset')
    if (!verified) {
      const error = new Error('Verify your email with the access code before resetting the password.')
      error.statusCode = 403
      error.code = 'EMAIL_NOT_VERIFIED'
      error.expose = true
      throw error
    }

    // Bumping sessionVersion here invalidates any session issued before the reset (F-02) -- e.g.
    // an attacker who stole a session token loses it the moment the legitimate owner resets their
    // password, instead of the token staying valid until its own 7-day expiry regardless.
    await db().user.updateMany({
      where: { email: validEmail },
      data: { passwordHash: hashPassword(validPassword), sessionVersion: { increment: 1 } },
    })
    return json(res, 200, { ok: true })
  }

  if (url.pathname === '/api/auth/register') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    const body = await readJson(req)
    assertNoUnknownFields(body, ['role', 'email', 'phone', 'password', 'displayName', 'firstName', 'lastName', 'referralCode'], 'registration body')
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

    const validEmail = body.email ? assertValidEmail(body.email) : undefined
    const validPhone = body.phone ? assertValidPhone(body.phone) : undefined
    const validPassword = assertValidPassword(body.password)
    const displayName = assertBoundedString(body.displayName, { fieldName: 'displayName', maxLength: NAME_FIELD_MAX_LENGTH })
    const firstName = assertBoundedString(body.firstName, { fieldName: 'firstName', maxLength: NAME_FIELD_MAX_LENGTH })
    const lastName = assertBoundedString(body.lastName, { fieldName: 'lastName', maxLength: NAME_FIELD_MAX_LENGTH })

    // Guest self-registration (the Rentals/Buy/Stays "open account" gate) must prove email
    // ownership before an account is created — the frontend's old phone-code step never actually
    // checked anything server-side. Checked after basic input-shape validation so a malformed
    // request always gets a validation error first, not a business-rule rejection.
    if (role === 'GUEST') {
      if (!validEmail) {
        const error = new Error('email is required for guest registration.')
        error.statusCode = 400
        error.code = 'EMAIL_REQUIRED'
        error.expose = true
        throw error
      }
      const verified = await hasRecentlyVerifiedEmail(validEmail, 'guest-signup')
      if (!verified) {
        const error = new Error('Verify your email before opening an account.')
        error.statusCode = 403
        error.code = 'EMAIL_NOT_VERIFIED'
        error.expose = true
        throw error
      }
    }

    // Host/Driver self-registration reaches the same staff dashboards as login does (the internal
    // access gate has no separate signup step) — gated with the same real 'staff-login' email OTP
    // as sign-in below, replacing what used to be a purely decorative, server-unchecked code box
    // (src/engines/security/verificationCodeEngine.ts). Admin cannot self-register at all
    // (PUBLIC_REGISTER_ROLES above), so it never reaches this branch.
    if (STAFF_ROLES_REQUIRING_OTP.has(role)) {
      if (!validEmail) {
        const error = new Error('email is required for this account type.')
        error.statusCode = 400
        error.code = 'EMAIL_REQUIRED'
        error.expose = true
        throw error
      }
      const verified = await hasRecentlyVerifiedEmail(validEmail, 'staff-login')
      if (!verified) {
        const error = new Error('Verify your email with the access code before opening this account.')
        error.statusCode = 403
        error.code = 'EMAIL_NOT_VERIFIED'
        error.expose = true
        throw error
      }
    }

    const phoneHash = validPhone ? hashPhone(validPhone) : undefined
    const passwordHash = hashPassword(validPassword)

    try {
      const user = await db().$transaction(async (tx) => {
        const referralCode = await generateUniqueReferralCode(tx)
        const created = await tx.user.create({
          data: {
            email: validEmail,
            phoneHash,
            passwordHash,
            displayName: displayName || [firstName, lastName].filter(Boolean).join(' ') || validEmail || 'SYBNB User',
            referralCode,
            roles: {
              create: { role },
            },
            wallets: {
              create: { currency: 'SYP' },
            },
          },
          include: { roles: true },
        })

        if (body.referralCode) {
          await attachReferralOnRegister(tx, { newUserId: created.id, referralCode: body.referralCode })
        }

        return created
      })

      return json(res, 201, {
        ok: true,
        user: publicUser(user),
        token: createSessionToken(user),
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
    const body = await readJson(req)
    assertNoUnknownFields(body, ['email', 'phone', 'password'], 'login body')

    if (body.email && body.phone) {
      const error = new Error('Provide either email or phone, not both.')
      error.statusCode = 400
      error.code = 'LOGIN_IDENTIFIER_AMBIGUOUS'
      error.expose = true
      throw error
    }

    // Normalized identically to registration (assertValidEmail trims + lowercases) — previously
    // this compared the raw, un-normalized request value against the always-normalized stored
    // value, so a legitimate user logging in with a different letter case than they registered
    // with (e.g. "User@Example.com" vs the stored "user@example.com") would be rejected as
    // "invalid credentials" even with the correct password.
    const validEmail = body.email ? assertValidEmail(body.email) : undefined
    const validPhone = body.phone ? assertValidPhone(body.phone) : undefined
    assertValidPassword(body.password)

    const where = validEmail
      ? { email: validEmail }
      : validPhone
        ? { phoneHash: hashPhone(validPhone) }
        : undefined

    if (!where) {
      const error = new Error('email or phone is required.')
      error.statusCode = 400
      error.code = 'LOGIN_IDENTIFIER_REQUIRED'
      error.expose = true
      throw error
    }

    const user = await db().user.findUnique({ where, include: { roles: true } })
    // Security audit finding F-03: always run verifyPassword, even when no user matched, using a
    // fixed decoy hash in that case. Without this, the "no such account" branch short-circuits
    // before the expensive scrypt call runs, making it measurably faster than "account exists,
    // wrong password" — an attacker can enumerate registered accounts via response timing even
    // though the error message is identical either way.
    const passwordOk = verifyPassword(body.password, user?.passwordHash || DUMMY_PASSWORD_HASH)
    if (!user || user.status !== 'ACTIVE' || !passwordOk) {
      const error = new Error('Invalid login credentials.')
      error.statusCode = 401
      error.code = 'INVALID_CREDENTIALS'
      error.expose = true
      throw error
    }

    // Real email-OTP gate for staff sign-in (admin/host/driver dashboards), checked only after
    // credentials are already confirmed valid so this can't be used to enumerate accounts by
    // timing/response-shape. Replaces the old client-side-only code box that the server never
    // verified at all (StaffAccessPage.tsx / verificationCodeEngine.ts).
    const needsStaffOtp = user.roles.some((entry) => STAFF_ROLES_REQUIRING_OTP.has(entry.role))
    if (needsStaffOtp) {
      if (!validEmail) {
        const error = new Error('Sign in with email and the access code for this account type.')
        error.statusCode = 400
        error.code = 'STAFF_EMAIL_REQUIRED'
        error.expose = true
        throw error
      }
      const verified = await hasRecentlyVerifiedEmail(validEmail, 'staff-login')
      if (!verified) {
        const error = new Error('Verify your email with the access code before signing in.')
        error.statusCode = 403
        error.code = 'STAFF_OTP_REQUIRED'
        error.expose = true
        throw error
      }
    }

    return json(res, 200, {
      ok: true,
      user: publicUser(user),
      token: createSessionToken(user),
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
    referralCode: user.referralCode,
  }
}
