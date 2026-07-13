// Global Vitest setup: raises the login/register rate limits for the whole run so functional
// tests that legitimately call these endpoints several times (register + login + duplicate +
// invalid-field variants across multiple files) don't trip F-08's limiter as a side effect.
// Rate-limit enforcement itself is exercised deliberately, with its own narrow per-test
// overrides, in test/security/rate-limit-http.test.mjs and test/unit/rate-limit.test.mjs.
process.env.RATE_LIMIT_AUTH_LOGIN_MAX = '1000'
process.env.RATE_LIMIT_AUTH_REGISTER_MAX = '1000'
// GUEST registration now requires a verified email code (server/lib/email-verification.mjs) —
// every functional test that registers a GUEST fixture calls the real send+verify endpoints
// (test/support/testServer.mjs's verifyEmailForTest), so these need the same generous ceiling.
process.env.RATE_LIMIT_AUTH_EMAIL_CODE_SEND_MAX = '1000'
process.env.RATE_LIMIT_AUTH_EMAIL_CODE_VERIFY_MAX = '1000'
