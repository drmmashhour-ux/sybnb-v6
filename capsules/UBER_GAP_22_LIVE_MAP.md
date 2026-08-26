# SR Ride vs. Uber Gap-Closure — Capsule 22: Live Map

**Source finding:** P0 #1 of `sr-ride-vs-uber-benchmark.md` — "No live map at all (decorative dot only), though `DriverProfile.lastLocationGeo` — a PostGIS point column — already exists in schema and is completely unused."
**Commit:** `55d88f1` on `candidate/satisfaction-remediation`
**Scope:** Schema migration (`029_driver_location_freshness`, purely additive), new dependency (`leaflet`).
**Status: DONE — verified live (data pipeline via API, rendering via a real signed-in browser session), committed.**

---

## What changed

The single biggest trust/usability gap from the Uber benchmark, and the one that unlocks trip-sharing next. Riders now see a real map — OpenStreetMap tiles, a pickup pin, a dropoff pin, and the driver's live position — instead of a decorative placeholder dot.

- **`server/lib/live-map.mjs`** (new): `updateDriverLocation`/`getDriverLocation` (PostGIS read/write, mirroring the exact `pickup_geo`/`dropoff_geo` pattern already used elsewhere in this codebase) and `getRideCoords` to read a ride's own geocoded pickup/dropoff back out. A driver's position older than 2 minutes is treated as *no location at all* — never a stale fake dot.
- **`server/routes/driver.mjs`**: `PATCH /api/driver/location` — the driver client reports its own GPS position here, validated server-side (lat ∈ [-90,90], lng ∈ [-180,180]).
- **`server/routes/sr-rides.mjs`**: the ride-detail response now includes `pickupCoords`/`dropoffCoords` whenever the address was actually geocoded, and the driver's live location only while the ride is genuinely in a live-tracking status (`DRIVER_ASSIGNED`/`DRIVER_ARRIVING`/`IN_PROGRESS`) — never for a completed or cancelled ride, and never if stale.
- **`src/shared/maps/RideMap.tsx`** (new): a plain Leaflet map component — deliberately not `react-leaflet`, to avoid its React-19 peer-dependency risk. Custom colored-dot/emoji markers instead of Leaflet's default icons, which are a well-known thing that silently breaks under a bundler.
- **`SrRidePage.tsx`**: the map renders on the rider's tracking screen.
- **`DriverDashboardPage.tsx`**: a per-ride "Share my location" toggle using the browser's `watchPosition`, throttled to about one network post every 8 seconds, and automatically stopping when the ride leaves its live-tracking window (the toggle component unmounts, and its own cleanup clears the watch).

## Two real bugs caught during verification, not by inspection

1. **The account-creation gate rejected a synthetic session.** Injecting a hand-built session object into `sessionStorage` to skip login was silently refused — the page required fields a shortcut object didn't have. This isn't a bug in this capsule; it's confirmation the existing account-gating is doing real work, and it meant verification had to go through an actual signup + email-OTP flow, not a shortcut.
2. **The map only ever showed the driver's marker, never pickup/dropoff — every single test, until traced down.** The cause: React's dev-mode StrictMode double-invokes mount effects (mount → cleanup → mount), and the cleanup that destroys the old Leaflet map wasn't also clearing the marker-reference cache. A later update then called `.setLatLng()` on a marker object that belonged to the *destroyed* map — the call succeeded, but nothing on screen showed it, because it wasn't attached to the currently-rendered map anymore. Fixed by resetting the marker refs in the same cleanup that tears down the map, then re-confirmed against a genuinely fresh mount: all three markers appeared correctly.

## Verification (live, not code review)

1. Created a real ride through the actual UI (full signup, email OTP, ride request) — confirmed the address geocoder produced real `pickup_geo`/`dropoff_geo` coordinates.
2. Driver reports a location → surfaces to the rider within one poll cycle, exact lat/lng match.
3. Backdated the location by 3 minutes → correctly disappears from the rider's view (stale, not shown).
4. Sent an out-of-range latitude (200) → `400 DRIVER_LOCATION_INVALID`.
5. Marked the ride `COMPLETED`, freshly re-reported the driver's location → still correctly hidden (ride is no longer in a live-tracking status).
6. Visual confirmation in a real signed-in browser session: OpenStreetMap tiles rendered, green pickup marker, red dropoff marker, and the driver's car marker, all present together.
7. `tsc --noEmit`, `prisma validate`, `npm run build` — all clean.
8. Static payment-policy-enforcement audit: **114/114 passed**, unchanged (not payment-adjacent; run as a sanity check).
9. All test fixtures (3 users, 4 rides created across the debugging session, 1 driver profile) removed via direct `psql` in FK order.

---

Next: trip-sharing with a trusted contact (P0 #3), which reuses this capsule's map and driver-location pipeline directly.
