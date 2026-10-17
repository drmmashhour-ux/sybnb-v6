// SYBNB — owner price re-verification E2E. Self-contained. Run: node tests/e2e/price-confirm.e2e.mjs
import { randomUUID } from 'node:crypto'
import { createSessionToken } from './_session.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
const RUN = randomUUID().slice(0, 8)
let pass = 0
let fail = 0
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`   PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}  -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`) }
}
async function call(method, path, token, body) {
  const res = await fetch(API + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, j: await res.json().catch(() => ({})) }
}
async function seed(label, roles) {
  const u = await db().user.create({ data: { email: `pc-${label}-${RUN}@example.test`, displayName: `PC ${label}`, locale: 'en', hostVerifiedAt: new Date(), roles: { create: roles.map((role) => ({ role })) } } })
  return { ...u, token: await createSessionToken({ id: u.id, roles: roles.map((role) => ({ role })) }) }
}

async function main() {
  console.log('=== PRICE CONFIRM E2E ===')
  const owner = await seed('owner', ['HOST', 'SELLER', 'GUEST'])
  const other = await seed('other', ['HOST', 'SELLER', 'GUEST'])
  const old = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const l = await db().listing.create({ data: { ownerId: owner.id, division: 'BUY', titleAr: `بيع ${RUN}`, titleEn: `Sale ${RUN}`, status: 'APPROVED', priceMinor: 500_000_000, currency: 'SYP', metadata: { priceConfirmedAt: old } } })
  const path = `/api/host/listings/${l.id}/confirm-price`

  check('anonymous -> 401', (await call('POST', path, null)).status === 401, 'not 401')
  check('another account -> 404', (await call('POST', path, other.token)).status === 404, 'not 404')
  check('GET -> 405', (await call('GET', path, owner.token)).status === 405, 'not 405')

  const r = await call('POST', path, owner.token)
  check('owner -> 200', r.status === 200, r)
  const after = await db().listing.findUnique({ where: { id: l.id } })
  check('stamp moved forward to now', Date.now() - Date.parse(after.metadata.priceConfirmedAt) < 60_000, after.metadata)
  check('listing stays APPROVED (no re-review)', after.status === 'APPROVED', after.status)
  check('price untouched', after.priceMinor === 500_000_000, after.priceMinor)
  check('audit row written', Boolean(await db().adminAuditLog.findFirst({ where: { entityId: l.id, action: 'HOST_LISTING_PRICE_CONFIRMED' } })), 'no audit')

  // A client patch can't forge the stamp.
  await db().listing.update({ where: { id: l.id }, data: { metadata: { priceConfirmedAt: old } } })
  await call('PATCH', `/api/host/listings/${l.id}`, owner.token, { metadata: { priceConfirmedAt: new Date().toISOString(), note: 'x' } })
  const forged = await db().listing.findUnique({ where: { id: l.id } })
  check('metadata patch cannot forge priceConfirmedAt', forged.metadata.priceConfirmedAt === old && forged.metadata.note === 'x', forged.metadata)

  // Changing the price stamps it.
  await call('PATCH', `/api/host/listings/${l.id}`, owner.token, { priceMinor: 450_000_000 })
  const repriced = await db().listing.findUnique({ where: { id: l.id } })
  check('changing the price refreshes the stamp', repriced.priceMinor === 450_000_000 && Date.now() - Date.parse(repriced.metadata.priceConfirmedAt) < 60_000, repriced.metadata)

  console.log(`\n==== PRICE CONFIRM E2E: ${pass} passed, ${fail} failed ====`)
}
try { await main() } catch (e) { fail++; console.error('UNCAUGHT', e) } finally { await disconnectDb() }
process.exit(fail ? 1 : 0)
