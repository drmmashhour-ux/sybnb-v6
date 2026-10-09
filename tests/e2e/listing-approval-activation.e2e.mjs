// SYBNB — new-host onboarding order E2E (owner decision of 2026-10-09; governed evidence).
//
//   listing submitted -> automatic AI pre-check (advisory) -> admin review -> activation code
//   emailed at the END -> host enters it -> stay live.
//
// SELF-CONTAINED: seeds its own unverified host, already-verified host and admin through Prisma.
//
// Proves, through the real HTTP API + real rows:
//   1. Submitting a stay leaves it PENDING_REVIEW and, in the background, writes a listing_ai_reviews
//      row (SKIPPED/NO_API_KEY when ANTHROPIC_API_KEY is unset -- the governed run -- or DONE/FAILED
//      with a key). The AI never changes the listing status. The admin queue carries `aiReview`.
//   2. Tracker: GET /api/host/verification -> onboarding.step 2 while in review.
//   3. Sending back for fixes (REJECT + note) stores host feedback the host sees (step 2,
//      needsFixes), never the raw AI report.
//   4. Approving the unverified host's stay auto-issues ONE activation code in the same transaction:
//      a host_activation_codes row (issued_by = the admin), an audit row with trigger LISTING_APPROVED
//      and no code/hash, the response never contains the code; email is a no-op without RESEND.
//      Tracker -> step 3 with hasPendingCode. A second approved stay does not replace the live code.
//   5. Approving an already-verified host's stay issues nothing.
//   6. POST /api/admin/listings/:id/ai-review: ADMIN only; ?wait=1 returns the stored record.
//
// Needs the API running and DATABASE_URL + AUTH_SECRET in this process's env.
// Run: node tests/e2e/listing-approval-activation.e2e.mjs

import { randomUUID } from 'node:crypto'
import { createSessionToken } from './_session.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'
import { hashPassword } from '../../server/lib/security.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
const RUN = randomUUID().slice(0, 8)

let pass = 0
let fail = 0
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`   PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}  -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`) }
}
async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let j
  try { j = JSON.parse(text) } catch { j = { raw: text } }
  return { status: res.status, j }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function clearBuckets(prefixes) {
  await db().rateLimitBucket.deleteMany({ where: { OR: prefixes.map((p) => ({ bucketKey: { startsWith: p } })) } })
}

async function seedUser(label, roles, extra = {}) {
  const user = await db().user.create({
    data: {
      email: `onboard-${label}-${RUN}@example.test`,
      displayName: `OB ${label} ${RUN}`,
      locale: 'ar-SY',
      passwordHash: hashPassword('Onboard-E2E-Pw!'),
      roles: { create: roles.map((role) => ({ role })) },
      ...extra,
    },
  })
  const token = await createSessionToken({ id: user.id, roles: roles.map((role) => ({ role })) })
  return { ...user, token }
}

// A publisher must have an approved ID + the listing agreement before /submit (existing gate).
async function makePublisher(user) {
  await db().user.update({ where: { id: user.id }, data: { idDocumentStatus: 'APPROVED' } })
  await db().legalConsent.create({ data: { userId: user.id, documentKey: 'listing-agreement', version: 'e2e' } })
}

async function createAndSubmit(host, label) {
  const created = await call('POST', '/api/listings', host.token, {
    division: 'STAYS',
    titleAr: `شقة تجربة ${label} ${RUN}`,
    titleEn: `Onboarding stay ${label} ${RUN}`,
    description: 'Two bedrooms near the park.',
    priceMinor: 450000,
    currency: 'SYP',
    governorate: 'damascus',
    metadata: { address: 'Test street 1', bedrooms: 2 },
  })
  const id = created.j?.listing?.id
  const submitted = id ? await call('PATCH', `/api/listings/${id}/submit`, host.token) : created
  return { id, created, submitted }
}

async function waitForAiRow(listingId, ms = 60_000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const row = await db().listingAiReview.findUnique({ where: { listingId } })
    if (row && row.status !== 'PENDING') return row
    await sleep(250)
  }
  return db().listingAiReview.findUnique({ where: { listingId } })
}

async function main() {
  console.log('=== LISTING -> AI CHECK -> ADMIN REVIEW -> ACTIVATION CODE E2E (2026-10-09) ===')
  const host = await seedUser('host', ['HOST', 'GUEST'])
  const verifiedHost = await seedUser('vhost', ['HOST', 'GUEST'], { hostVerifiedAt: new Date() })
  const admin = await seedUser('admin', ['ADMIN'])
  await makePublisher(host)
  await makePublisher(verifiedHost)
  await clearBuckets([`admin-action:${admin.id}`, `ai-review-rerun:${admin.id}`])

  // --- 1. submit -> AI row, listing untouched ---------------------------------------------------
  console.log('\n--- 1. submit -> automatic AI pre-check (advisory) ---')
  const step0 = (await call('GET', '/api/host/verification', host.token)).j
  check('tracker before any listing -> step 1', step0?.onboarding?.step === 1, step0)
  const a = await createAndSubmit(host, 'A')
  check('create 201 + submit 200 -> PENDING_REVIEW', a.created.status === 201 && a.submitted.status === 200 && a.submitted.j?.listing?.status === 'PENDING_REVIEW', a.submitted)
  const aiRow = await waitForAiRow(a.id)
  check('listing_ai_reviews row written in the background', Boolean(aiRow) && ['SKIPPED', 'DONE', 'FAILED'].includes(aiRow.status), aiRow)
  if (!process.env.ANTHROPIC_API_KEY) {
    check('no ANTHROPIC_API_KEY on this run -> SKIPPED / NO_API_KEY', aiRow?.status === 'SKIPPED' && aiRow?.error === 'NO_API_KEY', aiRow)
  }
  const afterAi = await db().listing.findUnique({ where: { id: a.id } })
  check('the AI never decides: still PENDING_REVIEW', afterAi.status === 'PENDING_REVIEW', afterAi.status)
  check('nothing AI-related was written into listings.metadata', !('aiReview' in (afterAi.metadata || {})), afterAi.metadata)
  check('AI audit row written', Boolean(await db().adminAuditLog.findFirst({ where: { entityId: a.id, action: { startsWith: 'LISTING_AI_REVIEW_' } } })), 'missing')
  const queue = await call('GET', '/api/admin/review-queue', admin.token)
  const queued = queue.j?.queue?.listings?.find((l) => l.id === a.id)
  check('admin review queue carries aiReview for the listing', queued && queued.aiReview && queued.aiReview.status === aiRow?.status, queued?.aiReview || queue.status)
  const publicDetail = await call('GET', `/api/listings/${a.id}`, null)
  check('public detail of a pending listing is 404 (and never carries aiReview)', publicDetail.status === 404, publicDetail.status)
  const step2 = (await call('GET', '/api/host/verification', host.token)).j
  check('tracker -> step 2 (in review), no code yet', step2?.onboarding?.step === 2 && step2?.onboarding?.needsFixes === false && step2?.hasPendingCode === false, step2?.onboarding)

  // --- 3. send back for fixes ------------------------------------------------------------------
  console.log('\n--- 3. send back for fixes ---')
  const reject = await call('PATCH', `/api/admin/review-queue/listings/${a.id}`, admin.token, {
    decision: 'REJECT',
    adminNote: 'Please remove the phone number from photo 2.',
    hostIssues: ['أزل رقم الهاتف من الصورة الثانية.'],
  })
  check('REJECT with note -> 200, REJECTED, no code issued', reject.status === 200 && reject.j?.entity?.status === 'REJECTED' && !reject.j?.activationCode, reject)
  const fb = (await call('GET', '/api/host/verification', host.token)).j
  const item = fb?.onboarding?.feedback?.find((f) => f.listingId === a.id)
  check('host sees step 2 needsFixes + note + issues', fb?.onboarding?.step === 2 && fb?.onboarding?.needsFixes === true && item?.note?.includes('phone number') && item?.issues?.[0]?.includes('رقم الهاتف'), fb?.onboarding)
  check('host feedback never contains the admin summary / score', !JSON.stringify(fb).includes('summaryForAdmin') && !JSON.stringify(fb).includes('"score"'), 'leaked')
  check('no activation code exists yet', (await db().hostActivationCode.count({ where: { hostId: host.id } })) === 0, 'code present')
  const resubmit = await call('PATCH', `/api/listings/${a.id}/submit`, host.token)
  check('host resubmits -> PENDING_REVIEW', resubmit.status === 200 && resubmit.j?.listing?.status === 'PENDING_REVIEW', resubmit)
  await waitForAiRow(a.id)

  // --- 4. approve -> code at the end -------------------------------------------------------------
  console.log('\n--- 4. approve unverified host -> activation code auto-issued ---')
  const approve = await call('PATCH', `/api/admin/review-queue/listings/${a.id}`, admin.token, { decision: 'APPROVE' })
  check('APPROVE -> 200 APPROVED', approve.status === 200 && approve.j?.entity?.status === 'APPROVED', approve)
  check('response: activationCode.issued true, emailQueued (host has an email)', approve.j?.activationCode?.issued === true && approve.j?.activationCode?.emailQueued === true, approve.j?.activationCode)
  check('response never contains the plaintext code', !/"code":"\d{6}"/.test(JSON.stringify(approve.j)) && approve.j?.activationCode?.code === undefined, approve.j?.activationCode)
  const codes = await db().hostActivationCode.findMany({ where: { hostId: host.id } })
  check('DB: exactly one code row, issued by the approving admin, unused, ~7 days', codes.length === 1 && codes[0].issuedById === admin.id && !codes[0].usedAt && codes[0].expiresAt.getTime() - Date.now() > 6.9 * 86400_000, codes)
  check('DB: only a hash is stored', codes[0] && !/^\d{6}$/.test(codes[0].codeHash) && codes[0].codeHash.length > 20, codes[0]?.codeHash?.length)
  const audit = await db().adminAuditLog.findFirst({ where: { action: 'HOST_ACTIVATION_CODE_ISSUED', entityId: host.id }, orderBy: { createdAt: 'desc' } })
  check('audit HOST_ACTIVATION_CODE_ISSUED: trigger LISTING_APPROVED, listingId, actor = admin', audit?.after?.trigger === 'LISTING_APPROVED' && audit?.after?.listingId === a.id && audit?.actorUserId === admin.id, audit)
  check('audit never contains the code or its hash', !JSON.stringify(audit?.after || {}).includes(codes[0]?.codeHash || '#'), 'leaked')
  const step3 = (await call('GET', '/api/host/verification', host.token)).j
  check('tracker -> step 3 with hasPendingCode', step3?.onboarding?.step === 3 && step3?.hasPendingCode === true && step3?.verified === false, step3)
  check('the approved stay is still hidden until the code is entered', (await call('GET', `/api/listings/${a.id}`, null)).status === 404, 'visible')

  const b = await createAndSubmit(host, 'B')
  await waitForAiRow(b.id)
  const approveB = await call('PATCH', `/api/admin/review-queue/listings/${b.id}`, admin.token, { decision: 'APPROVE' })
  check('second stay approved -> no new code (ACTIVE_CODE_EXISTS)', approveB.status === 200 && approveB.j?.activationCode?.issued === false && approveB.j?.activationCode?.reason === 'ACTIVE_CODE_EXISTS', approveB.j?.activationCode)
  const live = await db().hostActivationCode.findMany({ where: { hostId: host.id, usedAt: null, expiresAt: { gt: new Date() } } })
  check('still exactly one live code (the emailed one was not invalidated)', live.length === 1 && live[0].id === codes[0]?.id, live.length)

  // --- 5. verified owner -> nothing --------------------------------------------------------------
  console.log('\n--- 5. verified owner -> no code ---')
  const v = await createAndSubmit(verifiedHost, 'V')
  await waitForAiRow(v.id)
  const approveV = await call('PATCH', `/api/admin/review-queue/listings/${v.id}`, admin.token, { decision: 'APPROVE' })
  check('approve -> 200, activationCode.issued false (ALREADY_VERIFIED)', approveV.status === 200 && approveV.j?.activationCode?.issued === false && approveV.j?.activationCode?.reason === 'ALREADY_VERIFIED', approveV.j)
  check('DB: no code row for the verified host', (await db().hostActivationCode.count({ where: { hostId: verifiedHost.id } })) === 0, 'code present')
  check('verified host stay is public right away', (await call('GET', `/api/listings/${v.id}`, null)).status === 200, 'not public')

  // --- 6. manual re-run --------------------------------------------------------------------------
  console.log('\n--- 6. POST /api/admin/listings/:id/ai-review ---')
  check('host cannot re-run -> 403', (await call('POST', `/api/admin/listings/${a.id}/ai-review`, host.token)).status === 403, 'not 403')
  check('unknown listing -> 404', (await call('POST', `/api/admin/listings/${randomUUID()}/ai-review`, admin.token)).status === 404, 'not 404')
  const rerun = await call('POST', `/api/admin/listings/${a.id}/ai-review?wait=1`, admin.token)
  check('admin re-run (wait=1) -> 200 with a stored record', rerun.status === 200 && ['SKIPPED', 'DONE', 'FAILED'].includes(rerun.j?.aiReview?.status), rerun)
  check('re-run did not change the listing status', (await db().listing.findUnique({ where: { id: a.id } })).status === 'APPROVED', 'changed')
  const bg = await call('POST', `/api/admin/listings/${b.id}/ai-review`, admin.token)
  check('admin re-run (background) -> 202 PENDING', bg.status === 202 && bg.j?.aiReview?.status === 'PENDING', bg)
  await waitForAiRow(b.id)

  // Manual fallback still works for an unverified host (re-issue retires the auto code).
  const manual = await call('POST', `/api/admin/hosts/${host.id}/activation-code`, admin.token, {})
  check('manual "Generate activation code" still works -> 201', manual.status === 201 && /^\d{6}$/.test(manual.j?.code || ''), manual.status)
  const activate = await call('POST', '/api/host/activate', host.token, { code: manual.j?.code })
  check('host activates with it -> 200', activate.status === 200 && Boolean(activate.j?.verifiedAt), activate)
  const step4 = (await call('GET', '/api/host/verification', host.token)).j
  check('tracker -> step 4 (verified)', step4?.onboarding?.step === 4 && step4?.verified === true, step4?.onboarding)
  check('stay A is now public', (await call('GET', `/api/listings/${a.id}`, null)).status === 200, 'hidden')

  console.log(`\n==== LISTING APPROVAL ACTIVATION E2E: ${pass} passed, ${fail} failed ====`)
}

try {
  await main()
} catch (error) {
  fail++
  console.error('UNCAUGHT', error)
  console.log(`\n==== LISTING APPROVAL ACTIVATION E2E: ${pass} passed, ${fail} failed ====`)
} finally {
  await disconnectDb()
}
process.exit(fail ? 1 : 0)
