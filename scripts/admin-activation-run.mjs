// STEP 5B -- run ONE activation cycle for approved high-risk grants and exit. For an external scheduler
// (for example a Render cron job) when the API runs more than one replica or the in-process interval is disabled
// (ADMIN_ACTIVATION_MODE=EXTERNAL; this is the production runner for multi-replica deployments). Safe to run concurrently with the in-process worker and with itself.
//   DATABASE_URL=... node scripts/admin-activation-run.mjs
import { PrismaClient } from '@prisma/client'
import { runActivationCycle } from '../server/lib/authz/activation-worker.mjs'
import { retryFailedDeliveries } from '../server/lib/authz/notifications.mjs'
import { syncClock } from '../server/lib/authz/clock.mjs'

const db = new PrismaClient()
try {
  await syncClock(db)
  const r = await runActivationCycle(db)
  console.log(JSON.stringify({ event: 'activation_cycle', ...r }))
  const d = await retryFailedDeliveries(db)
  console.log(JSON.stringify({ event: 'security_notification_retry', ...d }))
  process.exitCode = r.errors ? 1 : 0
} finally {
  await db.$disconnect()
}
