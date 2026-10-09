// SYBNB loyalty program (points + tiers) — migration 051.
//
// Members (guests AND hosts) earn points when a booking completes; points convert to SYBNB wallet
// credit. Tier is derived from LIFETIME points and raises the earn multiplier. All rates live here
// (not in the schema) so they stay tunable. Points carry monetary value only at redemption, where
// they become a real wallet CREDIT through the same money ledger as everything else.
import { db } from './prisma.mjs'
import { recordWalletEntry } from './finance-ledger.mjs'
import { idempotencyKey } from './security.mjs'

// --- Config -----------------------------------------------------------------------------------
// Base points earned = floor(booking amount in WHOLE currency units / divisor). priceMinor/amountMinor
// are whole units in this app (see toMinor/moneyText), so SYP 1,000 or USD 5 each earn ~1 base point.
const EARN_DIVISOR = { SYP: 1000, USD: 5 }
const DEFAULT_DIVISOR = 1000

// Tiers by lifetime points (high → low) with the earn multiplier each grants.
const TIERS = [
  { tier: 'PLATINUM', min: 6000, multiplier: 1.5 },
  { tier: 'GOLD', min: 2000, multiplier: 1.25 },
  { tier: 'SILVER', min: 500, multiplier: 1.1 },
  { tier: 'BRONZE', min: 0, multiplier: 1.0 },
]

// Redemption: points → wallet credit, in the local settlement currency.
export const REDEEM_POINTS_PER_UNIT = 100 // 100 points ...
export const REDEEM_MINOR_PER_UNIT = 1000 // ... = 1,000 SYP of wallet credit
export const REDEEM_CURRENCY = 'SYP'
export const MIN_REDEEM_POINTS = 100
export const REDEEM_STEP_POINTS = 100

// AI loyalty-manager safety caps. The AI manager runs the program autonomously, but these ceilings
// are enforced here in code — the model cannot exceed them no matter what it returns. Together with
// the fixed redemption rate above, this is what makes "AI controls the points" safe: it can reward
// generously within bounds, but can never be driven (by a model error or prompt injection) into
// minting unlimited wallet value.
export const AI_BONUS_CAP_PER_REVIEW = 500
export const AI_BONUS_CAP_PER_DAY = 1000

export function tierForLifetime(lifetimePoints) {
  const n = Math.max(0, Number(lifetimePoints) || 0)
  return (TIERS.find((t) => n >= t.min) || TIERS[TIERS.length - 1]).tier
}
export function tierMultiplier(tier) {
  return (TIERS.find((t) => t.tier === tier) || TIERS[TIERS.length - 1]).multiplier
}
// TIERS is ordered high→low; the "next" tier up is the one just before the current index.
function nextTierUp(tier) {
  const idx = TIERS.findIndex((t) => t.tier === tier)
  if (idx <= 0) return null // PLATINUM (or unknown) has nothing higher
  const up = TIERS[idx - 1]
  return { tier: up.tier, min: up.min }
}

export function loyaltyConfig() {
  return {
    tiers: [...TIERS].reverse().map((t) => ({ tier: t.tier, min: t.min, multiplier: t.multiplier })),
    redeem: {
      pointsPerUnit: REDEEM_POINTS_PER_UNIT,
      minorPerUnit: REDEEM_MINOR_PER_UNIT,
      currency: REDEEM_CURRENCY,
      minPoints: MIN_REDEEM_POINTS,
      stepPoints: REDEEM_STEP_POINTS,
    },
    earn: { divisor: EARN_DIVISOR },
  }
}

function basePointsFor(amountMinor, currency) {
  const divisor = EARN_DIVISOR[String(currency || '').toUpperCase()] || DEFAULT_DIVISOR
  return Math.max(0, Math.floor((Number(amountMinor) || 0) / divisor))
}

async function ensureAccount(tx, userId) {
  return tx.loyaltyAccount.upsert({ where: { userId }, update: {}, create: { userId } })
}

// Append a loyalty movement. Positive (EARN / positive ADJUST) is idempotent on keyParts — safe to
// re-run (the completion sweep does). Negative (REDEEM / negative ADJUST) uses an atomic guarded
// decrement so points can never go below zero or be double-spent under concurrency.
export async function recordLoyalty(tx, { userId, type, pointsSigned, reason, referenceType, referenceId, keyParts }) {
  const key = idempotencyKey(keyParts)
  const account = await ensureAccount(tx, userId)

  if (pointsSigned >= 0) {
    try {
      await tx.loyaltyEntry.create({
        data: { accountId: account.id, type, points: pointsSigned, reason, referenceType, referenceId, idempotencyKey: key },
      })
    } catch (err) {
      if (err?.code === 'P2002') return { applied: false } // already recorded — no double-award
      throw err
    }
    const addLifetime = type === 'REDEEM' ? 0 : pointsSigned
    const newLifetime = account.lifetimePoints + addLifetime
    const updated = await tx.loyaltyAccount.update({
      where: { id: account.id },
      data: { pointsBalance: { increment: pointsSigned }, lifetimePoints: newLifetime, tier: tierForLifetime(newLifetime) },
    })
    return { applied: true, account: updated }
  }

  const dec = -pointsSigned
  const guard = await tx.loyaltyAccount.updateMany({
    where: { id: account.id, pointsBalance: { gte: dec } },
    data: { pointsBalance: { decrement: dec } },
  })
  if (guard.count === 0) {
    const error = new Error('Not enough points for this redemption.')
    error.statusCode = 409
    error.code = 'LOYALTY_INSUFFICIENT_POINTS'
    error.expose = true
    throw error
  }
  // Record the movement; a duplicate key here (vanishingly unlikely — redeem refs are unique) rolls
  // back the decrement with the surrounding transaction rather than silently dropping it.
  await tx.loyaltyEntry.create({
    data: { accountId: account.id, type, points: pointsSigned, reason, referenceType, referenceId, idempotencyKey: key },
  })
  return { applied: true }
}

// Award points to BOTH the guest and the host when a booking completes. Idempotent per booking+role.
export async function awardBookingCompletion(tx, booking) {
  const base = basePointsFor(booking.amountMinor, booking.currency)
  if (base <= 0) return
  const parties = [
    ['guest', booking.guestId],
    ['host', booking.listing?.ownerId],
  ]
  for (const [role, userId] of parties) {
    if (!userId) continue
    const account = await ensureAccount(tx, userId)
    const pts = Math.max(1, Math.round(base * tierMultiplier(account.tier)))
    await recordLoyalty(tx, {
      userId,
      type: 'EARN',
      pointsSigned: pts,
      reason: `Completed booking (${role})`,
      referenceType: 'booking_completion',
      referenceId: booking.id,
      keyParts: ['loyalty-earn', booking.id, role],
    })
  }
}

// Redeem points for wallet credit. Atomic within the caller's transaction: guarded points debit,
// then a wallet CREDIT through the money ledger.
export async function redeemPoints(tx, { userId, points }) {
  const p = Math.floor(Number(points) || 0)
  if (p < MIN_REDEEM_POINTS || p % REDEEM_STEP_POINTS !== 0) {
    const error = new Error(`Redeem in multiples of ${REDEEM_STEP_POINTS}, minimum ${MIN_REDEEM_POINTS} points.`)
    error.statusCode = 400
    error.code = 'LOYALTY_REDEEM_INVALID'
    error.expose = true
    throw error
  }
  const creditMinor = (p / REDEEM_POINTS_PER_UNIT) * REDEEM_MINOR_PER_UNIT
  const redeemRef = `${userId}:${p}:${Date.now()}`
  await recordLoyalty(tx, {
    userId,
    type: 'REDEEM',
    pointsSigned: -p,
    reason: `Redeemed ${p} points for wallet credit`,
    referenceType: 'loyalty_redeem',
    referenceId: redeemRef,
    keyParts: ['loyalty-redeem', redeemRef],
  })
  await recordWalletEntry(tx, {
    userId,
    type: 'CREDIT',
    amountMinor: creditMinor,
    currency: REDEEM_CURRENCY,
    referenceType: 'loyalty_redeem',
    referenceId: redeemRef,
    keyParts: ['loyalty-redeem-credit', redeemRef],
    note: `Loyalty redemption: ${p} points`,
  })
  return { points: p, creditMinor, currency: REDEEM_CURRENCY }
}

// AI bonus points this member already received today (enforces the per-day cap).
export async function aiBonusGrantedToday(tx, userId) {
  const account = await tx.loyaltyAccount.findUnique({ where: { userId } })
  if (!account) return 0
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const agg = await tx.loyaltyEntry.aggregate({
    where: { accountId: account.id, referenceType: 'loyalty_ai_bonus', type: 'ADJUST', createdAt: { gte: start } },
    _sum: { points: true },
  })
  return agg._sum.points || 0
}

// Apply the AI manager's decision in a transaction: grant a capped bonus (clamped to per-review AND
// per-day ceilings) and report exactly what was applied. FLAG/HOLD award nothing.
export async function applyAiLoyaltyDecision(tx, { userId, decision }) {
  let awarded = 0
  if (decision.action === 'GRANT_BONUS' && decision.bonusPoints > 0) {
    const already = await aiBonusGrantedToday(tx, userId)
    const room = Math.max(0, AI_BONUS_CAP_PER_DAY - already)
    awarded = Math.min(decision.bonusPoints, AI_BONUS_CAP_PER_REVIEW, room)
    if (awarded > 0) {
      const stamp = `${userId}:${Date.now()}`
      await recordLoyalty(tx, {
        userId,
        type: 'ADJUST',
        pointsSigned: awarded,
        reason: `AI loyalty manager bonus: ${decision.summary || 'loyalty reward'}`.slice(0, 300),
        referenceType: 'loyalty_ai_bonus',
        referenceId: stamp,
        keyParts: ['loyalty-ai-bonus', stamp],
      })
    }
  }
  return {
    awarded,
    action: decision.action,
    flags: decision.flags || [],
    summary: decision.summary,
    capPerReview: AI_BONUS_CAP_PER_REVIEW,
    capPerDay: AI_BONUS_CAP_PER_DAY,
  }
}

// Read-only summary for the profile UI.
export async function loyaltySummary(userId) {
  const account = await db().loyaltyAccount.findUnique({ where: { userId } })
  const pointsBalance = account?.pointsBalance ?? 0
  const lifetimePoints = account?.lifetimePoints ?? 0
  const tier = account?.tier ?? 'BRONZE'
  const up = nextTierUp(tier)
  const recent = account
    ? await db().loyaltyEntry.findMany({ where: { accountId: account.id }, orderBy: { createdAt: 'desc' }, take: 20 })
    : []
  return {
    pointsBalance,
    lifetimePoints,
    tier,
    multiplier: tierMultiplier(tier),
    nextTier: up ? { tier: up.tier, pointsToGo: Math.max(0, up.min - lifetimePoints) } : null,
    redeemableMinor: Math.floor(pointsBalance / REDEEM_POINTS_PER_UNIT) * REDEEM_MINOR_PER_UNIT,
    config: loyaltyConfig(),
    recent: recent.map((e) => ({ id: e.id, type: e.type, points: e.points, reason: e.reason, createdAt: e.createdAt })),
  }
}
