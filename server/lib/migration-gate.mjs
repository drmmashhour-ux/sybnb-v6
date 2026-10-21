// STEP 5E -- migration approval gate. Run BEFORE `prisma migrate deploy` (Render preDeployCommand and `npm run
// start:render`). Migrations listed in GATED_MIGRATIONS change security-critical schema permanently, so they are
// applied only when an operator has explicitly approved them for THIS environment:
//     APPROVED_MIGRATIONS=083_security_record_organization_boundary   (the LATEST reviewed migration: approves it and every earlier pending gated one)
// The wording below is derived from GATED_MIGRATIONS, so it cannot go stale when the reviewed chain grows. An approval naming an EARLIER
// migration (for example 082) does not approve a later one (083); a pending migration that is not in GATED_MIGRATIONS blocks the deploy.
// If a gated migration is pending and not approved, the gate prints a banner and exits 1, so the deploy stops
// BEFORE any schema change. When nothing gated is pending (or it is approved) the gate exits 0 and is invisible.
// The gate only reads (_prisma_migrations); it never changes the database. No new infrastructure is involved.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const STEP5 = 'Step 5 admin security foundation (never applied to production). Needs a recovery point, ADMIN_ACTIVATION_MODE decision and the Owner bootstrap runbook (docs/admin/MIGRATION_082_RUNBOOK.md).'
export const GATED_MIGRATIONS = Object.freeze({
  '078_admin_foundation': STEP5,
  '079_admin_modules': STEP5,
  '080_session_mfa_method': STEP5,
  '081_security_reconciliation': STEP5,
  '082_security_foundation_closure': STEP5 + ' 082 adds security_bootstrap, evidence ruleset_version NOT NULL and the organization triggers.',
  '083_security_record_organization_boundary': STEP5 + ' 083 adds a nullable organization_id to admin_audit_logs, security_events and authorization_evidence (legacy rows stay unattributed and invisible to organization-scoped routes) and makes it write-once in the audit/security guards.',
})

/**
 * Approval is "through" (and limited to the reviewed chain: any other pending migration stops the deploy): APPROVED_MIGRATIONS=<latest reviewed migration> (today 083_security_record_organization_boundary) approves it AND every earlier gated
 * migration that is still pending (they are applied together, in order, by one `migrate deploy`).
 */
export function pendingGatedMigrations({ dirNames, appliedNames, approved = '', gated = GATED_MIGRATIONS }) {
  const applied = new Set(appliedNames)
  const approvals = String(approved).split(',').map((s) => s.trim()).filter(Boolean)
  const pending = dirNames.filter((n) => !applied.has(n) && Object.hasOwn(gated, n))
  // Reviewed-chain rule: the approval covers EXACTLY the reviewed chain. If a gated migration is pending, any OTHER
  // pending migration (e.g. a future 084 nobody reviewed here) is "unreviewed" and stops the deploy even when the
  // approval variable is set, so an approval meant for the reviewed chain can never authorize an unrelated migration.
  const unreviewed = pending.length ? dirNames.filter((n) => !applied.has(n) && !Object.hasOwn(gated, n)) : []
  return { pending, blocked: pending.filter((n) => !approvals.some((a) => Object.hasOwn(gated, a) && n <= a)), unreviewed }
}

/** "078-083": the reviewed chain, derived from the gated list (never hand-written). */
export function reviewedChainLabel(gated = GATED_MIGRATIONS) {
  const names = Object.keys(gated).sort()
  const num = (n) => n.split('_')[0]
  return names.length ? `${num(names[0])}-${num(names[names.length - 1])}` : 'none'
}

export function unreviewedBanner(unreviewed, gated = GATED_MIGRATIONS) {
  return ['', '==================== UNREVIEWED MIGRATIONS PENDING ====================',
    `The approval covers only the reviewed Step 5 chain (${reviewedChainLabel(gated)}). These other migrations are also pending:`,
    ...unreviewed.map((n) => `  - ${n}`),
    'Nothing has been changed. Review and add them to GATED_MIGRATIONS (or apply them separately first), then deploy again.',
    '=======================================================================', ''].join('\n')
}

export function bannerFor(blocked, gated = GATED_MIGRATIONS) {
  return [
    '', '==================== MIGRATION APPROVAL REQUIRED ====================',
    'This deploy would apply gated, security-critical migrations (all pending ones are applied together, in order):',
    ...blocked.map((n) => `  - ${n}`), `  (${gated[blocked[blocked.length - 1]]})`,
    '',
    'Deploying this branch to a production-connected service WILL apply it. Nothing has been changed.',
    'Before approving: approved migration, database recovery point/backup, environment verification,',
    'ADMIN_ACTIVATION_MODE decision, Owner bootstrap runbook ready.',
    `To approve for this environment set APPROVED_MIGRATIONS=${blocked[blocked.length - 1]} (approves it and every earlier gated migration) and deploy again.`,
    '=====================================================================', '',
  ].join('\n')
}

export async function runGate({ env = process.env, migrationsDir = join(fileURLToPath(new URL('../../prisma/migrations', import.meta.url))), prismaFactory = null, log = console } = {}) {
  const dirNames = readdirSync(migrationsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
  let prisma
  try {
    prisma = prismaFactory ? prismaFactory() : new (await import('@prisma/client')).PrismaClient()
    const [{ t }] = await prisma.$queryRaw`SELECT to_regclass('_prisma_migrations')::text AS t`
    const appliedNames = t ? (await prisma.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`).map((r) => r.migration_name) : []
    const { pending, blocked, unreviewed } = pendingGatedMigrations({ dirNames, appliedNames, approved: env.APPROVED_MIGRATIONS })
    if (blocked.length) { log.error(bannerFor(blocked)); return { ok: false, pending, blocked, unreviewed } }
    if (unreviewed.length) { log.error(unreviewedBanner(unreviewed)); return { ok: false, pending, blocked, unreviewed } }
    if (pending.length) log.log(`migration gate: approved gated migration(s) will be applied: ${pending.join(', ')}`)
    return { ok: true, pending, blocked }
  } catch (e) {
    log.error(`migration gate: could not read the migration history (${String(e.message || e).split('\n')[0].slice(0, 160)}); refusing to continue.`)
    return { ok: false, error: true, pending: [], blocked: [] }
  } finally { await prisma?.$disconnect?.() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await runGate()
  process.exit(r.ok ? 0 : 1)
}
