import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Validate required configuration at startup, failing closed. Core secrets are always required;
// production additionally requires an explicit CORS origin and, when the s3 storage provider is
// selected, its bucket/region. Returns the list of problems (empty = ok) so the caller can decide
// to exit.
export function validateEnv(env = process.env) {
  const problems = []
  for (const key of ['AUTH_SECRET', 'PHONE_HASH_SECRET', 'DATABASE_URL']) {
    if (!env[key]) problems.push(`${key} is required`)
  }
  if (env.NODE_ENV === 'production') {
    if (!env.CORS_ORIGIN) problems.push('CORS_ORIGIN must be set in production (no wildcard fallback)')
    if (env.OTP_EXPOSE_FOR_TEST === 'true') problems.push('OTP_EXPOSE_FOR_TEST must NOT be enabled in production')
    if (env.STORAGE_ALLOW_LOCAL === 'true') problems.push('STORAGE_ALLOW_LOCAL must NOT be enabled in production')
    const provider = (env.STORAGE_PROVIDER || 'local').toLowerCase()
    if (provider === 'local') problems.push('STORAGE_PROVIDER must be a durable object store (not local) in production')
    if (provider === 's3' && (!env.STORAGE_S3_BUCKET || !env.STORAGE_S3_REGION)) {
      problems.push('STORAGE_S3_BUCKET and STORAGE_S3_REGION are required when STORAGE_PROVIDER=s3')
    }
  }
  return problems
}

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
