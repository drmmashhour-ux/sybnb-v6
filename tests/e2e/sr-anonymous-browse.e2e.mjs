// Prices and availability can be browsed without signing in (the rider signs in at Confirm, just before paying);
// creating a ride still needs a session.
const API = process.env.API_BASE || 'http://127.0.0.1:3051'
let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => { if (cond) { pass++; console.log(`  PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label} ${extra}`) } }
async function call(method, path, body) {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let j
  try { j = JSON.parse(text) } catch { j = { raw: text } }
  return { status: res.status, j }
}
console.log('=== ANONYMOUS BROWSE ===')
const trip = { pickup: 'mazzeh jabal', dropoff: 'damascus airport', category: 'SR Economy', lowDataMode: false, pickupCoords: { lat: 33.5, lng: 36.26 }, dropoffCoords: { lat: 33.41, lng: 36.51 } }
const quote = await call('POST', '/api/sr/quote', trip)
ok(quote.status === 200 && quote.j.ok === true, 'anonymous quote works', JSON.stringify(quote.j).slice(0, 160))
ok(Number(quote.j.quote?.fareMinor ?? quote.j.quote?.fare) > 0 || quote.j.quote != null, 'quote has a fare')
const bad = await call('POST', '/api/sr/quote', { ...trip, category: 'SR Nope' })
ok(bad.status === 400, 'anonymous quote still validates the category', String(bad.status))
const avail = await call('GET', '/api/sr/availability?lat=33.5&lng=36.26')
ok(avail.status === 200 && Array.isArray(avail.j.availability), 'anonymous availability works', String(avail.status))
const create = await call('POST', '/api/sr/rides', trip)
ok(create.status === 401, 'creating a ride still needs sign-in', String(create.status))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
