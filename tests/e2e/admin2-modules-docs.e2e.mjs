// STEP 5 -- module APIs, documents (test DB only).
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { db } from '../../server/lib/prisma.mjs'
import { startApi, createStaffUser, loginAsStaff, assignRole, makeRunner, randomUUID } from './helpers/admin2-harness.mjs'

const run = randomUUID().slice(0, 8)
const api = await startApi()
const { t, summary } = makeRunner()
const p = db()
const org = await p.organization.findFirst()
const le = await p.legalEntity.findFirst({ where: { code: 'LE-9375-7649' } })
const ORG = [{ kind: 'ORGANIZATION', organizationId: org.id }]
const LE = [{ kind: 'LEGAL_ENTITY', legalEntityId: le.id }]
const plat = Object.fromEntries((await p.platform.findMany()).map((x) => [x.code, x]))
const mk = async (label, role, scopes = ORG) => { const u = await createStaffUser(label, run); await assignRole(u, role, scopes); return { u, s: await loginAsStaff(api, u) } }

const [o1, o2, str, sup, acct, rest, secu, fin] = await Promise.all([
  mk('o1', 'OWNER'), mk('o2', 'OWNER'), mk('str', 'STR_MANAGER', LE), mk('sup', 'SUPPORT_AGENT'), mk('acct', 'EXTERNAL_ACCOUNTANT'),
  mk('rest', 'RESTAURANT_OPS', LE), mk('secu', 'SECURITY_ADMIN'), mk('fin', 'FINANCE_VIEWER'),
])
const H = (x) => x.s.http
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

let docId, v1
await t('documents: upload stores hash, rejects bad content, self-review forbidden, verified by another person', async () => {
  const bad = await H(o1).post('/api/admin2/documents', { title: 'bad', documentType: 'ID', file: { base64: Buffer.from('not a png').toString('base64'), contentType: 'image/png', filename: 'x.png' } })
  assert.equal(bad.status, 400)
  const up = await H(o1).post('/api/admin2/documents', { title: `ID ${run}`, documentType: 'IDENTITY', platformId: plat.str.id, file: { base64: PNG.toString('base64'), contentType: 'image/png', filename: 'id.png' } })
  assert.equal(up.status, 201, up.text)
  docId = up.json.id; v1 = up.json.versionId
  assert.equal(up.json.sha256, createHash('sha256').update(PNG).digest('hex'))
  assert.equal((await H(o1).post(`/api/admin2/documents/${docId}/review`, { decision: 'VERIFIED' })).status, 403, 'self-review denied by segregation of duties (evaluator)')
  assert.equal((await H(o2).post(`/api/admin2/documents/${docId}/review`, { decision: 'REJECTED' })).status, 400, 'reject needs a reason')
  assert.equal((await H(o2).post(`/api/admin2/documents/${docId}/review`, { decision: 'VERIFIED' })).status, 200)
  assert.equal((await H(o1).get(`/api/admin2/documents/${docId}`)).json.document.status, 'VERIFIED')
})

await t('documents: download is a separate permission, integrity-checked and audited; STR manager reads metadata only', async () => {
  assert.equal((await H(str).get(`/api/admin2/documents/${docId}`)).status, 200)
  assert.equal((await H(str).get(`/api/admin2/documents/${docId}/download`)).status, 403)
  const res = await fetch(`${api.base}/api/admin2/documents/${docId}/download`, { headers: { authorization: `Bearer ${o1.s.token}` } })
  assert.equal(res.status, 200)
  assert.equal(createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex'), createHash('sha256').update(PNG).digest('hex'))
  assert.ok(await p.adminAuditLog.findFirst({ where: { entityId: docId, action: 'document.downloaded' } }))
  assert.equal(JSON.stringify((await H(o1).get(`/api/admin2/documents/${docId}`)).json).includes('storageKey'), false, 'storage key never exposed')
})

await t('documents: a correction is a NEW version; the original stays downloadable; status resets for review', async () => {
  const nv = await H(o1).post(`/api/admin2/documents/${docId}/versions`, { reason: 'sharper scan', file: { base64: PNG.toString('base64'), contentType: 'image/png', filename: 'id2.png' } })
  assert.equal(nv.status, 201); assert.equal(nv.json.versionNumber, 2)
  const d = (await H(o1).get(`/api/admin2/documents/${docId}`)).json
  assert.equal(d.document.status, 'UPLOADED'); assert.equal(d.versions.length, 2)
  const old = await fetch(`${api.base}/api/admin2/documents/${docId}/download?versionId=${v1}`, { headers: { authorization: `Bearer ${o1.s.token}` } })
  assert.equal(old.status, 200)
  assert.equal((await H(o1).post(`/api/admin2/documents/${docId}/status`, { to: 'VERIFIED', reason: 'skip review please' })).status, 409, 'cannot jump to VERIFIED by status edit')
})

api.stop()
const failed = summary()
await p.$disconnect()
process.exit(failed ? 1 : 0)
