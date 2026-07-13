import { describe, expect, it } from 'vitest'
import { assertTestDatabaseSafe, checkTestDatabaseSafety } from '../../server/lib/test-db-guard.mjs'

const SAFE_TEST_URL = 'postgresql://sybnb_v6_test_role:secret@127.0.0.1:5432/sybnb_v6_test'
const DEV_URL = 'postgresql://sybnb:secret@127.0.0.1:5432/sybnb_v6'

function safeOptions(overrides = {}) {
  return {
    nodeEnv: 'test',
    testUrl: SAFE_TEST_URL,
    devEnvUrl: DEV_URL,
    ...overrides,
  }
}

describe('checkTestDatabaseSafety: happy path', () => {
  it('passes when every condition is satisfied', () => {
    const result = checkTestDatabaseSafety(safeOptions())
    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
  })
})

describe('checkTestDatabaseSafety: each required condition, tested independently', () => {
  it('fails when NODE_ENV is not exactly "test"', () => {
    // Note: `undefined` is deliberately not included here — checkTestDatabaseSafety() falls back
    // to the ambient process.env.NODE_ENV via `??` when no explicit value is passed, which is the
    // correct real-usage behavior, but makes `undefined` ambiguous in a test runner that itself
    // sets NODE_ENV=test. The "nothing set at all" case is covered by construction: any caller
    // that never sets NODE_ENV=test anywhere fails this same check in real usage.
    for (const nodeEnv of ['development', 'production', 'Test', 'TEST', '']) {
      const result = checkTestDatabaseSafety(safeOptions({ nodeEnv }))
      expect(result.ok).toBe(false)
      expect(result.problems.join(' ')).toMatch(/NODE_ENV/)
    }
  })

  it('fails when DATABASE_URL is missing', () => {
    const result = checkTestDatabaseSafety(safeOptions({ testUrl: undefined }))
    expect(result.ok).toBe(false)
    expect(result.problems.join(' ')).toMatch(/not set/)
  })

  it('fails when DATABASE_URL is not a valid URL', () => {
    const result = checkTestDatabaseSafety(safeOptions({ testUrl: 'not a url at all' }))
    expect(result.ok).toBe(false)
    expect(result.problems.join(' ')).toMatch(/valid URL/)
  })

  it('fails when the host is not local/loopback and no CI flag is approved', () => {
    const result = checkTestDatabaseSafety(
      safeOptions({ testUrl: 'postgresql://u:p@db.example.com:5432/sybnb_v6_test' }),
    )
    expect(result.ok).toBe(false)
    expect(result.problems.join(' ')).toMatch(/local\/loopback/)
  })

  it('passes a non-loopback host only when allowCI is true AND the CI flag is explicitly "1"', () => {
    const withoutFlag = checkTestDatabaseSafety(
      safeOptions({ testUrl: 'postgresql://u:p@db.example.com:5432/sybnb_v6_test', allowCI: true, ciFlag: undefined }),
    )
    expect(withoutFlag.ok).toBe(false)

    const withFlag = checkTestDatabaseSafety(
      safeOptions({ testUrl: 'postgresql://u:p@db.example.com:5432/sybnb_v6_test', allowCI: true, ciFlag: '1' }),
    )
    expect(withFlag.ok).toBe(true)
  })

  it('fails when the database name does not end with "_test"', () => {
    const result = checkTestDatabaseSafety(
      safeOptions({ testUrl: 'postgresql://u:p@127.0.0.1:5432/sybnb_v6' }),
    )
    expect(result.ok).toBe(false)
    expect(result.problems.join(' ')).toMatch(/_test/)
  })

  it('fails when the database name contains a production indicator', () => {
    const result = checkTestDatabaseSafety(
      safeOptions({ testUrl: 'postgresql://u:p@127.0.0.1:5432/sybnb_v6_prod_test' }),
    )
    expect(result.ok).toBe(false)
    expect(result.problems.join(' ')).toMatch(/production indicator/)
  })

  it('fails when the host matches a known managed-cloud/production hosting pattern', () => {
    const result = checkTestDatabaseSafety(
      safeOptions({ testUrl: 'postgresql://u:p@mydb.rds.amazonaws.com:5432/sybnb_v6_test', allowCI: true, ciFlag: '1' }),
    )
    expect(result.ok).toBe(false)
    expect(result.problems.join(' ')).toMatch(/production\/managed-cloud/)
  })

  it('fails when the test URL is identical to the development URL', () => {
    const result = checkTestDatabaseSafety(safeOptions({ testUrl: DEV_URL, devEnvUrl: DEV_URL }))
    expect(result.ok).toBe(false)
    expect(result.problems.join(' ')).toMatch(/identical to the development/)
    // A same-URL failure also trips the "_test" suffix check — both real, independent problems.
  })

  it('fails when the test URL shares host/port/database with the dev URL even under different credentials', () => {
    const sameTargetDifferentCreds = 'postgresql://someoneelse:otherpass@127.0.0.1:5432/sybnb_v6'
    const result = checkTestDatabaseSafety(safeOptions({ testUrl: sameTargetDifferentCreds, devEnvUrl: DEV_URL }))
    expect(result.ok).toBe(false)
    expect(result.problems.join(' ')).toMatch(/same host\/port\/database/)
  })

  it('passes when the dev URL is present but points somewhere genuinely different', () => {
    const result = checkTestDatabaseSafety(safeOptions({ devEnvUrl: DEV_URL }))
    expect(result.ok).toBe(true)
  })

  it('passes when there is no dev .env at all (devEnvUrl undefined/empty)', () => {
    const result = checkTestDatabaseSafety(safeOptions({ devEnvUrl: '' }))
    expect(result.ok).toBe(true)
  })
})

describe('checkTestDatabaseSafety: accumulates multiple independent failures', () => {
  it('reports every failing condition, not just the first', () => {
    const result = checkTestDatabaseSafety({
      nodeEnv: 'production',
      testUrl: DEV_URL, // wrong suffix AND identical to dev
      devEnvUrl: DEV_URL,
    })
    expect(result.ok).toBe(false)
    expect(result.problems.length).toBeGreaterThanOrEqual(3)
  })
})

describe('assertTestDatabaseSafe: throws instead of returning, never leaks the URL', () => {
  it('throws a TEST_DB_GUARD_FAILED error on an unsafe configuration', () => {
    expect(() => assertTestDatabaseSafe(safeOptions({ nodeEnv: 'development' }))).toThrow(
      expect.objectContaining({ code: 'TEST_DB_GUARD_FAILED' }),
    )
  })

  it('does not include the raw DATABASE_URL, host, or credentials anywhere in the thrown message', () => {
    let caught
    try {
      assertTestDatabaseSafe(safeOptions({ testUrl: DEV_URL, devEnvUrl: DEV_URL }))
    } catch (error) {
      caught = error
    }
    expect(caught).toBeDefined()
    expect(caught.message).not.toContain('secret')
    expect(caught.message).not.toContain(DEV_URL)
    expect(caught.message).not.toContain('sybnb_v6')
  })

  it('does not throw on a fully safe configuration', () => {
    expect(() => assertTestDatabaseSafe(safeOptions())).not.toThrow()
  })
})
