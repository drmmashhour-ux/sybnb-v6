// USD is a fully-supported guest-facing currency alongside SYP (the platform default), not a
// replacement for it. Listings/rides are priced in SYP by the host/platform; a guest who chooses
// to pay in USD gets that SYP price converted at this fixed, manually-configured rate — there is
// no live market-rate feed. Update this constant when the platform operator wants to reflect a
// new rate; it is deliberately not fetched from any external source.
export const SYP_PER_USD = 15000

// All amountMinor fields in this codebase already store whole currency units, not true cents
// (a 4,500,000 SYP/night listing is 4.5M SYP, not 45,000) — see moneyText() in
// src/shared/i18n/display.ts, which never divides by 100. Cash and card payments alike round UP
// to the nearest $5 so guests are never asked for change/coins the platform can't reliably give
// (e.g. $18.99 -> $20, $18.80 -> $20) — requested explicitly by the platform operator. This is
// only ever applied to USD; SYP amounts are untouched.
export const USD_ROUNDING_STEP = 5

export function convertSypMinorToUsd(sypAmountMinor) {
  return Math.max(0, sypAmountMinor || 0) / SYP_PER_USD
}

export function roundUsdUpToStep(amountUsd) {
  const value = Math.max(0, amountUsd || 0)
  return Math.ceil(value / USD_ROUNDING_STEP) * USD_ROUNDING_STEP
}

// Converts a SYP-denominated minor amount to a guest-facing, change-friendly whole-dollar USD
// amount in one step: convert at the fixed rate, then round up to the nearest $5.
export function sypMinorToRoundedUsdMinor(sypAmountMinor) {
  return roundUsdUpToStep(convertSypMinorToUsd(sypAmountMinor))
}
