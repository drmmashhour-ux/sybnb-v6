import { db } from '../lib/prisma.mjs'
import { createSessionToken } from '../lib/security.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { sendEmail } from '../lib/email.mjs'
import { normalizePurpose, requestEmailOtp, verifyEmailOtp } from '../lib/otp.mjs'

// Email OTP endpoints:
//   POST /api/otp/email/request  — generate + email a 6-digit code
//   POST /api/otp/email/resend   — same as request (resend, rate-limited by the engine)
//   POST /api/otp/email/verify   — verify a code; for purpose LOGIN this issues a session
export async function handleOtp(req, res, url) {
  if (url.pathname === '/api/otp/email/request' || url.pathname === '/api/otp/email/resend') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    const body = await readJson(req)
    const purpose = normalizePurpose(body.purpose)
    const result = await requestEmailOtp({ email: body.email, purpose, sendEmail })
    return json(res, 200, {
      ok: true,
      purpose,
      expiresAt: result.expiresAt,
      resendAvailableAt: result.resendAvailableAt,
    })
  }

  if (url.pathname === '/api/otp/email/verify') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    const body = await readJson(req)
    const purpose = normalizePurpose(body.purpose)
    const verified = await verifyEmailOtp({ email: body.email, purpose, code: body.code })

    if (purpose === 'LOGIN') {
      const user = await db().user.findFirst({
        where: { email: { equals: verified.email, mode: 'insensitive' } },
        include: { roles: true },
      })
      if (!user || user.status !== 'ACTIVE') {
        const error = new Error('No active account exists for this email.')
        error.statusCode = 404
        error.code = 'ACCOUNT_NOT_FOUND'
        error.expose = true
        throw error
      }
      return json(res, 200, {
        ok: true,
        verified: true,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          locale: user.locale,
          status: user.status,
          roles: user.roles.map((item) => item.role),
        },
        token: createSessionToken(user),
      })
    }

    return json(res, 200, { ok: true, verified: true, purpose })
  }

  return false
}
