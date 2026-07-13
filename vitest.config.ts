import { defineConfig } from 'vitest/config'

// Config for database-backed tests (test/api, test/security) — requires .env.test to exist and
// point at an isolated database (server/lib/test-db-guard.mjs enforces this at the actual
// connection point regardless of what runs this config, but setup.env.mjs fails fast with a
// clear message before even attempting to run a test file). test/unit has its own config
// (vitest.unit.config.ts) that does not require a database at all — see
// docs/testing/SYBNB_V6_TEST_DATABASE_SETUP.md.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    testTimeout: 20000,
    hookTimeout: 20000,
    // Sequential, not parallel workers: API/security/finance tests share the one isolated test
    // database via real HTTP requests against an in-process server instance (see
    // test/support/testServer.mjs). Parallel workers would race on the same DB rows.
    fileParallelism: false,
    include: ['test/api/**/*.test.{ts,mjs}', 'test/security/**/*.test.{ts,mjs}'],
    setupFiles: ['test/support/setup.env.mjs', 'test/support/setup.mjs'],
  },
})
