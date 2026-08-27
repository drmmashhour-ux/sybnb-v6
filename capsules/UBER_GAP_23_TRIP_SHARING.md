# SR Ride vs. Uber Gap-Closure — Capsule 23: Trip-Sharing

**Source finding:** P0 #3 of `sr-ride-vs-uber-benchmark.md` — "No real trip-sharing with a trusted contact" (depends on the live map, capsule 22).
**Commit:** `49c4d19` on `candidate/satisfaction-remediation`
**Scope:** No schema change — builds directly on capsule 22's map and driver-location pipeline.
**Status: DONE — verified live, committed.**

---

## What changed

A rider can now share a live-tracking link for a trusted contact to watch the trip — no account needed on the receiving end, matching exactly how Uber's own trip-sharing links work.

- **`server/lib/ride-share.mjs`** (new): a signed, time-limited token (6-hour max) bound to a specific ride id — the same HMAC-signature discipline this codebase already uses for private storage retrieval (`signObjectUrl`/`verifySignedObject`), applied here to a new kind of link.
- **`POST /api/sr/rides/:id/share`**: rider-only, must own the ride, only mintable while the ride is genuinely in a live-tracking status (a not-yet-matched or already-finished ride has nothing live to share).
- **`GET /api/sr/rides/:id/shared`**: genuinely public — zero authentication, verified purely by the signed token. The payload is deliberately minimal: ride status, pickup/dropoff coordinates, and only the safe driver fields (name, vehicle, verified badge, live location). Never the rider's own identity — whoever holds the link already knows who they're checking on — and never payment or fare data.
- **`SrRidePage.tsx`**: a "Share my trip" button, using the Web Share API where available and falling back to a clipboard copy.
- **`SharedRidePage.tsx`** (new) + a new public route in `App.tsx`: reuses capsule 22's `RideMap` component directly, deliberately kept out of the app's guest-account gate — same category as the existing trust-center/SOS routes (informational, verified by its own token rather than a login).

## Verification (live, not code review)

1. Rider mints a share token for a `DRIVER_ASSIGNED` ride → the public `/shared` endpoint, called with **zero** `Authorization` header, returns the correct ride status, exact pickup/dropoff coordinates, and driver identity.
2. Security checks — all correctly rejected: a tampered signature; an expired token; and a *valid-looking* signature reused against a different ride's id (proving the token is bound to its specific ride, not just internally self-consistent).
3. A stranger's real account (not this ride's rider) attempting to mint a share token for someone else's ride → `404`.
4. Attempting to share a ride with no driver yet → `400 RIDE_NOT_SHAREABLE`.
5. Visual confirmation in a genuinely fresh browser tab with zero stored session — the public page renders the real map with pickup, dropoff, and driver markers, plus the driver's name.
6. `tsc --noEmit`, `npm run build` — clean (`RideMap` now splits into its own shared lazy chunk, reused by both the rider's page and this new public one).
7. Static payment-policy-enforcement audit: **114/114 passed**, unchanged (not payment-adjacent; run as a sanity check).
8. All test fixtures (3 users, 2 rides) removed via direct `psql` in FK order.

---

Next: scheduled rides (P1 #6), then the smaller P2 polish items (promo codes, saved places, multi-stop, accessibility ride options).
