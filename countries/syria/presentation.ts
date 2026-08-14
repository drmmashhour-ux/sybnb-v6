// SYBNB — Syria PUBLIC presentation profile (browser-safe).
//
// CRITICAL: this file contains ONLY client-visible presentation fields. It must NEVER include
// secrets, provider configuration, internal launch gates, corporate-control/entity data, or any
// server-only policy. The full server-side country profile (countries/syria/profile.mjs) is NOT
// imported into browser code — the frontend uses this narrow, explicitly-public contract instead.
import type { CountryPresentationProfile } from '../../src/shared/country/presentation'

export const syriaPresentation: CountryPresentationProfile = {
  countryCode: 'SY',
  locale: 'ar-SY',          // Arabic (Syria) formatting locale
  fallbackLocale: 'en-US',  // non-Arabic display
  phoneCallingCode: '+963',
  phonePlaceholder: '+963 9XX XXX XXX',
  supportedLanguages: ['ar', 'en'],
  displayCurrencies: ['SYP', 'USD'], // already public (Fee Schedule); no CAD
  timeZone: 'UTC',          // dates are formatted in UTC across the app
}
