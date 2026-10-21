import test from 'node:test'
import assert from 'node:assert/strict'
import { validateEnv } from '../../server/lib/env.mjs'

const base = { AUTH_SECRET: 'a'.repeat(40), PHONE_HASH_SECRET: 'b'.repeat(40), DATABASE_URL: 'postgresql://x', SYBNB_COUNTRY: 'syria', NODE_ENV: 'production', CORS_ORIGIN: 'https://rides.rezekme.com', STORAGE_PROVIDER: 's3', STORAGE_S3_BUCKET: 'b', STORAGE_S3_REGION: 'r', EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'k', EMAIL_FROM: 'a@b.c' }

test('rezekme production refuses to start without prepay (no cash rides)', () => {
  const p = validateEnv({ ...base, PLATFORM_BRAND: 'rezekme' })
  assert.ok(p.some((x) => x.includes('SR_REQUIRE_PREPAY')))
  assert.ok(!validateEnv({ ...base, PLATFORM_BRAND: 'rezekme', SR_REQUIRE_PREPAY: '1' }).some((x) => x.includes('SR_REQUIRE_PREPAY')))
})
test('other platforms are not forced to prepay', () => {
  assert.ok(!validateEnv(base).some((x) => x.includes('SR_REQUIRE_PREPAY')))
})
test('brevo provider needs its key and sender in production', () => {
  assert.ok(validateEnv({ ...base, BREVO_API_KEY: '' }).some((x) => x.includes('BREVO_API_KEY')))
  assert.ok(!validateEnv(base).some((x) => x.includes('BREVO')))
})
