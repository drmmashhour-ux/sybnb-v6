import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode, verifyEmailForTest } from '../support/testServer.mjs'

async function registerUser(app, role, label) {
  const email = uniqueTestEmail(label)
  if (role === 'GUEST') await verifyEmailForTest(app, email)
  const res = await request(app).post('/api/auth/register').send({
    role,
    email,
    password: 'correct-horse-battery',
  })
  trackTestUser(res.body.user.id)
  return { email, token: res.body.token, user: res.body.user }
}

// ADMIN/SUPPORT are deliberately excluded from PUBLIC_REGISTER_ROLES (server/routes/auth.mjs) —
// there is no self-registration path for staff roles by design, so test fixtures for them are
// created directly via Prisma instead of the public /api/auth/register endpoint.
async function createPrivilegedUser(role, label) {
  const email = uniqueTestEmail(label)
  const user = await db().user.create({
    data: {
      email,
      passwordHash: hashPassword('correct-horse-battery'),
      displayName: `Test ${role}`,
      referralCode: uniqueTestReferralCode(),
      roles: { create: { role } },
    },
    include: { roles: true },
  })
  trackTestUser(user.id)
  return { email, token: createSessionToken(user), user }
}

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

async function submitIdDocument(app, token) {
  return request(app)
    .patch('/api/me/id-document')
    .set('Authorization', `Bearer ${token}`)
    .send({ fileBase64: TINY_PNG_BASE64, mimeType: 'image/png' })
}

describe('ID-document verification state machine', () => {
  let app
  let admin
  let support

  beforeAll(async () => {
    app = testApp()
    admin = await createPrivilegedUser('ADMIN', 'verif-admin')
    support = await createPrivilegedUser('SUPPORT', 'verif-support')
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('a fresh submission moves status to PENDING_REVIEW', async () => {
    const guest = await registerUser(app, 'GUEST', 'verif-submit')
    const res = await submitIdDocument(app, guest.token)

    expect(res.status).toBe(200)
    expect(res.body.user.idDocumentStatus).toBe('PENDING_REVIEW')
  })

  it('rejects a submission missing the file or mime type', async () => {
    const guest = await registerUser(app, 'GUEST', 'verif-missing-file')
    const res = await request(app).patch('/api/me/id-document').set('Authorization', `Bearer ${guest.token}`).send({})
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('ID_DOCUMENT_REQUIRED')
  })

  it('shows up in the admin review queue once PENDING_REVIEW', async () => {
    const guest = await registerUser(app, 'GUEST', 'verif-queue')
    await submitIdDocument(app, guest.token)

    const res = await request(app).get('/api/admin/review-queue').set('Authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(200)
    expect(res.body.queue.idDocuments.some((doc) => doc.id === guest.user.id)).toBe(true)
  })

  it('an ADMIN can approve a pending submission', async () => {
    const guest = await registerUser(app, 'GUEST', 'verif-approve')
    await submitIdDocument(app, guest.token)

    const res = await request(app)
      .patch(`/api/admin/review-queue/iddocument/${guest.user.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'APPROVE' })

    expect(res.status).toBe(200)
    expect(res.body.entity.idDocumentStatus).toBe('APPROVED')
    expect(res.body.entity.idDocumentReviewedById).toBe(admin.user.id)
  })

  it('an ADMIN can reject a pending submission', async () => {
    const guest = await registerUser(app, 'GUEST', 'verif-reject')
    await submitIdDocument(app, guest.token)

    const res = await request(app)
      .patch(`/api/admin/review-queue/iddocument/${guest.user.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'REJECT' })

    expect(res.status).toBe(200)
    expect(res.body.entity.idDocumentStatus).toBe('REJECTED')
  })

  it('SUPPORT can view the queue but cannot make the APPROVE/REJECT decision', async () => {
    const guest = await registerUser(app, 'GUEST', 'verif-support-forbidden')
    await submitIdDocument(app, guest.token)

    const viewRes = await request(app).get('/api/admin/review-queue').set('Authorization', `Bearer ${support.token}`)
    expect(viewRes.status).toBe(200)

    const decideRes = await request(app)
      .patch(`/api/admin/review-queue/iddocument/${guest.user.id}`)
      .set('Authorization', `Bearer ${support.token}`)
      .send({ decision: 'APPROVE' })
    expect(decideRes.status).toBe(403)
  })

  it('re-submitting after a rejection resets status to PENDING_REVIEW and clears the prior review', async () => {
    const guest = await registerUser(app, 'GUEST', 'verif-resubmit')
    await submitIdDocument(app, guest.token)
    await request(app)
      .patch(`/api/admin/review-queue/iddocument/${guest.user.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'REJECT' })

    const resubmit = await submitIdDocument(app, guest.token)
    expect(resubmit.status).toBe(200)
    expect(resubmit.body.user.idDocumentStatus).toBe('PENDING_REVIEW')

    const meRes = await request(app).get('/api/me/overview').set('Authorization', `Bearer ${guest.token}`)
    expect(meRes.body.overview.user.idDocumentStatus).toBe('PENDING_REVIEW')
  })

  it('rejects deciding on a submission that is not PENDING_REVIEW (double-decision race guard)', async () => {
    const guest = await registerUser(app, 'GUEST', 'verif-double-decision')
    await submitIdDocument(app, guest.token)

    const first = await request(app)
      .patch(`/api/admin/review-queue/iddocument/${guest.user.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'APPROVE' })
    const second = await request(app)
      .patch(`/api/admin/review-queue/iddocument/${guest.user.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'REJECT' })

    expect(first.status).toBe(200)
    expect(second.status).toBe(400)
    expect(second.body.error.code).toBe('ID_DOCUMENT_NOT_REVIEWABLE')

    // The first (successful) decision must stand — the failed second attempt did not flip it.
    const meRes = await request(app).get('/api/me/overview').set('Authorization', `Bearer ${guest.token}`)
    expect(meRes.body.overview.user.idDocumentStatus).toBe('APPROVED')
  })

  it('a GUEST cannot access another user\'s ID-document file', async () => {
    const owner = await registerUser(app, 'GUEST', 'verif-file-owner')
    await submitIdDocument(app, owner.token)
    const outsider = await registerUser(app, 'GUEST', 'verif-file-outsider')

    // There is no cross-account file route for non-admins in the first place — /api/me/id-document/file
    // is always scoped to the caller's own document, so "reading someone else's file" isn't a route
    // an outsider can even address. Confirm the outsider's own call 404s (they haven't submitted one)
    // rather than ever seeing the owner's document.
    const res = await request(app).get('/api/me/id-document/file').set('Authorization', `Bearer ${outsider.token}`)
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('ID_DOCUMENT_NOT_FOUND')
  })

  it('a non-admin cannot access the admin id-document-by-user-id file route', async () => {
    const guest = await registerUser(app, 'GUEST', 'verif-admin-file-forbidden')
    await submitIdDocument(app, guest.token)

    const res = await request(app).get(`/api/admin/id-document/${guest.user.id}/file`).set('Authorization', `Bearer ${guest.token}`)
    expect(res.status).toBe(403)
  })
})
