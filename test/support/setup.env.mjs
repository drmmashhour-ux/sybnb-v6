// Runs before every other setup file and before any test file is imported for the database-
// backed Vitest config (vitest.config.ts, covering test/api and test/security). Loads .env.test
// — never .env — and fails loudly if it's missing, rather than silently letting
// server/index.mjs's own loadEnv('.env') populate DATABASE_URL from the development environment.
import '../../scripts/require-test-env.mjs'

// Then reset the isolated test database to a blank slate before this run's first test. Combined
// with test/support/testServer.mjs's unique-per-run id generation, this makes two consecutive
// full suite runs produce identical results — not just "no collisions" but "provably starting
// from the same empty state" — which is what proves repeatability rather than merely hoping for
// it. resetTestDatabase() re-validates the safety guard itself; this is not this file's only
// protection.
import { resetTestDatabase } from './resetTestDatabase.mjs'

await resetTestDatabase()
