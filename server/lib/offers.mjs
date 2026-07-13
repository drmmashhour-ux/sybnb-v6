// A "special offer" is defined strictly as a per-date price override below the listing's own
// base price — an override equal to or above the base price is just seasonal pricing, not a
// discount worth surfacing to guests. One definition shared by every surface (listing detail,
// accommodation siblings, search results) so they never disagree with each other.
export function isOfferPrice(priceOverrideMinor, basePriceMinor) {
  return priceOverrideMinor != null && priceOverrideMinor < basePriceMinor
}

export function summarizeOffers(rows, basePriceMinor) {
  const offerRows = rows.filter((row) => isOfferPrice(row.priceOverrideMinor, basePriceMinor))
  const cheapestOfferMinor = offerRows.length
    ? Math.min(...offerRows.map((row) => row.priceOverrideMinor))
    : null
  return { offerNightsCount: offerRows.length, cheapestOfferMinor }
}
