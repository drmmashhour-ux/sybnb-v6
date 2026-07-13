import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
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

// Fixtures are created directly via Prisma rather than by driving the full booking/payment/host
// flow (already covered end-to-end elsewhere this session) — this file's job is to exercise
// messaging authorization/eligibility, not booking-state-machine transitions.
async function createListing(ownerId, overrides = {}) {
  return db().listing.create({
    data: {
      ownerId,
      division: 'STAYS',
      titleAr: 'شقة اختبار',
      status: 'APPROVED',
      priceMinor: 100000,
      currency: 'USD',
      ...overrides,
    },
  })
}

async function createBooking(listingId, guestId, status) {
  return db().booking.create({
    data: {
      listingId,
      guestId,
      status,
      amountMinor: 100000,
      currency: 'USD',
    },
  })
}

describe('booking-thread messaging', () => {
  let app
  let host
  let guest
  let listing

  beforeAll(async () => {
    app = testApp()
    host = await registerUser(app, 'HOST', 'msg-host')
    guest = await registerUser(app, 'GUEST', 'msg-guest')
    listing = await createListing(host.user.id)
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('the guest can send a message on a CONFIRMED booking, tagged with senderRole GUEST', async () => {
    const booking = await createBooking(listing.id, guest.user.id, 'CONFIRMED')
    const res = await request(app)
      .post(`/api/bookings/${booking.id}/thread/messages`)
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ body: 'Hello from the guest' })

    expect(res.status).toBe(201)
    expect(res.body.message.senderRole).toBe('GUEST')
    expect(res.body.message.body).toBe('Hello from the guest')
  })

  it('the host (listing owner) can reply on the same booking, tagged with senderRole HOST', async () => {
    const booking = await createBooking(listing.id, guest.user.id, 'CONFIRMED')
    await request(app)
      .post(`/api/bookings/${booking.id}/thread/messages`)
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ body: 'Guest opener' })

    const res = await request(app)
      .post(`/api/bookings/${booking.id}/thread/messages`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ body: 'Host reply' })

    expect(res.status).toBe(201)
    expect(res.body.message.senderRole).toBe('HOST')
  })

  it('guest and host both read the identical thread (same message list)', async () => {
    const booking = await createBooking(listing.id, guest.user.id, 'CONFIRMED')
    await request(app)
      .post(`/api/bookings/${booking.id}/thread/messages`)
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ body: 'shared visibility check' })

    const guestView = await request(app).get(`/api/bookings/${booking.id}/thread`).set('Authorization', `Bearer ${guest.token}`)
    const hostView = await request(app).get(`/api/bookings/${booking.id}/thread`).set('Authorization', `Bearer ${host.token}`)

    expect(guestView.status).toBe(200)
    expect(hostView.status).toBe(200)
    expect(guestView.body.thread.id).toBe(hostView.body.thread.id)
    expect(guestView.body.thread.messages.map((m) => m.id)).toEqual(hostView.body.thread.messages.map((m) => m.id))
  })

  it('an unrelated account cannot read or post to the thread (403)', async () => {
    const booking = await createBooking(listing.id, guest.user.id, 'CONFIRMED')
    const outsider = await registerUser(app, 'GUEST', 'msg-outsider')

    const readRes = await request(app).get(`/api/bookings/${booking.id}/thread`).set('Authorization', `Bearer ${outsider.token}`)
    const writeRes = await request(app)
      .post(`/api/bookings/${booking.id}/thread/messages`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ body: 'should not be allowed' })

    expect(readRes.status).toBe(403)
    expect(readRes.body.error.code).toBe('BOOKING_FORBIDDEN')
    expect(writeRes.status).toBe(403)
  })

  it('messaging is blocked before the booking reaches an eligible status (REQUESTED)', async () => {
    const booking = await createBooking(listing.id, guest.user.id, 'REQUESTED')
    const res = await request(app)
      .post(`/api/bookings/${booking.id}/thread/messages`)
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ body: 'too early' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('MESSAGING_NOT_ELIGIBLE')
  })

  it('messaging remains open on a COMPLETED booking', async () => {
    const booking = await createBooking(listing.id, guest.user.id, 'COMPLETED')
    const res = await request(app)
      .post(`/api/bookings/${booking.id}/thread/messages`)
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ body: 'post-stay follow up' })

    expect(res.status).toBe(201)
  })

  it('rejects an empty message body', async () => {
    const booking = await createBooking(listing.id, guest.user.id, 'CONFIRMED')
    const res = await request(app)
      .post(`/api/bookings/${booking.id}/thread/messages`)
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ body: '   ' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('MESSAGE_BODY_REQUIRED')
  })

  it('rejects a message body over 4000 characters', async () => {
    const booking = await createBooking(listing.id, guest.user.id, 'CONFIRMED')
    const res = await request(app)
      .post(`/api/bookings/${booking.id}/thread/messages`)
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ body: 'x'.repeat(4001) })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('MESSAGE_BODY_TOO_LONG')
  })
})

describe('listing-inquiry-thread messaging', () => {
  let app
  let owner
  let inquiringGuest
  let listing

  beforeAll(async () => {
    app = testApp()
    owner = await registerUser(app, 'HOST', 'msg-listing-owner')
    inquiringGuest = await registerUser(app, 'GUEST', 'msg-listing-guest')
    listing = await createListing(owner.user.id)
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('a guest can open an inquiry thread on an approved listing by sending the first message', async () => {
    const res = await request(app)
      .post(`/api/listings/${listing.id}/thread/messages`)
      .set('Authorization', `Bearer ${inquiringGuest.token}`)
      .send({ body: 'Is this still available?' })

    expect(res.status).toBe(201)
    expect(res.body.message.senderRole).toBe('GUEST')
  })

  it('the owner can reply by supplying the guestId explicitly', async () => {
    const res = await request(app)
      .post(`/api/listings/${listing.id}/thread/messages`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ body: 'Yes, it is!', guestId: inquiringGuest.user.id })

    expect(res.status).toBe(201)
    expect(res.body.message.senderRole).toBe('HOST')
  })

  it('the owner cannot open a thread with themselves', async () => {
    const res = await request(app)
      .get(`/api/listings/${listing.id}/thread`)
      .query({ guestId: owner.user.id })
      .set('Authorization', `Bearer ${owner.token}`)

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_GUEST_ID')
  })

  it('the owner must supply guestId to read a thread', async () => {
    const res = await request(app).get(`/api/listings/${listing.id}/thread`).set('Authorization', `Bearer ${owner.token}`)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('GUEST_ID_REQUIRED')
  })

  it('a non-owner guest cannot read another guest\'s inquiry thread by passing their id as a query param (ignored, not honored)', async () => {
    await request(app)
      .post(`/api/listings/${listing.id}/thread/messages`)
      .set('Authorization', `Bearer ${inquiringGuest.token}`)
      .send({ body: 'my private inquiry' })

    const thirdPartyGuest = await registerUser(app, 'GUEST', 'msg-listing-third-party')
    const res = await request(app)
      .get(`/api/listings/${listing.id}/thread`)
      .query({ guestId: inquiringGuest.user.id })
      .set('Authorization', `Bearer ${thirdPartyGuest.token}`)

    // Non-owner callers always read (and lazily create) their own guestId-keyed thread — the
    // guestId query param is silently ignored for them, never used to read someone else's thread.
    expect(res.status).toBe(200)
    expect(res.body.thread.guestId).toBe(thirdPartyGuest.user.id)
    expect(res.body.thread.messages).toEqual([])
  })
})
