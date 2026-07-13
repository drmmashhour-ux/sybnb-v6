import { defineConfig, devices } from '@playwright/test'

const API_PORT = 3061
const FRONTEND_PORT = 5190

// Deterministic, headless-capable, repository-owned browser smoke coverage — no Claude-specific
// preview dependency, no real external API calls. Both servers below start fresh, backed by the
// isolated .env.test database (never the development database): server/index.mjs is spawned with
// Node's native --env-file, which errors out immediately if .env.test doesn't exist rather than
// silently falling back to .env — same fail-closed principle as scripts/require-test-env.mjs.
export default defineConfig({
  testDir: './test/browser',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${FRONTEND_PORT}`,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  webServer: [
    {
      command: `node --env-file=.env.test server/index.mjs`,
      port: API_PORT,
      reuseExistingServer: false,
      env: { API_PORT: String(API_PORT), API_HOST: '127.0.0.1' },
      timeout: 30_000,
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${FRONTEND_PORT}`,
      port: FRONTEND_PORT,
      reuseExistingServer: false,
      env: { VITE_API_BASE_URL: `http://127.0.0.1:${API_PORT}` },
      timeout: 30_000,
    },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Playwright's bundled WebKit engine — reported here as "webkit", never as "Safari". This is
    // not equivalent to testing real Safari (different build, no Apple-specific integrations);
    // see docs/testing/SYBNB_V6_TEST_DATABASE_SETUP.md for that caveat spelled out for reviewers.
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
})
