// Mirrors server/lib/currency.mjs — used for live client-side quote previews only. The backend
// recomputes the same conversion/rounding independently when the guest actually submits, so this
// file is never the source of truth for money that gets charged.
export const SYP_PER_USD = 15000
export const USD_ROUNDING_STEP = 5

export function convertSypMinorToUsd(sypAmountMinor: number) {
  return Math.max(0, sypAmountMinor || 0) / SYP_PER_USD
}

export function roundUsdUpToStep(amountUsd: number) {
  const value = Math.max(0, amountUsd || 0)
  return Math.ceil(value / USD_ROUNDING_STEP) * USD_ROUNDING_STEP
}

export function sypMinorToRoundedUsdMinor(sypAmountMinor: number) {
  return roundUsdUpToStep(convertSypMinorToUsd(sypAmountMinor))
}
