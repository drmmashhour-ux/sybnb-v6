# SR Ride vs. Uber Gap-Closure — Capsule 27: Multi-Stop Rides

**Source finding:** P2 #14 of `sr-ride-vs-uber-benchmark.md` — "No multi-stop rides."
**Commit:** `00129f6` on `candidate/satisfaction-remediation`
**Scope:** New table (`033_ride_stops`, purely additive). One test file updated (a real regression caught and fixed, see below).
**Status: DONE — verified live, committed.**

---

## What changed

Riders can now add up to 3 intermediate stops between pickup and dropoff, matching Uber's own cap. The base fare and surcharge apply once for the whole trip — only distance accumulates across legs, the same way Uber's own multi-stop pricing works (it extends one trip, it doesn't stack several flat fares).

- **`countries/syria/geo/geocoding.mjs`**: `quoteSrRide()` gains an optional `stops` list, resolved leg-by-leg exactly the way pickup/dropoff already are. An unresolved stop makes the *whole* quote fall back to the default distance — not a new failure mode, just the existing "every point must resolve" rule extended to cover stops too.
- **New `RideStop` table**: `rideId`, `sequence`, `address`, plain `lat`/`lng` — same reasoning as capsule 26's `SavedPlace`: resolved once at creation, only ever played back for display, never spatially queried again.
- **`server/routes/sr-rides.mjs`**: accepts up to 3 stops (blank entries dropped, not rejected — clearing a field shouldn't block the whole request).
- **`server/routes/driver.mjs`**: both the pending list and a driver's own claimed rides now include stops, so a driver can see the extra legs before deciding to claim.
- **`RideMap.tsx`**: numbered stop markers alongside the existing pickup/dropoff/driver markers.
- **`SrRidePage.tsx`** / **`DriverDashboardPage.tsx`**: add/remove stop fields on the request form, stops shown on both the rider's tracking screen and the driver's ride cards.

## A real regression caught by running an existing test, not just writing new ones

`tests/e2e/sr-geocoding.e2e.mjs` is a characterization test that pins `quoteSrRide()`'s exact return shape with deep equality. Running it after this change — before committing — immediately failed 4 of its existing assertions: the new `stopCoords` field appeared in every result, including plain single-leg quotes that never asked for stops, and the test's `want` objects didn't expect it. This is exactly what running the existing suite (not just adding new tests) is for. Fixed by updating those 4 assertions to include `stopCoords: []`, and adding two new cases for the multi-stop path itself — one with a resolved stop (confirming the fare reflects the longer *summed* distance, not a per-leg base fare) and one with an unresolved stop (confirming the fallback behavior matches what an unresolved pickup/dropoff already does).

## Verification (live, not code review)

1. A ride requested with one stop persists it with real resolved coordinates, correctly reflected in both the rider's own ride-detail view and the driver's pending-rides list.
2. 5 submitted stops (including one blank) correctly cap at 3 and drop the blank, preserving order.
3. `tests/e2e/sr-geocoding.e2e.mjs`: **13/13 passed** (after the fix above).
4. `tsc --noEmit`, `prisma validate`, `npm run build` — all clean.
5. Static payment-policy-enforcement audit: **114/114 passed**, unchanged (not payment-adjacent; run as a sanity check).
6. All test fixtures (2 users, 2 rides, 4 stop rows) removed via direct `psql` in FK order.

---

This closes every gap from the benchmark except push notifications (blocked, needs real credentials from the owner) and promo codes — which genuinely needs a real discount/marketing decision from the owner before it can be built honestly, unlike every other gap closed this arc, which had a safe, disclosed-placeholder default to build against.
