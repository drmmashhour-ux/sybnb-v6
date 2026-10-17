// Input limits for POST /api/listings so bad values fail with a clear 400, not a database 500.
const INT4_MAX = 2147483647

function bad(code, message) {
  const error = new Error(message)
  error.statusCode = 400
  error.code = code
  error.expose = true
  return error
}

export function assertListingPrice(priceMinor) {
  if (!Number.isFinite(priceMinor) || priceMinor <= 0) throw bad('LISTING_PRICE_INVALID', 'Listing price must be greater than zero.')
  if (!Number.isInteger(priceMinor)) throw bad('LISTING_PRICE_INVALID', 'Listing price must be a whole number of minor units.')
  if (priceMinor > INT4_MAX) throw bad('LISTING_PRICE_TOO_LARGE', 'Listing price is too large.')
}

export function assertListingText(body) {
  if (String(body.titleAr || '').length > 200) throw bad('LISTING_TITLE_TOO_LONG', 'Listing title is too long (200 characters max).')
  if (body.titleEn && String(body.titleEn).length > 200) throw bad('LISTING_TITLE_TOO_LONG', 'Listing title is too long (200 characters max).')
  if (body.description && String(body.description).length > 10000) throw bad('LISTING_DESCRIPTION_TOO_LONG', 'Listing description is too long (10,000 characters max).')
}

// Free-text place names become Location rows; keep them short.
export function clampPlaceText(value, max = 80) {
  return value === undefined || value === null ? undefined : String(value).trim().slice(0, max) || undefined
}
