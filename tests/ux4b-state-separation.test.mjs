// UX-4B regression test. Plain Node script, same convention as
// tests/sr-ride-location-guard.test.mjs and tests/new-construction-bedroom-filter.test.mjs
// (this repo has no frontend test framework -- these assert against the real source text).
// Run: node tests/ux4b-state-separation.test.mjs
//
// Covers the three UX-4B findings:
//   A. finding 1.3 -- transactional/application state isolation between Rentals and Buy.
//   B. finding 2.1 -- search restoration after the listing-detail round-trip.
//   C. finding 1.1 -- division-specific filter cleanup while geography survives.
//
// The load-bearing invariant this file exists to protect is that A and B stay SEPARATE:
// the search drafts (B) must never carry a transactional field (A), or restoring a search
// would resurrect exactly the application state the mode switch is supposed to clear.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (...parts) => readFileSync(path.join(here, '..', ...parts), 'utf8')

const rentals = read('src', 'modules', 'rentals', 'RentalsPage.tsx')
const searchBar = read('src', 'modules', 'search', 'UnifiedSearchBar.tsx')
const app = read('src', 'app', 'App.tsx')

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

// Extracts the body of a `function name(...) { ... }` block by brace matching.
function functionBody(src, name) {
  const start = src.indexOf(`function ${name}(`)
  if (start === -1) return null
  const open = src.indexOf('{', start)
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(open + 1, i)
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// A. Finding 1.3 -- Rentals <-> Buy application/transaction state isolation.
// ---------------------------------------------------------------------------

// The premise of the finding: App.tsx renders ONE RentalsPage instance for both modes with no
// `key`, so nothing remounts on the switch and the reset must be done in-component. If a future
// change adds a key here, this test should be revisited rather than silently passing.
check(
  'A0. App.tsx still renders RentalsPage for both /rentals and /buy without a remount key',
  /<RentalsPage lang=\{lang\} mode="rentals" \/>/.test(app) && /<RentalsPage lang=\{lang\} mode="buy" \/>/.test(app),
  true,
)

const resetBody = functionBody(rentals, 'resetApplicationState')
check('A1. resetApplicationState() exists', resetBody !== null, true)

// Every transactional/application field named in the finding must be cleared on the mode change.
const mustReset = [
  ['selected listing identity', 'setSelectedId('],
  ['uploaded documents', 'setDocuments([])'],
  ['document mode/listing binding', 'setDocumentsContext(null)'],
  ['in-flight upload count', 'setUploadingCount(0)'],
  ['upload error', 'setUploadError('],
  ['agreement acceptance', 'setAcceptedAgreement(false)'],
  ['sentRequest flag', 'setSentRequest(null)'],
  ['send state', "setSendState('idle')"],
]
for (const [label, needle] of mustReset) {
  check(`A2. resetApplicationState clears ${label}`, (resetBody || '').includes(needle), true)
}

// The reset must actually be REACHED on the mode transition (the whole point of the finding --
// a reset that exists but is never invoked is what the prior state of the code effectively had).
check(
  'A3. resetApplicationState() is invoked on an actual mode change',
  /appliedMode !== mode\)\s*\{[\s\S]{0,400}?resetApplicationState\(\)/.test(rentals),
  true,
)

// Geography must NOT be cleared by the mode switch (finding 1.3, proof 6).
for (const setter of ['setSelectedGovernorate', 'setSelectedCity', 'setSelectedStreet']) {
  check(`A4. resetApplicationState does NOT clear geography (${setter})`, (resetBody || '').includes(setter), false)
}

// Proof 7: a document can never be submitted under the wrong mode or against a different listing.
check(
  'A5. uploads are bound to the mode + listing they were collected under',
  /const contextAtUpload = \{ mode, listingId: selectedListing\?\.id \|\| '' \}/.test(rentals),
  true,
)
check(
  'A6. sendRequest fails closed on a mode/listing context mismatch',
  /if \(!documentsContext \|\| documentsContext\.mode !== mode \|\| documentsContext\.listingId !== selectedListing\.id\)/.test(
    rentals,
  ),
  true,
)
check(
  'A7. a search that re-points the selection drops documents rather than reassigning them',
  /documentsContext && documentsContext\.listingId !== nextSelectedId/.test(rentals),
  true,
)

// ---------------------------------------------------------------------------
// B. Finding 2.1 -- search restoration after listing detail, and its separation from A.
// ---------------------------------------------------------------------------

check('B1. a shared geography draft key exists', /PROPERTY_GEO_DRAFT_KEY = 'sybnb-v6-property-search-geo'/.test(rentals), true)
check('B2. filters/sort are drafted per mode', /return `sybnb-v6-\$\{mode\}-search-filters`/.test(rentals), true)

// The restored search must actually be applied on entry, including the customer's own location
// narrowing -- otherwise "restored" filters would display but not filter.
check('B3. the restored location narrowing is re-applied on load', /void loadRentals\(locationApplied\)/.test(rentals), true)
check('B4. pressing Search records locationApplied', /setLocationApplied\(true\)/.test(rentals), true)

// Search state is read back into the initial state of each search field.
for (const [label, needle] of [
  ['governorate', "useState(geoDraft.governorate ?? 'damascus')"],
  ['city', "useState(geoDraft.city ?? 'damascus-city')"],
  ['street', "useState(geoDraft.street ?? 'old-city')"],
  ['sort mode', "useState<SortMode>(filtersDraft.sortMode ?? 'newest')"],
  ['visual filters', 'filtersDraft.visualFilters ?? DEFAULT_VISUAL_FILTERS'],
]) {
  check(`B5. restored on re-entry: ${label}`, rentals.includes(needle), true)
}

// A mode switch must adopt the incoming mode's own filters, so the persist effect cannot write
// the outgoing mode's filters over them.
check(
  'B6. mode switch loads the incoming mode filters draft',
  /const incoming = loadDraft<PropertyFiltersDraft>\(filtersDraftKey\(mode\)\)/.test(rentals),
  true,
)

// *** The critical cross-cutting invariant: B must not resurrect A. ***
// Neither draft shape may ever contain a transactional/application field.
const geoShape = rentals.match(/type PropertyGeoDraft = \{([\s\S]*?)\n\}/)
const filtersShape = rentals.match(/type PropertyFiltersDraft = \{([\s\S]*?)\n\}/)
check('B7a. PropertyGeoDraft shape found', Boolean(geoShape), true)
check('B7b. PropertyFiltersDraft shape found', Boolean(filtersShape), true)

const draftShapes = `${geoShape ? geoShape[1] : ''}\n${filtersShape ? filtersShape[1] : ''}`
const forbiddenInDrafts = [
  'documents',
  'documentsContext',
  'acceptedAgreement',
  'agreement',
  'sentRequest',
  'sendState',
  'selectedId',
  'listingId',
  'uploading',
  'uploadError',
]
for (const field of forbiddenInDrafts) {
  check(
    `B8. persisted SEARCH drafts carry no application field '${field}'`,
    new RegExp(`\\b${field}\\b`, 'i').test(draftShapes),
    false,
  )
}

// And the persisted payloads themselves must only ever write those two shapes.
const geoSave = rentals.match(/saveDraft\(PROPERTY_GEO_DRAFT_KEY, \{([\s\S]*?)\}\)/)
const filtersSave = rentals.match(/saveDraft\(filtersDraftKey\(mode\), \{([\s\S]*?)\}\)/)
const savedPayloads = `${geoSave ? geoSave[1] : ''}\n${filtersSave ? filtersSave[1] : ''}`
check('B9a. both save payloads found', Boolean(geoSave) && Boolean(filtersSave), true)
for (const field of forbiddenInDrafts) {
  check(
    `B9b. saved SEARCH payloads never include '${field}'`,
    new RegExp(`\\b${field}\\b`, 'i').test(savedPayloads),
    false,
  )
}

// Deep-link entry to a listing detail must not be steered by the restored search: the detail page
// reads only the Stays date draft, which this capsule did not touch.
check(
  'B10. ListingDetailPage does not read the property search drafts',
  /property-search-geo|search-filters/.test(read('src', 'modules', 'listings', 'ListingDetailPage.tsx')),
  false,
)

// ---------------------------------------------------------------------------
// C. Finding 1.1 -- division-specific filter cleanup, geography survives.
// ---------------------------------------------------------------------------

check(
  'C1. the reset is applied on the remount/route path that rebuilds state from the draft',
  /\.\.\.restoreDraftForDivision\(loadSearchDraft\(\), initialDivision\)/.test(searchBar),
  true,
)
check(
  'C2. the reset is also applied when only the initialDivision prop changes',
  /lastInitialDivision\.current = initialDivision[\s\S]{0,200}?DIVISION_ATTRIBUTE_DEFAULTS/.test(searchBar),
  true,
)
check(
  'C3. restoreDraftForDivision leaves a same-division draft untouched',
  /if \(!draft\.division \|\| draft\.division === division\) return draft/.test(searchBar),
  true,
)

// The reset must strip division-specific attributes...
const defaultsBlock = searchBar.match(/const DIVISION_ATTRIBUTE_DEFAULTS: Pick<([\s\S]*?)\n> = \{([\s\S]*?)\n\}/)
check('C4. DIVISION_ATTRIBUTE_DEFAULTS found', Boolean(defaultsBlock), true)
const resetKeys = defaultsBlock ? defaultsBlock[2] : ''

// Cars-specific and Marketplace-specific attributes -- the exact leakage named in the finding
// (Cars(carBrand=Toyota) -> Marketplace, and Marketplace -> Cars).
for (const field of ['carBrand', 'carYear', 'carFuel', 'carTransmission', 'carBody', 'marketCategory', 'condition']) {
  check(`C5. division-specific attribute is reset: ${field}`, new RegExp(`\\b${field}\\b`).test(resetKeys), true)
}
// Stays / New Construction property attributes are division-specific too.
for (const field of ['propertyType', 'furnishing', 'roomType', 'bedType', 'bedrooms', 'amenities']) {
  check(`C6. division-specific attribute is reset: ${field}`, new RegExp(`\\b${field}\\b`).test(resetKeys), true)
}

// ...and must NOT strip shared, legitimately cross-division context. Geography above all.
for (const field of [
  'governorate',
  'city',
  'area',
  'locationTouched',
  'customPlaceName',
  'checkIn',
  'checkOut',
  'guests',
  'keyword',
  'minPrice',
  'maxPrice',
]) {
  check(`C7. shared cross-division field survives the switch: ${field}`, new RegExp(`\\b${field}\\b`).test(resetKeys), false)
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
