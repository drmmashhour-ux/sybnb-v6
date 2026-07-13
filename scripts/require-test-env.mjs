// Loaded first (before server/index.mjs) by every command that runs tests or smoke checks
// against the database: Vitest's api/security setup, and both smoke scripts. Loads .env.test
// into process.env — never falls back to plain .env, and fails loudly with a clear message
// instead of silently proceeding if .env.test doesn't exist yet.
//
// Import side effect only: `import '../scripts/require-test-env.mjs'` at the very top of a file,
// before anything else (including server/index.mjs) has a chance to call loadEnv('.env') and
// populate process.env.DATABASE_URL from the wrong file first.
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const path = resolve(process.cwd(), '.env.test')

if (!existsSync(path)) {
  console.error(
    '\n[test-env] .env.test not found.\n' +
      '[test-env] Database-backed tests and smoke checks require an isolated local test\n' +
      '[test-env] database — this project never falls back to the development .env for them.\n' +
      '[test-env] See docs/testing/SYBNB_V6_TEST_DATABASE_SETUP.md to create one, then copy\n' +
      '[test-env] .env.test.example to .env.test and fill in your local test-role credentials.\n',
  )
  process.exit(1)
}

process.loadEnvFile(path)

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test'
}
