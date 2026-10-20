// STEP 5 -- authorization evidence writer (Step 3A.3). Append-only, hash-chained, written inside the
// caller's transaction so the evidence and the action commit or roll back together.
import { createHash } from 'node:crypto'

const FIELDS = [
  'userId', 'sessionId', 'roleAssignmentId', 'roleVersionId', 'roleCode', 'roleVersionNumber', 'permissionId', 'permissionCode',
  'scopeId', 'scopeKind', 'scopeTarget', 'scopeDescription', 'platformContext', 'resourceType', 'resourceId', 'action',
  'authStrength', 'mfaMethod', 'mfaResult', 'recentAuthAt', 'requestId', 'correlationId', 'decision', 'denyReason',
  'policyVersionId', 'delegationId', 'auditEventId', 'approvalSnapshotId',
]
// Added in STEP 5B. Included in the hash ONLY when present, so rows written before 5B still verify unchanged.
const OPTIONAL_FIELDS = ['rulesetVersion']

export function canonicalEvidence(record, prevHash, decidedAt) {
  const body = {}
  for (const f of FIELDS) {
    const v = record[f]
    body[f] = v instanceof Date ? v.toISOString() : v ?? null
  }
  for (const f of OPTIONAL_FIELDS) if (record[f] != null) body[f] = record[f]
  return JSON.stringify({ prev: prevHash ?? null, decidedAt: decidedAt.toISOString(), body })
}

export function hashEvidence(record, prevHash, decidedAt) {
  return createHash('sha256').update(canonicalEvidence(record, prevHash, decidedAt)).digest('hex')
}

/** Insert one evidence row. `tx` MUST be a transaction client so the chain tail is read under lock. */
export async function writeEvidence(tx, record) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('authorization_evidence_chain'))`
  const last = await tx.authorizationEvidence.findFirst({ orderBy: { sequence: 'desc' }, select: { hash: true } })
  const decidedAt = new Date()
  const hash = hashEvidence(record, last?.hash ?? null, decidedAt)
  const data = { ...pick(record), prevHash: last?.hash ?? null, hash, decidedAt }
  return tx.authorizationEvidence.create({ data })
}

function pick(record) {
  const out = {}
  for (const f of [...FIELDS, ...OPTIONAL_FIELDS]) if (record[f] !== undefined) out[f] = record[f]
  return out
}

/** Re-verify the chain. Returns { ok, checked, brokenAtSequence? }. Read-only. */
export async function verifyEvidenceChain(client, { limit = 10_000 } = {}) {
  const rows = await client.authorizationEvidence.findMany({ orderBy: { sequence: 'asc' }, take: limit })
  let prev = null
  for (const r of rows) {
    if ((r.prevHash ?? null) !== prev) return { ok: false, checked: rows.indexOf(r), brokenAtSequence: String(r.sequence), reason: 'PREV_HASH_MISMATCH' }
    const expected = hashEvidence(r, prev, r.decidedAt)
    if (expected !== r.hash) return { ok: false, checked: rows.indexOf(r), brokenAtSequence: String(r.sequence), reason: 'HASH_MISMATCH' }
    prev = r.hash
  }
  return { ok: true, checked: rows.length }
}
