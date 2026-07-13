// Mirrors the real STR revenue split (server/lib/finance-ledger.mjs bookingFinanceSplit, STAYS
// branch) so the what-if calculator on the Finance page projects using the platform's actual
// commission math, not an invented flat percentage. Kept read-only/pure — this file only ever
// computes numbers from user-entered assumptions, it never touches the database.
export const STR_CLEANING_RATE = 0.05
export const STR_TAX_RATE = 0.02
export const STR_ADMIN_COMMISSION_RATE = 0.1
export const CANCELLATION_PROTECTION_RATE = 0.03

// Real SYBNB revenue per booking (tax + commission share), for a STAYS booking paid in full at
// `paidTotalMinor`, before any cancellation-protection add-on.
export function strAdminShareMinor(paidTotalMinor: number) {
  const divisor = 1 + STR_CLEANING_RATE + STR_TAX_RATE
  const rentMinor = Math.round(paidTotalMinor / divisor)
  const cleaningFeeMinor = Math.round(rentMinor * STR_CLEANING_RATE)
  const taxesMinor = Math.max(0, paidTotalMinor - rentMinor - cleaningFeeMinor)
  const adminCommissionMinor = Math.round(rentMinor * STR_ADMIN_COMMISSION_RATE)
  return taxesMinor + adminCommissionMinor
}

export function cancellationProtectionFeeMinor(paidTotalMinor: number) {
  return Math.round(paidTotalMinor * CANCELLATION_PROTECTION_RATE)
}
