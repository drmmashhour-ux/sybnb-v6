// STEP 5I -- LEGACY ROW ATTRIBUTION (audit + security rows ONLY). PREPARED, NOT RUN. Read docs/admin/STEP5I_LEGACY_ATTRIBUTION_RUNBOOK.md first.
//
// Migration 083 left every pre-existing admin_audit_logs / security_events row with organization_id NULL = UNATTRIBUTED = invisible to
// every organization-scoped admin. This script attributes those rows to ONE organization, and only in a deployment where it can be PROVEN
// that exactly one organization existed for the whole historical period. It never touches authorization_evidence: that table is
// append-only and hash-chained, its legacy rows can never be changed, and they stay unattributed forever (see the runbook).
//
//   DRY RUN (default; changes nothing, writes a report):
//     DATABASE_URL=... node scripts/admin-attribute-legacy-records.mjs --organization-id=<uuid>
//   APPLY (all three are required):
//     DATABASE_URL=... node scripts/admin-attribute-legacy-records.mjs --organization-id=<uuid> --apply \
//         --confirm-single-organization-history=<the same uuid> --proof-ref=<change ticket / sign-off id>
//   More than one organization exists (or ever existed): REFUSED, unless a reviewer signs the special override
//         --allow-multiple-organizations-reviewed=<reviewer name or id>   (and --proof-ref); the proof must show the rows really belong to ONE organization.
//   Options: --report=<path> (default ./legacy-attribution-report-<timestamp>.json), --batch=<n> (default 1000)
//
// Idempotent: only rows with organization_id IS NULL are ever updated, and the database guard makes organization_id write-once, so a second
// run changes nothing. Exit codes: 0 ok, 1 error, 2 refused.
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const TABLES = Object.freeze({ audit: 'admin_audit_logs', security: 'security_events' })
export const NEVER_TOUCHED = Object.freeze(['authorization_evidence'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseArgs(argv) {
  const out = { apply: false, tables: Object.keys(TABLES), batch: 1000 }
  for (const a of argv) {
    if (a === '--apply') out.apply = true
    else if (a.startsWith('--organization-id=')) out.organizationId = a.slice(18)
    else if (a.startsWith('--confirm-single-organization-history=')) out.confirm = a.slice(38)
    else if (a.startsWith('--proof-ref=')) out.proofRef = a.slice(12)
    else if (a.startsWith('--allow-multiple-organizations-reviewed=')) out.override = a.slice(40)
    else if (a.startsWith('--report=')) out.report = a.slice(9)
    else if (a.startsWith('--batch=')) out.batch = Number(a.slice(8))
    else if (a.startsWith('--tables=')) out.tables = a.slice(9).split(',').map((s) => s.trim()).filter(Boolean)
    else out.unknown = [...(out.unknown ?? []), a]
  }
  return out
}

const refuse = (reason) => ({ status: 'REFUSED', reason })

/**
 * io = { organizationCount(), organizationExists(id), countNull(table), nullIds(table, limit), attribute(table, ids, organizationId) -> ids actually updated,
 *        writeReport(report), now() }. Pure orchestration, so it is unit-tested with a fake; the CLI below supplies the Prisma-backed io.
 */
export async function runAttribution(args, io) {
  const report = { script: 'admin-attribute-legacy-records', mode: args.apply ? 'APPLY' : 'DRY_RUN', startedAt: io.now().toISOString(), organizationId: args.organizationId ?? null, proofRef: args.proofRef ?? null, neverTouched: [...NEVER_TOUCHED], tables: {} }
  const finish = async (result) => { Object.assign(report, result, { finishedAt: io.now().toISOString() }); await io.writeReport(report); return report }

  if (args.unknown?.length) return finish(refuse(`unknown argument(s): ${args.unknown.join(' ')}`))
  for (const t of args.tables) {
    if (NEVER_TOUCHED.includes(t) || /evidence/i.test(t)) return finish(refuse('authorization_evidence is never attributed: it is append-only and hash-chained'))
    if (!TABLES[t]) return finish(refuse(`unknown table selector "${t}" (allowed: ${Object.keys(TABLES).join(', ')})`))
  }
  if (!args.organizationId || !UUID.test(args.organizationId)) return finish(refuse('--organization-id=<uuid> is required (the script never chooses an organization)'))
  if (!(await io.organizationExists(args.organizationId))) return finish(refuse('that organization does not exist'))

  const orgCount = await io.organizationCount()
  report.organizationCount = orgCount
  if (orgCount > 1) {
    if (!args.override || !args.proofRef) return finish(refuse(`${orgCount} organizations exist: attribution to one of them cannot be assumed correct. A reviewed override (--allow-multiple-organizations-reviewed=<reviewer> and --proof-ref) is required.`))
    report.reviewedOverride = args.override
  }

  for (const t of args.tables) report.tables[TABLES[t]] = { unattributedBefore: await io.countNull(TABLES[t]), attributed: 0, ids: [], truncated: false }

  if (!args.apply) return finish({ status: 'DRY_RUN', note: 'Nothing was changed. Re-run with --apply, --confirm-single-organization-history and --proof-ref after the runbook sign-off.' })

  if (args.confirm !== args.organizationId) return finish(refuse('--confirm-single-organization-history=<the same organization id> is required to apply'))
  if (!args.proofRef) return finish(refuse('--proof-ref=<change ticket / sign-off id> is required to apply: the single-organization history must be proven'))
  const batch = Number.isInteger(args.batch) && args.batch > 0 && args.batch <= 10_000 ? args.batch : 1000
  const MAX_IDS = 200_000
  for (const t of args.tables) {
    const table = TABLES[t]; const entry = report.tables[table]
    for (;;) {
      const ids = await io.nullIds(table, batch)
      if (!ids.length) break
      const done = await io.attribute(table, ids, args.organizationId)
      entry.attributed += done.length
      for (const id of done) { if (entry.ids.length < MAX_IDS) entry.ids.push(id); else entry.truncated = true }
      if (done.length === 0) break // nothing could be updated (guard or concurrent run): stop rather than loop
    }
    entry.unattributedAfter = await io.countNull(table)
  }
  return finish({ status: 'APPLIED' })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const { PrismaClient } = await import('@prisma/client')
  const db = new PrismaClient()
  const reportPath = args.report ?? `./legacy-attribution-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  const io = {
    now: () => new Date(),
    organizationCount: () => db.organization.count(),
    organizationExists: async (id) => Boolean(await db.organization.findUnique({ where: { id }, select: { id: true } })),
    countNull: async (table) => Number((await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${table}" WHERE organization_id IS NULL`))[0].n),
    nullIds: async (table, limit) => (await db.$queryRawUnsafe(`SELECT id::text AS id FROM "${table}" WHERE organization_id IS NULL ORDER BY created_at, id LIMIT ${Number(limit)}`)).map((r) => r.id),
    attribute: async (table, ids, organizationId) => (await db.$queryRawUnsafe(`UPDATE "${table}" SET organization_id = $1::uuid WHERE organization_id IS NULL AND id = ANY($2::uuid[]) RETURNING id::text AS id`, organizationId, ids)).map((r) => r.id),
    writeReport: (report) => writeFileSync(reportPath, JSON.stringify(report, null, 2)),
  }
  try {
    const report = await runAttribution(args, io)
    console.log(JSON.stringify({ event: 'legacy_attribution', status: report.status, mode: report.mode, reason: report.reason, report: reportPath, tables: Object.fromEntries(Object.entries(report.tables).map(([k, v]) => [k, { before: v.unattributedBefore, attributed: v.attributed, after: v.unattributedAfter }])) }))
    process.exitCode = report.status === 'REFUSED' ? 2 : 0
  } catch (e) {
    console.error(`legacy attribution failed: ${e.message}`)
    process.exitCode = 1
  } finally {
    await db.$disconnect()
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
