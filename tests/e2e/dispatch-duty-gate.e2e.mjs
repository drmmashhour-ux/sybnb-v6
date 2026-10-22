// Dispatch offers a ride only to a driver who could accept it: on duty AND every required document
// approved (the same rule the claim path enforces). Runs against the throwaway e2e DB.
import { db } from '../../server/lib/prisma.mjs'
import { findNextDriverForRide } from '../../server/lib/ride-dispatch.mjs'
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`); if (!ok) failed++ }
const prisma = db()
const driverId = process.env.DRIVER_ID
const riderId = process.env.GUEST
const before = {
  docs: await prisma.driverDocument.findMany({ where: { userId: driverId } }),
  profile: await prisma.driverProfile.findUnique({ where: { userId: driverId }, select: { onDutyAt: true, vehiclePlate: true, vehicleStatus: true, vehicleCategory: true, inspectionStatus: true, inspectionExpiresAt: true, registrationExpiresAt: true } }),
}
const KINDS = ['LICENCE', 'CRIMINAL_RECORD', 'REGISTRATION', 'INSURANCE', 'MECHANIC_REPORT', 'CAR_PHOTO_FRONT', 'CAR_PHOTO_BACK', 'CAR_PHOTO_LEFT', 'CAR_PHOTO_RIGHT', 'CAR_PHOTO_INSIDE', 'CAR_PHOTO_BOOT']
await prisma.user.update({ where: { id: driverId }, data: { idDocumentStatus: 'APPROVED' } })
await prisma.driverProfile.upsert({ where: { userId: driverId }, create: { userId: driverId }, update: {} })
await prisma.$executeRawUnsafe(`update driver_profiles set vehicle_plate='E2E-1', vehicle_status='APPROVED', vehicle_category='ECONOMY', inspection_status='PASSED', inspection_expires_at=now()+interval '30 days', registration_expires_at=now()+interval '30 days', on_duty_at=null, last_location_geo=ST_SetSRID(ST_MakePoint(36.2351,33.5024),4326), last_location_updated_at=now() where user_id=$1::uuid`, driverId)
await prisma.$executeRawUnsafe(`update ride_requests set status='CANCELLED' where driver_id=$1::uuid and status in ('DRIVER_ASSIGNED','DRIVER_ARRIVING','IN_PROGRESS')`, driverId)
await prisma.driverDocument.deleteMany({ where: { userId: driverId } })
const [ride] = await prisma.$queryRawUnsafe(`insert into ride_requests (id, rider_id, status, pickup_geo, metadata, updated_at) values (gen_random_uuid(), $1::uuid, 'REQUESTED', ST_SetSRID(ST_MakePoint(36.235,33.503),4326), '{"category":"SR Economy"}'::jsonb, now()) returning id`, riderId)
const r = { id: ride.id, accessibilityRequired: false }
check('off duty, no documents -> not offered', (await findNextDriverForRide(r)) === null)
await prisma.$executeRawUnsafe(`update driver_profiles set on_duty_at=now() where user_id=$1::uuid`, driverId)
check('on duty but documents missing -> not offered', (await findNextDriverForRide(r)) === null)
for (const kind of KINDS) await prisma.driverDocument.create({ data: { userId: driverId, kind, storageKey: `e2e/${kind}`, mimeType: 'image/png', status: 'APPROVED' } })
const got = await findNextDriverForRide(r)
check('on duty + all documents approved -> offered', got?.userId === driverId, JSON.stringify(got))
await prisma.driverDocument.updateMany({ where: { userId: driverId, kind: 'INSURANCE' }, data: { status: 'REJECTED' } })
check('a rejected document -> not offered', (await findNextDriverForRide(r)) === null)
await prisma.$executeRawUnsafe(`update ride_requests set status='CANCELLED' where id=$1::uuid`, ride.id)
// Put the shared e2e driver back exactly as it was (other suites claim rides with it).
await prisma.driverDocument.deleteMany({ where: { userId: driverId } })
for (const d of before.docs) await prisma.driverDocument.create({ data: d })
if (before.profile) await prisma.driverProfile.update({ where: { userId: driverId }, data: before.profile })
console.log(failed ? `FAILED ${failed}` : 'ALL PASS')
await prisma.$disconnect()
process.exit(failed ? 1 : 0)
