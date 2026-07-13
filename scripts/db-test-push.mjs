// Syncs the isolated test database's schema from prisma/schema.prisma. Loads .env.test (never
// .env — see require-test-env.mjs) and re-validates the safety guard before touching anything.
//
// Deliberately does NOT pass --accept-data-loss automatically: if a future schema change needs
// it, prisma will print the same warning this project's own setup hit once (see
// docs/testing/SYBNB_V6_TEST_DATABASE_SETUP.md), and a human must re-run the command by hand with
// that flag explicitly typed — this script never makes that decision unattended.
import { spawnSync } from 'node:child_process'
import './require-test-env.mjs'
import { assertTestDatabaseSafe } from '../server/lib/test-db-guard.mjs'

assertTestDatabaseSafe()

const result = spawnSync('npx', ['prisma', 'db', 'push', '--skip-generate'], {
  stdio: 'inherit',
  env: process.env,
})

process.exit(result.status ?? 1)
