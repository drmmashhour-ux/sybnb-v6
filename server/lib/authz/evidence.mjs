import { dbClock } from './clock.mjs'
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
// Added in STEP 5H (migration 083): organizationId, likewise hashed ONLY when present (rows written before 083 are NULL and verify unchanged).
const OPTIONAL_FIELDS = ['rulesetVersion', 'organizationId']
// Evidence written before rule-set versioning existed carries this explicit marker (migration 082). It is NOT a
// rule-set version: it is excluded from the hash (so historical hashes still verify) and can never be written anew.
export const LEGACY_RULESET_VERSION = 'LEGACY_PRE_VERSIONED'

export function canonicalEvidence(record, prevHash, decidedAt) {
  const body = {}
  for (const f of FIELDS) {
    const v = record[f]
    body[f] = v instanceof Date ? v.toISOString() : v ?? null
  }
  for (const f of OPTIONAL_FIELDS) if (record[f] != null && !(f === 'rulesetVersion' && record[f] === LEGACY_RULESET_VERSION)) body[f] = record[f]
  return JSON.stringify({ prev: prevHash ?? null, decidedAt: decidedAt.toISOString(), body })
}

export function hashEvidence(record, prevHash, decidedAt) {
  return createHash('sha256').update(canonicalEvidence(record, prevHash, decidedAt)).digest('hex')
}

/** Insert one evidence row. `tx` MUST be a transaction client so the chain tail is read under lock. */
export async function writeEvidence(tx, record) {
  // 5D: new evidence must say which rule set decided it; the legacy marker is reserved for pre-versioning rows.
  if (typeof record.rulesetVersion !== 'string' || !record.rulesetVersion.trim() || record.rulesetVersion === LEGACY_RULESET_VERSION) {
    throw Object.assign(new Error('authorization evidence requires a real rulesetVersion'), { code: 'EVIDENCE_RULESET_REQUIRED' })
  }
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('authorization_evidence_chain'))`
  const last = await tx.authorizationEvidence.findFirst({ orderBy: { sequence: 'desc' }, select: { hash: true } })
  const decidedAt = await dbClock(tx) // database clock, read under the chain lock => monotonic along the chain
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

/**
 * STEP 5H: verify only ONE organization's evidence, without reading any other organization's rows. Two checks per row:
 *   1. self-consistency: the stored hash equals the hash recomputed from the row's own content and its own prevHash;
 *   2. linkage: prevHash is null (and the row is the very first in the chain) or equals the hash of an existing row with a
 *      LOWER sequence. Only hashes and sequence numbers of other rows are looked up; their content is never read or returned.
 * Rows of other organizations are verified by those organizations; legacy rows written before migration 083 carry no
 * organization and cannot be verified through this route. Read-only. Returns { ok, checked, scope, brokenAtSequence?, reason? }.
 */
export async function verifyEvidenceChainForOrganization(client, organizationId, { limit = 50_000 } = {}) {
  if (!organizationId) return { ok: false, checked: 0, scope: 'ORGANIZATION', reason: 'ORGANIZATION_REQUIRED' }
  const rows = await client.authorizationEvidence.findMany({ where: { organizationId }, orderBy: { sequence: 'asc' }, take: limit })
  const known = new Map()
  const wanted = [...new Set(rows.map((r) => r.prevHash).filter(Boolean))]
  for (let i = 0; i < wanted.length; i += 500) {
    const found = await client.authorizationEvidence.findMany({ where: { hash: { in: wanted.slice(i, i + 500) } }, select: { hash: true, sequence: true } })
    for (const f of found) known.set(f.hash, f.sequence)
  }
  const broken = (r, i, reason) => ({ ok: false, checked: i, scope: 'ORGANIZATION', brokenAtSequence: String(r.sequence), reason })
  for (const [i, r] of rows.entries()) {
    if (hashEvidence(r, r.prevHash ?? null, r.decidedAt) !== r.hash) return broken(r, i, 'HASH_MISMATCH')
    if (r.prevHash != null) {
      const seq = known.get(r.prevHash)
      if (seq == null || BigInt(seq) >= BigInt(r.sequence)) return broken(r, i, 'PREV_HASH_MISMATCH')
    } else if (await client.authorizationEvidence.findFirst({ where: { sequence: { lt: r.sequence } }, select: { sequence: true } })) {
      return broken(r, i, 'PREV_HASH_MISMATCH') // a null prevHash is only valid for the first row of the whole chain
    }
  }
  return { ok: true, checked: rows.length, scope: 'ORGANIZATION' }
}
