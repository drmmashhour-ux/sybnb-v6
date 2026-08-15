// SYBNB — Vehicle/listing TITLE DISPLAY governed test (no-cheat).
//
// Bundles the REAL client display helper (src/shared/i18n/display.ts) with esbuild and asserts
// listingTitleText: an Arabic user must see the actual make/model/year of a car listing whose
// stored title is Latin (e.g. "BMW 320i 2020"), NOT a generic "{division} {id}" placeholder that
// hides the vehicle identity. Regression guard for the Journey-4 Cars blocker.
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const out = join(mkdtempSync(join(tmpdir(), 'sybnb-title-')), 'display.mjs')
execSync(`npx esbuild ${join(root, 'src/shared/i18n/display.ts')} --bundle --format=esm --outfile=${out} --log-level=error "--define:import.meta.env={}"`, { stdio: 'inherit' })

const { listingTitleText } = await import(out)
let pass = 0, fail = 0
const check = (label, cond, detail) => { if (cond) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) } }

const car = { id: '1224ead1-9bd4-4bd9-b8ca-80dc6e308f3a', division: 'CARS', titleAr: 'BMW 320i 2020', titleEn: 'BMW 320i 2020' }
const carEnOnly = { id: 'aaaaaaaa-0000-0000-0000-000000000000', division: 'CARS', titleAr: '', titleEn: 'Kia Rio 2019' }
const arabicCar = { id: 'bbbbbbbb-0000-0000-0000-000000000000', division: 'CARS', titleAr: 'سيارة عائلية جاهزة للفحص', titleEn: 'Family car' }
const untitled = { id: 'cccccccc-1111-2222-3333-444455556666', division: 'CARS', titleAr: '', titleEn: '' }

console.log('=== LISTING TITLE DISPLAY (Cars, Arabic default) ===')
check('AR: Latin make/model title is shown, not a placeholder', listingTitleText(car, 'ar') === 'BMW 320i 2020', listingTitleText(car, 'ar'))
check('AR: no generic "{division} {id}" placeholder for a real car', !/^السيارات\s+[0-9A-F]{8}$/i.test(listingTitleText(car, 'ar')), listingTitleText(car, 'ar'))
check('AR: falls back to titleEn when titleAr empty', listingTitleText(carEnOnly, 'ar') === 'Kia Rio 2019', listingTitleText(carEnOnly, 'ar'))
check('AR: genuine Arabic title still preserved', listingTitleText(arabicCar, 'ar') === 'سيارة عائلية جاهزة للفحص', listingTitleText(arabicCar, 'ar'))
check('AR: only-when-empty placeholder is still produced', /^السيارات\s+CCCCCCCC$/.test(listingTitleText(untitled, 'ar')), listingTitleText(untitled, 'ar'))
check('EN: shows the English title', listingTitleText(car, 'en') === 'BMW 320i 2020', listingTitleText(car, 'en'))

console.log(`\n==== CARS TITLE DISPLAY E2E: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
