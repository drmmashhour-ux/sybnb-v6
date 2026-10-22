// Production safety for the Rezekme Rides k6 scripts. Two layers, both must pass:
//   1. checkTargetUrl() (init time, before any request): the URL must match the declared
//      LOADTEST_ENV, must not be a known production host, and staging hosts must say "staging".
//   2. assertLoadTestTarget() (setup(), one GET before any load): the server's /api/health must
//      answer `loadTestTarget: true`. The API only says that when LOADTEST_TARGET_ENABLED=1, no live
//      Stripe key is configured, AND its database has the `loadtest_target_marker` table, which
//      exists only on a marked staging branch (server/lib/loadtest-target.mjs). Production answers
//      false, so a mistyped URL fails here with zero load sent.
import http from 'k6/http'
import exec from 'k6/execution'

import { targetRefusal } from './target-rules.js'
export { targetRefusal, PRODUCTION_HOSTS } from './target-rules.js'

export function checkTargetUrl(env) {
  const why = targetRefusal(env)
  if (why) throw new Error(`REFUSING TO RUN: ${why}`)
  return String(env.BASE_URL).replace(/\/+$/, '')
}

export function assertLoadTestTarget(base) {
  const res = http.get(`${base}/api/health`, { tags: { name: 'safety_health' }, timeout: '15s' })
  let body = null
  try { body = res.json() } catch { body = null }
  if (res.status !== 200 || !body || body.loadTestTarget !== true) {
    exec.test.abort(`REFUSING TO RUN: ${base}/api/health did not confirm loadTestTarget=true (status ${res.status}). ` +
      'Only a marked staging/local environment answers true; see loadtest/k6/README.md.')
  }
  return body
}
