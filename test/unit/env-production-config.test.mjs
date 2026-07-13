import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { validateProductionConfig } from '../../server/lib/env.mjs'

const REQUIRED_KEYS = ['AUTH_SECRET', 'PHONE_HASH_SECRET', 'DATABASE_URL', 'CORS_ORIGIN', 'DISABLE_RATE_LIMIT']

function setValidBaseline() {
  process.env.AUTH_SECRET = 'a'.repeat(32)
  process.env.PHONE_HASH_SECRET = 'b'.repeat(32)
  process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:5432/placeholder'
  process.env.CORS_ORIGIN = 'https://example.com'
  delete process.env.DISABLE_RATE_LIMIT
}

describe('validateProductionConfig: pre-existing checks still pass with a valid baseline', () => {
  const snapshot = {}

  beforeEach(() => {
    for (const key of [...REQUIRED_KEYS, ...Object.keys(process.env).filter((k) => k.startsWith('RATE_LIMIT_'))]) {
      snapshot[key] = process.env[key]
      delete process.env[key]
    }
    setValidBaseline()
  })

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('RATE_LIMIT_') && !(key in snapshot)) delete process.env[key]
    }
    for (const [key, value] of Object.entries(snapshot)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('does not throw with a fully valid baseline', () => {
    expect(() => validateProductionConfig()).not.toThrow()
  })

  it('throws when AUTH_SECRET is missing', () => {
    delete process.env.AUTH_SECRET
    expect(() => validateProductionConfig()).toThrow(/AUTH_SECRET/)
  })

  it('throws when DISABLE_RATE_LIMIT=1', () => {
    process.env.DISABLE_RATE_LIMIT = '1'
    expect(() => validateProductionConfig()).toThrow(/DISABLE_RATE_LIMIT/)
  })

  describe('new: RATE_LIMIT_* override validation', () => {
    it('does not throw when no RATE_LIMIT_* overrides are set', () => {
      expect(() => validateProductionConfig()).not.toThrow()
    })

    it('does not throw when a RATE_LIMIT_* override is a valid positive integer', () => {
      process.env.RATE_LIMIT_AUTH_LOGIN_MAX = '10'
      expect(() => validateProductionConfig()).not.toThrow()
    })

    it('throws when a RATE_LIMIT_*_MAX override is non-numeric', () => {
      process.env.RATE_LIMIT_AUTH_LOGIN_MAX = 'not-a-number'
      expect(() => validateProductionConfig()).toThrow(/RATE_LIMIT_AUTH_LOGIN_MAX/)
    })

    it('throws when a RATE_LIMIT_*_MAX override is zero', () => {
      process.env.RATE_LIMIT_AUTH_LOGIN_MAX = '0'
      expect(() => validateProductionConfig()).toThrow(/RATE_LIMIT_AUTH_LOGIN_MAX/)
    })

    it('throws when a RATE_LIMIT_*_MAX override is negative', () => {
      process.env.RATE_LIMIT_AUTH_LOGIN_MAX = '-1'
      expect(() => validateProductionConfig()).toThrow(/RATE_LIMIT_AUTH_LOGIN_MAX/)
    })

    it('throws when a RATE_LIMIT_*_WINDOW_MS override is non-integer', () => {
      process.env.RATE_LIMIT_PUBLIC_SEARCH_WINDOW_MS = '60000.5'
      expect(() => validateProductionConfig()).toThrow(/RATE_LIMIT_PUBLIC_SEARCH_WINDOW_MS/)
    })

    it('reports every invalid RATE_LIMIT_* key, not just the first', () => {
      process.env.RATE_LIMIT_AUTH_LOGIN_MAX = 'bad'
      process.env.RATE_LIMIT_AUTH_REGISTER_WINDOW_MS = '-1'
      let caught
      try {
        validateProductionConfig()
      } catch (error) {
        caught = error
      }
      expect(caught).toBeDefined()
      expect(caught.message).toMatch(/RATE_LIMIT_AUTH_LOGIN_MAX/)
      expect(caught.message).toMatch(/RATE_LIMIT_AUTH_REGISTER_WINDOW_MS/)
    })
  })
})
