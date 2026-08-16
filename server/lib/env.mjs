import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { countryProblems } from './country.mjs'

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
    // Email OTP is the primary auth identifier platform-wide (and the ONLY channel for email-only
    // countries like Syria). The sandbox provider reports delivered:true but sends nothing, so a
    // production deploy left on sandbox would let signups "succeed" while no OTP email is ever sent
    // — nobody could sign in. Fail closed, consistent with the storage/CORS guards above.
    const emailProvider = (env.EMAIL_PROVIDER || 'sandbox').toLowerCase()
    if (emailProvider === 'sandbox') {
      problems.push('EMAIL_PROVIDER must be a live email provider (not sandbox) in production — email OTP is the primary auth channel')
    } else if (emailProvider === 'resend' && (!env.RESEND_API_KEY || !env.EMAIL_FROM)) {
      problems.push('RESEND_API_KEY and EMAIL_FROM are required when EMAIL_PROVIDER=resend')
    }
  }
  // Fail-closed country selection (all environments): refuse when the country profile is missing,
  // unsupported, or incomplete, or when a currency override conflicts with the active profile.
  problems.push(...countryProblems(env))
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
