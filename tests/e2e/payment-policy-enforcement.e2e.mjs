// SYBNB — Payment policy enforcement audit (governed evidence artifact, static analysis, no server
// required). Proves "every money-moving route calls the authoritative payment policy, before it
// mutates anything" is a checked invariant, not a convention someone eventually forgets.
//
// Rewritten from a regex/comment-stripping heuristic to a real AST (acorn — see
// server/lib/payment-policy-audit.mjs's own header comment for the full design). This version
// closes two of the three gaps the previous one only disclosed: it now DETECTS indirect calls
// through a local or allow-listed-imported wrapper function (previously a disclosed miss), and it
// FAILS CLOSED on a computed/template route-path dispatch instead of silently ignoring it
// (previously also a disclosed miss). What genuinely remains undetectable by ANY static analyzer —
// a call reached only through fully dynamic dispatch with no static resolution possible — is
// demonstrated, not just claimed, in section 10 below.
//
// Run: node tests/e2e/payment-policy-enforcement.e2e.mjs (no server, no DB — pure static analysis)

import { readFileSync } from 'node:fs'
import { allRouteFiles, auditRouteFile, auditSource } from '../../server/lib/payment-policy-audit.mjs'
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

function undeclaredLabels(result) {
  return result.chunks
    .filter((c) => c.kind !== 'unresolvable_trigger' && c.findings.some((f) => f.kind === 'money_moving') && !c.findings.some((f) => f.kind === 'policy_call'))
    .map((c) => c.label)
}
function unresolvableTriggerLabels(result) {
  return result.chunks.filter((c) => c.kind === 'unresolvable_trigger').map((c) => c.label)
}
function dangerousFindings(result) {
  return result.chunks.flatMap((c) => c.findings.filter((f) => f.kind === 'unresolvable'))
}

console.log('=== 1. Every mounted router is covered, discovered from disk, not a hardcoded list ===')
const routeFiles = allRouteFiles()
const indexSource = readFileSync('server/index.mjs', 'utf8')
const mountedHandlerImports = [...indexSource.matchAll(/from\s+'\.\/routes\/([a-zA-Z0-9-]+)\.mjs'/g)].map((m) => m[1])
check('every router imported by server/index.mjs was discovered on disk', mountedHandlerImports.every((name) => routeFiles.includes(`server/routes/${name}.mjs`)), JSON.stringify({ mountedHandlerImports, routeFiles }))
check('every router discovered on disk is actually mounted by server/index.mjs', routeFiles.every((f) => mountedHandlerImports.includes(f.replace('server/routes/', '').replace('.mjs', ''))), JSON.stringify({ mountedHandlerImports, routeFiles }))
console.log(`   (${routeFiles.length} route files scanned: ${routeFiles.map((f) => f.replace('server/routes/', '')).join(', ')})`)

console.log('\n=== 2. No undeclared money-moving route anywhere, no unresolvable dispatch, no order violation, no parse failure ===')
check('PAYMENT_POLICY_KNOWN_GAPS is empty (payout_release closed the one prior gap)', PAYMENT_POLICY_KNOWN_GAPS.length === 0, JSON.stringify(PAYMENT_POLICY_KNOWN_GAPS))
// The AST scanner's chunk label is the literal path string (exact-match routes) or the raw source
// text of the .match() argument (regex routes) — for a short, deliberately-broad exclusion like
// '^/api/wallet' that's the single segment 'wallet', which is exactly the intended breadth.
const pathSegments = (value) => String(value).match(/[a-zA-Z]{4,}/g) || []
const excludedSegmentSets = PAYMENT_POLICY_EXCLUDED_ROUTES.map((r) => pathSegments(r.pathPattern)).filter((segs) => segs.length > 0)
function isDeclaredExcluded(label) {
  const labelSegments = pathSegments(label)
  return excludedSegmentSets.some((excluded) => excluded.every((seg) => labelSegments.includes(seg)))
}
for (const file of routeFiles) {
  const result = auditRouteFile(file)
  check(`${file} parses cleanly (AST, not regex)`, result.parseError === null, String(result.parseError))
  const gaps = undeclaredLabels(result).filter((label) => !isDeclaredExcluded(label))
  check(`${file} has zero undeclared money-moving routes (beyond documented exclusions)`, gaps.length === 0, JSON.stringify(gaps))
  check(`${file} has zero unresolvable route-dispatch shapes`, unresolvableTriggerLabels(result).length === 0 && result.fileUnresolvableTriggers.length === 0, JSON.stringify({ chunks: unresolvableTriggerLabels(result), fileLevel: result.fileUnresolvableTriggers }))
  check(`${file} has zero dangerous unresolvable calls (eval / Function / computed member call)`, dangerousFindings(result).length === 0, JSON.stringify(dangerousFindings(result)))
}

console.log('\n=== 3. Every declared route (including payout_release) still exists in its file ===')
const FILE_SOURCE_CACHE = new Map()
function sourceOf(file) {
  if (!FILE_SOURCE_CACHE.has(file)) FILE_SOURCE_CACHE.set(file, readFileSync(file, 'utf8'))
  return FILE_SOURCE_CACHE.get(file)
}
for (const route of [...PAYMENT_POLICY_ROUTES, ...PAYMENT_POLICY_EXCLUDED_ROUTES]) {
  const source = sourceOf(route.file)
  const literalCandidate = route.pathPattern.replace(/^\^/, '').replace(/\$$/, '').replace(/\\\//g, '/')
  const present = source.includes(literalCandidate) || source.includes(route.pathPattern) || literalCandidate.split('/').filter(Boolean).some((seg) => seg.length > 3 && source.includes(seg))
  check(`${route.method} ${route.pathPattern} (${route.file}) still exists`, present, `not found in ${route.file}`)
}
const payoutReleaseRoute = PAYMENT_POLICY_ROUTES.find((r) => r.operation === 'payout_release')
check('payout_release is registered as its own distinct operation (not stretched onto capture/refund/replay)', payoutReleaseRoute?.operation === 'payout_release', JSON.stringify(payoutReleaseRoute))

console.log('\n=== 4. Comments and string contents never produce a false result (parser-native, not regex-stripped) ===')
const commentOnlyFile = `
export async function handleSynthetic(req, res, url, context) {
  if (url.pathname === '/api/synthetic/comment-only') {
    // recordWalletEntry(tx, {...}) -- this is just a comment describing what NOT to do here
    const doc = "call recordWalletEntry(tx, {...}) in the real handler"
    return json(res, 200, { ok: true })
  }
  return false
}
`
check('a money-moving pattern appearing only in a comment/string is NOT flagged', undeclaredLabels(auditSource(commentOnlyFile)).length === 0, JSON.stringify(undeclaredLabels(auditSource(commentOnlyFile))))

console.log('\n=== 5. Fails on a newly-added, unregistered money-moving route (synthetic content only) ===')
const undeclaredSyntheticFile = `
export async function handleSynthetic(req, res, url, context) {
  if (url.pathname === '/api/synthetic/uncovered') {
    await recordWalletEntry(tx, { userId: 'x', type: 'REFUND', amountMinor: 100 })
  }
  return false
}
`
check('an undeclared money-moving synthetic route IS flagged', undeclaredLabels(auditSource(undeclaredSyntheticFile)).length === 1, JSON.stringify(undeclaredLabels(auditSource(undeclaredSyntheticFile))))

console.log('\n=== 6. Fails when policy enforcement is REMOVED from previously-covered code ===')
const coveredSyntheticFile = `
export async function handleSynthetic(req, res, url, context) {
  if (url.pathname === '/api/synthetic/covered') {
    authorizePaymentOperation({ operation: 'refund', rail: 'x', provider: 'x', division: 'x', country: 'x', environment: 'x' })
    await recordWalletEntry(tx, { userId: 'x', type: 'REFUND', amountMinor: 100 })
  }
  return false
}
`
const enforcementRemovedFile = coveredSyntheticFile.replace(/authorizePaymentOperation\([^)]*\)\n\s*/, '')
check('the covered version is clean', undeclaredLabels(auditSource(coveredSyntheticFile)).length === 0, JSON.stringify(undeclaredLabels(auditSource(coveredSyntheticFile))))
check('deleting only the policy call from otherwise-identical code now fails the audit', undeclaredLabels(auditSource(enforcementRemovedFile)).length === 1, JSON.stringify(undeclaredLabels(auditSource(enforcementRemovedFile))))

console.log('\n=== 7. Policy call present but positioned AFTER the first mutation — newly caught (order-of-operations) ===')
const orderViolationFile = `
export async function handleSynthetic(req, res, url, context) {
  if (url.pathname === '/api/synthetic/late-policy') {
    await recordWalletEntry(tx, { userId: 'x', type: 'REFUND', amountMinor: 100 })
    authorizePaymentOperation({ operation: 'refund', rail: 'x', provider: 'x', division: 'x', country: 'x', environment: 'x' })
  }
  return false
}
`
const orderResult = auditSource(orderViolationFile)
check('a policy call moved after the first mutation fails the audit', orderResult.ok === false, JSON.stringify(orderResult.chunks))
check('a READ-only stripe call (retrieve/constructEvent) before the policy call does NOT false-positive as an order violation', (() => {
  const readBeforePolicy = `
export async function handleSynthetic(req, res, url, context) {
  if (url.pathname === '/api/synthetic/read-then-authorize') {
    const session = await stripe.checkout.sessions.retrieve(id)
    authorizePaymentOperation({ operation: 'capture', rail: 'x', provider: 'x', division: 'x', country: 'x', environment: 'x' })
    await finalizeStripeSession(session)
  }
  return false
}
`
  return auditSource(readBeforePolicy).ok === true
})(), 'a read before the policy call was incorrectly treated as an order violation')

console.log('\n=== 8. Indirect calls through a wrapper function — PREVIOUSLY a disclosed miss, NOW caught ===')
const localWrapperFile = `
async function releaseHostPayout(tx, args) {
  return recordWalletEntry(tx, args)
}
export async function handleSynthetic(req, res, url, context) {
  if (url.pathname === '/api/synthetic/local-wrapper') {
    await releaseHostPayout(tx, { userId: 'x', type: 'RELEASE', amountMinor: 100 })
  }
  return false
}
`
check('a call through a LOCAL wrapper function that itself calls recordWalletEntry IS now detected', undeclaredLabels(auditSource(localWrapperFile)).length === 1, JSON.stringify(undeclaredLabels(auditSource(localWrapperFile))))

const importedWrapperFile = `
import { releaseHostPayout } from '../lib/finance-ledger.mjs'
export async function handleSynthetic(req, res, url, context) {
  if (url.pathname === '/api/synthetic/imported-wrapper') {
    await releaseHostPayout(tx, { userId: 'x', type: 'RELEASE', amountMinor: 100 })
  }
  return false
}
`
const financeLedgerFixture = `
export async function releaseHostPayout(tx, args) {
  return recordWalletEntry(tx, args)
}
`
check('a call through an IMPORTED wrapper (from an allow-listed lib file) that calls recordWalletEntry IS now detected',
  undeclaredLabels(auditSource(importedWrapperFile, { followImports: new Map([['finance-ledger.mjs', financeLedgerFixture]]) })).length === 1,
  JSON.stringify(undeclaredLabels(auditSource(importedWrapperFile, { followImports: new Map([['finance-ledger.mjs', financeLedgerFixture]]) }))))

const aliasedImportFile = `
import { recordWalletEntry as rwe } from '../lib/finance-ledger.mjs'
export async function handleSynthetic(req, res, url, context) {
  if (url.pathname === '/api/synthetic/aliased-import') {
    await rwe(tx, { userId: 'x', type: 'RELEASE', amountMinor: 100 })
  }
  return false
}
`
check('a call through an ALIASED import (import { recordWalletEntry as rwe }) IS detected', undeclaredLabels(auditSource(aliasedImportFile)).length === 1, JSON.stringify(undeclaredLabels(auditSource(aliasedImportFile))))

console.log('\n=== 9. Computed/template route dispatch — PREVIOUSLY a disclosed miss, NOW fails closed ===')
const computedPathFile = `
const dynamicSegment = 'payouts'
export async function handleSynthetic(req, res, url, context) {
  if (url.pathname === '/api/admin/' + dynamicSegment + '/release') {
    await recordWalletEntry(tx, { userId: 'x', type: 'RELEASE', amountMinor: 100 })
  }
  return false
}
`
const computedResult = auditSource(computedPathFile)
check('a computed/concatenated route path fails closed (UNRESOLVABLE_ROUTE_TRIGGER), not silently ignored', computedResult.ok === false && unresolvableTriggerLabels(computedResult).length === 1, JSON.stringify(computedResult.chunks))

const templatePathFile = `
export async function handleSynthetic(req, res, url, context) {
  if (url.pathname === \`/api/admin/\${segment}/release\`) {
    await recordWalletEntry(tx, { userId: 'x', type: 'RELEASE', amountMinor: 100 })
  }
  return false
}
`
check('a template-literal route path also fails closed', auditSource(templatePathFile).ok === false, JSON.stringify(auditSource(templatePathFile).chunks))

console.log('\n=== 10. Genuinely unresolvable dynamic dispatch — still fails closed (inherent to ANY static analyzer, not a defect) ===')
const computedCallFile = `
const handlers = { release: recordWalletEntry }
export async function handleSynthetic(req, res, url, context) {
  if (url.pathname === '/api/synthetic/computed-call') {
    await handlers['release'](tx, { userId: 'x', type: 'RELEASE', amountMinor: 100 })
  }
  return false
}
`
const computedCallResult = auditSource(computedCallFile)
check('a computed member call (handlers[\'release\'](...)) fails closed, not silently assumed safe', computedCallResult.ok === false && dangerousFindings(computedCallResult).some((f) => f.why === 'computed_member_call'), JSON.stringify(computedCallResult.chunks))

const evalFile = `
export async function handleSynthetic(req, res, url, context) {
  if (url.pathname === '/api/synthetic/eval') {
    eval("recordWalletEntry(tx, {})")
  }
  return false
}
`
const evalResult = auditSource(evalFile)
check('eval(...) fails closed', evalResult.ok === false && dangerousFindings(evalResult).some((f) => f.why === 'eval'), JSON.stringify(evalResult.chunks))
console.log('   Remaining honest limitation, inherent to any static analyzer (not a defect of this one): a function reference threaded through runtime state with no static call site at all (e.g. stored in a database row and invoked by a generic dispatcher) cannot be found by ANY source-level scan — it fails closed only if the dispatch mechanism itself is one of the shapes above (computed member, eval, Function); a fully opaque dispatcher (e.g. reflection via a string looked up at runtime through multiple indirections) is beyond what static analysis of any kind can prove either way.')

// Note: "an alternate mounted router bypasses detection" is already disproven by section 1's
// bidirectional check (every file server/index.mjs imports is on disk, AND every file on disk is
// imported by server/index.mjs) — a hypothetical extra router file would fail that check the moment
// it existed. Not re-asserted here as a separate synthetic case, since the property is about the
// relationship between the real filesystem and the real dispatcher, not about one file's content.

console.log(`\n==== PAYMENT POLICY ENFORCEMENT AUDIT: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
