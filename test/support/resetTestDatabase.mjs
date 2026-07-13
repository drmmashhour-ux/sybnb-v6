// Destructive full-database reset — TRUNCATEs every table in the current connection's database.
// Available only in test mode: re-validates the safety guard on every call (independently of
// server/lib/prisma.mjs's own one-time check on first connection), because this is the single
// most dangerous operation in the whole test suite and must never rely on "a safe connection was
// opened once earlier" as its only protection.
import { db } from '../../server/lib/prisma.mjs'
import { assertTestDatabaseSafe } from '../../server/lib/test-db-guard.mjs'

export async function resetTestDatabase() {
  assertTestDatabaseSafe()

  const client = db()
  // Scoped to tables the connecting role actually owns — this naturally excludes PostGIS's own
  // system table (spatial_ref_sys, owned by whichever superuser ran CREATE EXTENSION postgis,
  // never by the dedicated test role) and any future non-application system table, without
  // needing to maintain an explicit exclusion list. The test role can only ever TRUNCATE tables
  // it owns in the first place, so this also means the query never even attempts something
  // Postgres would reject.
  const tables = await client.$queryRaw`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT LIKE '\_prisma\_%'
      AND tableowner = current_user
  `
  if (!tables.length) return

  const identifiers = tables.map((row) => `"public"."${row.tablename}"`).join(', ')
  await client.$executeRawUnsafe(`TRUNCATE TABLE ${identifiers} RESTART IDENTITY CASCADE;`)
}
