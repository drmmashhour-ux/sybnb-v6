// Fail-closed safety guard: refuses to let a test process open a database connection unless
// every condition below holds. This is the *primary* isolation enforcement mechanism for this
// project's test database — not PostgreSQL ACLs. (A defense-in-depth attempt to REVOKE CONNECT
// on the development database for the dedicated test role was found to be ineffective: PostgreSQL
// grants CONNECT to PUBLIC by default, and revoking a privilege from one specific role has no
// effect when that role's access actually comes from a PUBLIC grant — the only way to truly block
// it at the database layer would be to revoke CONNECT from PUBLIC on the development database
// itself, which is exactly the kind of development-database modification this project's test
// tooling must never perform. So this application-level check is load-bearing, not a
// belt-and-suspenders extra.)
//
// Called from server/lib/prisma.mjs's db() before the first PrismaClient is ever constructed,
// whenever NODE_ENV === 'test' — so normal dev/production `db()` calls are entirely unaffected
// (this module does nothing unless NODE_ENV is exactly 'test').

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

// Hostname substrings that indicate a managed cloud/production database provider. Not
// exhaustive — a narrow, cheap check, not a substitute for the other checks.
const PRODUCTION_HOST_INDICATORS = [
  'amazonaws.com',
  'rds.',
  'azure',
  '.gcp.',
  'googleapis.com',
  'render.com',
  'railway.app',
  'herokuapp.com',
  'supabase.co',
  'neon.tech',
  'planetscale',
]

function parseEnvFile(path) {
  if (!existsSync(path)) return {}
  const result = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (key) result[key] = value
  }
  return result
}

function safeParseUrl(raw) {
  if (!raw) return null
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

// Returns { ok: true } or { ok: false, problems: string[] }. Never throws, never includes any
// URL, hostname, username, or password in its return value — only booleans and generic reason
// strings safe to print. `options.devEnvUrl` and `options.testUrl` are injectable for unit
// testing without touching real files/env; production callers omit them and this reads the real
// process.env / .env file.
export function checkTestDatabaseSafety(options = {}) {
  const problems = []

  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV
  if (nodeEnv !== 'test') {
    problems.push('NODE_ENV must be exactly "test".')
  }

  const testUrlRaw = options.testUrl ?? process.env.DATABASE_URL
  const testUrl = safeParseUrl(testUrlRaw)
  if (!testUrlRaw) {
    problems.push('DATABASE_URL is not set.')
  } else if (!testUrl) {
    problems.push('DATABASE_URL is not a valid URL.')
  }

  if (testUrl) {
    const isLoopback = LOOPBACK_HOSTS.has(testUrl.hostname)
    const ciApproved = options.allowCI === true && (options.ciFlag ?? process.env.CI_TEST_DB_APPROVED) === '1'
    if (!isLoopback && !ciApproved) {
      problems.push('Database host is not local/loopback, and no approved CI test flag is set.')
    }

    const dbName = testUrl.pathname.replace(/^\//, '')
    if (!dbName.endsWith('_test')) {
      problems.push('Database name does not end with "_test".')
    }
    if (/prod/i.test(dbName)) {
      problems.push('Database name contains a production indicator.')
    }

    const hostLower = testUrl.hostname.toLowerCase()
    if (PRODUCTION_HOST_INDICATORS.some((fragment) => hostLower.includes(fragment))) {
      problems.push('Database host matches a known production/managed-cloud hosting pattern.')
    }

    // Compare against the ordinary development .env's DATABASE_URL — read directly here (not
    // process.env, since loadEnv() only sets vars that aren't already set, and by the time this
    // runs under NODE_ENV=test, DATABASE_URL is already populated from .env.test) so this check
    // works regardless of load order. Never included in the returned problem strings.
    const devEnvUrl =
      options.devEnvUrl !== undefined
        ? options.devEnvUrl
        : parseEnvFile(resolve(options.cwd ?? process.cwd(), '.env')).DATABASE_URL
    const devUrl = safeParseUrl(devEnvUrl)
    if (devUrl) {
      if (devUrl.href === testUrl.href) {
        problems.push('DATABASE_URL is identical to the development .env DATABASE_URL.')
      } else if (
        devUrl.hostname === testUrl.hostname &&
        (devUrl.port || '5432') === (testUrl.port || '5432') &&
        devUrl.pathname === testUrl.pathname
      ) {
        problems.push('DATABASE_URL points at the same host/port/database as the development environment (even though credentials differ).')
      }
    }
  }

  if (problems.length) return { ok: false, problems }
  return { ok: true, problems: [] }
}

// Throws a generic, credential-free error if any check fails. This is what actual code paths
// (prisma.mjs, the destructive reset helper) call — checkTestDatabaseSafety() itself is exported
// separately so it can be unit-tested without needing to catch an exception for every case.
export function assertTestDatabaseSafe(options = {}) {
  const result = checkTestDatabaseSafety(options)
  if (!result.ok) {
    const error = new Error(
      'Refusing to run database tests: the current environment does not satisfy the test-database ' +
        `safety guard (${result.problems.length} check(s) failed). No connection was opened. ` +
        'See docs/testing/SYBNB_V6_TEST_DATABASE_SETUP.md to set up an isolated .env.test. ' +
        `Reasons: ${result.problems.join(' | ')}`,
    )
    error.code = 'TEST_DB_GUARD_FAILED'
    throw error
  }
}
