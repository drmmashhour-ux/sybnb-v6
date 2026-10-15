// SYBNB — SE (Eats) Menu Studio: verified photos + promotions (2026-10-15).
//
// Proves, against the real HTTP API:
//   PHOTOS  — upload standards are enforced server-side (garbage/too-small refused with the exact
//             reason); a passing upload lands PENDING_REVIEW; the photo is INVISIBLE to customers
//             until an ADMIN approves it in the review queue; rejection requires a note the
//             merchant sees; re-upload resets the review; files carrying an editing-software
//             signature (Photoshop etc.) are flagged in the queue evidence for the human reviewer.
//   PROMOS  — a promo price must be a whole amount strictly below base; the EFFECTIVE price is
//             computed server-side at order time (active window → promo, expired → base) and
//             snapshotted, with metadata.promoApplied as the audit trail. This is the explicit,
//             tested money-semantics change required by AGENTS.md §6.
//
// Synthetic fixtures only (eats-studio-* users), cleanup is a real CHECK — residue is loud.
// Run: node tests/e2e/food-menu-studio.e2e.mjs   (API_BASE default http://127.0.0.1:3051)
import { randomUUID } from 'node:crypto'
import zlib from 'node:zlib'
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

// --- Real PNG generator (solid color, correct CRCs) so the server's header parser sees a true image.
function crc32(buf) {
  const table = []
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c }
  let c = 0xffffffff
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function makePng(width, height, rgb = [200, 80, 40]) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3)])
  for (let x = 0; x < width; x++) { row[1 + x * 3] = rgb[0]; row[2 + x * 3] = rgb[1]; row[3 + x * 3] = rgb[2] }
  const raw = Buffer.concat(Array(height).fill(row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0)),
  ])
}
const GOOD_PNG = makePng(800, 600).toString('base64')
const SMALL_PNG = makePng(300, 200).toString('base64')
// A valid PNG carrying an editing-software signature in a tEXt chunk — like a real exported file.
const FLAGGED_PNG = (() => {
  const base = makePng(800, 600, [40, 120, 200])
  const text = pngChunk('tEXt', Buffer.from('Software\0Adobe Photoshop 2026', 'latin1'))
  // insert before IEND (last 12 bytes)
  return Buffer.concat([base.subarray(0, base.length - 12), text, base.subarray(base.length - 12)]).toString('base64')
})()

const RUN = Date.now()
const ids = { owner: randomUUID(), customer: randomUUID(), admin: randomUUID() }

async function cleanup() {
  const stale = await db().user.findMany({ where: { email: { startsWith: 'eats-studio-' } }, select: { id: true } })
  const all = [...new Set([...stale.map((u) => u.id), ...Object.values(ids)])]
  if (!all.length) return
  await db().foodOrder.deleteMany({ where: { OR: [{ customerId: { in: all } }, { courierId: { in: all } }, { merchant: { ownerId: { in: all } } }] } })
  await db().merchant.deleteMany({ where: { ownerId: { in: all } } })
  await db().adminAuditLog.deleteMany({ where: { actorUserId: { in: all } } })
  await db().adminAuditLog.deleteMany({ where: { entityType: 'user', entityId: { in: all } } })
  await db().user.deleteMany({ where: { id: { in: all } } })
}

await cleanup().catch(() => {})
await db().user.create({ data: { id: ids.owner, email: `eats-studio-owner-${RUN}@sybnb.test`, displayName: 'studio owner', status: 'ACTIVE', roles: { create: [{ role: 'GUEST' }] } } })
await db().user.create({ data: { id: ids.customer, email: `eats-studio-cust-${RUN}@sybnb.test`, displayName: 'studio customer', status: 'ACTIVE', roles: { create: [{ role: 'GUEST' }] } } })
await db().user.create({ data: { id: ids.admin, email: `eats-studio-admin-${RUN}@sybnb.test`, displayName: 'studio admin', status: 'ACTIVE', roles: { create: [{ role: 'ADMIN' }] } } })

const ownerT = await createSessionToken({ id: ids.owner, roles: [{ role: 'GUEST' }] })
const custT = await createSessionToken({ id: ids.customer, roles: [{ role: 'GUEST' }] })
const adminT = await createSessionToken({ id: ids.admin, roles: [{ role: 'ADMIN' }] })

console.log('=== SE (EATS) MENU STUDIO — VERIFIED PHOTOS + PROMOTIONS ===')

// 0. Fixture store: registered, admin-approved, one menu item at 20000.
const reg = await call('POST', '/api/food/merchants', ownerT, { name: `Studio Grill ${RUN}`, nameAr: 'مشاوي الاستوديو', city: 'Damascus', address: 'Bab Touma 12' })
const merchantId = reg.j?.merchant?.id
await call('PATCH', `/api/food/merchants/${merchantId}/status`, adminT, { status: 'APPROVED' })
const itemRes = await call('POST', `/api/food/merchants/${merchantId}/menu`, ownerT, { name: 'Mixed grill', nameAr: 'مشاوي مشكلة', priceMinor: 20000 })
const item = itemRes.j?.item
check('0a. fixture store approved + item created', Boolean(merchantId) && itemRes.status === 201 && item?.priceMinor === 20000, JSON.stringify(itemRes.j).slice(0, 160))

// 1. Upload standards are enforced server-side, with the exact reason.
const garbage = await call('PATCH', `/api/food/menu/${item.id}/photo`, ownerT, { fileBase64: Buffer.from('not an image at all').toString('base64'), mimeType: 'image/png' })
check('1a. garbage bytes refused (PHOTO_UNREADABLE)', garbage.status === 400 && code(garbage) === 'PHOTO_UNREADABLE', `${garbage.status} ${code(garbage)}`)
const small = await call('PATCH', `/api/food/menu/${item.id}/photo`, ownerT, { fileBase64: SMALL_PNG, mimeType: 'image/png' })
check('1b. 300×200 refused (PHOTO_TOO_SMALL, min 640×480)', small.status === 400 && code(small) === 'PHOTO_TOO_SMALL', `${small.status} ${code(small)}`)
const badType = await call('PATCH', `/api/food/menu/${item.id}/photo`, ownerT, { fileBase64: GOOD_PNG, mimeType: 'image/gif' })
check('1c. unsupported type refused', badType.status === 400, `${badType.status} ${code(badType)}`)
const strangerUp = await call('PATCH', `/api/food/menu/${item.id}/photo`, custT, { fileBase64: GOOD_PNG, mimeType: 'image/png' })
check('1d. a non-owner cannot upload (403)', strangerUp.status === 403 && code(strangerUp) === 'MERCHANT_NOT_OWNER', `${strangerUp.status} ${code(strangerUp)}`)
const up = await call('PATCH', `/api/food/menu/${item.id}/photo`, ownerT, { fileBase64: GOOD_PNG, mimeType: 'image/png' })
check('1e. valid 800×600 accepted → PENDING_REVIEW with meta evidence', up.status === 200 && up.j?.item?.photoStatus === 'PENDING_REVIEW' && up.j?.item?.photoMeta?.width === 800 && up.j?.item?.photoMeta?.height === 600, JSON.stringify(up.j).slice(0, 200))
check('1f. clean file carries no editor signature', up.j?.item?.photoMeta?.editorSignature === null || up.j?.item?.photoMeta?.editorSignature === undefined, JSON.stringify(up.j?.item?.photoMeta))

// 2. Fail-closed moderation: pending photo is invisible to customers, visible to the owner.
const custMenu1 = await call('GET', `/api/food/merchants/${merchantId}/menu`, custT)
const custItem1 = custMenu1.j?.items?.find((row) => row.id === item.id)
check('2a. customer does NOT see the pending photo', custMenu1.status === 200 && custItem1 && custItem1.photoUrl == null, JSON.stringify(custItem1).slice(0, 200))
const ownMenu1 = await call('GET', `/api/food/merchants/${merchantId}/menu`, ownerT)
const ownItem1 = ownMenu1.j?.items?.find((row) => row.id === item.id)
check('2b. owner sees their own pending photo + status', Boolean(ownItem1?.photoUrl) && ownItem1?.photoStatus === 'PENDING_REVIEW', JSON.stringify(ownItem1).slice(0, 200))

// 3. Admin review queue: reject needs a note, the merchant sees it, re-upload resets.
const q1 = await call('GET', '/api/food/admin/photos', adminT)
check('3a. photo sits in the admin queue', q1.status === 200 && q1.j?.queue?.some((e) => e.kind === 'menu-item' && e.id === item.id), JSON.stringify(q1.j).slice(0, 200))
const qByOwner = await call('GET', '/api/food/admin/photos', ownerT)
check('3b. the queue is ADMIN-only', qByOwner.status === 403, `${qByOwner.status}`)
const rejNoNote = await call('PATCH', `/api/food/admin/photos/menu-item/${item.id}`, adminT, { decision: 'REJECT' })
check('3c. rejection without a note is refused', rejNoNote.status === 400 && code(rejNoNote) === 'PHOTO_REJECT_NOTE_REQUIRED', `${rejNoNote.status} ${code(rejNoNote)}`)
const rej = await call('PATCH', `/api/food/admin/photos/menu-item/${item.id}`, adminT, { decision: 'REJECT', note: 'Photo is a stock image, not your actual dish.' })
check('3d. admin rejects with a note', rej.status === 200 && rej.j?.photoStatus === 'REJECTED', JSON.stringify(rej.j).slice(0, 160))
const ownMenu2 = await call('GET', `/api/food/merchants/${merchantId}/menu`, ownerT)
const ownItem2 = ownMenu2.j?.items?.find((row) => row.id === item.id)
check('3e. merchant sees the rejection reason', ownItem2?.photoStatus === 'REJECTED' && /stock image/.test(ownItem2?.photoReviewNote || ''), JSON.stringify(ownItem2).slice(0, 200))
const custMenu2 = await call('GET', `/api/food/merchants/${merchantId}/menu`, custT)
check('3f. rejected photo still invisible to customers', custMenu2.j?.items?.find((row) => row.id === item.id)?.photoUrl == null, 'photoUrl leaked')
const reUp = await call('PATCH', `/api/food/menu/${item.id}/photo`, ownerT, { fileBase64: GOOD_PNG, mimeType: 'image/png' })
check('3g. re-upload resets to PENDING_REVIEW and clears the note', reUp.status === 200 && reUp.j?.item?.photoStatus === 'PENDING_REVIEW' && !reUp.j?.item?.photoReviewNote, JSON.stringify(reUp.j?.item).slice(0, 200))
const approvePhoto = await call('PATCH', `/api/food/admin/photos/menu-item/${item.id}`, adminT, { decision: 'APPROVE' })
check('3h. admin approves the re-upload', approvePhoto.status === 200 && approvePhoto.j?.photoStatus === 'APPROVED', JSON.stringify(approvePhoto.j).slice(0, 160))
const custMenu3 = await call('GET', `/api/food/merchants/${merchantId}/menu`, custT)
const custItem3 = custMenu3.j?.items?.find((row) => row.id === item.id)
check('3i. APPROVED photo is now customer-visible (signed URL)', Boolean(custItem3?.photoUrl) && String(custItem3.photoUrl).includes('/api/storage/food-photo/'), JSON.stringify(custItem3).slice(0, 200))

// 4. Editor-signature heuristic lands in the queue evidence (merchant cover photo).
const coverUp = await call('PATCH', `/api/food/merchants/${merchantId}/photo`, ownerT, { fileBase64: FLAGGED_PNG, mimeType: 'image/png' })
check('4a. cover upload accepted (flag is evidence, not a block)', coverUp.status === 200 && coverUp.j?.merchant?.photoStatus === 'PENDING_REVIEW', JSON.stringify(coverUp.j).slice(0, 200))
const q2 = await call('GET', '/api/food/admin/photos', adminT)
const coverEntry = q2.j?.queue?.find((e) => e.kind === 'merchant' && e.id === merchantId)
check('4b. queue evidence flags the editing-software signature', /Photoshop/.test(coverEntry?.photoMeta?.editorSignature || ''), JSON.stringify(coverEntry).slice(0, 220))
const coverOk = await call('PATCH', `/api/food/admin/photos/merchant/${merchantId}`, adminT, { decision: 'APPROVE' })
const browse = await call('GET', '/api/food/merchants?city=Damascus', custT)
const browsed = browse.j?.merchants?.find((m) => m.id === merchantId)
check('4c. approved cover shows in the customer browse list', coverOk.status === 200 && Boolean(browsed?.photoUrl), JSON.stringify(browsed).slice(0, 200))

// 5. Promotions: validated, time-windowed, priced server-side, snapshotted, audited.
const promoTooHigh = await call('PATCH', `/api/food/menu/${item.id}`, ownerT, { promoPriceMinor: 20000 })
check('5a. promo >= base price refused (no fake discounts)', promoTooHigh.status === 400 && code(promoTooHigh) === 'MENU_PROMO_PRICE_INVALID', `${promoTooHigh.status} ${code(promoTooHigh)}`)
const badWindow = await call('PATCH', `/api/food/menu/${item.id}`, ownerT, { promoPriceMinor: 12000, promoStartsAt: new Date(Date.now() + 3600e3).toISOString(), promoEndsAt: new Date(Date.now() + 1800e3).toISOString() })
check('5b. inverted promo window refused', badWindow.status === 400 && code(badWindow) === 'MENU_PROMO_WINDOW_INVALID', `${badWindow.status} ${code(badWindow)}`)
const promoSet = await call('PATCH', `/api/food/menu/${item.id}`, ownerT, { promoPriceMinor: 12000, promoLabel: 'عرض الافتتاح', promoStartsAt: new Date(Date.now() - 3600e3).toISOString(), promoEndsAt: new Date(Date.now() + 3600e3).toISOString() })
check('5c. live promo set (12000 under base 20000)', promoSet.status === 200 && promoSet.j?.item?.promoActive === true && promoSet.j?.item?.effectivePriceMinor === 12000, JSON.stringify(promoSet.j?.item).slice(0, 200))
const custMenu4 = await call('GET', `/api/food/merchants/${merchantId}/menu`, custT)
const custItem4 = custMenu4.j?.items?.find((row) => row.id === item.id)
check('5d. customer sees promo price + label', custItem4?.effectivePriceMinor === 12000 && custItem4?.promoActive === true && Boolean(custItem4?.promoLabel), JSON.stringify(custItem4).slice(0, 200))
const promoOrder = await call('POST', '/api/food/orders', custT, { merchantId, deliveryAddress: 'Mezzeh', items: [{ menuItemId: item.id, quantity: 2 }] })
const po = promoOrder.j?.order
check('5e. order priced at the PROMO price server-side (2×12000)', promoOrder.status === 201 && po?.subtotalMinor === 24000, `subtotal=${po?.subtotalMinor}`)
check('5f. snapshot records the effective price', po?.items?.[0]?.priceMinorSnapshot === 12000, JSON.stringify(po?.items))
check('5g. metadata.promoApplied audits the discount (base 20000 → 12000)', po?.metadata?.promoApplied?.[0]?.basePriceMinor === 20000 && po?.metadata?.promoApplied?.[0]?.promoPriceMinor === 12000, JSON.stringify(po?.metadata).slice(0, 200))
const expire = await call('PATCH', `/api/food/menu/${item.id}`, ownerT, { promoPriceMinor: 12000, promoStartsAt: new Date(Date.now() - 7200e3).toISOString(), promoEndsAt: new Date(Date.now() - 3600e3).toISOString() })
check('5h. expired promo no longer active', expire.status === 200 && expire.j?.item?.promoActive === false && expire.j?.item?.effectivePriceMinor === 20000, JSON.stringify(expire.j?.item).slice(0, 200))
const baseOrder = await call('POST', '/api/food/orders', custT, { merchantId, deliveryAddress: 'Mezzeh', items: [{ menuItemId: item.id, quantity: 1 }] })
check('5i. expired promo orders at BASE price (20000), no promo audit', baseOrder.j?.order?.subtotalMinor === 20000 && !baseOrder.j?.order?.metadata?.promoApplied, `subtotal=${baseOrder.j?.order?.subtotalMinor} meta=${JSON.stringify(baseOrder.j?.order?.metadata).slice(0, 120)}`)
const clear = await call('PATCH', `/api/food/menu/${item.id}`, ownerT, { promoPriceMinor: null })
check('5j. clearing the promo wipes price, label and window', clear.status === 200 && clear.j?.item?.promoPriceMinor == null && clear.j?.item?.promoLabel == null, JSON.stringify(clear.j?.item).slice(0, 200))

let cleanupError = null
await cleanup().catch((err) => { cleanupError = err })
check('cleanup removed all suite fixtures (no residue for later suites)', !cleanupError, cleanupError?.message?.slice(0, 200))
await disconnectDb()
console.log(`\n=== SE EATS MENU STUDIO RESULT: ${pass} passed, ${fail} failed ===`)
process.exit(fail ? 1 : 0)
