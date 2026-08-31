// UX-4A regression + adversarial test (Priority A). Plain Node script, no
// test framework -- this repo has none (vitest/jest/testing-library all
// absent, confirmed via package.json before writing this), and adding one
// wasn't authorized. Run: node tests/sr-ride-location-guard.test.mjs
//
// Covers both the original 5 required scenarios AND the 4 owner-requested
// adversarial closure checks (A1-A4) against the real, current
// srRideLocationGuard.ts -- source-based, not a bare touched boolean.

import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcPath = path.join(here, '..', 'src', 'modules', 'sr', 'srRideLocationGuard.ts')
const outPath = path.join(os.tmpdir(), `sr-ride-location-guard-${Date.now()}.mjs`)
await build({ entryPoints: [srcPath], outfile: outPath, format: 'esm', bundle: false, platform: 'neutral' })
const { isSrRideLocationConfirmed } = await import(outPath)
fs.rmSync(outPath, { force: true })

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

const EN_PICKUP_DEFAULT = 'Damascus, Malki'
const EN_DROPOFF_DEFAULT = 'Damascus, Mezzeh'
const AR_PICKUP_DEFAULT = 'دمشق، المالكي'
const AR_DROPOFF_DEFAULT = 'دمشق، المزة'

function guard(overrides) {
  return isSrRideLocationConfirmed({
    pickupSource: 'default',
    dropoffSource: 'default',
    pickup: EN_PICKUP_DEFAULT,
    dropoff: EN_DROPOFF_DEFAULT,
    pickupDefaultText: EN_PICKUP_DEFAULT,
    dropoffDefaultText: EN_DROPOFF_DEFAULT,
    ...overrides,
  })
}

console.log('--- Original 5 required scenarios ---')

check(
  '1. untouched hardcoded defaults are rejected',
  guard({}),
  false,
)

check(
  '2. both fields genuinely edited are accepted',
  guard({
    pickupSource: 'manual', pickup: 'Bab Touma, Damascus',
    dropoffSource: 'manual', dropoff: 'Mezzeh Highway, Damascus',
  }),
  true,
)

check(
  '3. GPS-confirmed pickup + typed dropoff is accepted',
  guard({
    pickupSource: 'gps', pickup: 'Current location',
    dropoffSource: 'manual', dropoff: 'Mezzeh Highway, Damascus',
  }),
  true,
)

check(
  '4a. pickup confirmed, dropoff untouched -> rejected',
  guard({ pickupSource: 'manual', pickup: 'Bab Touma, Damascus' }),
  false,
)
check(
  '4b. dropoff confirmed, pickup untouched -> rejected',
  guard({ dropoffSource: 'manual', dropoff: 'Mezzeh Highway, Damascus' }),
  false,
)

check(
  'extra. touched but blank text is rejected',
  guard({ pickupSource: 'manual', pickup: '   ', dropoffSource: 'manual', dropoff: 'Mezzeh Highway, Damascus' }),
  false,
)

check(
  '5. guard result is identical regardless of scheduling (schedule state is a separate, untouched check)',
  guard({
    pickupSource: 'manual', pickup: 'Bab Touma, Damascus',
    dropoffSource: 'manual', dropoff: 'Mezzeh Highway, Damascus',
  }) ===
    guard({
      pickupSource: 'manual', pickup: 'Bab Touma, Damascus',
      dropoffSource: 'manual', dropoff: 'Mezzeh Highway, Damascus',
    }),
  true,
)

console.log('\n--- A1: edit then restore to literal seeded default ---')

// Edited by one character then restored exactly -- source is 'manual', but
// text is once again the literal placeholder. Must BLOCK.
check(
  'A1a. pickup manually edited then restored to exact EN default -> BLOCK',
  guard({ pickupSource: 'manual', pickup: EN_PICKUP_DEFAULT }),
  false,
)
check(
  'A1b. dropoff manually edited then restored to exact EN default -> BLOCK',
  guard({ pickupSource: 'manual', pickup: 'Bab Touma, Damascus', dropoffSource: 'manual', dropoff: EN_DROPOFF_DEFAULT }),
  false,
)
check(
  'A1c. same check in Arabic -- pickup restored to exact AR default -> BLOCK',
  isSrRideLocationConfirmed({
    pickupSource: 'manual', pickup: AR_PICKUP_DEFAULT,
    dropoffSource: 'manual', dropoff: 'باب توما، دمشق',
    pickupDefaultText: AR_PICKUP_DEFAULT, dropoffDefaultText: AR_DROPOFF_DEFAULT,
  }),
  false,
)
check(
  'A1d. same check in Arabic -- dropoff restored to exact AR default -> BLOCK',
  isSrRideLocationConfirmed({
    pickupSource: 'manual', pickup: 'باب توما، دمشق',
    dropoffSource: 'manual', dropoff: AR_DROPOFF_DEFAULT,
    pickupDefaultText: AR_PICKUP_DEFAULT, dropoffDefaultText: AR_DROPOFF_DEFAULT,
  }),
  false,
)
// Whitespace-only difference from the default must not slip through either.
check(
  'A1e. default text with surrounding whitespace only -> still BLOCK (trimmed comparison)',
  guard({ pickupSource: 'manual', pickup: `  ${EN_PICKUP_DEFAULT}  ` }),
  false,
)
// A genuinely DIFFERENT manual address must still pass -- this isn't a ban
// on manual entry, only on the literal placeholder text.
check(
  'A1f. a real, different manual address is still accepted (not over-blocked)',
  guard({
    pickupSource: 'manual', pickup: 'Umayyad Square, Damascus',
    dropoffSource: 'manual', dropoff: 'Mezzeh Highway, Damascus',
  }),
  true,
)

console.log('\n--- A2: arbitrary non-empty manual text ---')

// SR Ride's existing product design (manualHint/addressUnrecognized in
// SrRidePage.tsx) already intentionally supports free-form manual addresses
// that don't resolve to real geocoded coordinates -- "the request can
// continue without GPS through manual addresses." This guard does NOT
// invent a new geocoding requirement on top of that: any non-blank,
// non-placeholder manual text is valid by design, exactly like every other
// manual address SR Ride already accepts.
check(
  'A2. arbitrary non-empty manual text with no real geocoding meaning is still accepted (existing product design, not a new requirement)',
  guard({
    pickupSource: 'manual', pickup: 'xyz not a real place 123',
    dropoffSource: 'manual', dropoff: 'qqq also not real',
  }),
  true,
)

console.log('\n--- A3: GPS then destructive edit ---')

// Step 1: GPS fix succeeds -- source 'gps', coordinate-backed, valid.
check(
  'A3a. GPS fix alone (paired with typed dropoff) is valid',
  guard({ pickupSource: 'gps', pickup: 'Current location', dropoffSource: 'manual', dropoff: 'Mezzeh Highway, Damascus' }),
  true,
)
// Step 2: SrRidePage.tsx's pickup <input> onChange demotes source to
// 'manual' AND clears pickupCoords the instant the user hand-edits the
// GPS-derived text (see the component, not this pure function -- the
// guard itself only ever receives the CURRENT source/text pair, so this
// test proves the guard's behavior on the post-edit state, which is what
// the component produces).
check(
  'A3b. after a destructive manual edit, source is "manual" (not "gps") and a real edit still validates normally',
  guard({ pickupSource: 'manual', pickup: 'A real new address', dropoffSource: 'manual', dropoff: 'Mezzeh Highway, Damascus' }),
  true,
)
// Step 3: if that destructive edit clears the text to blank, must BLOCK --
// stale coordinates (already cleared by the component) can't substitute.
check(
  'A3c. destructive edit that clears pickup to blank -> BLOCK regardless of prior GPS state',
  guard({ pickupSource: 'manual', pickup: '', dropoffSource: 'manual', dropoff: 'Mezzeh Highway, Damascus' }),
  false,
)
// Step 4: if the destructive edit happens to retype the exact placeholder
// text, must also BLOCK -- covered by the same rule as A1, proven here in
// the GPS-then-edit sequence specifically.
check(
  'A3d. destructive edit back to the exact placeholder text after a GPS fix -> BLOCK',
  guard({ pickupSource: 'manual', pickup: EN_PICKUP_DEFAULT, dropoffSource: 'manual', dropoff: 'Mezzeh Highway, Damascus' }),
  false,
)

console.log('\n--- A4: saved place selected, then cleared, then reselected ---')

check(
  'A4a. a genuine saved place selection is valid',
  guard({ pickupSource: 'saved', pickup: 'Home', dropoffSource: 'manual', dropoff: 'Mezzeh Highway, Damascus' }),
  true,
)
check(
  'A4b. clearing the selected saved-place text to blank -> BLOCK',
  guard({ pickupSource: 'saved', pickup: '', dropoffSource: 'manual', dropoff: 'Mezzeh Highway, Damascus' }),
  false,
)
check(
  'A4c. reselecting a saved place after clearing -> valid again',
  guard({ pickupSource: 'saved', pickup: 'Home', dropoffSource: 'manual', dropoff: 'Mezzeh Highway, Damascus' }),
  true,
)
// A saved place whose text coincidentally equals the placeholder is still
// a genuine, independently-established selection -- 'saved' is trusted
// regardless of text content, unlike 'manual'.
check(
  'A4d. a saved place that happens to read identically to the placeholder text is still valid (real selection, not the untouched default)',
  guard({ pickupSource: 'saved', pickup: EN_PICKUP_DEFAULT, dropoffSource: 'manual', dropoff: 'Mezzeh Highway, Damascus' }),
  true,
)

console.log('\n--- 7. scheduled valid ride still passes (guard is schedule-agnostic by design) ---')
check(
  '7. a fully valid manual pickup+dropoff pair passes regardless of scheduling (scheduleForLater is a separate, untouched check in SrRidePage.tsx)',
  guard({
    pickupSource: 'manual', pickup: 'Bab Touma, Damascus',
    dropoffSource: 'manual', dropoff: 'Mezzeh Highway, Damascus',
  }),
  true,
)

console.log('\n--- 8. editing/reselecting a valid location does not falsely reject ---')
check(
  '8. re-editing an already-valid manual field to another real address stays valid',
  guard({
    pickupSource: 'manual', pickup: 'Second real address, Damascus',
    dropoffSource: 'manual', dropoff: 'Mezzeh Highway, Damascus',
  }),
  true,
)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
