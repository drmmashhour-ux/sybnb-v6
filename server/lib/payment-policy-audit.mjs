// SYBNB — turns "every money-moving route calls the payment policy" from a convention into
// something checkable. Used by tests/e2e/payment-policy-enforcement.e2e.mjs against the real repo,
// and unit-testable in isolation against synthetic file content (see MONEY_MOVING_PATTERNS below).
//
// HONEST LIMITATION, stated up front rather than implied: this is a static, heuristic, regex-based
// scan, NOT a real AST/syntax parser — this repo has no JS-parser dependency, and adding one was
// judged out of scope for "Item 1 only". It strips line comments, block comments, and string/
// template literal CONTENTS before matching (so a comment or string that happens to contain
// "recordWalletEntry(" as text can't produce a false result), which closes the most likely false
// positive/negative source without a full parser. It matches this codebase's own very consistent
// route-dispatch style (every route file reads as a flat sequence of
// `if (url.pathname === '...')` / `const xMatch = url.pathname.match(...); if (xMatch)` blocks,
// confirmed across every file in server/routes/). What it genuinely cannot do: follow an INDIRECT
// call (a route calling a differently-named local wrapper that itself, elsewhere, calls
// recordWalletEntry) or recognize a route matched via a fully computed/dynamic path expression
// instead of a literal string or inline regex literal — both are disclosed explicitly in the
// enforcement test's own report, not silently assumed away.

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROUTES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'routes')

// Every file server/index.mjs actually mounts as a router, discovered from disk rather than
// hand-copied into a list here — a new router file is picked up automatically, closing the
// "bypass through an alternate router file" gap a hardcoded file list would have left open.
export function allRouteFiles() {
  return readdirSync(ROUTES_DIR)
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => path.join('server', 'routes', name))
}

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

// Strips // line comments, /* */ block comments, and the CONTENTS of string/template literals
// (keeping the quote characters themselves, so line/column structure and matching against
// `url.pathname === '...'` literals in ROUTE_TRIGGER_PATTERN still works) — done with one
// character-scanning pass rather than a handful of regexes, since comment/string stripping via
// regex alone is notoriously easy to get subtly wrong (e.g. a `//` inside a string).
export function stripCommentsAndStringContents(source) {
  let out = ''
  let i = 0
  const n = source.length
  while (i < n) {
    const ch = source[i]
    const next = source[i + 1]
    if (ch === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i++
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      out += ch
      i++
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') i++ // skip escaped char, never treat it as the closing quote
        i++
      }
      out += quote
      i++
      continue
    }
    out += ch
    i++
  }
  return out
}

// Splits a route file's (already comment/string-stripped) source into per-route "chunks": each
// trigger line (an exact-match or regex-match dispatch) through the start of the next one (or end
// of file for the last one).
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

export function chunkIsMoneyMoving(body) {
  return MONEY_MOVING_PATTERNS.some((pattern) => pattern.test(body))
}

export function chunkCallsPolicy(body) {
  return /authorizePaymentOperation\s*\(/.test(body)
}

// The real audit. Chunk-splitting runs on the RAW source (route-path string literals like
// url.pathname === '/api/foo' must stay intact for the trigger regex to find them at all); only
// each chunk's BODY is then comment/string-stripped before checking it for money-moving patterns
// and policy calls. Stripping before splitting was tried first and was a real bug: it erased every
// exact-match route's own path literal too, silently dropping those routes from the scan entirely
// (a false negative far worse than the false positives it was meant to prevent) — fixed by scoping
// the strip to post-split chunk bodies only.
export function findUndeclaredMoneyMovingChunks(rawSource) {
  return splitIntoRouteChunks(rawSource)
    .filter((chunk) => {
      const strippedBody = stripCommentsAndStringContents(chunk.body)
      return chunkIsMoneyMoving(strippedBody) && !chunkCallsPolicy(strippedBody)
    })
    .map((chunk) => chunk.label)
}

export function auditRouteFile(filePath) {
  return findUndeclaredMoneyMovingChunks(readFileSync(filePath, 'utf8'))
}
