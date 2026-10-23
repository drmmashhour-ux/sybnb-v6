import { useEffect, useState } from 'react'
import { fetchStripePaymentStatus } from '../api/platformApi'

/**
 * Whether the server currently accepts card (Stripe) payments.
 * null while loading; false when the server has card payments off (CARD_PAYMENTS=off), Stripe is not
 * set up, or the status call fails. Screens hide the card option unless this is true.
 */
export function useCardPaymentsEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchStripePaymentStatus()
      .then((status) => {
        if (!cancelled) setEnabled(status.cardEnabled ?? status.configured)
      })
      .catch(() => {
        if (!cancelled) setEnabled(false)
      })
    return () => {
      cancelled = true
    }
  }, [])
  return enabled
}
