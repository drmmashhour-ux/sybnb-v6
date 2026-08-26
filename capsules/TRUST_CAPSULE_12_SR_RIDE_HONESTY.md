# Trust Remediation — Capsule 12: Honest SR Ride Quotes and Filters

**Source finding:** Part of P2 #10 of `sybnb-client-satisfaction-trust-audit.md` (2026-08-26) — "SR Ride: ... nonsense addresses silently accepted (geocoder falls back to a fixed 5km with no warning); most of the filter panel (route type, amenities, payment method) never reaches the backend."
**Commit:** `5bf9792` on `candidate/satisfaction-remediation`
**Scope:** Frontend + a small, purely additive backend metadata pass-through. No schema change, no money/payment logic touched.
**Status: DONE — verified live, committed.**

---

## Finding 1: nonsense addresses produced a confident-looking estimate

`countries/syria/geo/geocoding.mjs`'s gazetteer geocoder already correctly returns `null` coordinates when it can't match any known place — that signal already reached the frontend via `quote.pickupCoords`/`quote.dropoffCoords`. The bug was that the frontend only ever showed a generic `"(approximate)"` note for *any* estimated quote, with no way to tell "GPS was imprecise but we still recognized the neighborhood" from "we recognized nothing at all." Typing gibberish produced the exact same soft caveat as a real, merely-unlisted address.

**Fix:** added `addressUnrecognized` — true only when *both* pickup and dropoff coordinates come back null — and a distinct, prominent amber warning: *"We couldn't recognize this address. The price and distance are a rough default, not based on your actual location — check that the neighborhood name is spelled correctly."* Deliberately left "Request ride" enabled: a real Syrian neighborhood that's simply missing from a ~20-entry gazetteer shouldn't be blocked from requesting a ride, only clearly told the estimate is a guess.

## Finding 2: decorative filters — two different fixes for two different reasons

Of Ride type / Route / Ride features / Payment methods, only Ride type ever reached the backend. Investigated each remaining one on its own merits rather than treating them as one uniform bug:

- **Route type + Ride features**: genuine preference data with no false claim attached — just silently thrown away. Now actually persisted into `ride.metadata` (`requestedRouteType`, `requestedFeatures`) at creation. No driver-matching logic reads this yet — it's honest recordkeeping, not automation that doesn't exist, but it's real data now, visible to anyone reviewing the ride, not discarded.
- **Payment methods**: removed entirely, not persisted. Confirmed via schema search that `RideRequest` has no `PaymentProof` relation anywhere — SR Ride has **zero** in-app payment-collection mechanism (fares are informational only, presumably cash-in-person like a traditional taxi). Offering a payment-method selector implied a real transactional capability that doesn't exist at all — closer in kind to capsule 2's fake "Verified driver" removal than to ordinary UI decoration.

**Important scoping note:** the `'payments'` filter group definition itself was left completely untouched — confirmed via `grep` that it's a *shared* group used by STAYS, marketplace, and rentals filter panels, which do have real payment/proof-upload flows. Only SR Ride's own filter-group request list stopped including it. Deleting the shared definition would have silently broken those other divisions.

## Verification (live, not code review)

1. `npx tsc --noEmit` and `npm run build` — both clean.
2. Typed real gibberish into both pickup and dropoff fields (via a real React-controlled input update, not a shortcut) — confirmed the new warning renders and the old generic "(approximate)" note does not.
3. Reset both fields to a real, recognized neighborhood pair (Malki → Mezzeh) — confirmed the warning disappears and a real haversine-computed distance (5.1 km) shows instead of the 5 km blind default.
4. Confirmed the "Payment methods" section no longer renders anywhere in the SR Ride filter panel.
5. Selected the "Airport" route type (default features left as-is), requested a real ride through the actual UI, then queried the database directly: `ride.metadata` now contains `"requestedRouteType": "airport"` and `"requestedFeatures": ["instantConfirm", "ac"]` — genuinely persisted, not discarded.
6. Cleaned up the test fixtures afterward.

## What this round deliberately did NOT touch

- Did not build real driver-matching logic against route type or features — that's a genuinely separate, larger initiative (would need real driver availability/preference data that doesn't exist yet).
- Did not attempt to improve the gazetteer's coverage or add a real geocoding provider — flagged as a real limitation, not fixed (no API key/provider is configured for this prototype, per the existing code comment).
- Did not touch the other filter panel's `'payments'` group definition or its usage in STAYS/marketplace/rentals — those divisions' payment-method filters were not investigated this round.

---

Remaining from P2 #10: no receipt/rating after a completed ride — the largest of the P2 sub-findings, since a real rating system needs a new data model. Next up, before P2 #11 (RTL/mobile header-clipping bug).
