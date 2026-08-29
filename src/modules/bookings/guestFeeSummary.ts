import type { PlatformBooking, PlatformListing } from '../../shared/api/platformApi'

export type GuestFeeSummary = {
  stayAmountMinor: number
  cleaningFeeMinor: number
  taxesMinor: number
  serviceFeeMinor: number
  parkingFeeMinor: number
  extraFeesMinor: number
  cancellationProtectionFeeMinor: number
  cancellationProtectionPurchased: boolean
  totalMinor: number
}

type BookingLike = Pick<PlatformBooking, 'amountMinor'> & {
  listing?: Pick<PlatformListing, 'division' | 'metadata'>
  metadata?: Record<string, unknown>
}

function metadataNumber(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

export function guestFeeSummary(booking: BookingLike): GuestFeeSummary {
  const stayAmountMinor = Math.max(0, Math.round(booking.amountMinor || 0))
  const metadata = booking.listing?.metadata
  const bookingMetadata = booking.metadata
  const isShortStay = !booking.listing || booking.listing.division === 'STAYS'

  // Prefer the fee breakdown snapshotted at booking-creation time (server/lib/finance-ledger.mjs's
  // feeSnapshot) over the listing's current metadata, so this mirrors exactly what the server
  // charged/will charge — a later host/admin fee edit must never change what an existing booking
  // shows the guest. Falls back to live listing metadata for bookings created before this existed.
  const feeSnapshot = bookingMetadata?.feeSnapshot as Record<string, unknown> | undefined
  const feeSource = feeSnapshot || metadata

  const cleaningFeeMinor = metadataNumber(feeSource, 'cleaningFeeMinor') || (isShortStay ? Math.round(stayAmountMinor * 0.05) : 0)
  const taxesMinor = metadataNumber(feeSource, 'taxesMinor') || (isShortStay ? Math.round(stayAmountMinor * 0.02) : 0)
  const serviceFeeMinor = metadataNumber(feeSource, 'serviceFeeMinor')
  const parkingFeeMinor = metadataNumber(feeSource, 'parkingFeeMinor')
  const extraFeesMinor = metadataNumber(metadata, 'extraFeesMinor')
  const cancellationProtectionPurchased = bookingMetadata?.cancellationProtectionPurchased === true
  const cancellationProtectionFeeMinor = cancellationProtectionPurchased
    ? metadataNumber(bookingMetadata, 'cancellationProtectionFeeMinor') || Math.round(stayAmountMinor * 0.03)
    : 0

  return {
    stayAmountMinor,
    cleaningFeeMinor,
    taxesMinor,
    serviceFeeMinor,
    parkingFeeMinor,
    extraFeesMinor,
    cancellationProtectionFeeMinor,
    cancellationProtectionPurchased,
    totalMinor:
      stayAmountMinor +
      cleaningFeeMinor +
      taxesMinor +
      serviceFeeMinor +
      parkingFeeMinor +
      extraFeesMinor +
      cancellationProtectionFeeMinor,
  }
}
