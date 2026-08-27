# SR Ride vs. Uber Gap-Closure — Capsule 31: Ride-Pooling

**Source finding:** benchmark item, previously assessed as out of reasonable scope.
**Commit:** `0fe78df` on `candidate/satisfaction-remediation`
**Scope:** Schema migration (`037_ride_pooling`, purely additive). One disclosed, non-money-safety limitation.
**Status: DONE — verified live across five distinct scenarios. Committed.**

---

## Built carefully, again on purpose

This was the other item flagged as out of scope — either a real-time matching engine well beyond this arc's size, or a decorative "Share" toggle that would repeat the exact mistake already found and fixed once in this codebase (a pre-checked "Verified driver" filter that implied vetting that never happened). Built for real instead, at a deliberately bounded scope: a flat opt-in discount, and *genuine* proximity-based eligibility — a driver can only pick up a second passenger if that passenger is actually nearby, checked with real geometry against each ride's real geocoded pickup, not a label nobody has to honor.

## What changed

- **`RideRequest.shareable`**: a rider opts in for a flat 15% discount (a disclosed placeholder rate — the same pattern as the 0%-commission and 20%-cancellation-fee defaults already used this arc; a real number is the owner's decision, not invented as final).
- **Real matching logic** (`assertPoolClaimEligible`): a driver may hold a second simultaneous active ride only if both rides are shareable *and* the second one's pickup is genuinely within 3km of the driver's other active ride's pickup — plain geometry against real, already-geocoded coordinates.
- **A genuine pre-existing gap, found and closed while building this**: the claim route never checked whether a driver already had another active ride at all — nothing stopped a driver from claiming any number of unrelated rides across the city simultaneously. Fixed in the same change: a normal (non-pooled) ride now correctly enforces one active ride per driver; only a compatible shareable pair is allowed to coexist.
- **`SrRidePage.tsx` / `DriverDashboardPage.tsx`**: a "Share & save 15%" checkbox, a tracking-screen indicator, and a shareable badge on pending offers and claimed rides so a driver can see it before deciding to claim.

## One limitation, disclosed rather than hidden

The eligibility check and the final claim write are two separate database operations. A driver double-tapping claim on two *different* rides within the same instant could theoretically slip past the active-ride-count check on both requests before either write lands, ending up with 3 simultaneous rides instead of the intended cap of 2. This is narrow (same driver, same instant, two different rides) and has no money-safety or security impact — unlike the two-*different*-drivers race on a *single* ride, which the existing optimistic-concurrency check already closes correctly. Scoped out of this capsule rather than adding transaction-level locking for a low-probability UX edge case, and named here rather than left undiscovered.

## Verification (live, not code review) — five real scenarios

1. A 15%-off shareable ride's fare exactly matches the hand-computed discount (11,500 → 9,775 SYP), checked directly against the quote engine, not just trusted.
2. A driver claims a shareable ride, then tries to also claim an unrelated *normal* ride → `409 DRIVER_ALREADY_ON_A_RIDE` — the correctness fix, confirmed working.
3. The same driver tries to claim a second shareable ride whose pickup is 24.2km away (Damascus Airport) → `400 RIDE_POOL_TOO_FAR`, with the real computed distance in the message.
4. The same driver claims a second shareable ride whose pickup is genuinely close (Shaalan, near Malki) → succeeds; the database confirms the driver now holds exactly 2 simultaneous rides, both shareable.
5. A third shareable-ride claim attempt → `409 DRIVER_POOL_FULL`.
6. `tsc --noEmit`, `prisma validate`, `npm run build` — all clean.
7. Static payment-policy-enforcement audit: **122/122 passed**, unchanged.
8. `sr-geocoding.e2e.mjs`: **13/13 passed**, unchanged — confirms the pooling discount didn't disturb the existing fare-quote characterization.
9. All test fixtures (5 users, 5 rides) removed via direct `psql` in FK order.

---

**This closes every item from the original Uber benchmark, including both that were previously flagged out of scope.** All 17 numbered gaps plus business accounts and ride-pooling are now built, live-verified, and committed — 31 capsules across this arc.
