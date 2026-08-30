import { createSessionToken } from './_session.mjs'

const API = 'http://127.0.0.1:3051'

// Real users from sybnb_v6_dev
const guest = { id: process.env.BUYER || 'b2cf0295-8b24-4be0-a014-8b9321c44e0a', roles: [{ role: 'GUEST' }] }

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let j
  try { j = JSON.parse(text) } catch { j = { raw: text } }
  return { status: res.status, j }
}

function line(label, r) {
  const s = r.j?.ride?.status
  const code = r.j?.error?.code || r.j?.code
  console.log(`${label.padEnd(34)} http=${r.status} status=${s || '-'} ${code ? '['+code+']' : ''}`)
  return r
}

const gToken = await createSessionToken(guest)

console.log('=== GUEST RIDER LOOP ===')
const created = line('create ride', await call('POST', '/api/sr/rides', gToken, {
  pickup: 'Damascus, Malki', dropoff: 'Damascus, Mezzeh', category: 'SR Economy', currency: 'SYP', lowDataMode: true,
}))
const rideId = created.j?.ride?.id
console.log('   rideId =', rideId)

// pick a driver — grab pending list as driver, or assign via admin. First find a DRIVER user.
const driver = { id: process.env.DRIVER_ID, roles: [{ role: 'DRIVER' }] }
const dToken = await createSessionToken(driver)

// Driver sees it pending, claims it
line('driver: pending list', await call('GET', '/api/driver/rides/pending', dToken))
line('driver: claim ride', await call('PATCH', `/api/sr/rides/${rideId}/claim`, dToken))
line('driver: -> ARRIVING', await call('PATCH', `/api/driver/rides/${rideId}/status`, dToken, { status: 'DRIVER_ARRIVING' }))

// Rider can still cancel while arriving
console.log('--- test rider cancel is blocked once IN_PROGRESS ---')
line('driver: -> IN_PROGRESS', await call('PATCH', `/api/driver/rides/${rideId}/status`, dToken, { status: 'IN_PROGRESS' }))
line('rider: cancel (expect BLOCK)', await call('PATCH', `/api/sr/rides/${rideId}/cancel`, gToken))
line('driver: -> COMPLETED', await call('PATCH', `/api/driver/rides/${rideId}/status`, dToken, { status: 'COMPLETED' }))
line('rider: view final', await call('GET', `/api/sr/rides/${rideId}`, gToken))

console.log('\n=== SECOND RIDE: rider cancels before pickup ===')
const created2 = line('create ride 2', await call('POST', '/api/sr/rides', gToken, {
  pickup: 'Damascus, Shaalan', dropoff: 'Damascus, Abu Rummaneh', category: 'SR Comfort', currency: 'SYP', lowDataMode: true,
}))
const rideId2 = created2.j?.ride?.id
line('rider: cancel (expect OK)', await call('PATCH', `/api/sr/rides/${rideId2}/cancel`, gToken))
line('rider: cancel again (expect BLOCK)', await call('PATCH', `/api/sr/rides/${rideId2}/cancel`, gToken))
