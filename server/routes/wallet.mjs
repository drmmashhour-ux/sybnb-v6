import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { reauthorizeAtCommit } from '../lib/commit-authorization.mjs'
import { giftClaimCode, hashPhone, idempotencyKey, verifyGiftClaimCode } from '../lib/security.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { giftReviewThresholdMinor, recordWalletEntry } from '../lib/finance-ledger.mjs'
import { expireStaleWalletGifts } from '../lib/gift-lifecycle.mjs'
import { defaultCurrency, isCurrencyAllowed } from '../lib/country.mjs'

export async function handleWallet(req, res, url, context) {
  if (url.pathname === '/api/wallet') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)
    const wallet = await db().wallet.findUnique({
      where: { userId_currency: { userId: context.user.id, currency: defaultCurrency() } },
      include: { entries: { orderBy: { createdAt: 'desc' }, take: 25 } },
    })
    if (!wallet) return json(res, 200, { ok: true, wallet: null })
    // cachedBalanceMinor is the SETTLED/available balance: a HOLD never touches it, and a RELEASE
    // (or REFUND/CREDIT) increments it. So available = cachedBalanceMinor, and outstanding
    // protected/held funds = sum(HOLD) - sum(RELEASE). Compute over the WHOLE ledger here (not the
    // 25 most-recent entries the client sees) so a released payout no longer shows as still-held
    // with zero available.
    const [holdAgg, releaseAgg, refundAgg] = await Promise.all([
      db().walletEntry.aggregate({ _sum: { amountMinor: true }, where: { walletId: wallet.id, type: 'HOLD' } }),
      db().walletEntry.aggregate({ _sum: { amountMinor: true }, where: { walletId: wallet.id, type: 'RELEASE' } }),
      db().walletEntry.aggregate({ _sum: { amountMinor: true }, where: { walletId: wallet.id, type: 'REFUND' } }),
    ])
    const heldMinor = Math.max(0, (holdAgg._sum.amountMinor || 0) - (releaseAgg._sum.amountMinor || 0))
    const availableMinor = Math.max(0, wallet.cachedBalanceMinor || 0)
    const refundMinor = Math.max(0, refundAgg._sum.amountMinor || 0)
    return json(res, 200, { ok: true, wallet: { ...wallet, heldMinor, availableMinor, refundMinor } })
  }

  if (url.pathname === '/api/wallet/gifts') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)
    const body = await readJson(req)
    const amountMinor = Number(body.amountMinor || 0)
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      const error = new Error('Gift amount must be greater than zero.')
      error.statusCode = 400
      error.code = 'GIFT_AMOUNT_INVALID'
      error.expose = true
      throw error
    }

    const currency = body.currency ? String(body.currency).toUpperCase() : defaultCurrency()
    if (!isCurrencyAllowed(currency)) {
      const error = new Error(`Currency '${currency}' is not supported for this country.`)
      error.statusCode = 400
      error.code = 'GIFT_CURRENCY_NOT_ALLOWED'
      error.expose = true
      throw error
    }

    // A gift must be funded from the sender's own wallet balance — debit it atomically with creating
    // the gift, so a gift can never mint unbacked ledger money. recordWalletEntry's negative-balance
    // guard rejects this (409 WALLET_INSUFFICIENT_FUNDS) if the sender doesn't have the funds.
    const gift = await db().$transaction(async (tx) => {
      // SEC-002R Class A (finding N4): this transaction debits real ledger money out of the
      // sender's own wallet into a gift another person can then claim -- irreversible once claimed.
      // Authority was established once, at request admission, before this request's body was even
      // read; re-assert it here, inside the transaction, against locked authoritative rows.
      await reauthorizeAtCommit(tx, context, { action: 'WALLET_GIFT_SENT' })
      const created = await tx.walletGift.create({
        data: {
          senderUserId: context.user.id,
          recipientPhoneHash: hashPhone(body.recipientPhone),
          amountMinor,
          currency,
          message: body.message || undefined,
          status: amountMinor >= giftReviewThresholdMinor(currency) ? 'CLAIM_PENDING' : 'SENT',
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
        },
      })
      await recordWalletEntry(tx, {
        userId: context.user.id,
        type: 'DEBIT',
        amountMinor,
        currency,
        referenceType: 'wallet_gift_sent',
        referenceId: created.id,
        keyParts: ['wallet-gift-sent', created.id],
        note: 'Wallet gift sent.',
      })
      return created
    })
    // The claim code was previously never delivered to anyone (no SMS — Syria is email-only per
    // countries/syria/profile.mjs communications.sms=false — and no email exists on this model), so a
    // funded gift could never actually be claimed. Return it to the SENDER now (their own gift, they
    // are authenticated) so they can share it with the recipient directly, the same pattern already
    // used for document delivery elsewhere on this platform (WhatsApp/email, out of band).
    return json(res, 201, { ok: true, gift, claimCode: giftClaimCode(gift) })
  }

  const giftPreviewMatch = url.pathname.match(/^\/api\/wallet\/gifts\/([^/]+)$/)
  if (giftPreviewMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)
    const gift = await db().walletGift.findUnique({
      where: { id: giftPreviewMatch[1] },
      include: {
        sender: {
          select: {
            id: true,
            displayName: true,
          },
        },
      },
    })

    if (!gift) {
      const error = new Error('Gift was not found.')
      error.statusCode = 404
      error.code = 'GIFT_NOT_FOUND'
      error.expose = true
      throw error
    }

    // Close the IDOR: any authenticated caller who knows/guesses a gift id could previously read the
    // full record (sender/recipient user ids + the private message). Full detail is now limited to
    // the sender, the assigned recipient, or an admin/support agent. Everyone else (e.g. a recipient
    // opening a share link before claiming) gets only the minimal fields the claim screen needs —
    // no user ids, no private message — so ids can't be enumerated and messages can't be harvested.
    const privileged =
      gift.senderUserId === context.user.id ||
      gift.recipientUserId === context.user.id ||
      context.roles.includes('ADMIN') ||
      context.roles.includes('SUPPORT')

    if (privileged) {
      return json(res, 200, {
        ok: true,
        gift: {
          id: gift.id,
          senderUserId: gift.senderUserId,
          recipientUserId: gift.recipientUserId,
          amountMinor: gift.amountMinor,
          currency: gift.currency,
          message: gift.message,
          status: gift.status,
          expiresAt: gift.expiresAt,
          createdAt: gift.createdAt,
          updatedAt: gift.updatedAt,
          sender: gift.sender,
        },
      })
    }

    return json(res, 200, {
      ok: true,
      gift: {
        id: gift.id,
        amountMinor: gift.amountMinor,
        currency: gift.currency,
        status: gift.status,
        expiresAt: gift.expiresAt,
        sender: { displayName: gift.sender?.displayName },
      },
    })
  }

  const claimMatch = url.pathname.match(/^\/api\/wallet\/gifts\/([^/]+)\/claim$/)
  if (claimMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)
    const body = await readJson(req)
    const phoneHash = hashPhone(body.phone)
    await expireStaleWalletGifts()
    const gift = await db().walletGift.findUnique({
      where: { id: claimMatch[1] },
    })

    if (!gift) throw giftClaimError()
    // expireStaleWalletGifts() above is the authoritative expiry check -- by the time this row is
    // re-fetched, a past-due gift's status is already EXPIRED (never still SENT). Check that
    // specific status BEFORE the generic SENT check below, so a genuinely expired gift gets the
    // specific GIFT_EXPIRED code instead of the generic GIFT_NOT_CLAIMABLE the broader check would
    // otherwise throw first.
    if (gift.status === 'EXPIRED') {
      throw giftClaimError('This gift has expired and can no longer be claimed.', 'GIFT_EXPIRED')
    }
    if (gift.status !== 'SENT') throw giftClaimError()
    if (gift.recipientPhoneHash !== phoneHash) {
      await registerFailedGiftClaim(gift, context)
      throw giftClaimError()
    }
    if (gift.lockedUntil && gift.lockedUntil > new Date()) {
      const error = giftClaimError('Gift claim is temporarily locked after too many attempts.', 'GIFT_CLAIM_LOCKED')
      throw error
    }
    if (!verifyGiftClaimCode(gift, body.code)) {
      const updatedGift = await registerFailedGiftClaim(gift, context)
      if (updatedGift.lockedUntil && updatedGift.lockedUntil > new Date()) {
        throw giftClaimError('Gift claim is temporarily locked after too many attempts.', 'GIFT_CLAIM_LOCKED')
      }
      throw giftClaimError('Verification code is not correct.', 'GIFT_CODE_INVALID')
    }

    const wallet = await db().wallet.upsert({
      where: { userId_currency: { userId: context.user.id, currency: gift.currency } },
      create: { userId: context.user.id, currency: gift.currency, cachedBalanceMinor: 0 },
      update: {},
    })

    // Two different accounts claiming the same gift concurrently (leaked code, recipient logged
    // into two sessions, etc.) would otherwise both pass the SENT check above and both credit a
    // wallet the full amount, since each claim's idempotency key is scoped per-claiming-user and
    // so never collides with the other's. Re-checking status: 'SENT' inside the same transaction
    // as an updateMany makes the row-level lock do the job: the second concurrent transaction's
    // updateMany blocks until the first commits, then matches zero rows.
    const result = await db().$transaction(async (tx) => {
      // SEC-002R Class A: this transaction credits real ledger money into the claimant's wallet and
      // permanently consumes the gift. Re-authorized here, before the claim, so a session revoked
      // while this request was in flight cannot both burn the gift and bank the money.
      await reauthorizeAtCommit(tx, context, { action: 'WALLET_GIFT_CLAIMED' })
      const claimResult = await tx.walletGift.updateMany({
        where: { id: gift.id, status: 'SENT' },
        data: {
          status: 'CLAIMED',
          recipientUserId: context.user.id,
          claimAttemptCount: 0,
          lockedUntil: null,
        },
      })

      if (claimResult.count === 0) throw giftClaimError()

      const entry = await tx.walletEntry.create({
        data: {
          walletId: wallet.id,
          type: 'CREDIT',
          amountMinor: gift.amountMinor,
          currency: gift.currency,
          referenceType: 'wallet_gift',
          referenceId: gift.id,
          idempotencyKey: idempotencyKey(['gift-claim', gift.id, context.user.id]),
          note: 'Gift claimed into wallet',
        },
      })
      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: { cachedBalanceMinor: { increment: gift.amountMinor } },
      })
      const updatedGift = await tx.walletGift.findUnique({ where: { id: gift.id } })

      return [entry, updatedWallet, updatedGift]
    })

    return json(res, 200, { ok: true, entry: result[0], wallet: result[1], gift: result[2] })
  }

  return false
}

// SEC-002R round 2. This is the same shape as finding A8: a durable write that a failed request
// makes on ANOTHER party's row, sitting outside the re-authorized transaction. Three failed attempts
// set a 10-minute lockout on the gift, so a revoked session could still deny a legitimate recipient
// access to their own money for a window, and could keep doing it. The owner explicitly refused
// "it's only bookkeeping" as a justification for exactly this class of residual on A8, so it is
// closed here too rather than documented as acceptable: the counter/lockout write now runs in its
// own transaction whose first statement re-establishes the acting account's live authority under
// the same user_sessions/users locks every other Class A site takes. A revoked actor's wrong code
// gets the commit-boundary refusal and leaves the gift row untouched.
async function registerFailedGiftClaim(gift, context) {
  const nextAttempts = gift.claimAttemptCount + 1
  return db().$transaction(async (tx) => {
    await reauthorizeAtCommit(tx, context, { action: 'WALLET_GIFT_CLAIM_FAILED' })
    return tx.walletGift.update({
      where: { id: gift.id },
      data: {
        claimAttemptCount: { increment: 1 },
        lockedUntil: nextAttempts >= 3 ? new Date(Date.now() + 1000 * 60 * 10) : gift.lockedUntil,
      },
    })
  })
}

function giftClaimError(message = 'Gift is not claimable for this phone number.', code = 'GIFT_NOT_CLAIMABLE') {
  const error = new Error(message)
  error.statusCode = 403
  error.code = code
  error.expose = true
  return error
}
