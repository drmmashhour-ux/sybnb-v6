// Generates realistic historical activity in the DEV database (never touches the isolated
// .env.test database — see server/lib/prisma.mjs, this only runs with plain `node`, no
// NODE_ENV=test) so admin dashboards like the income projection have more than a handful of
// real rows to work with. Every row is created through the same Prisma models and finance math
// the real API uses (bookingFinanceSplit, the same HOLD/RELEASE/CREDIT wallet-entry shape
// approvePaymentProof produces) — this is synthetic *volume* over a real date range, not fake
// numbers bolted onto the UI. All simulated rows are tagged with a 'sim-' idempotency-key/
// providerRef prefix so they can be identified (or removed) later without touching real data.
import { db, disconnectDb } from '../server/lib/prisma.mjs'
import { bookingFinanceSplit } from '../server/lib/finance-ledger.mjs'
import { sypMinorToRoundedUsdMinor } from '../server/lib/currency.mjs'

const DAYS_BACK = 45
const SIM_TAG = 'sim-2026-07'

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pick(list) {
  return list[randomInt(0, list.length - 1)]
}

function daysAgo(n, hour = 10) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - n)
  date.setUTCHours(hour, randomInt(0, 59), 0, 0)
  return date
}

async function upsertWallet(userId, currency) {
  return db().wallet.upsert({
    where: { userId_currency: { userId, currency } },
    create: { userId, currency, cachedBalanceMinor: 0 },
    update: {},
  })
}

async function simCredit(tx, { userId, amountMinor, currency, referenceType, referenceId, createdAt, note }) {
  // Mirrors recordWalletEntry's own guard (server/lib/finance-ledger.mjs) — a zero/negative
  // amount is silently skipped rather than written, since the DB's amount_minor check
  // constraint rejects non-positive rows outright.
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) return
  const wallet = await upsertWallet(userId, currency)
  const key = `${SIM_TAG}-${referenceType}-${referenceId}-${userId}`
  await tx.walletEntry.create({
    data: {
      walletId: wallet.id,
      type: 'CREDIT',
      amountMinor,
      currency,
      referenceType,
      referenceId,
      idempotencyKey: key,
      note,
      createdAt,
    },
  })
  await tx.wallet.update({ where: { id: wallet.id }, data: { cachedBalanceMinor: { increment: amountMinor } } })
}

async function main() {
  const host = await db().user.findFirst({ where: { roles: { some: { role: 'HOST' } } } })
  const admin = await db().user.findFirst({ where: { email: 'admin@sybnb.local' } })
  const driver = await db().user.findFirst({ where: { roles: { some: { role: 'DRIVER' } } } })
  const guests = await db().user.findMany({ where: { roles: { some: { role: 'GUEST' } } }, take: 10 })
  const listings = await db().listing.findMany({ where: { division: 'STAYS', status: 'APPROVED' } })
  const sellers = await db().user.findMany({ where: { roles: { some: { role: 'SELLER' } } }, take: 5 })

  if (!admin || !driver || !guests.length || !listings.length) {
    console.error('Missing seed data (admin/driver/guests/listings) — run the app once to create the usual test accounts first.')
    process.exit(1)
  }

  let bookingCount = 0
  let rideCount = 0
  let sellerPlanCount = 0
  let commissionTotalSyp = 0
  let commissionTotalUsd = 0

  for (let daysBack = DAYS_BACK; daysBack >= 0; daysBack--) {
    const simDay = daysAgo(daysBack)

    // 0-3 STR bookings this day, each fully paid+approved and completed in the past.
    const bookingsToday = randomInt(0, 3)
    for (let i = 0; i < bookingsToday; i++) {
      const guest = pick(guests)
      const listing = pick(listings)
      const nights = randomInt(1, 5)
      const checkIn = daysAgo(daysBack - randomInt(1, 10))
      const checkOut = new Date(checkIn)
      checkOut.setUTCDate(checkOut.getUTCDate() + nights)
      const paidSypMinor = listing.priceMinor * nights
      const useUsd = Math.random() < 0.3
      const currency = useUsd ? 'USD' : 'SYP'
      const paidTotalMinor = useUsd ? sypMinorToRoundedUsdMinor(paidSypMinor) : paidSypMinor
      const hasProtection = Math.random() < 0.2

      await db().$transaction(async (tx) => {
        const booking = await tx.booking.create({
          data: {
            listingId: listing.id,
            guestId: guest.id,
            status: 'COMPLETED',
            checkIn,
            checkOut,
            amountMinor: paidTotalMinor,
            currency,
            metadata: hasProtection ? { cancellationProtectionPurchased: true } : {},
            createdAt: simDay,
          },
        })

        const proof = await tx.paymentProof.create({
          data: {
            bookingId: booking.id,
            userId: guest.id,
            provider: 'sham_cash',
            status: 'APPROVED',
            amountMinor: paidTotalMinor,
            currency,
            providerRef: `${SIM_TAG}-${booking.id}`,
            reviewedById: admin.id,
            reviewedAt: simDay,
            createdAt: simDay,
          },
        })

        // Same split math the real approval path uses (server/lib/finance-ledger.mjs), so the
        // host/admin shares are computed identically — just backdated to the simulated day.
        const split = bookingFinanceSplit(
          { ...booking, listing, amountMinor: paidTotalMinor },
          paidTotalMinor,
        )

        await simCredit(tx, {
          userId: listing.ownerId,
          amountMinor: split.hostGrossMinor,
          currency,
          referenceType: 'booking_payout',
          referenceId: booking.id,
          createdAt: simDay,
          note: 'Simulated host payout (HOLD-equivalent, recorded as CREDIT for simulation simplicity).',
        })

        const adminShare = split.adminShareMinor
        await simCredit(tx, {
          userId: admin.id,
          amountMinor: adminShare,
          currency,
          referenceType: 'booking_admin_share',
          referenceId: booking.id,
          createdAt: simDay,
          note: 'Simulated SYBNB commission share.',
        })
        if (currency === 'SYP') commissionTotalSyp += adminShare
        else commissionTotalUsd += adminShare

        if (hasProtection && split.cancellationProtectionFeeMinor > 0) {
          const protectionFee = split.cancellationProtectionFeeMinor
          await simCredit(tx, {
            userId: admin.id,
            amountMinor: protectionFee,
            currency,
            referenceType: 'booking_protection_fee',
            referenceId: booking.id,
            createdAt: simDay,
            note: 'Simulated cancellation-protection fee.',
          })
          if (currency === 'SYP') commissionTotalSyp += protectionFee
          else commissionTotalUsd += protectionFee
        }

        void proof
      })
      bookingCount++
    }

    // 1-4 completed SR rides this day (zero platform commission by design — see revenue-summary).
    const ridesToday = randomInt(1, 4)
    for (let i = 0; i < ridesToday; i++) {
      const rider = pick(guests)
      const distanceKm = randomInt(2, 15)
      const rawFareSyp = 15000 + distanceKm * 3200
      const fareSypMinor = Math.round(rawFareSyp / 500) * 500
      const useUsd = Math.random() < 0.3
      const currency = useUsd ? 'USD' : 'SYP'
      const fareMinor = useUsd ? sypMinorToRoundedUsdMinor(fareSypMinor) : fareSypMinor

      await db().rideRequest.create({
        data: {
          riderId: rider.id,
          driverId: driver.id,
          status: 'COMPLETED',
          requestedAt: simDay,
          fareMinor,
          currency,
          metadata: {
            pickup: pick(['دمشق، المالكي', 'دمشق، المزة', 'دمشق، أبو رمانة', 'دمشق، كفرسوسة']),
            dropoff: pick(['دمشق، باب توما', 'دمشق، شعلان', 'دمشق، دمر', 'مطار دمشق']),
            category: pick(['SR Economy', 'SR Comfort', 'SR SUV']),
            distanceKm,
            distanceEstimated: false,
            simulated: true,
          },
        },
      })
      rideCount++
    }

    // Roughly one seller-plan payment every ~6 days, when a seller account exists.
    if (sellers.length && daysBack % 6 === 0) {
      const seller = pick(sellers)
      const amountUsd = pick([50, 100, 150, 250, 500])
      await db().$transaction(async (tx) => {
        const proof = await tx.paymentProof.create({
          data: {
            userId: seller.id,
            provider: 'seller_plan',
            status: 'APPROVED',
            amountMinor: amountUsd,
            currency: 'USD',
            providerRef: `${SIM_TAG}-seller-${seller.id}-${daysBack}`,
            reviewedById: admin.id,
            reviewedAt: simDay,
            createdAt: simDay,
          },
        })
        await simCredit(tx, {
          userId: admin.id,
          amountMinor: amountUsd,
          currency: 'USD',
          referenceType: 'seller_plan_fee',
          referenceId: proof.id,
          createdAt: simDay,
          note: 'Simulated seller/dealer/developer plan fee.',
        })
        commissionTotalUsd += amountUsd
      })
      sellerPlanCount++
    }
  }

  console.log(JSON.stringify({
    daysSimulated: DAYS_BACK + 1,
    bookingsCreated: bookingCount,
    ridesCreated: rideCount,
    sellerPlanPaymentsCreated: sellerPlanCount,
    simulatedCommissionSyp: commissionTotalSyp,
    simulatedCommissionUsd: commissionTotalUsd,
  }, null, 2))

  await disconnectDb()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
