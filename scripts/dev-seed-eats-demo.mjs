// SYBNB — dev-only Eats demo fixtures (2026-10-15). Idempotent; NEVER for production.
// Seeds, into whatever DATABASE_URL is active (the dev script points it at the throwaway test DB):
//   - a demo CUSTOMER account and a demo MERCHANT OWNER account (password sign-in, no OTP needed)
//   - an APPROVED demo restaurant with a small menu
// Test credentials live HERE, in the fixture file, like the other e2e fixtures.
import { db, disconnectDb } from '../server/lib/prisma.mjs'
import { hashPassword } from '../server/lib/security.mjs'

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo fixtures with NODE_ENV=production.')
  process.exit(2)
}

export const DEMO_ACCOUNTS = {
  customer: { email: 'demo-customer@sybnb.local', password: process.env.DEMO_PASSWORD },
  owner: { email: 'demo-merchant@sybnb.local', password: process.env.DEMO_PASSWORD },
}

async function upsertUser(email, password, displayName) {
  const existing = await db().user.findUnique({ where: { email } })
  if (existing) {
    await db().user.update({ where: { id: existing.id }, data: { passwordHash: hashPassword(password), status: 'ACTIVE' } })
    await db().userRole.upsert({ where: { userId_role: { userId: existing.id, role: 'GUEST' } }, create: { userId: existing.id, role: 'GUEST' }, update: {} })
    return existing
  }
  return db().user.create({
    data: { email, displayName, status: 'ACTIVE', locale: 'ar-SY', passwordHash: hashPassword(password), roles: { create: [{ role: 'GUEST' }] } },
  })
}

const customer = await upsertUser(DEMO_ACCOUNTS.customer.email, DEMO_ACCOUNTS.customer.password, 'Demo Customer')
const owner = await upsertUser(DEMO_ACCOUNTS.owner.email, DEMO_ACCOUNTS.owner.password, 'Demo Merchant Owner')

let merchant = await db().merchant.findFirst({ where: { ownerId: owner.id, name: 'Shawarma Al-Sham (Demo)' } })
if (!merchant) {
  merchant = await db().merchant.create({
    data: {
      ownerId: owner.id,
      name: 'Shawarma Al-Sham (Demo)',
      nameAr: 'شاورما الشام (تجريبي)',
      category: 'restaurant',
      city: 'Damascus',
      address: 'Malki, main street 12',
      phone: '0999000000',
      status: 'APPROVED',
    },
  })
} else if (merchant.status !== 'APPROVED') {
  merchant = await db().merchant.update({ where: { id: merchant.id }, data: { status: 'APPROVED', active: true } })
}

const MENU = [
  { name: 'Chicken shawarma wrap', nameAr: 'شاورما دجاج', priceMinor: 25000, sortOrder: 1 },
  { name: 'Beef shawarma plate', nameAr: 'صحن شاورما لحمة', priceMinor: 45000, sortOrder: 2 },
  { name: 'Fattoush salad', nameAr: 'فتوش', priceMinor: 15000, sortOrder: 3 },
  { name: 'Fresh juice', nameAr: 'عصير طازج', priceMinor: 10000, sortOrder: 4 },
]
for (const item of MENU) {
  const existing = await db().menuItem.findFirst({ where: { merchantId: merchant.id, name: item.name } })
  if (!existing) {
    await db().menuItem.create({ data: { ...item, merchantId: merchant.id, currency: 'SYP', available: true } })
  }
}

// --- Menu Studio demo photos + promo (2026-10-15) -------------------------------------------
// Real generated PNGs (solid-color placeholders, 800x600) through the real storage pipeline, so
// the demo shows the full photo flow: cover + 3 item photos APPROVED, and one item left
// PENDING_REVIEW so the /admin/food queue has something to approve live. Idempotent.
import zlib from 'node:zlib'
import { putObject } from '../server/lib/storage.mjs'

function crc32(buf) {
  const t = []
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c }
  let c = 0xffffffff
  for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function makePng(rgb) {
  const w = 800, h = 600
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3)])
  for (let x = 0; x < w; x++) { row[1 + x * 3] = rgb[0]; row[2 + x * 3] = rgb[1]; row[3 + x * 3] = rgb[2] }
  const raw = Buffer.concat(Array(h).fill(row))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
async function seedPhoto(kind, row, rgb, status) {
  if (row.photoRef) return false
  const { key } = await putObject('food-photo', { base64: makePng(rgb).toString('base64'), contentType: 'image/png' })
  const data = {
    photoRef: key, photoMimeType: 'image/png', photoStatus: status,
    photoMeta: { width: 800, height: 600, format: 'image/png', editorSignature: null, seeded: true },
    photoSubmittedAt: new Date(), photoReviewedAt: status === 'APPROVED' ? new Date() : null,
  }
  if (kind === 'merchant') await db().merchant.update({ where: { id: row.id }, data })
  else await db().menuItem.update({ where: { id: row.id }, data })
  return true
}

const freshMerchant = await db().merchant.findUnique({ where: { id: merchant.id } })
await seedPhoto('merchant', freshMerchant, [146, 64, 14], 'APPROVED') // warm brown cover
const PHOTO_PLAN = {
  'Chicken shawarma wrap': { rgb: [217, 119, 6], status: 'APPROVED' },
  'Beef shawarma plate': { rgb: [153, 27, 27], status: 'APPROVED' },
  'Fattoush salad': { rgb: [22, 101, 52], status: 'APPROVED' },
  'Fresh juice': { rgb: [234, 88, 12], status: 'PENDING_REVIEW' }, // left pending for the admin demo
}
let seededCount = 0
for (const [name, plan] of Object.entries(PHOTO_PLAN)) {
  const row = await db().menuItem.findFirst({ where: { merchantId: merchant.id, name } })
  if (row && (await seedPhoto('menu-item', row, plan.rgb, plan.status))) seededCount++
}

// Live promo on the wrap (open-ended window) so the customer app shows strikethrough pricing.
const wrap = await db().menuItem.findFirst({ where: { merchantId: merchant.id, name: 'Chicken shawarma wrap' } })
if (wrap && wrap.promoPriceMinor == null) {
  await db().menuItem.update({ where: { id: wrap.id }, data: { promoPriceMinor: 20000, promoLabel: 'عرض الافتتاح', promoStartsAt: new Date() } })
}

console.log(`eats demo fixtures ready: merchant ${merchant.id} (APPROVED), ${MENU.length} menu items, 2 demo accounts, ${seededCount} photos seeded, promo on wrap`)
await disconnectDb()
