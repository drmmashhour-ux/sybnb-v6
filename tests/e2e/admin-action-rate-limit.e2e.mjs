// SYBNB — admin-action velocity floor (governed evidence artifact).
//
// A security audit found NO rate limiting anywhere on admin-mutating routes, and confirmed this
// is exactly what let two real incidents in this codebase's history happen: a single valid ADMIN
// credential processing hundreds of real backlog decisions in minutes, with nothing to slow it
// down or make it conspicuous. server/index.mjs now caps mutating /api/admin/* requests per admin
// account (isRateLimited(), the same shared Postgres-backed primitive already used for OTP/login/
// webhook limits).
//
// Needs its OWN dedicated server with a low ADMIN_ACTION_RATE_MAX override -- the shared main
// test server's default (250, calibrated with real headroom above this repo's own canonical
// regression's measured peak of 142 admin actions/minute) is deliberately too high to exercise
// the 429 path without an enormous, slow burst. Run:
//   ADMIN_ACTION_RATE_MAX=5 API_PORT=<port> node server/index.mjs &
//   API_BASE=http://127.0.0.1:<port> node tests/e2e/admin-action-rate-limit.e2e.mjs

import { createSessionToken } from './_session.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
const ADMIN = process.env.ADMIN || 'c6b57605-18aa-4093-bd99-264185de4b26'
const GUEST = process.env.GUEST || 'e14887c6-6fff-4cab-bcea-62e1b976ea61'
const RATE_MAX = Number(process.env.ADMIN_ACTION_RATE_MAX || 5)

let pass = 0
let fail = 0
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) }
}

async function bearerFor(userId, roles) {
  const user = await db().user.findUnique({ where: { id: userId } })
  if (!user) throw new Error(`fixture user ${userId} not found`)
  return await createSessionToken({ id: user.id, roles: roles.map((role) => ({ role })) })
}

async function run() {
  // Start every run from a clean bucket -- a prior run (or this same suite re-run) would otherwise
  // leave residual count, making the first assertion below flaky depending on what ran before it.
  await db().rateLimitBucket.deleteMany({ where: { bucketKey: `admin-action:${ADMIN}` } })

  const adminToken = await bearerFor(ADMIN, ['ADMIN'])
  const guestToken = await bearerFor(GUEST, ['GUEST'])

  console.log('== GET requests to an admin route are never rate-limited ==')
  {
    let allOk = true
    for (let i = 0; i < RATE_MAX * 3; i++) {
      const res = await fetch(`${API}/api/admin/review-queue`, { headers: { authorization: `Bearer ${adminToken}` } })
      if (res.status === 429) allOk = false
    }
    check(`${RATE_MAX * 3} GET requests, zero 429s`, allOk, 'a GET request was rate-limited')
  }

  console.log('== a non-admin hitting a mutating admin route gets 403, never 429 from this check ==')
  {
    const res = await fetch(`${API}/api/admin/sr/promo-codes/00000000-0000-4000-8000-000000000000`, {
      method: 'PATCH', headers: { authorization: `Bearer ${guestToken}`, 'content-type': 'application/json' }, body: '{}',
    })
    check('non-admin gets 403, not 429', res.status === 403, `got ${res.status}`)
  }

  console.log(`== the ${RATE_MAX + 1}th mutating admin request in the window gets 429 ==`)
  {
    let sawRateLimited = false
    let firstRateLimitedAt = null
    for (let i = 1; i <= RATE_MAX + 2; i++) {
      const res = await fetch(`${API}/api/admin/sr/promo-codes/00000000-0000-4000-8000-00000000000${i}`, {
        method: 'PATCH', headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' }, body: '{"active":false}',
      })
      if (res.status === 429) {
        sawRateLimited = true
        if (firstRateLimitedAt === null) firstRateLimitedAt = i
      } else {
        check(`request ${i} (under the limit) reaches its own handler, not rate-limited`, res.status !== 429, `got ${res.status}`)
      }
    }
    check('a 429 was hit once the limit was exceeded', sawRateLimited, 'never got a 429')
    check(`the 429 started at request ${RATE_MAX + 1} (right after the limit)`, firstRateLimitedAt === RATE_MAX + 1, `started at ${firstRateLimitedAt}`)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  await db().rateLimitBucket.deleteMany({ where: { bucketKey: `admin-action:${ADMIN}` } })
  await disconnectDb()
  process.exit(fail ? 1 : 0)
}

run().catch(async (err) => {
  console.error('SUITE ERROR', err)
  await db().rateLimitBucket.deleteMany({ where: { bucketKey: `admin-action:${ADMIN}` } }).catch(() => {})
  await disconnectDb().catch(() => {})
  process.exit(1)
})
