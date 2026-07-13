import { randomInt } from 'node:crypto'
import { recordWalletEntry } from './finance-ledger.mjs'

// Double-sided referral program: "give X, get Y", same shape Lyft/Uber popularized. Amounts are a
// business decision, not an engineering one -- flagged here as plain, easy-to-find constants
// (same pattern as CANCELLATION_ADMIN_FEE_MINOR) so they can be tuned without touching any logic.
export const REFEREE_SIGNUP_BONUS_MINOR = 500 // $5.00, credited immediately at signup
export const REFERRER_REWARD_MINOR = 1000 // $10.00, credited once the referee's first paid STR booking is approved
export const REFERRAL_REWARD_CURRENCY = 'USD'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I -- avoids misreads when shared by voice/WhatsApp
const CODE_LENGTH = 8
const MAX_GENERATION_ATTEMPTS = 10

function randomReferralCode() {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)]
  }
  return code
}

// Called once per new user at creation (server/routes/auth.mjs). Collision odds are astronomically
// low (33^8 possibilities) but checked anyway rather than trusted blindly, since a silent collision
// would violate the unique constraint and fail the whole registration.
export async function generateUniqueReferralCode(tx) {
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const code = randomReferralCode()
    const existing = await tx.user.findUnique({ where: { referralCode: code }, select: { id: true } })
    if (!existing) return code
  }
  throw new Error('Could not generate a unique referral code after several attempts.')
}

// Called during registration, after the new user row already exists, when the request supplied a
// referralCode. Silently no-ops on an invalid/unknown/self-referral code rather than failing
// registration outright -- a typo'd or expired-looking code shouldn't block someone from signing
// up at all, it should just mean they don't get the referral bonus.
export async function attachReferralOnRegister(tx, { newUserId, referralCode }) {
  const trimmedCode = String(referralCode || '').trim().toUpperCase()
  if (!trimmedCode) return null

  const referrer = await tx.user.findUnique({ where: { referralCode: trimmedCode }, select: { id: true } })
  if (!referrer || referrer.id === newUserId) return null

  const referral = await tx.referral.create({
    data: { referrerUserId: referrer.id, refereeUserId: newUserId },
  })

  await recordWalletEntry(tx, {
    userId: newUserId,
    type: 'CREDIT',
    amountMinor: REFEREE_SIGNUP_BONUS_MINOR,
    currency: REFERRAL_REWARD_CURRENCY,
    referenceType: 'referral_signup_bonus',
    referenceId: referral.id,
    keyParts: ['referral-signup-bonus', referral.id],
    note: 'Welcome credit for signing up with a referral code.',
  })

  return referral
}

// Called from approvePaymentProof() (finance-ledger.mjs) right after ANY payment is approved --
// an STR booking payment or a seller/dealer/developer plan payment (Marketplace/Cars/New
// Construction/Rentals/Buy). Only rewards the referrer once this is the referee's FIRST ever
// approved payment of any kind -- otherwise a referrer could be paid repeatedly for the same
// referee, or for a referee who never actually generates real revenue (e.g. an account created and
// abandoned). A referee who converts as a paying seller counts exactly the same as one who
// converts as a paying guest -- both are real revenue events.
export async function rewardReferralIfQualifying(tx, { guestUserId, qualifyingReferenceId }) {
  const referral = await tx.referral.findUnique({ where: { refereeUserId: guestUserId } })
  if (!referral || referral.status !== 'PENDING') return null

  const approvedPaymentCount = await tx.paymentProof.count({
    where: { userId: guestUserId, status: 'APPROVED' },
  })
  if (approvedPaymentCount !== 1) return null // not this guest's first approved payment

  const claimResult = await tx.referral.updateMany({
    where: { id: referral.id, status: 'PENDING' },
    data: { status: 'REWARDED', qualifyingBookingId: qualifyingReferenceId, rewardedAt: new Date() },
  })
  if (claimResult.count === 0) return null // already rewarded by a concurrent approval

  await recordWalletEntry(tx, {
    userId: referral.referrerUserId,
    type: 'CREDIT',
    amountMinor: REFERRER_REWARD_MINOR,
    currency: REFERRAL_REWARD_CURRENCY,
    referenceType: 'referral_referrer_reward',
    referenceId: referral.id,
    keyParts: ['referral-referrer-reward', referral.id],
    note: 'Referral reward: the referred user completed their first paid booking.',
  })

  return referral
}
