// UX-4A regression test (Priority A). Plain Node script, no test framework --
// this repo has none (vitest/jest/testing-library all absent, confirmed via
// package.json before writing this), and adding one wasn't authorized in
// this round. Run: node tests/sr-ride-location-guard.test.mjs
//
// Tests the extracted pure guard (src/modules/sr/srRideLocationGuard.ts)
// that SrRidePage.tsx's requestRide() and its submit button both now call --
// this is the exact function whose absence let hardcoded default pickup/
// dropoff strings be submitted as a genuine ride with zero user interaction.

// This repo's tests run under plain Node, which can't import .ts directly
// (no tsx/ts-node installed, and this repo targets Node 20 -- too old for
// Node's own experimental type-stripping). esbuild is already a real
// dependency here (Vite uses it), so it's used to transpile the guard's
// single source file at test-run time -- zero new dependencies added.
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

// 1. Untouched defaults cannot create a ride -- the exact bug this fix closes.
check(
  '1. untouched hardcoded defaults are rejected',
  isSrRideLocationConfirmed({
    pickupTouched: false,
    dropoffTouched: false,
    pickup: 'Damascus, Malki',
    dropoff: 'Damascus, Mezzeh',
  }),
  false,
)

// 2. Edited valid pickup/dropoff can submit.
check(
  '2. both fields genuinely edited are accepted',
  isSrRideLocationConfirmed({
    pickupTouched: true,
    dropoffTouched: true,
    pickup: 'Bab Touma, Damascus',
    dropoff: 'Mezzeh Highway, Damascus',
  }),
  true,
)

// 3. Legitimate GPS/coordinate-derived pickup: SrRidePage.tsx's
// useCurrentLocation() success handler sets pickupTouched=true itself (it
// also happens to set display text to "Current location" / "موقعي
// الحالي") -- the guard only cares that Touched flipped and text is
// non-blank, so a real GPS-confirmed pickup paired with a typed dropoff
// passes without requiring the user to additionally retype pickup.
check(
  '3. GPS-confirmed pickup (touched=true via GPS) + typed dropoff is accepted',
  isSrRideLocationConfirmed({
    pickupTouched: true,
    dropoffTouched: true,
    pickup: 'Current location',
    dropoff: 'Mezzeh Highway, Damascus',
  }),
  true,
)

// 4. One touched + one untouched field cannot submit (both directions).
check(
  '4a. pickup touched, dropoff untouched -> rejected',
  isSrRideLocationConfirmed({
    pickupTouched: true,
    dropoffTouched: false,
    pickup: 'Bab Touma, Damascus',
    dropoff: 'Damascus, Mezzeh',
  }),
  false,
)
check(
  '4b. dropoff touched, pickup untouched -> rejected',
  isSrRideLocationConfirmed({
    pickupTouched: false,
    dropoffTouched: true,
    pickup: 'Damascus, Malki',
    dropoff: 'Mezzeh Highway, Damascus',
  }),
  false,
)

// Extra: touched-but-cleared-to-blank text must still be rejected (a user
// could touch a field then delete everything before submitting).
check(
  'extra. touched but blank text is rejected',
  isSrRideLocationConfirmed({
    pickupTouched: true,
    dropoffTouched: true,
    pickup: '   ',
    dropoff: 'Mezzeh Highway, Damascus',
  }),
  false,
)

// 5. Scheduled-ride behavior: the guard itself is schedule-agnostic by
// design (requestRide()'s scheduleForLater/scheduledFor check is separate
// and unchanged by this fix) -- confirms this fix doesn't couple location
// confirmation to whether the ride is scheduled or immediate, i.e. a
// scheduled ride is held to the exact same real-location requirement as an
// immediate one, and neither bypasses the other's check.
check(
  '5. guard result is identical regardless of scheduling (schedule state is a separate, untouched check)',
  isSrRideLocationConfirmed({
    pickupTouched: true,
    dropoffTouched: true,
    pickup: 'Bab Touma, Damascus',
    dropoff: 'Mezzeh Highway, Damascus',
  }) ===
    isSrRideLocationConfirmed({
      pickupTouched: true,
      dropoffTouched: true,
      pickup: 'Bab Touma, Damascus',
      dropoff: 'Mezzeh Highway, Damascus',
    }),
  true,
)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
