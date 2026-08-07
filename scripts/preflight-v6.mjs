// Pre-deploy gate: verifies required environment is present before the V6 API
// or a build is trusted. Exits non-zero (fails CI/deploy) when anything is missing.
import { loadEnv } from '../server/lib/env.mjs'

loadEnv()

const REQUIRED = ['DATABASE_URL', 'AUTH_SECRET', 'PHONE_HASH_SECRET']
const RECOMMENDED = ['API_HOST', 'API_PORT', 'CORS_ORIGIN', 'VITE_API_BASE_URL']

const missing = REQUIRED.filter((key) => !process.env[key] || process.env[key].trim() === '')
const weak = ['AUTH_SECRET', 'PHONE_HASH_SECRET'].filter(
  (key) => process.env[key] && process.env[key].trim().length < 24,
)
const missingRecommended = RECOMMENDED.filter((key) => !process.env[key])

for (const key of missingRecommended) console.warn(`preflight: recommended env not set: ${key}`)
for (const key of weak) console.warn(`preflight: ${key} looks short; use >= 24 random chars`)

if (missing.length > 0) {
  console.error(`preflight: FAIL — missing required env: ${missing.join(', ')}`)
  process.exit(1)
}
console.log('preflight: PASS — required environment present')
