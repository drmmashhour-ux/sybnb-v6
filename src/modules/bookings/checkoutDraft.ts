// Shared between the listing page ("Reserve"), the checkout page and the booking page. Kept in its
// own tiny module so the listing page does not pull the whole checkout page into its bundle.

// The listing page's choices travel to /checkout/:listingId through this sessionStorage key (JSON).
export const CHECKOUT_DRAFT_KEY = 'sybnb-v6-checkout-draft'
// Set right before leaving for Stripe so the booking page can tell "came back from Stripe without
// paying" (the server's cancel URL carries no marker of its own) from a normal visit.
export const STRIPE_PENDING_KEY_PREFIX = 'sybnb-v6-stripe-pending:'
// Set when checkout had to send the guest to the booking page first (one-time ID photo step).
export const CHECKOUT_NOTE_KEY_PREFIX = 'sybnb-v6-checkout-note:'

export type CheckoutDraft = {
  listingId: string
  checkIn: string
  checkOut: string
  protection: boolean
  guests?: number
}

export function loadCheckoutDraft(listingId: string): CheckoutDraft | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(CHECKOUT_DRAFT_KEY)
    if (!raw) return null
    const draft = JSON.parse(raw) as CheckoutDraft
    return draft?.listingId === listingId ? draft : null
  } catch {
    return null
  }
}

export function saveCheckoutDraft(draft: CheckoutDraft) {
  try {
    sessionStorage.setItem(CHECKOUT_DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // storage unavailable: the checkout page still works for this visit
  }
}

// Reads and clears a one-shot flag.
export function takeSessionFlag(key: string) {
  try {
    const value = sessionStorage.getItem(key)
    if (value !== null) sessionStorage.removeItem(key)
    return value
  } catch {
    return null
  }
}
