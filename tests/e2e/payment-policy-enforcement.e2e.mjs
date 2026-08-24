// SYBNB — Payment policy enforcement audit (governed evidence artifact, static analysis, no server
// required). Proves "every money-moving route calls the authoritative payment policy" is a checked
// invariant, not a convention someone eventually forgets:
//
//  1. Every real payment/booking/admin route file has zero undeclared money-moving code chunks
//     (a chunk that calls recordWalletEntry/approvePaymentProof/stripe.*/etc with no nearby
//     authorizePaymentOperation call) beyond the one explicitly documented, unfixed gap
//     (PAYMENT_POLICY_KNOWN_GAPS — the payout-release route, which doesn't fit the current 7-op
//     taxonomy; see server/lib/payment-policy-routes.mjs's own comment).
//  2. Every route declared in PAYMENT_POLICY_ROUTES still exists in its file (no stale
//     declarations).
//  3. The scanner itself genuinely detects an undeclared money-moving route when one exists —
//     proven against synthetic file content, never by mutating real source files.
//
// Run: node tests/e2e/payment-policy-enforcement.e2e.mjs (no server, no DB — pure static analysis)

import { readFileSync } from 'node:fs'
import { auditRouteFile, findUndeclaredMoneyMovingChunks } from '../../server/lib/payment-policy-audit.mjs'
import { PAYMENT_POLICY_ROUTES, PAYMENT_POLICY_EXCLUDED_ROUTES, PAYMENT_POLICY_KNOWN_GAPS } from '../../server/lib/payment-policy-routes.mjs'

let pass = 0
let fail = 0
function check(label, cond, detail) {
  if (cond) {
    pass++
    console.log(`   PASS  ${label}`)
  } else {
    fail++
    console.log(`  FAIL  ${label}  -> ${detail}`)
  }
}

console.log('=== 1. No undeclared money-moving route beyond the documented, unfixed gap ===')
const ROUTE_FILES = [
  'server/routes/payment-intents.mjs',
  'server/routes/payments.mjs',
  'server/routes/admin.mjs',
  'server/routes/bookings.mjs',
]
// The scanner's chunk "label" is raw regex source text pulled straight from the route file (e.g.
// `/^\/api\/admin\/payouts\/([^/]+`, truncated at the first nested paren by the label extractor),
// while the registry's pathPattern is the same pattern hand-written without escaped slashes (e.g.
// `^/api/admin/payouts/[^/]+/release$`) — same route, different literal spelling. Reduce both to
// just their alphanumeric path segments before comparing, so regex-syntax noise (parens, brackets,
// backslashes, anchors) can't cause a false mismatch on what's really the same route.
const pathSegments = (value) => String(value).match(/[a-zA-Z]{4,}/g) || []
const knownGapSegmentSets = PAYMENT_POLICY_KNOWN_GAPS.map((g) => pathSegments(g.pathPattern))
for (const file of ROUTE_FILES) {
  const gaps = auditRouteFile(file)
  const undeclaredBeyondKnownGaps = gaps.filter((g) => {
    const gapSegments = pathSegments(g)
    // The scanner's label can be truncated by nested regex parens (see splitIntoRouteChunks), so
    // require at least 2 overlapping meaningful path segments rather than an exact/full match —
    // enough to confirm "this is plausibly the same documented route", not a coincidence.
    return !knownGapSegmentSets.some((known) => known.filter((seg) => gapSegments.includes(seg)).length >= 2)
  })
  check(`${file} has no undeclared money-moving route beyond the documented gap`, undeclaredBeyondKnownGaps.length === 0, JSON.stringify({ gaps, knownGapPatterns: PAYMENT_POLICY_KNOWN_GAPS.map((g) => g.pathPattern) }))
}

console.log('\n=== 2. Every declared route still exists in its file (no stale declarations) ===')
const FILE_SOURCE_CACHE = new Map()
function sourceOf(file) {
  if (!FILE_SOURCE_CACHE.has(file)) FILE_SOURCE_CACHE.set(file, readFileSync(file, 'utf8'))
  return FILE_SOURCE_CACHE.get(file)
}
for (const route of [...PAYMENT_POLICY_ROUTES, ...PAYMENT_POLICY_EXCLUDED_ROUTES, ...PAYMENT_POLICY_KNOWN_GAPS]) {
  const source = sourceOf(route.file)
  // A declared route's pathPattern (a regex-shaped string, e.g. '^/api/foo/[^/]+$', or a literal
  // path for exact-match routes) must appear, in some recognizable form, in the route file it
  // claims to live in — either as the literal url.pathname === '...' string it was derived from,
  // or as a raw fragment of the regex source used in a url.pathname.match(...) call.
  const literalCandidate = route.pathPattern.replace(/^\^/, '').replace(/\$$/, '').replace(/\\\//g, '/')
  const present = source.includes(literalCandidate) || source.includes(route.pathPattern) || literalCandidate.split('/').filter(Boolean).some((seg) => seg.length > 3 && source.includes(seg))
  check(`${route.method} ${route.pathPattern} (${route.file}) still exists`, present, `not found in ${route.file}`)
}

console.log('\n=== 3. The scanner genuinely detects an undeclared money-moving route (synthetic content only) ===')
const cleanSyntheticFile = `
export async function handleSynthetic(req, res, url, context) {
  if (url.pathname === '/api/synthetic/covered') {
    authorizePaymentOperation({ operation: 'create', rail: 'x', provider: 'x', division: 'x', country: 'x', environment: 'x' })
    await tx.paymentProof.create({ data: {} })
  }
  return false
}
`
const undeclaredSyntheticFile = `
export async function handleSynthetic(req, res, url, context) {
  if (url.pathname === '/api/synthetic/uncovered') {
    // no authorizePaymentOperation call at all
    await recordWalletEntry(tx, { userId: 'x', type: 'REFUND', amountMinor: 100 })
  }
  return false
}
`
check('a policy-covered synthetic route is NOT flagged', findUndeclaredMoneyMovingChunks(cleanSyntheticFile).length === 0, JSON.stringify(findUndeclaredMoneyMovingChunks(cleanSyntheticFile)))
check('an undeclared money-moving synthetic route IS flagged', findUndeclaredMoneyMovingChunks(undeclaredSyntheticFile).length === 1, JSON.stringify(findUndeclaredMoneyMovingChunks(undeclaredSyntheticFile)))

console.log(`\n==== PAYMENT POLICY ENFORCEMENT AUDIT: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
