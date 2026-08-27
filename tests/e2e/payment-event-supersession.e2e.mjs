// SYBNB — Duplicate-resolution supersession model E2E (governed evidence artifact).
//
// Proves, via direct library/DB calls against the real Postgres schema, the properties independent
// review specifically asked to be shown directly after finding that migration 020 rewrote a losing
// duplicate's providerEventId (appending '#env_dedup_loser:<id>') to resolve an identity collision —
// altering the most important provider-originated identifier on that row, breaking direct
// reconciliation by the provider's real event id. Migration 021 replaced that mechanism entirely with
// a canonical/superseded relationship: a losing row keeps its real providerEventId FOREVER; a new
// supersededByEventId column (plus supersededAt/supersededReason) records which row is canonical and
// why, and a PARTIAL unique index (scoped to non-superseded rows) is the real uniqueness enforcement.
//
//   - the partial unique index rejects a second CANONICAL row under an identical identity triple, in
//     EVERY one of the 8 PaymentEventProcessingStatus values -- proving this holds regardless of what
//     state a duplicate was in, not just the two specific historical rows that happened to exist;
//   - a duplicate correctly marked superseded keeps the EXACT SAME, byte-for-byte real providerEventId
//     as its survivor, in every status, and both remain independently queryable by it;
//   - ON DELETE RESTRICT: a canonical row can never be deleted while a superseded duplicate still
//     points to it;
//   - intakeEvent() resolves a genuine conflict against the CANONICAL row specifically, never a
//     superseded historical duplicate, and the canonical row itself stays completely unchanged.
//
// Run: DATABASE_URL=<url> node tests/e2e/payment-event-supersession.e2e.mjs
// (no live server required -- this suite exercises the schema/library layer directly)

import { db, disconnectDb } from '../../server/lib/prisma.mjs'
import { intakeEvent } from '../../server/lib/payment-event-pipeline.mjs'

let pass = 0
let fail = 0
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`   PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) }
}

const ALL_PROCESSING_STATUSES = ['RECEIVED', 'APPLYING', 'APPLIED', 'IGNORED', 'FAILED', 'DEAD_LETTERED', 'QUARANTINED', 'POLICY_DEFERRED']

console.log('=== 1. Partial unique index + non-destructive supersession, across EVERY processing status ===')
for (const status of ALL_PROCESSING_STATUSES) {
  const providerEventId = `evt_supersession_${status.toLowerCase()}_${Date.now()}`
  const base = {
    rail: 'payment_intent', provider: 'sandbox', providerEndpointKey: 'sandbox-test-account', environment: 'test',
    subjectType: 'PAYMENT_INTENT', providerReference: `ref_${providerEventId}`,
    providerEventId, type: 'payment_intent.succeeded', amountMinor: 100000, currency: 'syp',
    providerObjectId: `obj_${providerEventId}`, payloadDigest: `digest_${providerEventId}`,
  }
  const canonical = await db().paymentEvent.create({ data: { ...base, processingStatus: status } })

  let blocked = false
  try {
    await db().paymentEvent.create({ data: { ...base, processingStatus: status } })
  } catch (err) {
    blocked = err?.code === 'P2002'
  }
  check(`[${status}] the partial unique index rejects a second CANONICAL row under the identical identity triple`, blocked, 'insert unexpectedly succeeded')

  const duplicate = await db().paymentEvent.create({
    data: { ...base, processingStatus: status, supersededByEventId: canonical.id, supersededAt: new Date(), supersededReason: `test-seeded historical duplicate for status ${status}` },
  })
  check(
    `[${status}] the superseded duplicate keeps the EXACT SAME, real providerEventId as its canonical survivor -- never rewritten`,
    duplicate.providerEventId === canonical.providerEventId && duplicate.providerEventId === providerEventId,
    JSON.stringify({ canonical: canonical.providerEventId, duplicate: duplicate.providerEventId, expected: providerEventId }),
  )

  const byRawId = await db().paymentEvent.findMany({ where: { providerEventId } })
  check(`[${status}] both rows remain independently queryable by the real, unaltered provider event id`, byRawId.length === 2, byRawId.length)

  const canonicalOnly = await db().paymentEvent.findMany({ where: { providerEventId, supersededByEventId: null } })
  check(
    `[${status}] filtering to canonical-only (supersededByEventId: null) resolves to exactly the survivor`,
    canonicalOnly.length === 1 && canonicalOnly[0].id === canonical.id,
    JSON.stringify(canonicalOnly.map((r) => r.id)),
  )
}

console.log('\n=== 2. ON DELETE RESTRICT: a canonical row cannot be deleted while a superseded duplicate still references it ===')
{
  const providerEventId = `evt_supersession_restrict_${Date.now()}`
  const base = {
    rail: 'payment_intent', provider: 'sandbox', providerEndpointKey: 'sandbox-test-account', environment: 'test',
    subjectType: 'PAYMENT_INTENT', providerReference: `ref_${providerEventId}`,
    providerEventId, type: 'payment_intent.succeeded', amountMinor: 100000, currency: 'syp',
    providerObjectId: `obj_${providerEventId}`, payloadDigest: `digest_${providerEventId}`,
  }
  const canonical = await db().paymentEvent.create({ data: { ...base, processingStatus: 'APPLIED', appliedAt: new Date() } })
  const duplicate = await db().paymentEvent.create({
    data: { ...base, processingStatus: 'IGNORED', supersededByEventId: canonical.id, supersededAt: new Date(), supersededReason: 'ON DELETE RESTRICT test' },
  })

  let restricted = false
  try {
    await db().paymentEvent.delete({ where: { id: canonical.id } })
  } catch (err) {
    restricted = err?.code === 'P2003' || /foreign key/i.test(String(err?.message || ''))
  }
  check('deleting a canonical row referenced by a superseded duplicate is refused (ON DELETE RESTRICT)', restricted, 'delete unexpectedly succeeded')

  const canonicalStillThere = await db().paymentEvent.findUnique({ where: { id: canonical.id } })
  check('the canonical row still exists, fully intact, after the refused delete attempt', Boolean(canonicalStillThere), 'canonical row missing after a supposedly-refused delete')

  // Tidy up: delete the duplicate first (no longer restricted once nothing references the canonical),
  // then the canonical itself -- not required by anything else in this app (nothing ever deletes
  // PaymentEvent rows in production code), just keeps this test's own synthetic data out of the DB.
  await db().paymentEvent.delete({ where: { id: duplicate.id } })
  await db().paymentEvent.delete({ where: { id: canonical.id } })
}

console.log('\n=== 3. intakeEvent() resolves a genuine conflict against the CANONICAL row specifically, never a superseded historical duplicate ===')
{
  const providerEventId = `evt_supersession_intake_${Date.now()}`
  const base = {
    rail: 'payment_intent', provider: 'sandbox', providerEndpointKey: 'sandbox-test-account', environment: 'test',
    subjectType: 'PAYMENT_INTENT', providerReference: `ref_${providerEventId}`,
    providerEventId, type: 'payment_intent.succeeded', amountMinor: 100000, currency: 'syp',
    providerObjectId: `obj_${providerEventId}`, payloadDigest: `digest_${providerEventId}`,
  }
  const canonical = await db().paymentEvent.create({ data: { ...base, processingStatus: 'APPLIED', appliedAt: new Date(), attempts: 1 } })
  const duplicate = await db().paymentEvent.create({
    data: { ...base, processingStatus: 'IGNORED', supersededByEventId: canonical.id, supersededAt: new Date(), supersededReason: 'intake-conflict-resolution test' },
  })

  // A new delivery under this identity, with ALTERED content -> a genuine conflict, which must be
  // recorded against the CANONICAL row (never the superseded duplicate), leaving the canonical row's
  // own true, authoritative outcome (already APPLIED) completely untouched -- round 4's own
  // established principle, now proven to hold correctly even in the presence of a superseded sibling.
  const { eventRow, conflict } = await intakeEvent({ ...base, providerObjectId: 'ALTERED_OBJECT_ID', payloadDigest: 'ALTERED_DIGEST', processingStatus: 'RECEIVED' })
  check('a new conflicting delivery resolves against the CANONICAL row, not the superseded duplicate', eventRow.id === canonical.id, JSON.stringify({ resolved: eventRow.id, canonical: canonical.id, duplicate: duplicate.id }))
  check('it is correctly classified as a genuine conflict (content differs)', conflict === true, conflict)
  const conflictRecord = await db().paymentEventConflict.findFirst({ where: { paymentEventId: canonical.id }, orderBy: { receivedAt: 'desc' } })
  check('the conflict record references the canonical row', Boolean(conflictRecord), 'no conflict record created')
  const canonicalAfter = await db().paymentEvent.findUnique({ where: { id: canonical.id } })
  check('the canonical row itself is completely unchanged by the conflicting delivery', JSON.stringify(canonicalAfter) === JSON.stringify(canonical), JSON.stringify({ before: canonical, after: canonicalAfter }))
}

console.log(`\n==== PAYMENT EVENT SUPERSESSION & MIGRATION MODEL: ${pass} passed, ${fail} failed ====`)
await disconnectDb()
process.exit(fail ? 1 : 0)
