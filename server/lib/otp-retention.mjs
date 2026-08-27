import { db } from './prisma.mjs'

// Shared by the standalone cron script (scripts/prune-expired-otps.mjs) and the in-process
// scheduler in index.mjs, so both run the exact same deletion logic.
const RETAIN_HOURS = Number(process.env.OTP_RETAIN_HOURS || 24)

export async function pruneExpiredOtps() {
  const cutoff = new Date(Date.now() - RETAIN_HOURS * 3600 * 1000)
  const { count } = await db().verificationCode.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  })
  return { retainHours: RETAIN_HOURS, deleted: count }
}
