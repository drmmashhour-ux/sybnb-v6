import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { safePositiveInt } from './rate-limit.mjs'

export function loadEnv(path = '.env') {
  const file = resolve(process.cwd(), path)
  if (!existsSync(file)) return

  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const equalsAt = trimmed.indexOf('=')
    if (equalsAt === -1) continue

    const key = trimmed.slice(0, equalsAt).trim()
    const rawValue = trimmed.slice(equalsAt + 1).trim()
    const value = rawValue.replace(/^["']|["']$/g, '')
    if (key && process.env[key] == null) {
      process.env[key] = value
    }
  }
}

// Security audit finding "production configuration validation" (Phase 6, minimum repair #8):
// fails loudly at startup rather than silently running with dev-only-safe defaults in production.
// Only called when NODE_ENV=production (see index.mjs) — local dev is unaffected.
export function validateProductionConfig() {
  const problems = []

  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 16) {
    problems.push('AUTH_SECRET must be set to a value at least 16 characters long.')
  }
  if (!process.env.PHONE_HASH_SECRET || process.env.PHONE_HASH_SECRET.length < 16) {
    problems.push('PHONE_HASH_SECRET must be set to a value at least 16 characters long.')
  }
  if (!process.env.DATABASE_URL) {
    problems.push('DATABASE_URL must be set.')
  }
  if (!process.env.CORS_ORIGIN) {
    problems.push('CORS_ORIGIN must be set explicitly in production — the built-in dev fallback only allows localhost origins.')
  }
  if (process.env.DISABLE_RATE_LIMIT === '1') {
    problems.push('DISABLE_RATE_LIMIT must not be "1" in production.')
  }

  // A typo'd RATE_LIMIT_<NAME>_MAX/_WINDOW_MS (non-numeric, zero, negative, non-integer) would
  // silently fall back to the caller's default at request time (see
  // server/lib/rate-limit.mjs's safePositiveInt) rather than crash — safe at runtime, but a
  // production deployment should still be told loudly at startup that one of its rate-limit
  // overrides is malformed, rather than quietly running with a value nobody intended.
  const sentinel = Symbol('invalid')
  for (const [key, rawValue] of Object.entries(process.env)) {
    if (!/^RATE_LIMIT_.+_(MAX|WINDOW_MS)$/.test(key)) continue
    if (safePositiveInt(rawValue, sentinel) === sentinel) {
      problems.push(`${key}="${rawValue}" is not a valid positive integer — fix or unset it.`)
    }
  }

  if (problems.length) {
    const message = `Refusing to start with NODE_ENV=production and unsafe configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`
    throw new Error(message)
  }
}
