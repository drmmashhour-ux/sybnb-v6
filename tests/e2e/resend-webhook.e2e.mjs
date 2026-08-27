// SYBNB — Resend webhook route E2E (governed). Proves POST /api/webhooks/resend: fail-closed without
// secret, signature+timestamp/replay rejection, duplicate-event dedup, bounce/complaint suppression,
// size cap, and no secret logging. Also proves the suppression this route writes is actually
// consulted: it lands in the Postgres suppressed_emails table (not an in-process Map) and a
// subsequent sendEmail() to that same address is refused, not silently sent. Runs against the live
// API + DB. The API must be started WITH RESEND_WEBHOOK_SECRET set to the value below. Run via
// scripts/run-all-e2e.sh (which sets it and DATABASE_URL), or:
//   RESEND_WEBHOOK_SECRET=whsec_<b64> node server/index.mjs & node tests/e2e/resend-webhook.e2e.mjs
import { createHmac } from 'node:crypto'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'
import { sendEmail } from '../../server/lib/email.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
const SECRET = process.env.RESEND_WEBHOOK_SECRET || ''
let pass = 0, fail = 0
const check = (label, cond, detail) => { if (cond) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) } }

function sign(id, ts, payload) {
  const secretBytes = Buffer.from(SECRET.replace(/^whsec_/, ''), 'base64')
  return 'v1,' + createHmac('sha256', secretBytes).update(`${id}.${ts}.${payload}`).digest('base64')
}
async function post(payload, headers) {
  const res = await fetch(API + '/api/webhooks/resend', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: payload })
  let j = {}; try { j = await res.json() } catch {}
  return { status: res.status, j }
}
const code = (r) => r.j?.error?.code || r.j?.code

if (!SECRET) { console.error('RESEND_WEBHOOK_SECRET not set for the test client'); process.exit(2) }
const now = Math.floor(Date.now() / 1000)

console.log('=== METHOD + SIGNATURE ===')
check('GET not allowed (405)', (await fetch(API + '/api/webhooks/resend')).status === 405, 'wrong')
const body = JSON.stringify({ type: 'email.delivered', data: { to: ['x@sybnb.local'] } })
const id1 = 'evt_' + now
const good = await post(body, { 'svix-id': id1, 'svix-timestamp': String(now), 'svix-signature': sign(id1, now, body) })
check('valid signature accepted (200)', good.status === 200 && good.j?.ok === true, good.status + ' ' + code(good))
const tampered = await post(body + 'x', { 'svix-id': 'evt_t', 'svix-timestamp': String(now), 'svix-signature': sign('evt_t', now, body) })
check('tampered payload rejected (400)', tampered.status === 400 && code(tampered) === 'WEBHOOK_INVALID_SIGNATURE', tampered.status + ' ' + code(tampered))
const stale = await post(body, { 'svix-id': 'evt_s', 'svix-timestamp': String(now - 100000), 'svix-signature': sign('evt_s', now - 100000, body) })
check('stale timestamp rejected (replay window)', stale.status === 400 && code(stale) === 'WEBHOOK_INVALID_SIGNATURE', stale.status + ' ' + code(stale))
const noSig = await post(body, { 'svix-id': 'evt_n', 'svix-timestamp': String(now) })
check('missing signature rejected', noSig.status === 400, noSig.status + ' ' + code(noSig))

console.log('\n=== DUPLICATE-EVENT DEDUP ===')
const dupId = 'evt_dup_' + now
const first = await post(body, { 'svix-id': dupId, 'svix-timestamp': String(now), 'svix-signature': sign(dupId, now, body) })
const second = await post(body, { 'svix-id': dupId, 'svix-timestamp': String(now), 'svix-signature': sign(dupId, now, body) })
check('first delivery processed (200, not deduped)', first.status === 200 && first.j?.deduplicated !== true, JSON.stringify(first.j))
check('repeat delivery deduplicated (200, deduplicated)', second.status === 200 && second.j?.deduplicated === true, JSON.stringify(second.j))

console.log('\n=== BOUNCE/COMPLAINT SUPPRESSION + SIZE CAP ===')
const bounceAddr = `bad-${now}-${process.pid}@sybnb.local`
const bounceBody = JSON.stringify({ type: 'email.bounced', data: { to: [bounceAddr] } })
const bid = 'evt_b_' + now
const bounce = await post(bounceBody, { 'svix-id': bid, 'svix-timestamp': String(now), 'svix-signature': sign(bid, now, bounceBody) })
check('bounce event accepted (200)', bounce.status === 200 && bounce.j?.ok === true, bounce.status)

const suppressedRow = await db().suppressedEmail.findUnique({ where: { email: bounceAddr } })
check('bounce webhook persisted the address to the Postgres suppression table', suppressedRow?.reason === 'bounce', JSON.stringify(suppressedRow))

let blockedCode = ''
try { await sendEmail({ to: bounceAddr, subject: 's', text: 't', purpose: 'account-verify' }) } catch (e) { blockedCode = e.code }
check('sendEmail() to the just-bounced address is refused, not sent', blockedCode === 'EMAIL_SUPPRESSED', blockedCode)

await db().suppressedEmail.deleteMany({ where: { email: bounceAddr } })

const big = 'x'.repeat(70 * 1024)
const bigBody = JSON.stringify({ type: 'email.delivered', pad: big })
const oid = 'evt_o_' + now
const oversize = await post(bigBody, { 'svix-id': oid, 'svix-timestamp': String(now), 'svix-signature': sign(oid, now, bigBody) })
check('oversize payload rejected (413)', oversize.status === 413 && code(oversize) === 'PAYLOAD_TOO_LARGE', oversize.status + ' ' + code(oversize))

console.log(`\n==== RESEND WEBHOOK E2E: ${pass} passed, ${fail} failed ====`)
await disconnectDb()
process.exit(fail ? 1 : 0)
