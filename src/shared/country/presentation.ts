// Country-neutral PUBLIC presentation resolver (MASTER, browser-safe). Fail-closed.
//
// This module and the CountryPresentationProfile type are the ONLY country data the browser bundle
// may use. It intentionally does NOT import the server profile (countries/syria/profile.mjs), which
// carries server-only policy/gates. It imports only each country's explicitly-public presentation.

// The public, client-visible presentation contract. No secrets / providers / gates / entity data.
export type CountryPresentationProfile = {
  countryCode: string
  locale: string
  fallbackLocale: string
  phoneCallingCode: string
  phonePlaceholder: string
  supportedLanguages: string[]
  displayCurrencies: string[]
  timeZone: string
}

// Explicit registry — the ONLY sanctioned bridge from master browser code to a country's public
// presentation. Static import of the *public* profile only (never the server profile).
import { syriaPresentation } from '../../../countries/syria/presentation'

const PRESENTATIONS: Record<string, CountryPresentationProfile> = {
  syria: syriaPresentation,
}

const REQUIRED_FIELDS: (keyof CountryPresentationProfile)[] = [
  'countryCode', 'locale', 'fallbackLocale', 'phoneCallingCode', 'phonePlaceholder', 'supportedLanguages', 'displayCurrencies', 'timeZone',
]

function assertComplete(p: CountryPresentationProfile, key: string): CountryPresentationProfile {
  for (const f of REQUIRED_FIELDS) {
    const v = p[f]
    if (v == null || (Array.isArray(v) ? v.length === 0 : String(v).length === 0)) {
      throw new Error(`country presentation '${key}' is incomplete: missing '${String(f)}' (fail-closed)`)
    }
  }
  return p
}

// Resolve a country's public presentation explicitly. Fail closed on missing/unsupported/incomplete.
export function resolveCountryPresentation(country: string | undefined | null): CountryPresentationProfile {
  const key = String(country || '').trim().toLowerCase()
  if (!key) throw new Error('country presentation: no country selected (fail-closed)')
  const p = PRESENTATIONS[key]
  if (!p) throw new Error(`country presentation: country '${key}' is not supported (fail-closed)`)
  return assertComplete(p, key)
}

export function supportedPresentationCountries(): string[] {
  return Object.keys(PRESENTATIONS)
}

// The active country for the browser build. Derived from the build-time VITE_SYBNB_COUNTRY, or — in a
// single-country release — the sole registered country (registry-driven, NOT a hard-coded country).
// Fail-closed if ambiguous or unsupported.
export function activeCountryPresentation(): CountryPresentationProfile {
  const envCountry = typeof import.meta !== 'undefined' ? (import.meta as any)?.env?.VITE_SYBNB_COUNTRY : undefined
  const supported = supportedPresentationCountries()
  const key = envCountry || (supported.length === 1 ? supported[0] : undefined)
  if (!key) throw new Error('country presentation: VITE_SYBNB_COUNTRY must be set when multiple countries are supported (fail-closed)')
  return resolveCountryPresentation(key)
}

// ---- Presentation helpers (source of the previously hard-coded literals) ----

// Locale for a display language, from the active country presentation (was: lang==='ar'?'ar-SY':'en-US').
export function localeForLang(lang: string | undefined): string {
  const p = activeCountryPresentation()
  if (lang === 'ar') return p.locale
  // French UI language: French number/date formatting. Language-level (not a country value), so
  // the country profile stays the single source for currency, time zone and the Arabic locale.
  if (lang === 'fr') return 'fr'
  return p.fallbackLocale
}

export function phoneCallingCode(): string {
  return activeCountryPresentation().phoneCallingCode
}

export function phonePlaceholder(): string {
  return activeCountryPresentation().phonePlaceholder
}
