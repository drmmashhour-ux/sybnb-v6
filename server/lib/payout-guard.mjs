// Micro-payout safety checks: suppliers may withdraw as often as daily, but only one request can be
// open at a time and no more than MAX_PER_DAY in 24 h, so a hijacked account can't drain in a burst.
export const MAX_PER_DAY = 2
const DAY_MS = 24 * 60 * 60 * 1000

// requests: [{ status, createdAt }] for this supplier. Returns null when OK, else { code, message }.
export function payoutBlockReason(requests, now = Date.now()) {
  const list = Array.isArray(requests) ? requests : []
  if (list.some((r) => r.status === 'REQUESTED')) {
    return { code: 'PAYOUT_ALREADY_PENDING', message: 'You already have a withdrawal waiting to be paid. You can request another once it is paid.' }
  }
  const recent = list.filter((r) => r.status !== 'REJECTED' && now - new Date(r.createdAt).getTime() < DAY_MS)
  if (recent.length >= MAX_PER_DAY) {
    return { code: 'PAYOUT_DAILY_LIMIT', message: `Withdrawals are limited to ${MAX_PER_DAY} per day. Try again tomorrow.` }
  }
  return null
}
