// STEP 5B -- run ONE activation cycle for approved high-risk grants and exit. For an external scheduler
// (for example a Render cron job) when the API runs more than one replica or the in-process interval is disabled
// (ADMIN_ACTIVATION_JOB=off). Safe to run concurrently with the in-process worker and with itself.
//   DATABASE_URL=... node scripts/admin-activation-run.mjs
import { PrismaClient } from '@prisma/client'
import { runActivationCycle } from '../server/lib/authz/activation-worker.mjs'

const db = new PrismaClient()
try {
  const r = await runActivationCycle(db)
  console.log(JSON.stringify({ event: 'activation_cycle', ...r }))
  process.exitCode = r.errors ? 1 : 0
} finally {
  await db.$disconnect()
}
