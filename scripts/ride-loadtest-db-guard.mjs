// Database guard shared by the Rides load-test seed / verify / cleanup scripts.
//
// A LOCAL database (127.0.0.1 / localhost) is always allowed.
// A REMOTE database (e.g. a Neon staging branch) is allowed only when ALL of these hold:
//   - LOADTEST_REMOTE_DB_CONFIRM=staging-branch-only is set in the shell running the script;
//   - the database contains the table `loadtest_target_marker` (created by hand on the staging
//     branch only, see loadtest/k6/README.md; production never has it);
//   - the host is not listed in PRODUCTION_DATABASE_HOSTS (comma-separated, optional extra denylist).
// Anything else exits with code 2 before a single row is written.
import { databaseHasLoadTestMarker } from '../server/lib/loadtest-target.mjs'

export function isLocalDatabaseUrl(raw) {
  try {
    const host = new URL(raw).hostname
    return host === '127.0.0.1' || host === 'localhost' || host === '::1'
  } catch {
    return false
  }
}

export async function assertLoadTestDatabase(prisma, { script = 'ride-loadtest', env = process.env } = {}) {
  const raw = String(env.DATABASE_URL || '')
  const refuse = (why) => {
    console.error(`refusing (${script}): ${why}`)
    process.exit(2)
  }
  if (!raw) refuse('DATABASE_URL is not set')
  if (isLocalDatabaseUrl(raw)) return { local: true }
  let host = ''
  try { host = new URL(raw).hostname } catch { refuse('DATABASE_URL is not a valid URL') }
  const denied = String(env.PRODUCTION_DATABASE_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (denied.includes(host)) refuse(`database host ${host} is listed in PRODUCTION_DATABASE_HOSTS`)
  if (env.LOADTEST_REMOTE_DB_CONFIRM !== 'staging-branch-only') refuse('remote database: set LOADTEST_REMOTE_DB_CONFIRM=staging-branch-only to confirm this is a staging branch')
  let marked = false
  try { marked = await databaseHasLoadTestMarker(prisma) } catch (e) { refuse(`could not check the staging marker (${e?.code || 'error'})`) }
  if (!marked) refuse('remote database has no loadtest_target_marker table, so it is not a marked staging branch')
  return { local: false, host }
}
