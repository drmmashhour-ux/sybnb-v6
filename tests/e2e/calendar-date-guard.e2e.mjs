// SYBNB — Booking calendar past-date guard (governed, no-cheat).
//
// Bundles the REAL calendar helper (src/modules/search/DateRangePicker.tsx) with esbuild and asserts
// isSelectableDay: past dates are never selectable, today/future are, availability-blocked dates are
// not, and the rule holds across a year boundary. Regression guard for the Round-2 calendar HIGH
// (calendar opened on a past month and permitted past-date selection).
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const out = join(mkdtempSync(join(tmpdir(), 'sybnb-cal-')), 'DateRangePicker.mjs')
execSync(`npx esbuild ${join(root, 'src/modules/search/DateRangePicker.tsx')} --bundle --format=esm --outfile=${out} --log-level=error "--define:import.meta.env={}"`, { stdio: 'inherit' })

const { isSelectableDay } = await import(out)
let pass = 0, fail = 0
const check = (label, cond, detail) => { if (cond) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) } }

const today = '2026-08-16'

console.log('=== BOOKING CALENDAR PAST-DATE GUARD (isSelectableDay) ===')
check('yesterday is NOT selectable', isSelectableDay('2026-08-15', today) === false, 'yesterday selectable')
check('today IS selectable', isSelectableDay('2026-08-16', today) === true, 'today blocked')
check('tomorrow is selectable', isSelectableDay('2026-08-17', today) === true, 'tomorrow blocked')
check('far future is selectable', isSelectableDay('2026-12-01', today) === true, 'future blocked')
check('a month in the past is NOT selectable', isSelectableDay('2026-07-10', today) === false, 'past month selectable')
check('availability-blocked future date is NOT selectable', isSelectableDay('2026-08-20', today, new Set(['2026-08-20'])) === false, 'blocked date selectable')
check('non-blocked future date with a blocklist is selectable', isSelectableDay('2026-08-21', today, new Set(['2026-08-20'])) === true, 'over-blocked')

console.log('\n=== YEAR BOUNDARY ===')
check('Dec 29 before a Dec 30 today is NOT selectable', isSelectableDay('2026-12-29', '2026-12-30') === false, 'past across year')
check('Jan 5 next year IS selectable from Dec 30', isSelectableDay('2027-01-05', '2026-12-30') === true, 'next-year future blocked')

console.log(`\n==== CALENDAR DATE-GUARD E2E: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
