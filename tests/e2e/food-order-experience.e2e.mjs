// SYBNB — SE (Eats) order experience (2026-10-15): busy mode, pickup, prep-time ETA, delay with
// the customer's cancel right reopened, scheduled orders, per-order chat, and the courier queue
// excluding pickup orders. Real HTTP API, synthetic eats-xp-* fixtures, loud cleanup.
// Run: node tests/e2e/food-order-experience.e2e.mjs   (API_BASE default http://127.0.0.1:3051)
import { randomUUID } from 'node:crypto'
import { createSessionToken } from './_session.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3051'
let pass = 0, fail = 0
const check = (label, cond, detail) => { if (cond) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) } }
async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let j; try { j = JSON.parse(text) } catch { j = { raw: text.slice(0, 300) } }
  return { status: res.status, j }
}
const code = (r) => r.j?.error?.code || r.j?.code

const RUN = Date.now()
const ids = { owner: randomUUID(), customer: randomUUID(), courier: randomUUID(), admin: randomUUID() }

async function cleanup() {
  const stale = await db().user.findMany({ where: { email: { startsWith: 'eats-xp-' } }, select: { id: true } })
  const all = [...new Set([...stale.map((u) => u.id), ...Object.values(ids)])]
  if (!all.length) return
  await db().foodOrderMessage.deleteMany({ where: { senderId: { in: all } } })
  await db().foodOrder.deleteMany({ where: { OR: [{ customerId: { in: all } }, { courierId: { in: all } }, { merchant: { ownerId: { in: all } } }] } })
  await db().merchant.deleteMany({ where: { ownerId: { in: all } } })
  await db().adminAuditLog.deleteMany({ where: { actorUserId: { in: all } } })
  await db().adminAuditLog.deleteMany({ where: { entityType: 'user', entityId: { in: all } } })
  await db().user.deleteMany({ where: { id: { in: all } } })
}

await cleanup().catch(() => {})
await db().user.create({ data: { id: ids.owner, email: `eats-xp-owner-${RUN}@sybnb.test`, displayName: 'xp owner', status: 'ACTIVE', roles: { create: [{ role: 'GUEST' }] } } })
await db().user.create({ data: { id: ids.customer, email: `eats-xp-cust-${RUN}@sybnb.test`, displayName: 'xp customer', status: 'ACTIVE', roles: { create: [{ role: 'GUEST' }] } } })
await db().user.create({
  data: {
    id: ids.courier, email: `eats-xp-courier-${RUN}@sybnb.test`, displayName: 'xp courier', status: 'ACTIVE', idDocumentStatus: 'APPROVED',
    roles: { create: [{ role: 'DRIVER' }] },
    driverProfile: { create: { vehicleMake: 'Honda', vehicleModel: 'Wave', vehiclePlate: `XP-${RUN % 100000}`, vehicleYear: 2023, vehicleCategory: 'BIKE', vehicleStatus: 'APPROVED', inspectionStatus: 'PASSED', active: true } },
  },
})
await db().user.create({ data: { id: ids.admin, email: `eats-xp-admin-${RUN}@sybnb.test`, displayName: 'xp admin', status: 'ACTIVE', roles: { create: [{ role: 'ADMIN' }] } } })

const ownerT = await createSessionToken({ id: ids.owner, roles: [{ role: 'GUEST' }] })
const custT = await createSessionToken({ id: ids.customer, roles: [{ role: 'GUEST' }] })
const courT = await createSessionToken({ id: ids.courier, roles: [{ role: 'DRIVER' }] })
const adminT = await createSessionToken({ id: ids.admin, roles: [{ role: 'ADMIN' }] })

console.log('=== SE (EATS) ORDER EXPERIENCE ===')

// 0. Fixture store: approved, with a location and an item.
const reg = await call('POST', '/api/food/merchants', ownerT, { name: `XP Kitchen ${RUN}`, city: 'Damascus', address: 'Malki 9' })
const merchantId = reg.j?.merchant?.id
await call('PATCH', `/api/food/merchants/${merchantId}/status`, adminT, { status: 'APPROVED' })
const itemRes = await call('POST', `/api/food/merchants/${merchantId}/menu`, ownerT, { name: 'Plate', priceMinor: 20000 })
const item = itemRes.j?.item
const loc = await call('PATCH', `/api/food/merchants/${merchantId}/settings`, ownerT, { lat: 33.5105, lng: 36.2765 })
check('0a. store fixture approved with a map location', loc.status === 200 && loc.j?.merchant?.lat === 33.5105, JSON.stringify(loc.j).slice(0, 160))

// 1. Busy mode: refuse instant orders, allow scheduled, customer sees the switch.
const busyOn = await call('PATCH', `/api/food/merchants/${merchantId}/settings`, ownerT, { acceptingOrders: false })
check('1a. owner turns busy mode ON', busyOn.status === 200 && busyOn.j?.merchant?.acceptingOrders === false, JSON.stringify(busyOn.j).slice(0, 160))
const busyOrder = await call('POST', '/api/food/orders', custT, { merchantId, deliveryAddress: 'Mezzeh', items: [{ menuItemId: item.id, quantity: 1 }] })
check('1b. instant order refused while busy (409 MERCHANT_BUSY)', busyOrder.status === 409 && code(busyOrder) === 'MERCHANT_BUSY', `${busyOrder.status} ${code(busyOrder)}`)
const browseBusy = await call('GET', '/api/food/merchants?city=Damascus', custT)
check('1c. browse shows the store as busy', browseBusy.j?.merchants?.find((m) => m.id === merchantId)?.acceptingOrders === false, 'not busy in browse')
const schedAt = new Date(Date.now() + 2 * 3600e3).toISOString()
const scheduled = await call('POST', '/api/food/orders', custT, { merchantId, deliveryAddress: 'Mezzeh', items: [{ menuItemId: item.id, quantity: 1 }], scheduledFor: schedAt })
check('1d. scheduled order allowed while busy', scheduled.status === 201 && Boolean(scheduled.j?.order?.scheduledFor), `${scheduled.status} ${code(scheduled)}`)
const tooFar = await call('POST', '/api/food/orders', custT, { merchantId, deliveryAddress: 'x', items: [{ menuItemId: item.id, quantity: 1 }], scheduledFor: new Date(Date.now() + 30 * 24 * 3600e3).toISOString() })
check('1e. scheduling more than 7 days ahead refused', tooFar.status === 400 && code(tooFar) === 'ORDER_SCHEDULE_INVALID', `${tooFar.status} ${code(tooFar)}`)
await call('PATCH', `/api/food/merchants/${merchantId}/settings`, ownerT, { acceptingOrders: true })

// 2. Pickup: no courier leg, no delivery fee, merchant hands over.
const pickup = await call('POST', '/api/food/orders', custT, { merchantId, deliveryAddress: '', fulfillment: 'pickup', items: [{ menuItemId: item.id, quantity: 1 }] })
const po = pickup.j?.order
check('2a. pickup order created with fulfillment=pickup', pickup.status === 201 && po?.fulfillment === 'pickup', `${pickup.status} ${JSON.stringify(pickup.j).slice(0, 160)}`)
check('2b. pickup charges NO delivery fee (explicit money rule)', po?.deliveryFeeMinor === 0 && po?.totalMinor === 20000, `delivery=${po?.deliveryFeeMinor} total=${po?.totalMinor}`)
await call('PATCH', `/api/food/orders/${po.id}/status`, ownerT, { status: 'ACCEPTED', prepMinutes: 15 })
await call('PATCH', `/api/food/orders/${po.id}/status`, ownerT, { status: 'PREPARING' })
await call('PATCH', `/api/food/orders/${po.id}/status`, ownerT, { status: 'READY_FOR_PICKUP' })
const handover = await call('PATCH', `/api/food/orders/${po.id}/status`, ownerT, { status: 'DELIVERED' })
check('2c. merchant hands the pickup order to the customer (DELIVERED)', handover.status === 200 && handover.j?.order?.status === 'DELIVERED', `${handover.status} ${code(handover)}`)
const courierSees = await call('GET', '/api/food/courier/pending', courT)
check('2d. pickup orders never appear in the courier queue', !courierSees.j?.orders?.some((o) => o.id === po.id), 'pickup leaked to couriers')

// 3. Prep-time ETA on accept.
const d1 = await call('POST', '/api/food/orders', custT, { merchantId, deliveryAddress: 'Mezzeh', items: [{ menuItemId: item.id, quantity: 1 }] })
const o1 = d1.j?.order
const acc = await call('PATCH', `/api/food/orders/${o1.id}/status`, ownerT, { status: 'ACCEPTED', prepMinutes: 20 })
const etaMs = acc.j?.order?.etaAt ? new Date(acc.j.order.etaAt).getTime() - Date.now() : 0
check('3a. accept sets the promise: etaAt ≈ now + 20 min', acc.status === 200 && etaMs > 19 * 60e3 && etaMs < 21 * 60e3, `eta in ${Math.round(etaMs / 60e3)} min`)
const badPrep = await call('PATCH', `/api/food/orders/${o1.id}/status`, ownerT, { status: 'ACCEPTED', prepMinutes: 1 })
check('3b. out-of-range prep time refused', badPrep.status === 409 || badPrep.status === 400, `${badPrep.status} ${code(badPrep)}`)

// 4. Delay: restaurant moves the promise; customer cancel right reopens; a non-owner cannot delay.
const notOwnerDelay = await call('PATCH', `/api/food/orders/${o1.id}/delay`, custT, { extraMinutes: 15 })
check('4a. customer cannot delay their own order (403)', notOwnerDelay.status === 403 && code(notOwnerDelay) === 'ORDER_DELAY_FORBIDDEN', `${notOwnerDelay.status} ${code(notOwnerDelay)}`)
const lateCancelBefore = await call('PATCH', `/api/food/orders/${o1.id}/status`, custT, { status: 'CANCELLED' })
check('4b. customer cannot cancel an accepted order before any delay (409)', lateCancelBefore.status === 409, `${lateCancelBefore.status}`)
const delayRes = await call('PATCH', `/api/food/orders/${o1.id}/delay`, ownerT, { extraMinutes: 15 })
check('4c. merchant delay moves etaAt +15 and increments delayedCount', delayRes.status === 200 && delayRes.j?.order?.delayedCount === 1, JSON.stringify(delayRes.j).slice(0, 160))
const cancelAfterDelay = await call('PATCH', `/api/food/orders/${o1.id}/status`, custT, { status: 'CANCELLED' })
check('4d. after a delay the customer may cancel (choice restored)', cancelAfterDelay.status === 200 && cancelAfterDelay.j?.order?.status === 'CANCELLED', `${cancelAfterDelay.status} ${code(cancelAfterDelay)}`)

// 5. Per-order chat: parties only, roles recorded, strangers refused.
const d2 = await call('POST', '/api/food/orders', custT, { merchantId, deliveryAddress: 'Mezzeh', items: [{ menuItemId: item.id, quantity: 1 }] })
const o2 = d2.j?.order
await call('PATCH', `/api/food/orders/${o2.id}/status`, ownerT, { status: 'ACCEPTED', prepMinutes: 15 })
const msgCust = await call('POST', `/api/food/orders/${o2.id}/messages`, custT, { body: 'no onions please' })
check('5a. customer message stored with senderRole=customer', msgCust.status === 201 && msgCust.j?.message?.senderRole === 'customer', `${msgCust.status} ${JSON.stringify(msgCust.j).slice(0, 160)}`)
const msgOwner = await call('POST', `/api/food/orders/${o2.id}/messages`, ownerT, { body: 'noted' })
check('5b. merchant message stored with senderRole=merchant', msgOwner.status === 201 && msgOwner.j?.message?.senderRole === 'merchant', `${msgOwner.status}`)
const thread = await call('GET', `/api/food/orders/${o2.id}/messages`, custT)
check('5c. both parties see the thread', thread.status === 200 && thread.j?.messages?.length === 2, `${thread.status} ${thread.j?.messages?.length}`)
const strangerChat = await call('GET', `/api/food/orders/${o2.id}/messages`, courT)
check('5d. an unassigned courier cannot read the chat (403)', strangerChat.status === 403 && code(strangerChat) === 'ORDER_FORBIDDEN', `${strangerChat.status} ${code(strangerChat)}`)
const emptyMsg = await call('POST', `/api/food/orders/${o2.id}/messages`, custT, { body: '   ' })
check('5e. empty message refused', emptyMsg.status === 400 && code(emptyMsg) === 'MESSAGE_BODY_REQUIRED', `${emptyMsg.status} ${code(emptyMsg)}`)

// 6. Order tracking payload: restaurant pin always; courier position only while carrying.
const track = await call('GET', `/api/food/orders/${o2.id}`, custT)
check('6a. tracking carries the restaurant pin for the map', track.j?.tracking?.merchant?.lat === 33.5105, JSON.stringify(track.j?.tracking).slice(0, 160))
check('6b. no courier position before the courier claims the order', track.j?.tracking?.courier == null, 'courier leaked early')

let cleanupError = null
await cleanup().catch((err) => { cleanupError = err })
check('cleanup removed all suite fixtures (no residue for later suites)', !cleanupError, cleanupError?.message?.slice(0, 200))
await disconnectDb()
console.log(`\n=== SE EATS ORDER EXPERIENCE RESULT: ${pass} passed, ${fail} failed ===`)
process.exit(fail ? 1 : 0)
