// The database must refuse two overlapping CONFIRMED bookings on one listing, even bypassing the app.
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
let pass = 0, fail = 0
const ok = (n, c) => { console.log(`   ${c ? 'PASS' : 'FAIL'}  ${n}`); c ? pass++ : fail++ }
const tag = Date.now().toString(36)
const day = (n) => new Date(Date.UTC(2031, 0, n))
console.log('=== BOOKING NO-OVERLAP (DB CONSTRAINT) E2E ===')
const mkUser = (s) => db.user.create({ data: { email: `${s}-${tag}@example.test`, displayName: s, locale: 'en' } })
const host = await mkUser('nohost'), g1 = await mkUser('g1'), g2 = await mkUser('g2')
const listing = await db.listing.create({ data: { ownerId: host.id, division: 'STAYS', titleAr: `no-overlap ${tag}`, titleEn: `no-overlap ${tag}`, status: 'APPROVED', priceMinor: 100000, currency: 'SYP', metadata: {} } })
const book = (guestId, a, b, status = 'CONFIRMED') => db.booking.create({ data: { listingId: listing.id, guestId, status, checkIn: day(a), checkOut: day(b), amountMinor: 1, currency: 'SYP' } })
await book(g1.id, 10, 15)
let err = null
try { await book(g2.id, 12, 18) } catch (e) { err = e }
ok('overlapping CONFIRMED booking is rejected by the database', !!err)
try { await book(g2.id, 15, 18); ok('back-to-back stay (check-out day = check-in day) is allowed', true) } catch { ok('back-to-back stay (check-out day = check-in day) is allowed', false) }
try { await book(g2.id, 11, 13, 'CANCELLED'); ok('overlapping CANCELLED booking is allowed', true) } catch { ok('overlapping CANCELLED booking is allowed', false) }
await db.booking.deleteMany({ where: { listingId: listing.id } })
await db.listing.delete({ where: { id: listing.id } })
await db.user.deleteMany({ where: { id: { in: [host.id, g1.id, g2.id] } } })
console.log(`\n==== BOOKING NO-OVERLAP: ${pass} passed, ${fail} failed ====`)
await db.$disconnect()
process.exit(fail ? 1 : 0)
