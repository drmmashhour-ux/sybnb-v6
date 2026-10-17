// Basic stay-booking sanity rules every booking site enforces.
function reject(code, message) {
  const error = new Error(message)
  error.statusCode = 400
  error.code = code
  error.expose = true
  return error
}

// Check-in may be today, never earlier. Compared by UTC calendar day with one day of slack so a
// guest in a timezone ahead of/behind UTC can still book "today".
export function assertNotInPast(checkIn, now = new Date()) {
  if (!checkIn) return
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 24 * 3600 * 1000
  if (checkIn.getTime() < startOfToday) throw reject('BOOKING_DATES_IN_PAST', 'Check-in date cannot be in the past.')
}

// Guest count: optional (older clients do not send it) but if sent it must be a whole number >= 1
// and within the listing's maxGuests when the host set one.
export function parseGuests(raw, listingMetadata) {
  if (raw === undefined || raw === null || raw === '') return null
  const guests = Number(raw)
  if (!Number.isInteger(guests) || guests < 1 || guests > 100) throw reject('BOOKING_GUESTS_INVALID', 'Number of guests is not valid.')
  const max = listingMetadata && Number(listingMetadata.maxGuests)
  if (Number.isFinite(max) && max >= 1 && guests > max) {
    throw reject('BOOKING_TOO_MANY_GUESTS', `This place allows at most ${max} guests.`)
  }
  return guests
}
