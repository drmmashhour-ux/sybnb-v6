// SYBNB — host verification by activation code (owner decision of 2026-10-08, migration 049).
//
//   GET  /api/admin/hosts?status=unverified|verified|all[&q=]   ADMIN/SUPPORT  list hosts
//   POST /api/admin/hosts/:userId/activation-code {sendEmail?}  ADMIN          issue a code (shown once)
//   POST /api/host/activate {code}                              HOST/SELLER    redeem it
//   GET  /api/host/verification                                 signed in      own status
//
// Security model:
//   - The 6-digit code is crypto-random (generateActivationCode) and only its HMAC is stored, with
//     the SAME keyed hash as OTP codes (hashOtpCode, AUTH_SECRET), bound to the host's user id and
//     the 'host-activation' purpose -- a code row can never be redeemed by another account.
//   - It is returned to the issuing admin exactly once, in the POST response; optionally emailed to
//     the host. It is never logged or written to the audit log.
//   - Redeeming reserves an attempt ATOMICALLY (conditional UPDATE attempts = attempts + 1 WHERE
//     attempts < max) before comparing, so concurrent guesses can never exceed the cap; the compare
//     is timing-safe (verifyOtpCode). The 5th wrong guess locks the code until an admin re-issues.
//   - Issuing is a Class A admin action: commit-boundary re-authorization (ADMIN still held,
//     session live, not the admin's own account) + audit row in the same transaction, plus a
//     per-admin and per-host rate limit on top of the global admin-action limiter.

import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { hashOtpCode, verifyOtpCode } from '../lib/security.mjs'
import { isRateLimited, clientIp } from '../lib/rateLimit.mjs'
import { notifyUser } from '../lib/notifications.mjs'
import { reauthorizeAtCommit } from '../lib/commit-authorization.mjs'
import {
  HOST_ACTIVATION_MAX_ATTEMPTS,
  HOST_ACTIVATION_PURPOSE,
  activationAttemptOutcome,
  activationCodeExpiresAt,
  activationCodeState,
  generateActivationCode,
  hostListStatusWhere,
  normalizeActivationCode,
} from '../lib/host-verification.mjs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HOUR_MS = 60 * 60_000
const ISSUE_PER_ADMIN_MAX = Number(process.env.HOST_ACTIVATION_ISSUE_RATE_MAX || 30) // per admin per hour
const ISSUE_PER_HOST_MAX = 5 // per host per hour
const ACTIVATE_PER_USER_MAX = 10 // per host per 10 minutes (on top of the 5-per-code lock)
const ACTIVATE_PER_IP_MAX = 30

function fail(statusCode, code, message, extra) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  if (extra) error.details = extra
  return error
}

// Hash subject: the host's user id, so a code is bound to exactly one account.
const codeSubject = (hostId) => `host:${hostId}`

function latestCodeView(code, now) {
  if (!code) return null
  return {
    issuedAt: code.issuedAt,
    expiresAt: code.expiresAt,
    used: Boolean(code.usedAt),
    usedAt: code.usedAt || null,
    attempts: code.attempts,
    state: activationCodeState(code, now),
  }
}

export async function handleHostVerification(req, res, url, context) {
  // ---- Admin: list hosts -----------------------------------------------------------------------
  if (url.pathname === '/api/admin/hosts') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const statusWhere = hostListStatusWhere(url.searchParams.get('status'))
    if (!statusWhere) throw fail(400, 'INVALID_STATUS_FILTER', 'status must be unverified, verified or all.')
    const q = String(url.searchParams.get('q') || '').trim().slice(0, 120)
    const rows = await db().user.findMany({
      where: {
        AND: [
          statusWhere,
          // A "host" = holds HOST, or owns at least one stay (a SELLER may list one too).
          { OR: [{ roles: { some: { role: 'HOST' } } }, { listings: { some: { division: 'STAYS' } } }] },
          ...(q ? [{ OR: [{ email: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }] }] : []),
        ],
      },
      select: {
        id: true,
        displayName: true,
        email: true,
        status: true,
        createdAt: true,
        hostVerifiedAt: true,
        hostVerifiedBy: { select: { id: true, displayName: true } },
        _count: { select: { listings: true } },
        hostActivationCodes: {
          orderBy: { issuedAt: 'desc' },
          take: 1,
          select: { issuedAt: true, expiresAt: true, usedAt: true, attempts: true },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
    })
    const now = new Date()
    return json(res, 200, {
      ok: true,
      hosts: rows.map((row) => ({
        id: row.id,
        displayName: row.displayName,
        email: row.email,
        // Phone numbers are stored only as a keyed hash (users.phone_hash), so there is no
        // plaintext phone to show here.
        status: row.status,
        createdAt: row.createdAt,
        verifiedAt: row.hostVerifiedAt,
        verifiedBy: row.hostVerifiedBy || null,
        listingsCount: row._count.listings,
        latestCode: latestCodeView(row.hostActivationCodes[0], now),
      })),
    })
  }

  // ---- Admin: issue an activation code ------------------------------------------------------------
  const issueMatch = url.pathname.match(/^\/api\/admin\/hosts\/([^/]+)\/activation-code$/)
  if (issueMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['ADMIN'])
    const hostId = issueMatch[1]
    if (!UUID_RE.test(hostId)) throw fail(404, 'USER_NOT_FOUND', 'Host not found.')
    if (hostId === context.user.id) {
      throw fail(403, 'SELF_VERIFICATION_FORBIDDEN', 'An admin cannot issue an activation code for their own account.')
    }
    if (await isRateLimited(`host-activation-issue:${context.user.id}`, HOUR_MS, ISSUE_PER_ADMIN_MAX)) {
      throw fail(429, 'RATE_LIMITED', 'Too many activation codes issued. Wait a while and try again.')
    }
    if (await isRateLimited(`host-activation-issue-host:${hostId}`, HOUR_MS, ISSUE_PER_HOST_MAX)) {
      throw fail(429, 'RATE_LIMITED', 'Too many activation codes for this host in the last hour.')
    }
    const body = await readJson(req)
    const sendEmail = body?.sendEmail === true

    const target = await db().user.findUnique({
      where: { id: hostId },
      select: {
        id: true,
        email: true,
        status: true,
        hostVerifiedAt: true,
        roles: { select: { role: true } },
        _count: { select: { listings: { where: { division: 'STAYS' } } } },
      },
    })
    if (!target) throw fail(404, 'USER_NOT_FOUND', 'Host not found.')
    const isHost = target.roles.some((r) => r.role === 'HOST') || target._count.listings > 0
    if (!isHost) throw fail(409, 'NOT_A_HOST', 'This account is not a host.')
    if (target.status !== 'ACTIVE') throw fail(409, 'ACCOUNT_NOT_ACTIVE', 'This account is not active.')
    if (target.hostVerifiedAt) throw fail(409, 'HOST_ALREADY_VERIFIED', 'This host is already verified.')

    const code = generateActivationCode()
    const now = new Date()
    const expiresAt = activationCodeExpiresAt(now)
    const codeHash = hashOtpCode(codeSubject(hostId), HOST_ACTIVATION_PURPOSE, code)

    const issued = await db().$transaction(async (tx) => {
      await reauthorizeAtCommit(tx, context, {
        action: 'HOST_ACTIVATION_CODE_ISSUED',
        requiredRoles: ['ADMIN'],
        interestedPartyIds: [hostId],
        selfDealingError: { code: 'SELF_VERIFICATION_FORBIDDEN', message: 'An admin cannot issue an activation code for their own account.' },
      })
      // One live code per host: retire every earlier unused one (expires now).
      const retired = await tx.hostActivationCode.updateMany({
        where: { hostId, usedAt: null, expiresAt: { gt: now } },
        data: { expiresAt: now },
      })
      const row = await tx.hostActivationCode.create({
        data: { hostId, codeHash, issuedById: context.user.id, issuedAt: now, expiresAt },
        select: { id: true, issuedAt: true, expiresAt: true },
      })
      await tx.adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: 'HOST_ACTIVATION_CODE_ISSUED',
          entityType: 'users',
          entityId: hostId,
          // Never the code or its hash.
          after: { codeId: row.id, expiresAt: row.expiresAt.toISOString(), retiredPrevious: retired.count, emailRequested: sendEmail },
        },
      })
      return row
    })

    const emailQueued = sendEmail && Boolean(target.email)
    if (emailQueued) {
      notifyUser('host_activation_code', hostId, { code, expiresAt: issued.expiresAt.toISOString().slice(0, 10) }, `host-activation:${issued.id}`)
    }

    // The ONLY time the plaintext code leaves the server (besides the optional email).
    res.setHeader('cache-control', 'no-store')
    return json(res, 201, {
      ok: true,
      code,
      codeId: issued.id,
      issuedAt: issued.issuedAt,
      expiresAt: issued.expiresAt,
      maxAttempts: HOST_ACTIVATION_MAX_ATTEMPTS,
      emailQueued,
    })
  }

  // ---- Host: own verification status ----------------------------------------------------------
  if (url.pathname === '/api/host/verification') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)
    const [user, latest] = await Promise.all([
      db().user.findUnique({ where: { id: context.user.id }, select: { hostVerifiedAt: true } }),
      db().hostActivationCode.findFirst({
        where: { hostId: context.user.id, usedAt: null },
        orderBy: { issuedAt: 'desc' },
        select: { expiresAt: true, attempts: true, usedAt: true },
      }),
    ])
    const state = activationCodeState(latest, new Date())
    return json(res, 200, {
      ok: true,
      verified: Boolean(user?.hostVerifiedAt),
      verifiedAt: user?.hostVerifiedAt || null,
      hasPendingCode: !user?.hostVerifiedAt && state === 'ACTIVE',
      codeExpiresAt: state === 'ACTIVE' ? latest.expiresAt : null,
      codeLocked: !user?.hostVerifiedAt && state === 'LOCKED',
      attemptsRemaining: state === 'ACTIVE' ? HOST_ACTIVATION_MAX_ATTEMPTS - latest.attempts : 0,
    })
  }

  // ---- Host: redeem the code -------------------------------------------------------------------
  if (url.pathname === '/api/host/activate') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['HOST', 'SELLER'])
    const hostId = context.user.id
    if (await isRateLimited(`host-activate:${hostId}`, 10 * 60_000, ACTIVATE_PER_USER_MAX)) {
      throw fail(429, 'RATE_LIMITED', 'Too many attempts. Please wait a few minutes.')
    }
    if (await isRateLimited(`host-activate-ip:${clientIp(req)}`, 10 * 60_000, ACTIVATE_PER_IP_MAX)) {
      throw fail(429, 'RATE_LIMITED', 'Too many attempts. Please wait a few minutes.')
    }
    const body = await readJson(req)

    const current = await db().user.findUnique({ where: { id: hostId }, select: { hostVerifiedAt: true } })
    if (current?.hostVerifiedAt) {
      return json(res, 200, { ok: true, verifiedAt: current.hostVerifiedAt, alreadyVerified: true })
    }

    // A malformed entry is a typo, not a guess: it is refused without spending an attempt.
    const code = normalizeActivationCode(body?.code)
    if (!code) throw fail(400, 'ACTIVATION_CODE_FORMAT', 'Enter the 6-digit activation code.')

    const now = new Date()
    const latest = await db().hostActivationCode.findFirst({
      where: { hostId, usedAt: null },
      orderBy: { issuedAt: 'desc' },
    })
    const refuseFor = (state) => {
      if (state === 'NONE' || state === 'USED') return fail(404, 'ACTIVATION_CODE_NOT_FOUND', 'No activation code is waiting for this account. The SYBNB team will send you one.')
      if (state === 'EXPIRED') return fail(410, 'ACTIVATION_CODE_EXPIRED', 'This activation code has expired. Ask the SYBNB team for a new one.')
      return fail(423, 'ACTIVATION_CODE_LOCKED', 'Too many incorrect attempts. Ask the SYBNB team for a new code.', { attemptsRemaining: 0 })
    }
    const state = activationCodeState(latest, now)
    if (state !== 'ACTIVE') throw refuseFor(state)

    // Reserve one attempt atomically BEFORE comparing (see header).
    const reserved = await db().hostActivationCode.updateMany({
      where: { id: latest.id, usedAt: null, attempts: { lt: HOST_ACTIVATION_MAX_ATTEMPTS }, expiresAt: { gt: now } },
      data: { attempts: { increment: 1 } },
    })
    if (reserved.count === 0) {
      const again = await db().hostActivationCode.findUnique({ where: { id: latest.id } })
      throw refuseFor(activationCodeState(again, new Date()))
    }
    const afterReserve = await db().hostActivationCode.findUnique({ where: { id: latest.id }, select: { attempts: true } })
    const matched = verifyOtpCode(codeSubject(hostId), HOST_ACTIVATION_PURPOSE, code, latest.codeHash)
    const outcome = activationAttemptOutcome({ matched, attemptsAfter: afterReserve?.attempts ?? HOST_ACTIVATION_MAX_ATTEMPTS })

    if (outcome.result === 'INVALID') {
      throw fail(400, 'ACTIVATION_CODE_INVALID', 'That code is not correct.', { attemptsRemaining: outcome.attemptsRemaining })
    }
    if (outcome.result === 'LOCKED') {
      await db().adminAuditLog.create({
        data: { actorUserId: hostId, action: 'HOST_ACTIVATION_CODE_LOCKED', entityType: 'users', entityId: hostId, after: { codeId: latest.id } },
      })
      throw fail(423, 'ACTIVATION_CODE_LOCKED', 'Too many incorrect attempts. Ask the SYBNB team for a new code.', { attemptsRemaining: 0 })
    }

    const verifiedAt = await db().$transaction(async (tx) => {
      await reauthorizeAtCommit(tx, context, { action: 'HOST_VERIFIED' })
      const claimed = await tx.hostActivationCode.updateMany({
        where: { id: latest.id, usedAt: null },
        data: { usedAt: now },
      })
      if (claimed.count === 0) throw fail(409, 'ACTIVATION_CODE_ALREADY_USED', 'This activation code was already used.')
      await tx.user.updateMany({
        where: { id: hostId, hostVerifiedAt: null },
        data: { hostVerifiedAt: now, hostVerifiedById: latest.issuedById },
      })
      const fresh = await tx.user.findUnique({ where: { id: hostId }, select: { hostVerifiedAt: true } })
      await tx.adminAuditLog.create({
        data: {
          actorUserId: hostId,
          action: 'HOST_VERIFIED',
          entityType: 'users',
          entityId: hostId,
          after: { codeId: latest.id, issuedById: latest.issuedById, verifiedAt: fresh.hostVerifiedAt.toISOString() },
        },
      })
      return fresh.hostVerifiedAt
    })

    return json(res, 200, { ok: true, verifiedAt })
  }

  return false
}
