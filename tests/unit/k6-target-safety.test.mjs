// The k6 load-test scripts must refuse production and anything not explicitly declared as staging/local.
import test from 'node:test'
import assert from 'node:assert/strict'
import { targetRefusal } from '../../loadtest/k6/lib/target-rules.js'
import { loadTestFlagEnabled, liveStripeKeyConfigured } from '../../server/lib/loadtest-target.mjs'

const staging = { LOADTEST_ENV: 'staging', STAGING_CONFIRM: 'staging-only-no-real-payments', METRICS_TOKEN: 'x'.repeat(20) }

test('production hosts are refused in every mode', () => {
  for (const url of ['https://rides.rezekme.com', 'https://rezekme-api.onrender.com', 'https://api.rezekme.com/', 'https://sybnb.app', 'https://admin.rezekme.com']) {
    assert.match(targetRefusal({ ...staging, BASE_URL: url }), /production/, url)
    assert.match(targetRefusal({ LOADTEST_ENV: 'local', BASE_URL: url }), /production|local/, url)
  }
})

test('staging needs https, "staging" in the host, the confirmation and a metrics token', () => {
  assert.equal(targetRefusal({ ...staging, BASE_URL: 'https://rezekme-api-staging.onrender.com' }), null)
  assert.equal(targetRefusal({ ...staging, BASE_URL: 'https://staging-api.rezekme.com' }), null)
  assert.match(targetRefusal({ ...staging, BASE_URL: 'http://rezekme-api-staging.onrender.com' }), /https/)
  assert.match(targetRefusal({ ...staging, BASE_URL: 'https://rezekme-api-2.onrender.com' }), /staging/)
  assert.match(targetRefusal({ ...staging, BASE_URL: 'https://api.staging-x.rezekme.com' }), /production domain/)
  assert.match(targetRefusal({ ...staging, STAGING_CONFIRM: '', BASE_URL: 'https://rezekme-api-staging.onrender.com' }), /STAGING_CONFIRM/)
  assert.match(targetRefusal({ ...staging, METRICS_TOKEN: '', BASE_URL: 'https://rezekme-api-staging.onrender.com' }), /METRICS_TOKEN/)
  assert.match(targetRefusal({ ...staging, BASE_URL: 'https://rezekme-api-staging.onrender.com', EXTRA_PRODUCTION_HOSTS: 'rezekme-api-staging.onrender.com' }), /production/)
})

test('local mode only targets localhost; a missing mode or URL is refused', () => {
  assert.equal(targetRefusal({ LOADTEST_ENV: 'local', BASE_URL: 'http://127.0.0.1:3061' }), null)
  assert.match(targetRefusal({ LOADTEST_ENV: 'local', BASE_URL: 'https://rezekme-api-staging.onrender.com' }), /local/)
  assert.match(targetRefusal({ BASE_URL: 'http://127.0.0.1:3061' }), /LOADTEST_ENV/)
  assert.match(targetRefusal({ LOADTEST_ENV: 'staging' }), /BASE_URL/)
  assert.match(targetRefusal({ ...staging, BASE_URL: 'https://rezekme-api-staging.onrender.com/api' }), /origin/)
})

test('the API only advertises itself as a load-test target with the flag and no live Stripe key', () => {
  assert.equal(loadTestFlagEnabled({}), false)
  assert.equal(loadTestFlagEnabled({ LOADTEST_TARGET_ENABLED: '1' }), true)
  assert.equal(loadTestFlagEnabled({ LOADTEST_TARGET_ENABLED: '1', STRIPE_SECRET_KEY: 'sk_live_abc' }), false)
  assert.equal(loadTestFlagEnabled({ LOADTEST_TARGET_ENABLED: '1', STRIPE_SECRET_KEY: 'sk_test_abc' }), true)
  assert.equal(liveStripeKeyConfigured({ STRIPE_RESTRICTED_KEY: 'rk_live_x' }), true)
})
