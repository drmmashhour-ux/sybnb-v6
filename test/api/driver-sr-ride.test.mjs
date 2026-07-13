import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

async function registerUser(app, role, label) {
  const email = uniqueTestEmail(label)
  if (role === 'GUEST') await verifyEmailForTest(app, email)
  if (role === 'HOST' || role === 'DRIVER') await verifyEmailForTest(app, email, 'staff-login')
  const res = await request(app).post('/api/auth/register').send({
    role,
    email,
    password: 'correct-horse-battery',
  })
  trackTestUser(res.body.user.id)
  return { email, token: res.body.token, user: res.body.user }
}

async function requestRide(app, riderToken, label) {
  const res = await request(app)
    .post('/api/sr/rides')
    .set('Authorization', `Bearer ${riderToken}`)
    .send({ pickup: `Malki ${label}`, dropoff: `Mezzeh ${label}`, category: 'SR Economy' })
  return res.body.ride
}

describe('SR ride dual-sided flow: rider requests, driver claims and progresses status', () => {
  let app
  let rider
  let driver

  beforeAll(async () => {
    app = testApp()
    rider = await registerUser(app, 'GUEST', 'sr-rider')
    driver = await registerUser(app, 'DRIVER', 'sr-driver')
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('a GUEST can request a ride, receiving a fare quote and REQUESTED status', async () => {
    const ride = await requestRide(app, rider.token, 'flow-1')
    expect(ride.status).toBe('REQUESTED')
    expect(ride.riderId).toBe(rider.user.id)
    expect(typeof ride.fareMinor).toBe('number')
    expect(ride.fareMinor).toBeGreaterThan(0)
  })

  it('a DRIVER cannot request a ride (role-gated to GUEST)', async () => {
    const res = await request(app)
      .post('/api/sr/rides')
      .set('Authorization', `Bearer ${driver.token}`)
      .send({ pickup: 'Malki', dropoff: 'Mezzeh' })
    expect(res.status).toBe(403)
  })

  it('the requested ride shows up in the driver pending queue', async () => {
    const ride = await requestRide(app, rider.token, 'flow-2')
    const res = await request(app).get('/api/driver/rides/pending').set('Authorization', `Bearer ${driver.token}`)
    expect(res.status).toBe(200)
    expect(res.body.rides.some((r) => r.id === ride.id)).toBe(true)
  })

  it('the driver claims the ride, moving it to DRIVER_ASSIGNED and binding driverId', async () => {
    const ride = await requestRide(app, rider.token, 'flow-3')
    const res = await request(app).patch(`/api/sr/rides/${ride.id}/claim`).set('Authorization', `Bearer ${driver.token}`)

    expect(res.status).toBe(200)
    expect(res.body.ride.status).toBe('DRIVER_ASSIGNED')
    expect(res.body.ride.driverId).toBe(driver.user.id)
  })

  it('a second driver cannot claim an already-claimed ride (409, not a silent overwrite)', async () => {
    const ride = await requestRide(app, rider.token, 'flow-4')
    const otherDriver = await registerUser(app, 'DRIVER', 'sr-driver-2')

    const firstClaim = await request(app).patch(`/api/sr/rides/${ride.id}/claim`).set('Authorization', `Bearer ${driver.token}`)
    const secondClaim = await request(app).patch(`/api/sr/rides/${ride.id}/claim`).set('Authorization', `Bearer ${otherDriver.token}`)

    expect(firstClaim.status).toBe(200)
    expect(secondClaim.status).toBe(409)
    expect(secondClaim.body.error.code).toBe('RIDE_ALREADY_CLAIMED')
  })

  it('drives through the full valid status sequence: DRIVER_ARRIVING -> IN_PROGRESS -> COMPLETED', async () => {
    const ride = await requestRide(app, rider.token, 'flow-5')
    await request(app).patch(`/api/sr/rides/${ride.id}/claim`).set('Authorization', `Bearer ${driver.token}`)

    const arriving = await request(app)
      .patch(`/api/driver/rides/${ride.id}/status`)
      .set('Authorization', `Bearer ${driver.token}`)
      .send({ status: 'DRIVER_ARRIVING' })
    expect(arriving.status).toBe(200)
    expect(arriving.body.ride.status).toBe('DRIVER_ARRIVING')

    const inProgress = await request(app)
      .patch(`/api/driver/rides/${ride.id}/status`)
      .set('Authorization', `Bearer ${driver.token}`)
      .send({ status: 'IN_PROGRESS' })
    expect(inProgress.status).toBe(200)
    expect(inProgress.body.ride.status).toBe('IN_PROGRESS')

    const completed = await request(app)
      .patch(`/api/driver/rides/${ride.id}/status`)
      .set('Authorization', `Bearer ${driver.token}`)
      .send({ status: 'COMPLETED' })
    expect(completed.status).toBe(200)
    expect(completed.body.ride.status).toBe('COMPLETED')
  })

  it('rejects an out-of-order transition (e.g. DRIVER_ASSIGNED straight to COMPLETED)', async () => {
    const ride = await requestRide(app, rider.token, 'flow-6')
    await request(app).patch(`/api/sr/rides/${ride.id}/claim`).set('Authorization', `Bearer ${driver.token}`)

    const res = await request(app)
      .patch(`/api/driver/rides/${ride.id}/status`)
      .set('Authorization', `Bearer ${driver.token}`)
      .send({ status: 'COMPLETED' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_DRIVER_RIDE_TRANSITION')
  })

  it('a driver cannot progress a ride assigned to a different driver', async () => {
    const ride = await requestRide(app, rider.token, 'flow-7')
    await request(app).patch(`/api/sr/rides/${ride.id}/claim`).set('Authorization', `Bearer ${driver.token}`)

    const otherDriver = await registerUser(app, 'DRIVER', 'sr-driver-3')
    const res = await request(app)
      .patch(`/api/driver/rides/${ride.id}/status`)
      .set('Authorization', `Bearer ${otherDriver.token}`)
      .send({ status: 'DRIVER_ARRIVING' })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('DRIVER_RIDE_NOT_FOUND')
  })

  it('the rider can read their own ride detail; an unrelated guest cannot', async () => {
    const ride = await requestRide(app, rider.token, 'flow-8')
    const unrelatedGuest = await registerUser(app, 'GUEST', 'sr-unrelated-guest')

    const riderView = await request(app).get(`/api/sr/rides/${ride.id}`).set('Authorization', `Bearer ${rider.token}`)
    const unrelatedView = await request(app).get(`/api/sr/rides/${ride.id}`).set('Authorization', `Bearer ${unrelatedGuest.token}`)

    expect(riderView.status).toBe(200)
    expect(unrelatedView.status).toBe(403)
    expect(unrelatedView.body.error.code).toBe('RIDE_FORBIDDEN')
  })

  it('rejects an invalid status value with 400 before touching the database', async () => {
    const ride = await requestRide(app, rider.token, 'flow-9')
    await request(app).patch(`/api/sr/rides/${ride.id}/claim`).set('Authorization', `Bearer ${driver.token}`)

    const res = await request(app)
      .patch(`/api/driver/rides/${ride.id}/status`)
      .set('Authorization', `Bearer ${driver.token}`)
      .send({ status: 'TELEPORTED' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_DRIVER_RIDE_STATUS')
  })
})
