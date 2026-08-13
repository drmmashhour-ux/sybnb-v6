import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { hashPhone, idempotencyKey, verifyGiftClaimCode } from '../lib/security.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'

export async function handleWallet(req, res, url, context) {
  if (url.pathname === '/api/wallet') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)
    const wallet = await db().wallet.findUnique({
      where: { userId_currency: { userId: context.user.id, currency: 'SYP' } },
      include: { entries: { orderBy: { createdAt: 'desc' }, take: 25 } },
    })
    return json(res, 200, { ok: true, wallet })
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

    const gift = await db().walletGift.create({
      data: {
        senderUserId: context.user.id,
        recipientPhoneHash: hashPhone(body.recipientPhone),
        amountMinor,
        currency: body.currency || 'SYP',
        message: body.message || undefined,
        status: amountMinor >= 100000 ? 'CLAIM_PENDING' : 'SENT',
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
      },
    })
    return json(res, 201, { ok: true, gift })
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

  const claimMatch = url.pathname.match(/^\/api\/wallet\/gifts\/([^/]+)\/claim$/)
  if (claimMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)
    const body = await readJson(req)
    const phoneHash = hashPhone(body.phone)
    const gift = await db().walletGift.findUnique({
      where: { id: claimMatch[1] },
    })

    if (!gift || gift.status !== 'SENT') throw giftClaimError()
    // A gift carries an expiry (expiresAt) but the claim path never enforced it, so a SENT gift
    // past its window stayed claimable and the modelled EXPIRED status was never reached. Reject
    // expired gifts before any credit so the entitlement genuinely lapses.
    if (gift.expiresAt && gift.expiresAt <= new Date()) {
      throw giftClaimError('This gift has expired and can no longer be claimed.', 'GIFT_EXPIRED')
    }
    if (gift.recipientPhoneHash !== phoneHash) {
      await registerFailedGiftClaim(gift)
      throw giftClaimError()
    }
    if (gift.lockedUntil && gift.lockedUntil > new Date()) {
      const error = giftClaimError('Gift claim is temporarily locked after too many attempts.', 'GIFT_CLAIM_LOCKED')
      throw error
    }
    if (!verifyGiftClaimCode(gift, body.code)) {
      const updatedGift = await registerFailedGiftClaim(gift)
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

async function registerFailedGiftClaim(gift) {
  const nextAttempts = gift.claimAttemptCount + 1
  return db().walletGift.update({
    where: { id: gift.id },
    data: {
      claimAttemptCount: { increment: 1 },
      lockedUntil: nextAttempts >= 3 ? new Date(Date.now() + 1000 * 60 * 10) : gift.lockedUntil,
    },
  })
}

function giftClaimError(message = 'Gift is not claimable for this phone number.', code = 'GIFT_NOT_CLAIMABLE') {
  const error = new Error(message)
  error.statusCode = 403
  error.code = code
  error.expose = true
  return error
}
