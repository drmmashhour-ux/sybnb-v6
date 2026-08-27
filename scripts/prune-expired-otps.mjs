// SYBNB — OTP retention job (run by cron/owner; NOT on the request hot path).
// Deletes verification codes that expired more than RETAIN_HOURS ago, so verification_codes does not
// grow unbounded at scale. Bounded by data age; safe to run repeatedly. Never touches PENDING codes
// inside the retention window. Requires DATABASE_URL. Prints a JSON summary (no PII).
//
//   DATABASE_URL=... node scripts/prune-expired-otps.mjs
//
// Also runs automatically inside the API process every OTP_PRUNE_INTERVAL_HOURS (default 24) --
// see server/index.mjs -- so this script is a manual/cron-triggered escape hatch, not the only
// way this job runs. Shares its deletion logic with that in-process scheduler via
// server/lib/otp-retention.mjs so both paths do exactly the same thing.
import { pruneExpiredOtps } from '../server/lib/otp-retention.mjs'
import { disconnectDb } from '../server/lib/prisma.mjs'

try {
  const result = await pruneExpiredOtps()
  console.log(JSON.stringify({ ok: true, job: 'prune-expired-otps', ...result }))
} catch (error) {
  console.error(JSON.stringify({ ok: false, job: 'prune-expired-otps', error: error instanceof Error ? error.message : String(error) }))
  process.exitCode = 1
} finally {
  await disconnectDb()
}
