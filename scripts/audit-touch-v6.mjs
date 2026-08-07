// Audit connectivity check: confirms the admin audit log table is reachable and
// countable (validates DB wiring + the AdminAuditLog model). Read-only.
import { loadEnv } from '../server/lib/env.mjs'
import { db, disconnectDb } from '../server/lib/prisma.mjs'

loadEnv()

try {
  const count = await db().adminAuditLog.count()
  console.log(`audit:touch PASS — admin_audit_logs reachable (${count} rows)`)
} catch (error) {
  console.error(`audit:touch FAIL — ${error.message}`)
  process.exitCode = 1
} finally {
  await disconnectDb()
}
