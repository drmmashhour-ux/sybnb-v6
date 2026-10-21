// SYBNB — release PRE-FLIGHT (read-only; never connects to a database, never prints secret values).
//   NODE_ENV=production <the service's env> node scripts/preflight-v6.mjs
// Checks the configuration that decides whether a deploy is safe: required env (validateEnv), migration approval,
// administrative activation mode, and that dangerous switches are not on. Exit 1 on any blocker.
import { validateEnv } from '../server/lib/env.mjs'

const env = process.env
const blockers = [...validateEnv(env)]
const warnings = []

if (env.NODE_ENV !== 'production') warnings.push('NODE_ENV is not "production"; this check is meant for the production service environment.')
if (!env.APPROVED_MIGRATIONS) warnings.push('APPROVED_MIGRATIONS is unset: the migration gate will stop the deploy if any gated migration (078-083) is pending. This is the safe default.')
const mode = String(env.ADMIN_ACTIVATION_MODE ?? '').trim().toUpperCase()
if (!['IN_PROCESS', 'EXTERNAL', 'DISABLED'].includes(mode)) warnings.push('ADMIN_ACTIVATION_MODE is not set to IN_PROCESS, EXTERNAL or DISABLED (production default is IN_PROCESS on every replica).')
if (env.ADMIN_BOOTSTRAP_SECRET) warnings.push('ADMIN_BOOTSTRAP_SECRET is set: remove or rotate it once the Owner bootstrap has been completed.')
if (String(env.PAYMENTS_ENABLED ?? '').toLowerCase() === 'true') warnings.push('PAYMENTS_ENABLED=true: live payments must be explicitly authorized.')
if (env.STRIPE_SECRET_KEY && /^sk_live_/.test(env.STRIPE_SECRET_KEY)) warnings.push('A LIVE Stripe key is configured: confirm live payments are authorized.')

for (const b of blockers) console.log(`BLOCKER  ${b}`)
for (const w of warnings) console.log(`WARNING  ${w}`)
console.log(blockers.length ? `\npreflight FAILED (${blockers.length} blocker(s))` : `\npreflight OK (${warnings.length} warning(s))`)
process.exit(blockers.length ? 1 : 0)
