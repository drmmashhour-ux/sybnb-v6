// SYBNB — Wallet / Gift E2E (governed evidence artifact)
//
// Integration E2E against the real V6 API + schema-correct DB (uuid ids). Asserts wallet ledger
// and gift entitlement behavior ONLY — no real money, no Stripe, no payout. All amounts synthetic.
//
// Money model (as implemented):
//   * Wallet = stored value: cachedBalanceMinor + append-only WalletEntry ledger with a UNIQUE
//     idempotencyKey per (business event, user).
//   * Gift = a phone-targeted claimable entitlement (recipientPhoneHash + 6-digit HMAC claim code
//     derived from AUTH_SECRET). Small gifts (< 100000) are created SENT; large gifts
//     (>= 100000) are created CLAIM_PENDING and require admin approval (review-queue) to become
//     SENT. Claiming credits the CLAIMING user's wallet (a promotional/platform-funded CREDIT —
//     there is no sender debit; it is not a double-entry peer transfer). Claims are code-verified,
//     brute-force locked (3 fails -> 10min), single-use (row-locked SENT->CLAIMED), and — after
//     the fix shipped with this gate — expiry-enforced.
//
// Run (API must be up against sybnb_v6 with the same AUTH_SECRET):
//   AUTH_SECRET=<secret> SENDER=<uuid> RECIPIENT=<uuid> OTHER=<uuid> ADMIN=<uuid> \
//   node tests/e2e/wallet-gift.e2e.mjs      (or: npm run test:e2e:wallet)

import { createSessionToken } from './_session.mjs'
import { giftClaimCode } from '../../server/lib/security.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
const sender    = { id: process.env.SENDER,    roles: [{ role: 'SELLER' }] }
const recipient = { id: process.env.RECIPIENT, roles: [{ role: 'GUEST' }] }
const other     = { id: process.env.OTHER,     roles: [{ role: 'SELLER' }] }
const admin     = { id: process.env.ADMIN,     roles: [{ role: 'ADMIN' }] }
for (const [n, u] of [['SENDER', sender], ['RECIPIENT', recipient], ['OTHER', other], ['ADMIN', admin]]) {
  if (!u.id) { console.error(`Missing required env ${n}`); process.exit(2) }
}
const S = await createSessionToken(sender), R = await createSessionToken(recipient), O = await createSessionToken(other), A = await createSessionToken(admin)

let pass = 0, fail = 0
async function call(method, path, token, body) {
  const res = await fetch(API + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  let j; const text = await res.text(); try { j = JSON.parse(text) } catch { j = { raw: text } }
  return { status: res.status, j }
}
function check(label, cond, detail) { if (cond) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) } }
const code = r => r.j?.error?.code || r.j?.code
async function balance(token) { const r = await call('GET','/api/wallet', token); return r.j?.wallet?.cachedBalanceMinor || 0 }
const RCPT_PHONE = '+963900' + String(Math.floor(performance.now()) % 1000000).padStart(6, '0')
async function createGift(token, amount, phone, opts = {}) {
  return call('POST','/api/wallet/gifts', token, { amountMinor: amount, recipientPhone: phone, currency: 'SYP', message: 'test gift', ...opts })
}
const codeFor = gift => giftClaimCode({ id: gift.id, recipientPhoneHash: gift.recipientPhoneHash })

console.log('=== 1. AUTH / INPUT VALIDATION ===')
check('anon cannot read wallet (401)', (await call('GET','/api/wallet', null)).status === 401)
check('anon cannot create gift (401)', (await createGift(null, 5000, RCPT_PHONE)).status === 401)
check('anon cannot claim gift (401)', (await call('POST','/api/wallet/gifts/x/claim', null, {phone:RCPT_PHONE,code:'000000'})).status === 401)
check('gift amount <= 0 rejected (GIFT_AMOUNT_INVALID)', code(await createGift(S, 0, RCPT_PHONE)) === 'GIFT_AMOUNT_INVALID', 'wrong')
check('unknown gift id preview -> 404 (GIFT_NOT_FOUND)', code(await call('GET','/api/wallet/gifts/11111111-1111-1111-1111-111111111111', R)) === 'GIFT_NOT_FOUND', 'wrong')
check('claim unknown gift -> not claimable', (await call('POST','/api/wallet/gifts/11111111-1111-1111-1111-111111111111/claim', R, {phone:RCPT_PHONE,code:'000000'})).status === 403)

console.log('\n=== 2. USER JOURNEY: create -> claim -> ledger credit ===')
const g1 = await createGift(S, 5000, RCPT_PHONE)
check('small gift created as SENT (auto-claimable)', g1.status === 201 && g1.j?.gift?.status === 'SENT', g1.status+' '+g1.j?.gift?.status)
const gift1 = g1.j?.gift
const before = await balance(R)
const claim = await call('POST', `/api/wallet/gifts/${gift1.id}/claim`, R, { phone: RCPT_PHONE, code: codeFor(gift1) })
check('recipient claims with correct phone+code (200)', claim.status === 200, claim.status+' '+code(claim))
check('claim creates a CREDIT ledger entry (referenceType wallet_gift)', claim.j?.entry?.type === 'CREDIT' && claim.j?.entry?.referenceType === 'wallet_gift', JSON.stringify(claim.j?.entry?.type))
check('gift transitions to CLAIMED', claim.j?.gift?.status === 'CLAIMED', claim.j?.gift?.status)
const after = await balance(R)
check('wallet balance increased by exactly the gift amount', after - before === 5000, `delta=${after-before}`)

console.log('\n=== 3. IDEMPOTENCY / REPLAY (no double credit) ===')
const replay = await call('POST', `/api/wallet/gifts/${gift1.id}/claim`, R, { phone: RCPT_PHONE, code: codeFor(gift1) })
check('re-claiming same gift blocked (not SENT anymore)', replay.status === 403 && code(replay) === 'GIFT_NOT_CLAIMABLE', replay.status+' '+code(replay))
const afterReplay = await balance(R)
check('balance NOT double-applied on replay', afterReplay === after, `delta=${afterReplay-after}`)
// a different user cannot claim an already-claimed gift either
check('other user cannot claim an already-claimed gift', (await call('POST', `/api/wallet/gifts/${gift1.id}/claim`, O, { phone: RCPT_PHONE, code: codeFor(gift1) })).status === 403)

console.log('\n=== 4. CLAIM SECURITY: wrong phone / wrong code / brute-force lock ===')
const g2 = await createGift(S, 3000, RCPT_PHONE)
const gift2 = g2.j?.gift
check('claim with wrong phone rejected', (await call('POST', `/api/wallet/gifts/${gift2.id}/claim`, R, { phone: '+963900000000', code: codeFor(gift2) })).status === 403)
check('claim with wrong code rejected (GIFT_CODE_INVALID)', code(await call('POST', `/api/wallet/gifts/${gift2.id}/claim`, R, { phone: RCPT_PHONE, code: '000000' })) === 'GIFT_CODE_INVALID', 'wrong')
// two more wrong attempts -> lock (3 total)
await call('POST', `/api/wallet/gifts/${gift2.id}/claim`, R, { phone: RCPT_PHONE, code: '111111' })
const locked = await call('POST', `/api/wallet/gifts/${gift2.id}/claim`, R, { phone: RCPT_PHONE, code: '222222' })
check('brute-force lock engages after repeated wrong codes (GIFT_CLAIM_LOCKED)', code(locked) === 'GIFT_CLAIM_LOCKED', code(locked))
check('correct code blocked while locked', code(await call('POST', `/api/wallet/gifts/${gift2.id}/claim`, R, { phone: RCPT_PHONE, code: codeFor(gift2) })) === 'GIFT_CLAIM_LOCKED', 'not locked')

console.log('\n=== 5. EXPIRY ENFORCEMENT (fix shipped this gate) ===')
const gExp = await createGift(S, 4000, RCPT_PHONE, { expiresAt: new Date(Date.now() - 60000).toISOString() })
check('expired gift is created SENT (status) but...', gExp.j?.gift?.status === 'SENT', gExp.j?.gift?.status)
const expClaim = await call('POST', `/api/wallet/gifts/${gExp.j?.gift?.id}/claim`, R, { phone: RCPT_PHONE, code: codeFor(gExp.j?.gift) })
check('...claiming an expired gift is rejected (GIFT_EXPIRED)', expClaim.status === 403 && code(expClaim) === 'GIFT_EXPIRED', expClaim.status+' '+code(expClaim))
const balAfterExp = await balance(R)
check('expired-gift claim credits nothing', balAfterExp === afterReplay, `delta=${balAfterExp-afterReplay}`)

console.log('\n=== 6. ADMIN JOURNEY: large gift needs approval before claimable ===')
const big = await createGift(S, 150000, RCPT_PHONE)
check('large gift (>=100000) created CLAIM_PENDING (not claimable)', big.j?.gift?.status === 'CLAIM_PENDING', big.j?.gift?.status)
const bigGift = big.j?.gift
check('CLAIM_PENDING gift cannot be claimed yet', (await call('POST', `/api/wallet/gifts/${bigGift.id}/claim`, R, { phone: RCPT_PHONE, code: codeFor(bigGift) })).status === 403)
check('ordinary user cannot approve gift via admin route (403)', (await call('PATCH', `/api/admin/review-queue/gift/${bigGift.id}`, S, { decision: 'APPROVE' })).status === 403)
check('recipient cannot approve gift via admin route (403)', (await call('PATCH', `/api/admin/review-queue/gift/${bigGift.id}`, R, { decision: 'APPROVE' })).status === 403)
const approve = await call('PATCH', `/api/admin/review-queue/gift/${bigGift.id}`, A, { decision: 'APPROVE' })
check('admin approves gift -> SENT', approve.status === 200 && approve.j?.entity?.status === 'SENT', approve.status+' '+approve.j?.entity?.status)
const beforeBig = await balance(R)
const bigClaim = await call('POST', `/api/wallet/gifts/${bigGift.id}/claim`, R, { phone: RCPT_PHONE, code: codeFor(bigGift) })
check('recipient claims approved large gift (200)', bigClaim.status === 200, bigClaim.status+' '+code(bigClaim))
check('large gift credits exact amount', (await balance(R)) - beforeBig === 150000, 'wrong delta')
check('double approval of gift blocked (GIFT_NOT_REVIEWABLE)', code(await call('PATCH', `/api/admin/review-queue/gift/${bigGift.id}`, A, { decision: 'APPROVE' })) === 'GIFT_NOT_REVIEWABLE', 'not guarded')

console.log('\n=== 6b. GIFT-PREVIEW IDOR CLOSED ===')
// sender sees full detail (user ids + message); a third party gets only minimal claim fields.
const gPrev = await createGift(S, 7000, RCPT_PHONE, { message: 'private note' })
const gid = gPrev.j?.gift?.id
const senderView = await call('GET', `/api/wallet/gifts/${gid}`, S)
check('sender sees full detail (senderUserId + message)', senderView.j?.gift?.senderUserId === sender.id && senderView.j?.gift?.message === 'private note', 'sender detail missing')
const strangerView = await call('GET', `/api/wallet/gifts/${gid}`, O)
check('third party gets 200 minimal preview (claim UX preserved)', strangerView.status === 200 && strangerView.j?.gift?.amountMinor === 7000, strangerView.status)
check('third party CANNOT read user ids (IDOR closed)', strangerView.j?.gift?.senderUserId === undefined && strangerView.j?.gift?.recipientUserId === undefined, 'ids leaked')
check('third party CANNOT read the private message', strangerView.j?.gift?.message === undefined, 'message leaked')
check('admin sees full detail', (await call('GET', `/api/wallet/gifts/${gid}`, A)).j?.gift?.message === 'private note', 'admin blocked')

console.log('\n=== 7. WALLET ISOLATION + LEDGER INVARIANT ===')
const wR = await call('GET','/api/wallet', R)
const wO = await call('GET','/api/wallet', O)
check('userA (recipient) wallet is self-scoped', wR.j?.wallet?.userId === recipient.id, wR.j?.wallet?.userId)
check('userB (other) wallet does not expose userA balance', (wO.j?.wallet?.userId || null) !== recipient.id, 'leaked')
check('recipient ledger contains gift CREDIT entries', (wR.j?.wallet?.entries||[]).some(e => e.type === 'CREDIT' && e.referenceType === 'wallet_gift'), 'no gift entry')
// invariant: no negative balance
check('wallet balance is non-negative', (wR.j?.wallet?.cachedBalanceMinor || 0) >= 0, 'negative')

console.log(`\n==== WALLET / GIFT E2E: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
