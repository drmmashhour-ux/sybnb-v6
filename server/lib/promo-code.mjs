import { db } from './prisma.mjs'

// SR Ride vs. Uber gap-closure (P2 #12): promo codes. Owner-approved scope (2026-08-26, via
// AskUserQuestion): simple percent-or-flat discount, admin-created, single redemption per rider.

export async function validateActivePromoCode(code) {
  const normalized = String(code || '').trim().toUpperCase()
  if (!normalized) return null

  const promo = await db().promoCode.findUnique({ where: { code: normalized } })
  if (!promo || !promo.active || (promo.expiresAt && promo.expiresAt.getTime() < Date.now())) {
    const error = new Error('This promo code is invalid or has expired.')
    error.statusCode = 400
    error.code = 'PROMO_CODE_INVALID'
    error.expose = true
    throw error
  }
  return promo
}

// Always computed from the ride's own real, already-locked fareMinor -- never a client-supplied
// discount amount -- same discipline every other money-adjacent field in this codebase follows.
export function computeDiscountMinor(promo, fareMinor) {
  let discountMinor =
    promo.discountType === 'PERCENT' ? Math.round((fareMinor * promo.discountValue) / 100) : promo.discountValue
  if (promo.discountType === 'PERCENT' && promo.maxDiscountMinor != null) {
    discountMinor = Math.min(discountMinor, promo.maxDiscountMinor)
  }
  return Math.max(0, Math.min(discountMinor, fareMinor))
}

// The unique constraint on (promo_code_id, user_id) is what actually enforces single-redemption-
// per-rider -- this just recognizes the resulting P2002 so the caller can turn it into a clean
// error instead of a 500, the same recognize-the-constraint-violation pattern already used for
// provider-ref and payment-event-identity conflicts elsewhere in this codebase.
export function isPromoRedemptionUniqueViolation(err) {
  const target = err?.meta?.target
  return (
    err?.code === 'P2002' &&
    (target === 'promo_redemptions_promo_code_id_user_id_key' ||
      (Array.isArray(target) && target.includes('promo_code_id') && target.includes('user_id')))
  )
}

export function promoAlreadyUsedError() {
  const error = new Error('You have already used this promo code.')
  error.statusCode = 409
  error.code = 'PROMO_CODE_ALREADY_USED'
  error.expose = true
  return error
}
