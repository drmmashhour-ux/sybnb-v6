# Trust Remediation — Capsule 14: SR Ride Receipt + Rating

**Source finding:** Last piece of P2 #10 of `sybnb-client-satisfaction-trust-audit.md` (2026-08-26) — "No receipt or rating after a completed ride... There's no rating/review model anywhere in the schema for rides at all."
**Commit:** `7a78fcf` on `candidate/satisfaction-remediation`
**Scope:** New table (`ride_reviews`), one new backend route, one existing route extended, frontend UI. First schema change in this remediation arc — applied only after explicit owner approval.
**Status: DONE — verified live through a complete real lifecycle, committed.**

---

## The problem

A completed SR Ride simply ended with a static "Ride completed. Thanks for riding with SR." — no fare breakdown, no way to rate the driver, and no rating/review data model at all for rides, unlike STAYS bookings, which get a real `ListingReview`.

## Why this needed a schema change, and how it was handled

Every other capsule in this remediation (1 through 13) fixed things using data that already existed, or removed a false claim outright — none needed a new table. This one genuinely did: there is nowhere in the existing schema to store a rating. Applying the migration was **explicitly paused and flagged to the owner** rather than assumed or routed around when the environment's own auto-mode classifier blocked the first attempt — this was the first schema-touching change in the whole arc, so it got the same "stop and ask" treatment this session has applied to every other genuine architectural fork. The owner explicitly chose "apply the migration" before it was applied.

## The fix

**`ride_reviews`** (migration `024_ride_reviews`) is a direct structural mirror of the existing `ListingReview` model — not a new design, an applied precedent: `rideId` unique (one review per ride), `riderId`, `rating` with a DB-level `CHECK (rating >= 1 AND rating <= 5)` (matching `listing_reviews`'s own constraint exactly), optional `comment`, and the same `hiddenAt`/`hiddenByAdminId` admin-moderation columns `ListingReview` already has. No separate "reviewed party" column — the driver is derivable via `ride_requests.driver_id`, the same way `ListingReview` derives the host via `listings.owner_id` rather than duplicating it.

**`POST /api/sr/rides/:id/review`** (`server/routes/sr-rides.mjs`) mirrors `POST /api/reviews` (`reviews.mjs`) line for line in its validation logic: rating must be an integer 1–5, comment trimmed to 2000 chars, the ride must belong to the requesting rider, the ride must be `COMPLETED`, and a real existence check (backed by the DB's own unique constraint as the final guarantee) refuses a second review for the same ride.

**`GET /api/sr/rides/:id`** now includes the review relation, so the rider's own tracking/completion screen can tell "not yet rated" from "already rated" from a single fetch.

**Frontend**: the completed-ride screen now shows the real fare charged and real distance (both already stored on the ride — `fareMinor`, `metadata.distanceKm` — just never surfaced at completion) as an actual receipt, followed by either a real 5-star rating control with an optional comment field, or — once submitted — the rider's own real rating rendered back honestly (e.g. "★★★★☆"), never a placeholder or assumed value.

## Verification (live, not code review) — the full real lifecycle, not a shortcut

1. `npx prisma validate`, `npx tsc --noEmit`, `npm run build` — all clean.
2. Requested a real ride through the actual UI as a fresh test rider.
3. Progressed it through the complete real driver-side lifecycle via the actual API a driver app would call: claim → `DRIVER_ARRIVING` → `IN_PROGRESS` → `COMPLETED`, as a fresh test driver.
4. Refreshed the rider's screen — confirmed the receipt shows the exact real fare (12,500 SYP) and exact real distance (5.1 km), not placeholder values.
5. Submitted a real 4-star rating with a comment through the actual UI (clicking the 4th star, typing into the textarea, clicking submit) — confirmed the database row matches exactly (`rating: 4`, the exact comment text) and the UI correctly re-renders the submitted rating instead of the form.
6. Independently verified all four validation guards via direct HTTP, not just the happy path: a second review attempt on the same ride → `409 REVIEW_ALREADY_EXISTS`; `rating: 0` → `400 REVIEW_RATING_INVALID`; reviewing a still-`REQUESTED` ride → `400 REVIEW_RIDE_NOT_COMPLETED`; no auth token → `401 AUTH_REQUIRED`.
7. Ran the repo's static payment-policy enforcement audit (`payment-policy-enforcement.e2e.mjs`) — 114/114 passed, unchanged from before this capsule, confirming the new route was correctly recognized as a non-money operation and didn't need (or incorrectly trigger) payment-policy enforcement.
8. Hit one real, transient issue along the way: Vite's dev-server module graph went stale after the new named export was added mid-session, producing a real-looking but environmental `SyntaxError`. Diagnosed via the console (not assumed), fixed with a forced dev-server restart — not a defect in the shipped code, confirmed by `tsc`/`build` passing throughout.
9. Deleted every test fixture (both rides, the review row, the driver, the rider, wallets, roles) from the local database afterward.

## What this round deliberately did NOT touch

- No aggregate rating display anywhere (e.g. a driver's average star rating on their own dashboard) — the data now exists to build that later, but showing it wasn't part of the audit's finding and would be a separate, later addition.
- No admin moderation UI for hiding a review — the `hiddenAt`/`hiddenByAdminId` columns exist (matching the `ListingReview` precedent) but no admin route uses them yet, same as how far this capsule's scope was meant to reach.

---

This closes every finding from the original client-satisfaction audit. All 14 capsules are complete, each independently committed, verified live, and documented in its own report file in `capsules/`.
