# SR Ride vs. Uber Gap-Closure — Capsule 17: Surface Driver Ratings

**Source finding:** P1 #8 of `sr-ride-vs-uber-benchmark.md` — "Ratings are collected but never shown back anywhere."
**Commit:** `2ff286c` on `candidate/satisfaction-remediation`
**Scope:** No schema change. Backend aggregation query + frontend rendering only.
**Status: DONE — verified live, committed.**

---

## The fix

`getDriverRatingSummary(driverId)` (`server/lib/driver-rating.mjs`) computes a real average + count from `RideReview`, joined through the ride relation, excluding admin-hidden reviews. Wired into `GET /api/sr/rides/:id` (rider sees their matched driver's real rating) and `GET /api/driver/rides` (driver sees their own). A driver with zero ratings gets an honest `null`/`0`, not a placeholder — the rating line is omitted from the UI entirely rather than showing a fake number.

## Verification (live, not code review)

Focused on the aggregation math directly via the real API, since that's the actual risk here (the rendering reuses already-proven patterns):

1. Two completed, differently-rated rides for one driver (5 and 3) → averaged to exactly `4.0`.
2. A brand-new, unrated driver → `averageRating: null, ratingCount: 0`, not a fake number.
3. Admin-hid one of the two reviews → average correctly recomputed to `5.0` (count 1), the hidden one excluded, not silently included.
4. A second, different rider matched to the same driver on a new ride → correctly saw the driver-level aggregate (`4.0`, later `5.0` after the hide), confirming the rating is scoped to the driver, not leaking across unrelated rides or riders.
5. Confirmed the live driver dashboard UI renders it correctly ("Your rating: ★5 (1)") after a Vite dependency-cache issue (unrelated to this change, resolved by clearing `.vite` and restarting).
6. `tsc` + `vite build` clean. All test fixtures cleaned up afterward.

---

Next: rider-facing verified-driver badge (P1 #11), then cancellation-fee policy (P1 #9).
