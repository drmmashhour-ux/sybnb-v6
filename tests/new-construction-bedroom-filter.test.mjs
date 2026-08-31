// UX-4A regression test (Priority B). Plain Node script, same reasoning as
// tests/sr-ride-location-guard.test.mjs (no test framework in this repo).
// Run: node tests/new-construction-bedroom-filter.test.mjs
//
// Confirms the fix in src/modules/search/SearchPreviewPage.tsx: New
// Construction no longer receives an invisible bedroomsMin=1/bathroomsMin=1
// default (it had no editable UI to see or change that value), while Stays
// keeps its real, intended stepper-driven filtering, and Cars/Marketplace
// (which were never in the filtered Set) stay unaffected either way.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(
  path.join(here, '..', 'src', 'modules', 'search', 'SearchPreviewPage.tsx'),
  'utf8',
)

const match = src.match(/const HAS_BEDROOM_BATHROOM_FILTERS = new Set<[^>]*>\(\[([^\]]*)\]\)/)
if (!match) {
  console.log('FAIL could not find HAS_BEDROOM_BATHROOM_FILTERS declaration at all -- file structure changed')
  process.exit(1)
}
const members = match[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)

let pass = 0
let fail = 0
function check(label, actual, expected) {
  if (actual === expected) {
    pass += 1
    console.log(`ok   ${label}`)
  } else {
    fail += 1
    console.log(`FAIL ${label}: expected ${expected}, got ${actual}`)
  }
}

// 1. New Construction no longer receives invisible bedroom/bathroom minimums.
check('1. newConstruction is NOT in HAS_BEDROOM_BATHROOM_FILTERS', members.includes('newConstruction'), false)

// 2. Stays retains its intended bedroom/bathroom behavior.
check('2. stays IS still in HAS_BEDROOM_BATHROOM_FILTERS', members.includes('stays'), true)

// 3. Cars and Marketplace remain unaffected -- they were never in this Set
// (their listings carry no bedroom/bathroom metadata server-side at all;
// this fix must not add them, that would be a NEW, unauthorized behavior
// change rather than closing the New Construction gap).
check('3a. cars is NOT in HAS_BEDROOM_BATHROOM_FILTERS (unaffected)', members.includes('cars'), false)
check('3b. marketplace is NOT in HAS_BEDROOM_BATHROOM_FILTERS (unaffected)', members.includes('marketplace'), false)

// 4. Existing search behavior doesn't regress: rentals/buy stay in the Set
// exactly as before this fix (even though App.tsx currently routes those
// two divisions through a different component, RentalsPage.tsx, not this
// one -- removing them here was out of scope for this fix and would be an
// unrelated behavior change).
check('4. rentals is still in HAS_BEDROOM_BATHROOM_FILTERS (unchanged)', members.includes('rentals'), true)
check('4b. buy is still in HAS_BEDROOM_BATHROOM_FILTERS (unchanged)', members.includes('buy'), true)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
