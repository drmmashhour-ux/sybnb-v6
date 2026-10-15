// SYBNB — SE (Eats) Phase 1: full food-order loop + role gates (2026-10-15).
//
// Proves, against the real HTTP API:
//   merchant registers → is NOT sellable until an ADMIN approves → owner builds a menu →
//   customer orders (server-side pricing, snapshots, cash-only) → merchant accepts → prepares →
//   ready → a vetted courier claims (double-claim refused) → picked up → delivered,
// plus the negative space: ordering from an unapproved merchant 403s, client prices are ignored,
// wrong-role transitions 403, invalid transitions 409, customer cancel only while PLACED.
//
// Synthetic fixtures only (owner/customer/courier created here, removed at the end), same
// discipline as sr-vip-bonus: cleanup is a real CHECK so residue is loud, never silent.
// Run: node tests/e2e/food-order.e2e.mjs   (API_BASE default http://127.0.0.1:3051)
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
  const stale = await db().user.findMany({ where: { email: { startsWith: 'eats-' } }, select: { id: true } })
  const all = [...new Set([...stale.map((u) => u.id), ...Object.values(ids)])]
  if (!all.length) return
  await db().foodOrder.deleteMany({ where: { OR: [{ customerId: { in: all } }, { courierId: { in: all } }, { merchant: { ownerId: { in: all } } }] } })
  await db().merchant.deleteMany({ where: { ownerId: { in: all } } })
  await db().adminAuditLog.deleteMany({ where: { actorUserId: { in: all } } })
  await db().adminAuditLog.deleteMany({ where: { entityType: 'user', entityId: { in: all } } })
  await db().user.deleteMany({ where: { id: { in: all } } })
}

await cleanup().catch(() => {})
await db().user.create({ data: { id: ids.owner, email: `eats-owner-${RUN}@sybnb.test`, displayName: 'eats owner', status: 'ACTIVE', roles: { create: [{ role: 'GUEST' }] } } })
await db().user.create({ data: { id: ids.customer, email: `eats-customer-${RUN}@sybnb.test`, displayName: 'eats customer', status: 'ACTIVE', roles: { create: [{ role: 'GUEST' }] } } })
await db().user.create({
  data: {
    id: ids.courier, email: `eats-courier-${RUN}@sybnb.test`, displayName: 'eats courier', status: 'ACTIVE', idDocumentStatus: 'APPROVED',
    roles: { create: [{ role: 'DRIVER' }] },
    driverProfile: { create: { vehicleMake: 'Honda', vehicleModel: 'Wave', vehiclePlate: `EAT-${RUN % 100000}`, vehicleYear: 2023, vehicleCategory: 'BIKE', vehicleStatus: 'APPROVED', inspectionStatus: 'PASSED', active: true } },
  },
})
await db().user.create({ data: { id: ids.admin, email: `eats-admin-${RUN}@sybnb.test`, displayName: 'eats admin', status: 'ACTIVE', roles: { create: [{ role: 'ADMIN' }] } } })

const ownerT = await createSessionToken({ id: ids.owner, roles: [{ role: 'GUEST' }] })
const custT = await createSessionToken({ id: ids.customer, roles: [{ role: 'GUEST' }] })
const courT = await createSessionToken({ id: ids.courier, roles: [{ role: 'DRIVER' }] })
const adminT = await createSessionToken({ id: ids.admin, roles: [{ role: 'ADMIN' }] })

console.log('=== SE (EATS) PHASE 1 — FULL ORDER LOOP ===')

// 1. Merchant onboarding is fail-closed.
const reg = await call('POST', '/api/food/merchants', ownerT, { name: `Shawarma House ${RUN}`, nameAr: 'بيت الشاورما', city: 'Damascus', address: 'Malki, main street', phone: '0999999999' })
const merchantId = reg.j?.merchant?.id
check('1a. merchant registered (201, PENDING_REVIEW)', reg.status === 201 && reg.j?.merchant?.status === 'PENDING_REVIEW', JSON.stringify(reg.j).slice(0, 160))
const earlyMenuAdd = await call('POST', `/api/food/merchants/${merchantId}/menu`, ownerT, { name: 'Shawarma wrap', priceMinor: 25000 })
check('1b. owner can build the menu while pending', earlyMenuAdd.status === 201, `${earlyMenuAdd.status} ${code(earlyMenuAdd)}`)
const itemA = earlyMenuAdd.j?.item
const itemBRes = await call('POST', `/api/food/merchants/${merchantId}/menu`, ownerT, { name: 'Fattoush', priceMinor: 15000 })
const itemB = itemBRes.j?.item
const earlyOrder = await call('POST', '/api/food/orders', custT, { merchantId, deliveryAddress: 'Mezzeh, bldg 4', items: [{ menuItemId: itemA.id, quantity: 1 }] })
check('1c. ordering from an UNAPPROVED merchant is refused', earlyOrder.status === 403 && code(earlyOrder) === 'MERCHANT_NOT_AVAILABLE', `${earlyOrder.status} ${code(earlyOrder)}`)
const stranger = await call('POST', `/api/food/merchants/${merchantId}/menu`, custT, { name: 'hack', priceMinor: 1 })
check('1d. a non-owner cannot touch the menu', stranger.status === 403 && code(stranger) === 'MERCHANT_NOT_OWNER', `${stranger.status} ${code(stranger)}`)
const approveByGuest = await call('PATCH', `/api/food/merchants/${merchantId}/status`, ownerT, { status: 'APPROVED' })
check('1e. owner cannot self-approve (ADMIN only)', approveByGuest.status === 403, `${approveByGuest.status} ${code(approveByGuest)}`)
const approve = await call('PATCH', `/api/food/merchants/${merchantId}/status`, adminT, { status: 'APPROVED' })
check('1f. ADMIN approves the merchant', approve.status === 200 && approve.j?.merchant?.status === 'APPROVED', JSON.stringify(approve.j).slice(0, 160))
const listing = await call('GET', '/api/food/merchants?city=Damascus', custT)
check('1g. approved merchant appears in the city listing', listing.status === 200 && listing.j?.merchants?.some((m) => m.id === merchantId), JSON.stringify(listing.j).slice(0, 160))

// 2. Server-side pricing: totals come from the menu, client prices are ignored.
const order1 = await call('POST', '/api/food/orders', custT, {
  merchantId,
  deliveryAddress: 'Mezzeh, bldg 4',
  notes: 'extra garlic',
  items: [
    { menuItemId: itemA.id, quantity: 2, priceMinor: 1 }, // client-supplied price must be ignored
    { menuItemId: itemB.id, quantity: 1 },
  ],
})
const o1 = order1.j?.order
check('2a. order placed (201)', order1.status === 201 && Boolean(o1?.id), JSON.stringify(order1.j).slice(0, 200))
check('2b. subtotal priced from the MENU, not the client (2x25000 + 15000)', o1?.subtotalMinor === 65000 && o1?.totalMinor >= 65000, `subtotal=${o1?.subtotalMinor} total=${o1?.totalMinor}`)
check('2c. items snapshotted (name + price at order time)', o1?.items?.length === 2 && o1.items.every((i) => i.nameSnapshot && i.priceMinorSnapshot > 0), JSON.stringify(o1?.items))
const cardOrder = await call('POST', '/api/food/orders', custT, { merchantId, deliveryAddress: 'x', items: [{ menuItemId: itemA.id, quantity: 1 }], paymentMethod: 'card' })
check('2d. non-cash payment refused in Phase 1', cardOrder.status === 400 && code(cardOrder) === 'PAYMENT_METHOD_UNSUPPORTED', `${cardOrder.status} ${code(cardOrder)}`)

// 3. Lifecycle, role-gated.
const custAccept = await call('PATCH', `/api/food/orders/${o1.id}/status`, custT, { status: 'ACCEPTED' })
check('3a. customer cannot ACCEPT their own order (merchant-only)', custAccept.status === 403, `${custAccept.status} ${code(custAccept)}`)
const accept = await call('PATCH', `/api/food/orders/${o1.id}/status`, ownerT, { status: 'ACCEPTED' })
check('3b. merchant accepts', accept.status === 200 && accept.j?.order?.status === 'ACCEPTED', JSON.stringify(accept.j).slice(0, 160))
const lateCancel = await call('PATCH', `/api/food/orders/${o1.id}/status`, custT, { status: 'CANCELLED' })
check('3c. customer cancel after acceptance is refused (409)', lateCancel.status === 409, `${lateCancel.status} ${code(lateCancel)}`)
const skip = await call('PATCH', `/api/food/orders/${o1.id}/status`, ownerT, { status: 'DELIVERED' })
check('3d. skipping the lifecycle is refused (409)', skip.status === 409 && code(skip) === 'ORDER_TRANSITION_INVALID', `${skip.status} ${code(skip)}`)
await call('PATCH', `/api/food/orders/${o1.id}/status`, ownerT, { status: 'PREPARING' })
const ready = await call('PATCH', `/api/food/orders/${o1.id}/status`, ownerT, { status: 'READY_FOR_PICKUP' })
check('3e. merchant: PREPARING -> READY_FOR_PICKUP', ready.status === 200 && ready.j?.order?.status === 'READY_FOR_PICKUP' && Boolean(ready.j?.order?.readyAt), JSON.stringify(ready.j).slice(0, 160))

// 4. Courier claim + delivery.
const pending = await call('GET', '/api/food/courier/pending', courT)
check('4a. order visible in the courier pending queue', pending.status === 200 && pending.j?.orders?.some((o) => o.id === o1.id), JSON.stringify(pending.j).slice(0, 160))
const claim = await call('PATCH', `/api/food/orders/${o1.id}/claim`, courT)
check('4b. vetted courier claims the order', claim.status === 200 && claim.j?.order?.courierId === ids.courier, `${claim.status} ${JSON.stringify(claim.j).slice(0, 160)}`)
const doubleClaim = await call('PATCH', `/api/food/orders/${o1.id}/claim`, courT)
check('4c. second claim refused (already assigned)', doubleClaim.status === 409 && code(doubleClaim) === 'ORDER_NOT_CLAIMABLE', `${doubleClaim.status} ${code(doubleClaim)}`)
const custPickup = await call('PATCH', `/api/food/orders/${o1.id}/status`, custT, { status: 'PICKED_UP' })
check('4d. customer cannot mark PICKED_UP (courier-only)', custPickup.status === 403, `${custPickup.status} ${code(custPickup)}`)
const pickup = await call('PATCH', `/api/food/orders/${o1.id}/status`, courT, { status: 'PICKED_UP' })
check('4e. courier picks up', pickup.status === 200 && pickup.j?.order?.status === 'PICKED_UP', JSON.stringify(pickup.j).slice(0, 160))
const deliver = await call('PATCH', `/api/food/orders/${o1.id}/status`, courT, { status: 'DELIVERED' })
check('4f. courier delivers (timestamped)', deliver.status === 200 && deliver.j?.order?.status === 'DELIVERED' && Boolean(deliver.j?.order?.deliveredAt), JSON.stringify(deliver.j).slice(0, 160))

// 5. Customer cancel window + visibility scoping.
const order2 = await call('POST', '/api/food/orders', custT, { merchantId, deliveryAddress: 'Malki', items: [{ menuItemId: itemB.id, quantity: 1 }] })
const o2 = order2.j?.order
const cancel = await call('PATCH', `/api/food/orders/${o2.id}/status`, custT, { status: 'CANCELLED' })
check('5a. customer cancels while still PLACED', cancel.status === 200 && cancel.j?.order?.status === 'CANCELLED', JSON.stringify(cancel.j).slice(0, 160))
const peek = await call('GET', `/api/food/orders/${o1.id}`, ownerT)
check('5b. merchant owner can view its order', peek.status === 200, `${peek.status}`)
const strangerPeek = await call('GET', `/api/food/orders/${o2.id}`, courT)
check('5c. a non-party (courier never assigned to this order) is refused (403)', strangerPeek.status === 403 && code(strangerPeek) === 'ORDER_FORBIDDEN', `${strangerPeek.status} ${code(strangerPeek)}`)

let cleanupError = null
await cleanup().catch((err) => { cleanupError = err })
check('cleanup removed all suite fixtures (no residue for later suites)', !cleanupError, cleanupError?.message?.slice(0, 200))
await disconnectDb()
console.log(`\n=== SE EATS PHASE 1 RESULT: ${pass} passed, ${fail} failed ===`)
process.exit(fail ? 1 : 0)
