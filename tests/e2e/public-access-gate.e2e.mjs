// SYBNB — gates.publicAccess enforcement (governed evidence artifact).
//
// Before this suite, gates.publicAccess ('closed' for Syria) was pure documentation: no code
// anywhere read it, so the only thing standing between the public internet and a live backend was
// Vercel's own SSO-gating / deployment-pause -- a real single-layer-of-defense gap even though that
// infra layer was independently confirmed correctly locked down. server/lib/access-gate.mjs +
// server/index.mjs make the country profile's own gate a real, enforced second layer, mirroring how
// gates.payments is already enforced in payment-policy.mjs.
//
// This suite needs its OWN dedicated server, NOT the shared permissive one every other suite in this
// repo runs against -- the gate only activates when policyEnvironment() === 'production' (see
// access-gate.mjs's own comment for why every other environment defaults open), so it needs a real
// NODE_ENV=production boot with the full production-mode config validateEnv() requires. Run:
//
//   NODE_ENV=production API_HOST=127.0.0.1 API_PORT=3053 SYBNB_COUNTRY=syria \
//     AUTH_SECRET=... PHONE_HASH_SECRET=... DATABASE_URL=... \
//     CORS_ORIGIN=https://example.com \
//     EMAIL_PROVIDER=resend RESEND_API_KEY=test EMAIL_FROM=test@example.com \
//     STORAGE_PROVIDER=s3 STORAGE_S3_BUCKET=test STORAGE_S3_REGION=us-east-1 \
//     RESEND_WEBHOOK_SECRET=whsec_test \
//     node server/index.mjs &
//   API_BASE_CLOSED=http://127.0.0.1:3053 ADMIN=<real ACTIVE ADMIN id> GUEST=<real ACTIVE non-admin id> \
//     node tests/e2e/public-access-gate.e2e.mjs
//
// Section 3 also asserts the gate is OPEN against the ALREADY-RUNNING shared permissive server (the
// same one every other suite uses, API_BASE) -- no extra boot needed for that half.

import { createSessionToken } from '../../server/lib/security.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'

const CLOSED_API = process.env.API_BASE_CLOSED || 'http://127.0.0.1:3053'
const OPEN_API = process.env.API_BASE || 'http://127.0.0.1:3051'
const ADMIN = process.env.ADMIN
const GUEST = process.env.GUEST

let pass = 0
let fail = 0
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) }
}

async function bearerFor(userId) {
  const user = await db().user.findUnique({ where: { id: userId }, include: { roles: true } })
  if (!user) throw new Error(`fixture user ${userId} not found -- set ADMIN/GUEST to real ACTIVE users`)
  return createSessionToken(user)
}

async function run() {
  if (!ADMIN || !GUEST) {
    console.log('  SKIP  set ADMIN and GUEST to real ACTIVE user ids (one ADMIN role, one without) to run this suite')
    return
  }

  console.log('== 1. closed server: ordinary route refuses unauthenticated traffic ==')
  {
    const res = await fetch(`${CLOSED_API}/api/listings?division=STAYS`)
    const body = await res.json().catch(() => ({}))
    check('unauthenticated listings -> 503', res.status === 503, `got ${res.status}`)
    // Nested under error.code, matching this codebase's real error convention (responses.mjs) --
    // an admin-satisfaction audit found this suite and the route it tests had both been written
    // against the same wrong flat shape, so this assertion never actually proved what the real
    // frontend consumer (apiRequest(), which only reads payload.error?.message) needed proven.
    check('body carries PUBLIC_ACCESS_CLOSED', body.error?.code === 'PUBLIC_ACCESS_CLOSED', JSON.stringify(body))
  }

  console.log('== 2. closed server: exempt routes stay reachable (not gate-blocked) ==')
  {
    const health = await fetch(`${CLOSED_API}/api/health/live`)
    check('health/live -> 200, not 503', health.status === 200, `got ${health.status}`)

    const login = await fetch(`${CLOSED_API}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })
    check('auth/login reaches its own handler (400, not 503)', login.status !== 503, `got ${login.status}`)

    const otp = await fetch(`${CLOSED_API}/api/otp/send`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })
    check('otp/send reaches its own handler (not 503)', otp.status !== 503, `got ${otp.status}`)

    // A garbage signature must fail webhook verification (400), not the access gate (503) --
    // proves durable webhook intake is genuinely exempt, not just "returns something non-503 by
    // coincidence of a different rejection".
    const webhook = await fetch(`${CLOSED_API}/api/webhooks/resend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'svix-id': 'evt_test', 'svix-timestamp': String(Math.floor(Date.now() / 1000)), 'svix-signature': 'v1,bad' },
      body: JSON.stringify({ type: 'email.bounced', data: { to: 'nobody@example.com' } }),
    })
    const webhookBody = await webhook.json().catch(() => ({}))
    check('webhooks/resend rejects on signature, not the gate', webhookBody.error?.code === 'WEBHOOK_INVALID_SIGNATURE', JSON.stringify(webhookBody))

    // A security audit found the payment webhook routes live under /api/payments/, not
    // /api/webhooks/, so they were silently NOT covered by the prefix exemption above despite
    // this codebase's own stated intent that provider deliveries always stay reachable. Confirms
    // both are exempt (reach their own handler logic, whatever it decides -- never the gate's
    // 503) while a SIBLING path under the same /api/payments/ prefix (a real payment action, not
    // provider-delivered webhook intake) stays correctly gated -- proving this is a narrow,
    // exact-path exemption, not an accidental broadening of the whole prefix.
    const paymentIntentWebhook = await fetch(`${CLOSED_API}/api/payments/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })
    const paymentIntentWebhookBody = await paymentIntentWebhook.json().catch(() => ({}))
    check('payments/webhook (payment_intent rail) reaches its own handler, not the gate', paymentIntentWebhookBody.error?.code !== 'PUBLIC_ACCESS_CLOSED', JSON.stringify(paymentIntentWebhookBody))

    const stripeWebhook = await fetch(`${CLOSED_API}/api/payments/stripe/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })
    const stripeWebhookBody = await stripeWebhook.json().catch(() => ({}))
    check('payments/stripe/webhook reaches its own handler, not the gate', stripeWebhookBody.error?.code !== 'PUBLIC_ACCESS_CLOSED', JSON.stringify(stripeWebhookBody))

    const sellerPlanProof = await fetch(`${CLOSED_API}/api/payments/seller-plan-proof`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })
    const sellerPlanProofBody = await sellerPlanProof.json().catch(() => ({}))
    check('a sibling /api/payments/ route (real payment action) is still gated, not over-exempted', sellerPlanProof.status === 503 && sellerPlanProofBody.error?.code === 'PUBLIC_ACCESS_CLOSED', `got ${sellerPlanProof.status} ${JSON.stringify(sellerPlanProofBody)}`)
  }

  console.log('== 3. bypass is ADMIN-only, checked against real DB roles ==')
  {
    const adminToken = await bearerFor(ADMIN)
    const adminRes = await fetch(`${CLOSED_API}/api/listings?division=STAYS`, { headers: { authorization: `Bearer ${adminToken}` } })
    check('real ADMIN bearer bypasses the closed gate', adminRes.status !== 503, `got ${adminRes.status}`)

    const guestToken = await bearerFor(GUEST)
    const guestRes = await fetch(`${CLOSED_API}/api/listings?division=STAYS`, { headers: { authorization: `Bearer ${guestToken}` } })
    check('real non-admin bearer still gets the closed gate', guestRes.status === 503, `got ${guestRes.status}`)
  }

  console.log('== 4. every other environment defaults open (the shared permissive server) ==')
  {
    const res = await fetch(`${OPEN_API}/api/listings?division=STAYS`)
    check('unauthenticated listings on the dev/test server -> not 503', res.status !== 503, `got ${res.status}`)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  await disconnectDb()
  process.exit(fail ? 1 : 0)
}

run().catch(async (err) => {
  console.error('SUITE ERROR', err)
  await disconnectDb().catch(() => {})
  process.exit(1)
})
