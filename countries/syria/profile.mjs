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
  // `default` is the settlement currency used wherever a route needs to create or look up a
  // currency-scoped record (a wallet, a fallback price) with no explicit currency supplied —
  // read via server/lib/country.mjs's defaultCurrency(), never hardcoded at the call site.
  currencies: { allowed: ['SYP', 'USD'], default: 'SYP', advertisingDefault: 'USD' },

  // Localization defaults:
  phoneCountryCode: '+963',
  defaultLocale: 'ar-SY',

  // Communication channels. Syria is EMAIL-ONLY: SMS is disabled, so no Syria route can invoke the
  // SMS adapter. Phone may be optional CONTACT data but is never an authentication channel here.
  // (SMS remains a neutral adapter, reachable only if a future certified country sets sms:true.)
  communications: { email: true, sms: false },

  // Short-stay booking money policy (owner decisions 2026-10-08). Read by the country-neutral
  // server/lib/booking-policy.mjs through server/lib/country.mjs's bookingPolicySettings(); env
  // BOOKING_FULL_REFUND_CUTOFF_HOURS / BOOKING_UNPAID_EXPIRY_HOURS override the two windows.
  //   timezoneOffsetMinutes: "check-in date 00:00" is Syria time (UTC+3, no DST).
  //   fullRefundCutoffHours: a regular-price guest cancellation >= 72h before check-in 00:00 gets
  //     100% back; later gets 50%.
  //   unpaidExpiryHours: an unpaid PAYMENT_PENDING request with no live proof expires after 48h.
  bookingPolicy: { timezoneOffsetMinutes: 180, fullRefundCutoffHours: 72, unpaidExpiryHours: 48 },

  // Host payout (withdrawal) methods available in this country, with the fields each requires.
  // Admin pays these outside the platform and marks the request PAID; nothing moves automatically.
  payoutMethods: {
    SHAM_CASH: { required: ['shamCashNumber', 'accountName'] },
    BANK: { required: ['bankName', 'accountName', 'accountNumber'] },
    CASH_OFFICE: { required: ['officeCity'] },
  },

  // Per-country launch gates — all remain closed until Syria-specific review passes:
  gates: {
    legal: 'DRAFT',            // countries/syria legal versions (counsel-approved) required
    payments: 'disabled',      // live payments off until owner authorization
    publicAccess: 'open',      // owner-authorized 2026-08-27; legal/NAITS/vendor-clearance still open, see docs/launch
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
