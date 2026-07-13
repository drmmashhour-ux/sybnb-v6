import { defineConfig } from 'vitest/config'

// Config for pure-function/no-database tests (test/unit). Deliberately has no .env.test
// requirement and no database setup — these tests must be runnable by anyone with just
// `npm ci`, no local Postgres, no test-database bootstrap. If a file under test/unit ever needs
// a real database connection, it belongs in test/api or test/security instead (covered by
// vitest.config.ts, which does require the isolated test database).
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    testTimeout: 20000,
    hookTimeout: 20000,
    // test-db-guard-integration.test.mjs lives under test/security/ (it's a security-critical
    // guard) but, like everything under test/unit, never needs a real database connection — it
    // deliberately manufactures unsafe configs and asserts db() refuses to connect. Included here
    // explicitly so `test:guard` and `test:unit` can both run it without requiring .env.test.
    include: ['test/unit/**/*.test.{ts,mjs}', 'test/security/test-db-guard-integration.test.mjs'],
  },
})
