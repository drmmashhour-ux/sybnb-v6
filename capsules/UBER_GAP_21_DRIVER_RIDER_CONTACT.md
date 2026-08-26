# SR Ride vs. Uber Gap-Closure — Capsule 21: In-App Driver-Rider Contact

**Source finding:** P0 #4 of `sr-ride-vs-uber-benchmark.md` — "No in-app rider↔driver contact channel; `MessageThread` has no ride linkage at all, so the only way to coordinate a pickup is an external phone call."
**Commit:** `31ec855` on `candidate/satisfaction-remediation`
**Scope:** Schema migration (`028_ride_message_thread`, purely additive) — also fixes a real pre-existing bug caught during verification (see below).
**Status: DONE — verified live, committed.**

---

## What changed

Reuses the existing `MessageThread`/`Message` models exactly — the same infrastructure that already backs booking and listing-inquiry threads — rather than building new messaging infrastructure for rides. A `MessageThread` now optionally links to a `RideRequest` (nullable, unique — one thread per ride, mirroring how `bookingId` already works), and two new sender-role values (`DRIVER`, `RIDER`) label ride participants correctly instead of misusing `GUEST`/`HOST`, which mean something specific elsewhere in the platform.

Messaging opens once a driver is actually assigned (`DRIVER_ASSIGNED` onward, through `COMPLETED`) — never while still `REQUESTED`/`MATCHING` (there's no driver to talk to yet), never on a `CANCELLED` ride (no live coordination need; disputes go through support instead). This mirrors Uber's own in-app chat availability window, including staying open briefly past trip completion for things like a lost item.

- **`server/routes/messages.mjs`**: new `GET`/`POST /api/sr/rides/:id/thread(/messages)`, structured identically to the existing booking-thread routes — a participant check (rider, driver, admin, or support only), a status-eligibility check, a sender-role resolver, and an idempotent thread-upsert.
- **`platformApi.ts`**: `fetchPrototypeSrRideThread`/`sendPrototypeSrRideMessage`, with an `asDriver` flag — unlike booking messaging (always guest-vs-host through one shared session resolver), a ride thread genuinely has two different session types on either side.
- **`SrRidePage.tsx`**: an inline chat card on the rider's ride-tracking screen, polling every 5 seconds while eligible.
- **`DriverDashboardPage.tsx`**: a collapsed-by-default "Message rider" panel per ride card — a driver's dashboard lists several rides at once, unlike the rider's single-ride screen, so the chat stays out of the way until opened.

## A real bug caught during verification, not by inspection

The first live test — the rider sending an actual message — failed with a genuine `500`. Tracing it down (not just re-reading the diff) found a pre-existing database check constraint, `message_threads_booking_or_listing_chk`, that only recognized two valid thread shapes: booking-only, or listing+guest. A ride-only thread violated it outright. This wasn't something code review would have caught — it only surfaced by actually trying to write the row. Fixed by replacing the constraint with one that recognizes a third valid shape (ride-only, all other link columns null), folded into this capsule's own migration rather than shipped as a silent workaround.

## Verification (live, not code review)

1. Rider sends the first message on a `DRIVER_ASSIGNED` ride → `201`, `senderRole=RIDER`, thread auto-created (this is what first caught the constraint bug above).
2. Driver replies → `201`, `senderRole=DRIVER`.
3. Rider reads the thread back → both messages present, correctly ordered.
4. Messaging attempt on a `REQUESTED` ride (no driver yet) → `400 MESSAGING_NOT_ELIGIBLE`.
5. A real but unrelated third user attempting to read the thread → `403 RIDE_FORBIDDEN`.
6. `tsc --noEmit`, `prisma validate`, `npm run build` — all clean.
7. Static payment-policy-enforcement audit: **114/114 passed**, unchanged (this capsule isn't payment-adjacent; run as a sanity check since it touches shared route-dispatch files).
8. All test fixtures (3 users, 2 rides, 1 thread, 2 messages) removed via direct `psql` in FK order.

---

Next: the live map (P0 #1) — Leaflet + OpenStreetMap, writing to the already-existing but unused `DriverProfile.lastLocationGeo` column — which also unlocks trip-sharing (P0 #3).
