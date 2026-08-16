// SYBNB — OTP retention job (run by cron/owner; NOT on the request hot path).
// Deletes verification codes that expired more than RETAIN_HOURS ago, so verification_codes does not
// grow unbounded at scale. Bounded by data age; safe to run repeatedly. Never touches PENDING codes
// inside the retention window. Requires DATABASE_URL. Prints a JSON summary (no PII).
//
//   DATABASE_URL=... node scripts/prune-expired-otps.mjs
import { PrismaClient } from '@prisma/client'

const RETAIN_HOURS = Number(process.env.OTP_RETAIN_HOURS || 24)
const cutoff = new Date(Date.now() - RETAIN_HOURS * 3600 * 1000)

const prisma = new PrismaClient()
try {
  const { count } = await prisma.verificationCode.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  })
  console.log(JSON.stringify({ ok: true, job: 'prune-expired-otps', retainHours: RETAIN_HOURS, deleted: count }))
} catch (error) {
  console.error(JSON.stringify({ ok: false, job: 'prune-expired-otps', error: error instanceof Error ? error.message : String(error) }))
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
