// Admin pricing over real HTTP: only an admin can read/save, a save is audited, and a rider's quote
// changes right after the save. Needs the API running on API_BASE (default 127.0.0.1:3051) and a throwaway DB.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createSessionToken } from './_session.mjs'
import { db } from '../../server/lib/prisma.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
const run = crypto.randomUUID().slice(0, 8)
let passed = 0; const failures = []
const t = async (name, fn) => { try { await fn(); passed += 1; console.log('PASS', name) } catch (e) { failures.push(name); console.log('FAIL', name, '\n   ', String(e.message).slice(0, 400)) } }
async function call(method, path, token, body) {
  const res = await fetch(API + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text(); let j; try { j = JSON.parse(text) } catch { j = { raw: text } }
  return { status: res.status, j, code: j?.error?.code }
}
const p = db()
const mk = async (label, role) => { const u = await p.user.create({ data: { email: `pr-${run}-${label}@example.invalid`, displayName: `Pr ${label}`, status: 'ACTIVE' } }); await p.userRole.create({ data: { userId: u.id, role } }); return { u, token: await createSessionToken({ id: u.id, roles: [{ role }] }) } }
const rider = await mk('rider', 'GUEST'); const admin = await mk('admin', 'ADMIN')
await p.adminSetting.deleteMany({ where: { category: 'pricing' } })
const quote = (category = 'SR Economy') => call('POST', '/api/sr/quote', rider.token, { pickup: 'Damascus, Malki', dropoff: 'Damascus, Mezzeh', category, currency: 'USD' })

let before, version
await t('a rider cannot read or change pricing', async () => {
  assert.equal((await call('GET', '/api/admin/sr/pricing', rider.token)).status, 403)
  assert.equal((await call('PUT', '/api/admin/sr/pricing', rider.token, { config: {}, reason: 'trying it out' })).status, 403)
})
await t('with nothing saved the old fixed prices run', async () => {
  const r = await call('GET', '/api/admin/sr/pricing', admin.token)
  assert.equal(r.status, 200, JSON.stringify(r.j).slice(0, 200)); assert.equal(r.j.stored, false); assert.equal(r.j.config.rates['SR Economy'].perKmUsd, 0.18)
  assert.ok(r.j.recommended.rates['SR Economy'].perKmUsd > 0.3)
  before = await quote(); assert.equal(before.status, 200, JSON.stringify(before.j).slice(0, 200))
})
await t('saving needs a written reason', async () => {
  const r = await call('PUT', '/api/admin/sr/pricing', admin.token, { config: { mode: 'formula' }, reason: 'x' })
  assert.equal(r.code, 'PRICING_REASON_REQUIRED')
})
let recommended
await t('the admin saves the recommended formula; the rider quote follows within the request', async () => {
  const view = (await call('GET', '/api/admin/sr/pricing', admin.token)).j
  recommended = view.recommended
  const r = await call('PUT', '/api/admin/sr/pricing', admin.token, { config: recommended, reason: 'Launch pricing from the cost study' })
  assert.equal(r.status, 200, JSON.stringify(r.j).slice(0, 300)); version = r.j.version
  const after = await quote()
  assert.notEqual(after.j.quote?.fareMinor ?? after.j.fareMinor, before.j.quote?.fareMinor ?? before.j.fareMinor)
})
await t('a demand surge saved by the admin raises the next quote, an old version cannot overwrite', async () => {
  const cur = (await quote()).j; const fare = cur.quote?.fareMinor ?? cur.fareMinor
  const surge = structuredClone(recommended); surge.multipliers.demand = 2
  const r = await call('PUT', '/api/admin/sr/pricing', admin.token, { config: surge, reason: 'Storm: demand up for today', expectedVersion: version })
  assert.equal(r.status, 200, JSON.stringify(r.j).slice(0, 300))
  const up = (await quote()).j; assert.ok((up.quote?.fareMinor ?? up.fareMinor) >= fare * 1.8)
  const stale = await call('PUT', '/api/admin/sr/pricing', admin.token, { config: recommended, reason: 'Stale edit should fail', expectedVersion: version })
  assert.equal(stale.code, 'PRICING_VERSION_CONFLICT')
})
await t('every save is in the audit log with its reason', async () => {
  const rows = await p.adminAuditLog.findMany({ where: { action: 'SR_PRICING_CHANGED', actorUserId: admin.u.id } })
  assert.equal(rows.length, 2); assert.ok(rows.some((x) => x.reason === 'Storm: demand up for today'))
})
await t('garbage numbers are clamped, never stored raw', async () => {
  const bad = structuredClone(recommended); bad.multipliers.demand = 9999; bad.costs.platformFeePct = -4; bad.fees.roundingUsd = 0
  const cur = (await call('GET', '/api/admin/sr/pricing', admin.token)).j
  const r = await call('PUT', '/api/admin/sr/pricing', admin.token, { config: bad, reason: 'Clamp check with bad input', expectedVersion: cur.version })
  assert.equal(r.status, 200)
  const v = (await call('GET', '/api/admin/sr/pricing', admin.token)).j.config
  assert.ok(v.multipliers.demand <= 5); assert.ok(v.costs.platformFeePct >= 0); assert.ok(v.fees.roundingUsd >= 1)
})
await p.adminSetting.deleteMany({ where: { category: 'pricing' } })
console.log(`\n${passed} passed, ${failures.length} failed`)
await p.$disconnect()
process.exit(failures.length ? 1 : 0)
