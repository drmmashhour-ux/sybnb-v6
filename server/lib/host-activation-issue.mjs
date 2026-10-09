// SYBNB — issue a host activation code inside a caller's transaction (shared by the manual admin
// route POST /api/admin/hosts/:id/activation-code and, since the owner decision of 2026-10-09, by the
// listing-approval path in server/routes/admin.mjs: the code now comes at the END of onboarding,
// emailed automatically when an admin approves an unverified host's stay).
//
// Same rules in both places: crypto-random 6 digits (generateActivationCode), only the keyed HMAC is
// stored (hashOtpCode, bound to the host id + 'host-activation' purpose), expiry from
// activationCodeExpiresAt (HOST_ACTIVATION_CODE_TTL_DAYS), every earlier unused code is retired, and
// an audit row is written in the SAME transaction -- never containing the code or its hash.
// Authorization (reauthorizeAtCommit, self-dealing) stays with the caller.

import { hashOtpCode } from './security.mjs'
import {
  HOST_ACTIVATION_PURPOSE,
  activationCodeExpiresAt,
  activationCodeState,
  generateActivationCode,
  requiresHostVerification,
} from './host-verification.mjs'

// Hash subject: the host's user id, so a code is bound to exactly one account.
export const activationCodeSubject = (hostId) => `host:${hostId}`

// Returns { code, row: { id, issuedAt, expiresAt }, retiredPrevious }. The plaintext `code` must only
// go to the issuing admin's response or the host's email.
export async function issueHostActivationCodeTx(tx, { hostId, issuedById = null, now = new Date(), auditAfter = {} }) {
  const code = generateActivationCode()
  const expiresAt = activationCodeExpiresAt(now)
  const codeHash = hashOtpCode(activationCodeSubject(hostId), HOST_ACTIVATION_PURPOSE, code)
  // One live code per host: retire every earlier unused one (expires now).
  const retired = await tx.hostActivationCode.updateMany({
    where: { hostId, usedAt: null, expiresAt: { gt: now } },
    data: { expiresAt: now },
  })
  const row = await tx.hostActivationCode.create({
    data: { hostId, codeHash, issuedById, issuedAt: now, expiresAt },
    select: { id: true, issuedAt: true, expiresAt: true },
  })
  await tx.adminAuditLog.create({
    data: {
      actorUserId: issuedById,
      action: 'HOST_ACTIVATION_CODE_ISSUED',
      entityType: 'users',
      entityId: hostId,
      // Never the code or its hash.
      after: { codeId: row.id, expiresAt: row.expiresAt.toISOString(), retiredPrevious: retired.count, ...auditAfter },
    },
  })
  return { code, row, retiredPrevious: retired.count }
}

// Pure decision for the approval path: should approving `listing` (owned by `owner`) issue a code?
//   owner: { status, hostVerifiedAt, email } ; latestCode: newest unused code row or null.
// Returns { issue: true } or { issue: false, reason }.
//   - only divisions gated by host verification (STAYS) -- a car/marketplace seller is not a host
//   - only an ACTIVE, not-yet-verified owner
//   - not when a still-ACTIVE code is already out (a 2nd approved stay must not silently invalidate
//     the code the host was just emailed); an expired/locked one is replaced
export function approvalActivationDecision({ listing, owner, latestCode, now = new Date() }) {
  if (!listing || !requiresHostVerification(listing.division)) return { issue: false, reason: 'DIVISION_NOT_GATED' }
  if (!owner) return { issue: false, reason: 'OWNER_NOT_FOUND' }
  if (owner.hostVerifiedAt) return { issue: false, reason: 'ALREADY_VERIFIED' }
  if (owner.status && owner.status !== 'ACTIVE') return { issue: false, reason: 'ACCOUNT_NOT_ACTIVE' }
  if (activationCodeState(latestCode, now) === 'ACTIVE') return { issue: false, reason: 'ACTIVE_CODE_EXISTS' }
  return { issue: true }
}
