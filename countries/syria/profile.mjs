// SYBNB — Syria country profile (the FIRST country implementation).
//
// This file holds SYRIA-SPECIFIC configuration only. The master platform stays country-neutral and
// loads a profile like this one via server/lib/country.mjs. Other countries get their OWN folder
// under countries/<country> with their own profile, legal versions, providers, currency, data
// region, and deployment — no country inherits another's settings.
//
// The operating entity is Québec-incorporated (a CORPORATE identity), which is NOT the same as the
// service market. Syria is the service market here.
export const profile = {
  key: 'syria',
  country: 'SY',
  displayName: { en: 'Syria', ar: 'سوريا' },

  // Corporate operator identity (fact) — NOT a market claim:
  operatingEntity: { name: '9375-7649 QUÉBEC INC.', country: 'CA-QC' },

  // Currency policy (owner-confirmed): USD quoted; SYP for local settlement. No CAD.
  currencies: { allowed: ['SYP', 'USD'], advertisingDefault: 'USD' },

  // Localization defaults:
  phoneCountryCode: '+963',
  defaultLocale: 'ar-SY',

  // Communication channels. Syria is EMAIL-ONLY: SMS is disabled, so no Syria route can invoke the
  // SMS adapter. Phone may be optional CONTACT data but is never an authentication channel here.
  // (SMS remains a neutral adapter, reachable only if a future certified country sets sms:true.)
  communications: { email: true, sms: false },

  // Per-country launch gates — all remain closed until Syria-specific review passes:
  gates: {
    legal: 'DRAFT',            // countries/syria legal versions (counsel-approved) required
    payments: 'disabled',      // live payments off until owner authorization
    publicAccess: 'closed',    // no DNS/public cutover
    deployment: 'blocked',     // no authenticated production deploy
  },

  // External verification gates specific to Syria (NOT claimed here — require confirmation):
  externalGates: [
    'provider availability + permitted-country support (payments, SMS, storage) for Syria',
    'sanctions/export compliance review for a Syria-facing service',
    'data-region selection + cross-border (Law 25 / PIPEDA for the Québec operator) assessment',
    'Syrian tax/VAT, invoicing, employment/marketplace rules — counsel/accountant',
  ],
}
