// Pure target rules (no k6 imports) so they can be unit-tested in Node: tests/unit/k6-target-safety.test.mjs
// Known production hosts (exact). Anything under these apex domains is also refused unless the
// hostname contains "staging" (see below).
export const PRODUCTION_HOSTS = [
  'rezekme.com', 'www.rezekme.com', 'rides.rezekme.com', 'stay.rezekme.com', 'admin.rezekme.com', 'api.rezekme.com',
  'rezekme-api.onrender.com', 'rezekme-admin.vercel.app', 'rezekme-rides.vercel.app',
  'sybnb.app', 'www.sybnb.app', 'api.sybnb.app',
]
const PRODUCTION_APEXES = ['rezekme.com', 'sybnb.app']
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]']

function parse(url) {
  const m = /^(https?):\/\/([^/:?#]+|\[[^\]]+\])(?::(\d+))?(\/[^?#]*)?$/.exec(url)
  if (!m) return null
  return { scheme: m[1], host: m[2].toLowerCase(), port: m[3] || '', path: m[4] || '' }
}

// Returns null when allowed, or a reason string. Pure, so the unit test can run it in Node.
export function targetRefusal(env) {
  const mode = env.LOADTEST_ENV
  const raw = String(env.BASE_URL || '').replace(/\/+$/, '')
  if (mode !== 'local' && mode !== 'staging') return 'LOADTEST_ENV must be "local" or "staging"'
  if (!raw) return 'BASE_URL is required (the API origin, e.g. https://rezekme-api-staging.onrender.com)'
  const u = parse(raw)
  if (!u) return `BASE_URL is not a plain origin URL: ${raw}`
  if (u.path && u.path !== '/') return 'BASE_URL must be the API origin only (no path)'
  const extra = String(env.EXTRA_PRODUCTION_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (PRODUCTION_HOSTS.includes(u.host) || extra.includes(u.host)) return `${u.host} is a production host`
  const isLocal = LOCAL_HOSTS.includes(u.host)
  if (mode === 'local') {
    if (!isLocal) return 'LOADTEST_ENV=local only targets 127.0.0.1 / localhost'
    return null
  }
  // staging
  if (isLocal) return 'LOADTEST_ENV=staging must target the staging URL, not localhost'
  if (u.scheme !== 'https') return 'staging must use https'
  if (!u.host.includes('staging')) return `staging host must contain "staging" in its name (got ${u.host})`
  if (PRODUCTION_APEXES.some((apex) => u.host === apex || u.host.endsWith(`.${apex}`)) && !u.host.split('.')[0].includes('staging')) {
    return `${u.host} is under a production domain`
  }
  if (env.STAGING_CONFIRM !== 'staging-only-no-real-payments') return 'set STAGING_CONFIRM=staging-only-no-real-payments to confirm'
  if (!env.METRICS_TOKEN) return 'staging runs need METRICS_TOKEN so database health is watched'
  return null
}

