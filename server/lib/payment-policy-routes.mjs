// SYBNB — declarative inventory of every payment-adjacent route and the operation it performs
// under server/lib/payment-policy.mjs. This is the single source of truth
// tests/e2e/payment-policy-enforcement.e2e.mjs checks the real route files against: it fails the
// build if a route here no longer exists, or if a route that moves money/calls a provider/performs
// replay exists in the route files but has no entry here.
//
// "money-moving" is deliberately narrow: it means the route calls a provider, or mutates
// Payment/PaymentIntent/PaymentEvent/PaymentProof/Booking/WalletEntry state, or performs an admin
// replay. Pure reads (GET routes, or a route that only returns config presence) are declared with
// operation: 'reconciliation_read' if they touch payment-adjacent data, or omitted entirely if they
// don't touch it at all — see NOT_MONEY_MOVING below for routes deliberately excluded.

export const PAYMENT_POLICY_ROUTES = Object.freeze([
  // --- payment-intents.mjs (the electronic PaymentIntent rail) ---
  { method: 'POST', pathPattern: '^/api/payments/intents$', operation: 'create', file: 'server/routes/payment-intents.mjs', rail: 'payment_intent' },
  { method: 'POST', pathPattern: '^/api/payments/webhook$', operation: 'webhook_intake', file: 'server/routes/payment-intents.mjs', rail: 'payment_intent' },
  { method: 'POST', pathPattern: '^/api/payments/webhook$', operation: 'webhook_apply', file: 'server/routes/payment-intents.mjs', rail: 'payment_intent' },
  { method: 'POST', pathPattern: '^/api/admin/payment-events/[^/]+/replay$', operation: 'replay', file: 'server/routes/payment-intents.mjs', rail: 'payment_intent' },
  { method: 'GET', pathPattern: '^/api/payments/intents/[^/]+$', operation: 'reconciliation_read', file: 'server/routes/payment-intents.mjs', rail: 'payment_intent' },
  { method: 'GET', pathPattern: '^/api/admin/payment-intents/reconciliation$', operation: 'reconciliation_read', file: 'server/routes/payment-intents.mjs', rail: 'payment_intent' },

  // --- payments.mjs (Stripe Checkout + manual/local proof rails) ---
  { method: 'POST', pathPattern: '^/api/payments/stripe/create-checkout-session$', operation: 'create', file: 'server/routes/payments.mjs', rail: 'stripe_checkout' },
  { method: 'POST', pathPattern: '^/api/payments/stripe/confirm$', operation: 'capture', file: 'server/routes/payments.mjs', rail: 'stripe_checkout' },
  { method: 'POST', pathPattern: '^/api/payments/stripe/webhook$', operation: 'webhook_intake', file: 'server/routes/payments.mjs', rail: 'stripe_checkout' },
  { method: 'POST', pathPattern: '^/api/payments/stripe/webhook$', operation: 'webhook_apply', file: 'server/routes/payments.mjs', rail: 'stripe_checkout' },
  { method: 'POST', pathPattern: '^/api/payments/seller-plan-proof$', operation: 'create', file: 'server/routes/payments.mjs', rail: 'manual_proof' },
  { method: 'POST', pathPattern: '^/api/payments/local-wallet-proof$', operation: 'create', file: 'server/routes/payments.mjs', rail: 'manual_proof' },
  { method: 'GET', pathPattern: '^/api/payments/[^/]+$', operation: 'reconciliation_read', file: 'server/routes/payments.mjs', rail: 'manual_proof' },
  { method: 'GET', pathPattern: '^/api/admin/payment-proof/[^/]+/url$', operation: 'reconciliation_read', file: 'server/routes/payments.mjs', rail: 'manual_proof' },

  // --- admin.mjs (review-queue decisions that move money) ---
  { method: 'PATCH', pathPattern: '^/api/admin/review-queue/payment/[^/]+$', operation: 'capture', file: 'server/routes/admin.mjs', rail: 'manual_proof', note: 'decision=APPROVED branch' },
  { method: 'PATCH', pathPattern: '^/api/admin/review-queue/payment/[^/]+$', operation: 'refund', file: 'server/routes/admin.mjs', rail: 'manual_proof', note: 'decision!=APPROVED branch, reversing an already-approved payment' },
  { method: 'PATCH', pathPattern: '^/api/admin/review-queue/booking/[^/]+$', operation: 'refund', file: 'server/routes/admin.mjs', rail: 'manual_proof', note: 'decision!=APPROVED branch with an approved payment on the booking' },

  // --- bookings.mjs (guest-initiated cancellation, moves money) ---
  { method: 'PATCH', pathPattern: '^/api/bookings/[^/]+/cancel$', operation: 'refund', file: 'server/routes/bookings.mjs', rail: 'manual_proof' },

  // --- admin.mjs (paying the host out — the owner-authorized 8th operation type) ---
  { method: 'PATCH', pathPattern: '^/api/admin/payouts/[^/]+/release$', operation: 'payout_release', file: 'server/routes/admin.mjs', rail: 'manual_proof' },

  // --- admin.mjs (Item 2 Phase 2b round 1 — the owner-authorized 9th operation type) ---
  { method: 'PATCH', pathPattern: '^/api/admin/refunds/[^/]+/legacy-accept$', operation: 'legacy_refund_accept', file: 'server/routes/admin.mjs', rail: 'manual_proof' },

  // --- host.mjs (host-initiated cancellation, reverses an approved payment — found by the
  // all-routers enforcement scan, not the original hand-survey; see the implementation report) ---
  { method: 'PATCH', pathPattern: '^/api/host/requests/[^/]+$', operation: 'refund', file: 'server/routes/host.mjs', rail: 'manual_proof' },
])

// Routes deliberately excluded from the registry — documented so the enforcement audit's static
// scan doesn't mistake them for undeclared gaps, and so a future reader doesn't have to re-derive
// why each one is absent.
export const PAYMENT_POLICY_EXCLUDED_ROUTES = Object.freeze([
  { method: 'POST', pathPattern: '^/api/payments/proof-upload$', file: 'server/routes/payments.mjs', reason: 'raw file upload to storage; no payment/booking/wallet state change' },
  { method: 'GET', pathPattern: '^/api/payments/stripe/status$', file: 'server/routes/payments.mjs', reason: 'static config-presence read, not a payment operation' },
  { method: 'PATCH', pathPattern: '^/api/admin/review-queue/listing/[^/]+$', file: 'server/routes/admin.mjs', reason: 'same dispatcher as money-moving entity types, but listing decisions never touch payment/wallet state' },
  { method: 'PATCH', pathPattern: '^/api/admin/review-queue/iddocument/[^/]+$', file: 'server/routes/admin.mjs', reason: 'same dispatcher; KYC decisions never touch payment/wallet state' },
  { method: '*', pathPattern: '^/api/wallet', file: 'server/routes/wallet.mjs', reason: 'WalletGift is a separate, provider-independent domain (platform-funded promotional credit); out of scope for a payment-PROVIDER capability policy' },
  { method: '*', pathPattern: '^/api/admin/id-document', file: 'server/routes/admin.mjs', reason: 'KYC documents, unrelated to payments' },
])

// No known gaps remain — payout_release (below) closed the one previously-documented gap. Kept as
// an explicit, empty export (rather than removed) so the enforcement test's reconciliation logic
// and any future gap never need special-casing "this export might not exist".
export const PAYMENT_POLICY_KNOWN_GAPS = Object.freeze([])
