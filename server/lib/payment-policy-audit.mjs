// SYBNB — turns "every money-moving route calls the payment policy" from a convention into
// something checkable. Used by tests/e2e/payment-policy-enforcement.e2e.mjs against the real repo,
// and unit-testable in isolation against synthetic file content (see MONEY_MOVING_PATTERNS below).
//
// This is a static, heuristic scan, not a full AST analysis — it matches this codebase's own very
// consistent route-dispatch style (every route file reads as a flat sequence of
// `if (url.pathname === '...')` / `const xMatch = url.pathname.match(...); if (xMatch)` blocks,
// confirmed across every route file in server/routes/). It is deliberately conservative: it flags
// real gaps (a money-moving code shape with no nearby policy call) rather than trying to prove a
// negative with certainty.

import { readFileSync } from 'node:fs'

// Code shapes that indicate a route mutates payment/booking/refund/wallet state, calls a
// provider, or performs a replay — i.e. is money-moving under this policy's definition.
export const MONEY_MOVING_PATTERNS = [
  /recordWalletEntry\s*\(/,
  /approvePaymentProof\s*\(/,
  /reverseBookingPlatformShare\s*\(/,
  /tx\.paymentIntent\.(create|update|updateMany)\s*\(/,
  /tx\.paymentProof\.(create|update|updateMany)\s*\(/,
  /tx\.walletEntry\.create\s*\(/,
  /stripe\.[a-zA-Z.]+\.(create|retrieve|constructEvent)\s*\(/,
  /applyPaymentEvent\s*\(/,
]

const ROUTE_TRIGGER_PATTERN = /(?:if\s*\(\s*url\.pathname\s*===\s*'([^']+)'\s*\)|const\s+\w+\s*=\s*url\.pathname\.match\(([^)]+)\))/g

// Splits a route file's source into per-route "chunks": each trigger line (an exact-match or
// regex-match dispatch) through the start of the next one (or end of file for the last one).
export function splitIntoRouteChunks(source) {
  const triggers = [...source.matchAll(ROUTE_TRIGGER_PATTERN)]
  const chunks = []
  for (let i = 0; i < triggers.length; i++) {
    const start = triggers[i].index
    const end = i + 1 < triggers.length ? triggers[i + 1].index : source.length
    const label = triggers[i][1] || triggers[i][2] || `chunk_${i}`
    chunks.push({ label, body: source.slice(start, end) })
  }
  return chunks
}

// Does this chunk of source contain a money-moving shape?
export function chunkIsMoneyMoving(body) {
  return MONEY_MOVING_PATTERNS.some((pattern) => pattern.test(body))
}

// Does this chunk call authorizePaymentOperation at all?
export function chunkCallsPolicy(body) {
  return /authorizePaymentOperation\s*\(/.test(body)
}

// The real audit: for a given route file's real source, returns any money-moving chunk that never
// calls the policy. registeredPathFragments is an array of raw path strings/patterns already
// declared in PAYMENT_POLICY_ROUTES/PAYMENT_POLICY_EXCLUDED_ROUTES/PAYMENT_POLICY_KNOWN_GAPS for
// that file — used only for a richer report message, not to suppress real findings (an
// undeclared-but-money-moving chunk is always a finding regardless of what's declared elsewhere).
export function findUndeclaredMoneyMovingChunks(source) {
  return splitIntoRouteChunks(source)
    .filter((chunk) => chunkIsMoneyMoving(chunk.body) && !chunkCallsPolicy(chunk.body))
    .map((chunk) => chunk.label)
}

export function auditRouteFile(path) {
  const source = readFileSync(path, 'utf8')
  return findUndeclaredMoneyMovingChunks(source)
}
