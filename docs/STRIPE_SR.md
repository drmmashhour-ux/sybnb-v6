# Stripe card charging for SR rides

Status: **Option A shipped** (gated behind Stripe keys; nothing charges until the owner sets keys + deploys). Author: build session 2026-10-10.

## What already exists (and works)

A hardened Stripe **Checkout** rail, but it is **bookings-only**:

- `POST /api/payments/stripe/create-checkout-session` — builds a hosted Checkout session from a
  booking's locked total.
- `POST /api/payments/stripe/confirm` + `POST /api/payments/stripe/webhook` — settle the booking
  with durable event intake, idempotency (unique `(provider, endpointKey, environment, eventId)`),
  re-authorization *inside* the settlement transaction, and a closed-booking auto-refund guard.
- `GET /api/payments/stripe/status` — reports whether Stripe keys are configured.
- `stripeChargeAmount()` **fails closed on live keys**: a `sk_live_` key refuses to charge until a
  real FX rate (`SYP_PER_USD`) is set. **SR fares are already in USD**, so with `STRIPE_CURRENCY=usd`
  the fare's minor units map 1:1 to the Stripe charge — no FX hazard for rides.

The webhook resolves everything through `subjectType: 'BOOKING'` and a `bookingId` reference, and
settles via `finalizeStripeSession`, which is booking-shaped. **None of it touches rides yet.**

## The one decision: which charge model

Both run on the **Canada Stripe entity** and both start in **TEST mode** (test keys = no real money).

### Option A — Checkout per trip (lowest risk, recommended first step)
At ride end the rider taps **Pay by card** -> redirected to Stripe's hosted Checkout -> pays the
locked fare. A ride-aware webhook settles it by creating + approving a `stripe` card proof, which
the existing ledger already splits (85% driver / 15% platform commission).
- Reuses the proven booking machinery almost verbatim.
- PCI handled entirely by Stripe (hosted page); we store no card data.
- **Not fully automatic** — the rider confirms/authorizes each trip.

### Option B — Saved-card auto-charge (what "automatic charge from credit card" literally means)
Rider saves a card **once** (Stripe `SetupIntent` + a `Customer`). At trip end the server charges
the saved card **off-session** automatically (an `off_session` `PaymentIntent`), no rider tap —
exactly Uber's model.
- Bigger build: card vaulting, Customer management, and an **SCA/3DS fallback** for when an
  off-session charge is declined and needs the rider to re-authenticate.
- Larger money-risk surface, so it must bake in TEST mode before any live key.

## Recommendation

Ship **A** first (small, safe, reuses hardened code) so cards work end-to-end in test, then layer
**B** on top (save-card + off-session) for the true no-tap experience. Both gated behind
`requireStripe()`; nothing charges until the owner sets keys and deploys.

## Env to set (test first)
```
STRIPE_SECRET_KEY=sk_test_...        # Canada entity, TEST mode
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...      # from `stripe listen` or the dashboard endpoint
STRIPE_CURRENCY=usd                  # SR fares are USD; keep usd
# SYP_PER_USD only matters for SYP-denominated bookings, not USD rides
```

## Build checklist once the model is chosen
- [x] A: ride-aware `create-checkout-session` (accepts `rideId`, locked `fareMinor`, `subjectType:'SR_RIDE'`)
- [x] A: ride settlement in the webhook (+ confirm-on-return path) (ride-shaped equivalent of `finalizeStripeSession` -> card proof -> `approvePaymentProof`)
- [x] A: rider "Pay by card" button in `SrRidePage` payment section
- [ ] B: `SetupIntent` + Customer save-card flow; stored `stripeCustomerId` on the user
- [ ] B: off-session `PaymentIntent` at `COMPLETED`; 3DS/decline fallback to a Checkout/confirm link
- [ ] Tips over card: same rails, routed 100% to driver (tip ledger branch already exists)
