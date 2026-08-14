// SYBNB — Country PRESENTATION characterization + isolation test (governed). Locks phone/locale
// presentation behavior BEFORE and AFTER Phase 6 neutralization, and proves the browser-safe public
// profile (a) resolves fail-closed and (b) exposes NO server-only fields. Bundles the shared modules
// through their stable paths so the same assertions hold across the change.
//   node tests/e2e/presentation.e2e.mjs
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const dir = mkdtempSync(join(tmpdir(), 'sybnb-pres-'))
const bundle = (entry) => { const out = join(dir, entry.replace(/[\/]/g, '_') + '.mjs'); execSync(`npx esbuild ${join(root, entry)} --bundle --format=esm --outfile=${out} --log-level=error`, { stdio: 'inherit' }); return out }

const disp = await import(bundle('src/shared/i18n/display.ts'))
const canc = await import(bundle('src/shared/booking/cancellationPolicy.ts'))
const pres = await import(bundle('src/shared/country/presentation.ts'))

let pass = 0, fail = 0
const eq = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (ok) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> got ${JSON.stringify(got)} want ${JSON.stringify(want)}`) } }
const ok = (label, cond, detail) => { if (cond) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) } }

console.log('=== LOCALE FORMATTING (Arabic behavior preserved) ===')
eq('money ar SYP (Arabic-Indic digits + ل.س)', disp.moneyText(1234567, 'SYP', 'ar'), '١٬٢٣٤٬٥٦٧ ل.س')
eq('money en SYP', disp.moneyText(1234567, 'SYP', 'en'), '1,234,567 SYP')
eq('money en USD', disp.moneyText(1000, 'USD', 'en'), '1,000 USD')
eq('money ar USD (digits localized, currency USD)', disp.moneyText(1000, 'USD', 'ar'), '١٬٠٠٠ USD')
eq('hasArabic true/false', [disp.hasArabic('مرحبا'), disp.hasArabic('hello')], [true, false])
eq('cancellation date ar (Arabic month + digits)', canc.formatCancellationDate(new Date('2026-07-15T00:00:00.000Z'), 'ar'), '١٥ تموز ٢٠٢٦')
eq('cancellation date en', canc.formatCancellationDate(new Date('2026-07-15T00:00:00.000Z'), 'en'), 'July 15, 2026')

console.log('=== PUBLIC PRESENTATION RESOLVER (explicit + fail-closed) ===')
eq('supported presentation countries', pres.supportedPresentationCountries(), ['syria'])
eq('localeForLang(ar) -> ar-SY', pres.localeForLang('ar'), 'ar-SY')
eq('localeForLang(en) -> en-US', pres.localeForLang('en'), 'en-US')
eq('phoneCallingCode -> +963', pres.phoneCallingCode(), '+963')
eq('phonePlaceholder -> +963 9XX XXX XXX', pres.phonePlaceholder(), '+963 9XX XXX XXX')
let e1 = ''; try { pres.resolveCountryPresentation('') } catch (e) { e1 = e.message }
ok('resolve(empty) fail-closed', /fail-closed/.test(e1), e1)
let e2 = ''; try { pres.resolveCountryPresentation('canada') } catch (e) { e2 = e.message }
ok('resolve(canada) fail-closed', /not supported/.test(e2), e2)

console.log('=== BROWSER-SAFETY: public profile exposes ONLY safe fields ===')
const p = pres.resolveCountryPresentation('syria')
const allowed = ['countryCode', 'locale', 'fallbackLocale', 'phoneCallingCode', 'phonePlaceholder', 'supportedLanguages', 'displayCurrencies', 'timeZone']
const extra = Object.keys(p).filter((k) => !allowed.includes(k))
ok('no fields beyond the public contract', extra.length === 0, `extra: ${extra.join(',')}`)
const forbidden = ['operatingEntity', 'gates', 'externalGates', 'secret', 'provider', 'currencies']
const leaked = forbidden.filter((k) => k in p)
ok('no server-only fields (gates/entity/providers/secrets)', leaked.length === 0, `leaked: ${leaked.join(',')}`)

console.log(`\n==== PRESENTATION CHARACTERIZATION: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
