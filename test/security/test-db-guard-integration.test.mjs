import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Exercises the *actual wiring* in server/lib/prisma.mjs's db() — not just the pure guard
// function (see test/unit/test-db-guard.test.mjs for that). This file must never successfully
// call db() against a real database, so it never gets a chance to construct a real PrismaClient;
// each assertion below is expected to throw before any connection is attempted. Deliberately its
// own file (Vitest isolates module state per test file by default) so prisma.mjs's
// module-level `prisma` singleton always starts undefined here, regardless of what other test
// files have already done.
describe('db() refuses to construct a PrismaClient on an unsafe configuration', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env.NODE_ENV = 'test'
    // Force a fresh module graph on the next import so prisma.mjs's module-level `prisma`
    // singleton starts undefined for every test in this file, not just the first.
    vi.resetModules()
  })

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key]
    }
    Object.assign(process.env, originalEnv)
  })

  it('throws TEST_DB_GUARD_FAILED when DATABASE_URL points at a database not ending in "_test"', async () => {
    process.env.DATABASE_URL = 'postgresql://intentionally:unsafe@127.0.0.1:5432/sybnb_v6'
    const { db } = await import('../../server/lib/prisma.mjs')
    expect(() => db()).toThrow(expect.objectContaining({ code: 'TEST_DB_GUARD_FAILED' }))
  })

  it('throws TEST_DB_GUARD_FAILED when NODE_ENV is test but the host is not loopback', async () => {
    process.env.DATABASE_URL = 'postgresql://intentionally:unsafe@evil.example.com:5432/sybnb_v6_test'
    const { db } = await import('../../server/lib/prisma.mjs')
    expect(() => db()).toThrow(expect.objectContaining({ code: 'TEST_DB_GUARD_FAILED' }))
  })

  it('throws TEST_DB_GUARD_FAILED when DATABASE_URL is entirely missing', async () => {
    delete process.env.DATABASE_URL
    const { db } = await import('../../server/lib/prisma.mjs')
    expect(() => db()).toThrow(expect.objectContaining({ code: 'TEST_DB_GUARD_FAILED' }))
  })

  it('the thrown error never contains the attempted DATABASE_URL value', async () => {
    const unsafeUrl = 'postgresql://intentionally:unsafe-marker-xyz@127.0.0.1:5432/sybnb_v6'
    process.env.DATABASE_URL = unsafeUrl
    const { db } = await import('../../server/lib/prisma.mjs')
    let caught
    try {
      db()
    } catch (error) {
      caught = error
    }
    expect(caught).toBeDefined()
    expect(caught.message).not.toContain('unsafe-marker-xyz')
    expect(caught.message).not.toContain(unsafeUrl)
  })
})
