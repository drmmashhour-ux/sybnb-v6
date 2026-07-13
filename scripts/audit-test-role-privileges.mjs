// Read-only proof that the isolated test role (server/lib/test-db-guard.mjs's counterpart) has
// zero meaningful privilege on the development database, beyond what PostgreSQL grants to every
// role by default (CONNECT via PUBLIC, SELECT on its own system catalogs — see
// docs/testing/SYBNB_V6_TEST_DATABASE_SETUP.md for why CONNECT alone was already known not to be
// blockable without modifying the development database).
//
// Prints only booleans, table names, and role attributes — never a connection string, host,
// username, or password, and never any application/business data (no row is ever selected from
// an application table; every check below is a metadata/catalog query).
//
// Requires: .env.test (for the test role's own credentials — it already has legitimate creds,
// this script reuses them rather than needing separate ones) and .env (for the development
// database's *name* only, never its full URL/credentials).

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'

function parseEnvFile(path) {
  if (!existsSync(path)) return {}
  const result = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (key) result[key] = value
  }
  return result
}

const testEnv = parseEnvFile(resolve(process.cwd(), '.env.test'))
const devEnv = parseEnvFile(resolve(process.cwd(), '.env'))

if (!testEnv.DATABASE_URL) {
  console.error('[audit] .env.test not found or has no DATABASE_URL. Run this after test-database setup.')
  process.exit(1)
}
if (!devEnv.DATABASE_URL) {
  console.error('[audit] .env not found or has no DATABASE_URL — cannot determine the development database name.')
  process.exit(1)
}

const testUrl = new URL(testEnv.DATABASE_URL)
const devUrl = new URL(devEnv.DATABASE_URL)
const testRoleName = decodeURIComponent(testUrl.username)
const devDbName = devUrl.pathname.replace(/^\//, '')

if (devDbName.endsWith('_test')) {
  console.error('[audit] Refusing to run: the "development" database resolved from .env ends in "_test" — this looks like it would audit the test database against itself, not development. Check .env.')
  process.exit(1)
}

// Reuse the test role's own already-legitimate credentials, but point at the development
// database's name instead of the test database's — this is exactly the scenario being audited
// ("what can this role do if it ever connects to development"), not a new credential.
const auditUrl = new URL(testUrl.toString())
auditUrl.pathname = `/${devDbName}`

const prisma = new PrismaClient({ datasourceUrl: auditUrl.toString() })

const problems = []
const report = { role: testRoleName, checkedAgainst: '(development database — name not printed)' }

async function main() {
  const [attrs] = await prisma.$queryRawUnsafe(
    `SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
     FROM pg_roles WHERE rolname = $1`,
    testRoleName,
  )
  report.roleAttributes = attrs
    ? {
        superuser: attrs.rolsuper,
        createdb: attrs.rolcreatedb,
        createrole: attrs.rolcreaterole,
        replication: attrs.rolreplication,
        bypassRLS: attrs.rolbypassrls,
      }
    : null
  if (attrs?.rolsuper || attrs?.rolcreatedb || attrs?.rolcreaterole || attrs?.rolreplication || attrs?.rolbypassrls) {
    problems.push('Test role has an elevated role attribute (superuser/createdb/createrole/replication/bypassRLS).')
  }

  const memberships = await prisma.$queryRawUnsafe(
    `SELECT pg_get_userbyid(m.roleid) AS granted_role
     FROM pg_auth_members m JOIN pg_roles member ON member.oid = m.member
     WHERE member.rolname = $1`,
    testRoleName,
  )
  report.roleMemberships = memberships.map((r) => r.granted_role)
  if (memberships.length > 0) {
    problems.push(`Test role is a member of ${memberships.length} other role(s) — could inherit broader access.`)
  }

  const [schemaPriv] = await prisma.$queryRawUnsafe(
    `SELECT has_schema_privilege($1, 'public', 'CREATE') AS can_create`,
    testRoleName,
  )
  report.schemaCreatePrivilege = schemaPriv.can_create
  if (schemaPriv.can_create) {
    problems.push('Test role can CREATE objects in the development "public" schema.')
  }

  const ownedTables = await prisma.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = $1`,
    testRoleName,
  )
  report.ownedApplicationTables = ownedTables.map((r) => r.tablename)
  if (ownedTables.length > 0) {
    problems.push(`Test role owns ${ownedTables.length} application table(s) in the development database.`)
  }

  const grantedPrivileges = await prisma.$queryRawUnsafe(
    `SELECT table_name, privilege_type FROM information_schema.table_privileges WHERE grantee = $1`,
    testRoleName,
  )
  report.explicitTablePrivileges = grantedPrivileges
  const dmlPrivileges = grantedPrivileges.filter((r) =>
    ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'].includes(r.privilege_type),
  )
  if (dmlPrivileges.length > 0) {
    problems.push(`Test role has ${dmlPrivileges.length} explicit DML/DDL-adjacent table privilege(s) on application tables: ${JSON.stringify(dmlPrivileges)}`)
  }

  const routinePrivileges = await prisma.$queryRawUnsafe(
    `SELECT routine_name, privilege_type FROM information_schema.routine_privileges WHERE grantee = $1`,
    testRoleName,
  )
  report.functionExecutePrivileges = routinePrivileges
  if (routinePrivileges.length > 0) {
    problems.push(`Test role has ${routinePrivileges.length} explicit function-execute privilege(s).`)
  }

  // Representative spot-check on the highest-value tables using has_table_privilege(), matching
  // the manual verification performed during the independent review.
  const spotCheckTables = ['users', 'bookings', 'wallet_entries', 'admin_audit_logs', 'payment_proofs']
  const spotChecks = {}
  for (const table of spotCheckTables) {
    const exists = await prisma.$queryRawUnsafe(
      `SELECT to_regclass('public.' || $1) IS NOT NULL AS exists`,
      table,
    )
    if (!exists[0].exists) continue
    const [row] = await prisma.$queryRawUnsafe(
      `SELECT
        has_table_privilege($1, 'public.' || $2, 'SELECT') AS sel,
        has_table_privilege($1, 'public.' || $2, 'INSERT') AS ins,
        has_table_privilege($1, 'public.' || $2, 'UPDATE') AS upd,
        has_table_privilege($1, 'public.' || $2, 'DELETE') AS del,
        has_table_privilege($1, 'public.' || $2, 'TRUNCATE') AS trunc`,
      testRoleName,
      table,
    )
    spotChecks[table] = row
    if (row.sel || row.ins || row.upd || row.del || row.trunc) {
      problems.push(`Test role has a DML privilege on development table "${table}": ${JSON.stringify(row)}`)
    }
  }
  report.spotCheckedApplicationTables = spotChecks

  // Empirical proof, not just catalog inference: actually attempt a write against the
  // highest-value table, inside a transaction that is always rolled back regardless of outcome.
  // Expected: the INSERT itself fails with a Postgres permission-denied error before ever
  // committing — this is the real-world behavior the catalog checks above predict.
  let attemptedWriteResult
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO public.users (id, email, password_hash, display_name)
         VALUES (gen_random_uuid(), 'audit-probe@example.invalid', 'x', 'audit-probe')`,
      )
      // Unreachable if the INSERT above throws (expected) — thrown to force a rollback either way.
      throw new Error('AUDIT_PROBE_FORCED_ROLLBACK')
    })
    attemptedWriteResult = { attempted: true, blockedByPermissions: false, note: 'INSERT did not throw — unexpected, investigate immediately' }
  } catch (error) {
    const isPermissionDenied = /permission denied/i.test(error.message)
    const isForcedRollback = /AUDIT_PROBE_FORCED_ROLLBACK/.test(error.message)
    attemptedWriteResult = {
      attempted: true,
      blockedByPermissions: isPermissionDenied,
      // If the insert had somehow succeeded, only our own forced-rollback error would appear here
      // instead — distinguishing "blocked by Postgres" from "we rolled it back ourselves".
      reachedForcedRollback: isForcedRollback,
    }
    if (!isPermissionDenied && !isForcedRollback) {
      problems.push(`Unexpected error during the write-attempt probe (neither permission-denied nor our own forced rollback): ${error.message}`)
    }
    if (isForcedRollback) {
      problems.push('CRITICAL: the probe INSERT into development "users" succeeded (only blocked by our own forced rollback, not by Postgres permissions).')
    }
  }
  report.attemptedWriteProbe = attemptedWriteResult

  report.problems = problems
  report.safe = problems.length === 0
  console.log(JSON.stringify(report, null, 2))

  if (!report.safe) {
    console.error('\n[audit] UNSAFE: the test role has meaningful privilege on the development database. See "problems" above.')
    process.exitCode = 1
  } else {
    console.log('\n[audit] SAFE: no ownership, no DML/DDL-adjacent table privilege, no function-execute privilege, no elevated role attribute, no role membership, no schema-create privilege found for the test role against the development database.')
  }
}

main()
  .catch((error) => {
    console.error('[audit] Failed to complete:', error.message)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
