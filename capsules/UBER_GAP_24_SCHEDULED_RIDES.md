# SR Ride vs. Uber Gap-Closure — Capsule 24: Scheduled Rides

**Source finding:** P1 #6 of `sr-ride-vs-uber-benchmark.md` — "No scheduled rides; every ride is ASAP-only, unlike Uber's ability to book a pickup for later."
**Commit:** `f6457fa` on `candidate/satisfaction-remediation`
**Scope:** Schema migration (`030_ride_scheduled_for`, purely additive). No new enum value needed.
**Status: DONE — verified live, committed.**

---

## What changed

Riders can now request a ride for a future pickup time instead of only ASAP. No new status was needed: `RideStatus.DRAFT` has existed since the very first migration but was confirmed genuinely unused for any ride row (zero rows, no code reference) — reused here as the dormant "scheduled, not yet dispatched" state, rather than adding a new enum value for something the schema already had a name for.

- **`server/lib/ride-schedule.mjs`** (new): `activateScheduledRides()` — the exact same "opportunistic activation on a read path, not a cron job" pattern this codebase already documents and uses for booking expiry (`completeExpiredBookings()`, whose own comment says "since there is no scheduler in this deployment"). A scheduled ride becomes visible to drivers 15 minutes before pickup (mirrors Uber's own advance-notice window); riders must schedule at least 30 minutes ahead.
- **`server/routes/sr-rides.mjs`**: ride creation accepts an optional `scheduledFor`, rejecting anything too soon. The rider's own ride-detail read activates their scheduled ride directly (scoped, cheap) so they see it flip to dispatched right on time even without a driver polling first. A still-dormant scheduled ride is freely cancellable — no driver was ever committed to it.
- **`server/routes/driver.mjs`**: the driver's pending-rides read calls the same activation function, unscoped — exactly the read meant to surface everything ready for dispatch.
- **`SrRidePage.tsx`**: a "schedule for later" checkbox + datetime picker on the request form, and a dedicated "Scheduled for `<time>`" message instead of a generic status label while the ride is dormant.

## Verification (live, not code review)

1. Scheduling only 5 minutes ahead → `400 RIDE_SCHEDULE_TOO_SOON`.
2. A ride scheduled 40 minutes out is created `DRAFT` and correctly absent from the driver's pending list.
3. Moving that ride's scheduled time into the 15-minute window → the driver's next pending-list read activates it for real, confirmed directly against the database row (`DRAFT` → `REQUESTED`), not just the API response.
4. The rider's own ride-detail read independently activates a second scheduled ride the same way, via the scoped path.
5. Cancelling a still-dormant scheduled ride succeeds with **no** cancellation fee.
6. `tsc --noEmit`, `prisma validate`, `npm run build` — all clean.
7. Static payment-policy-enforcement audit: **114/114 passed**, unchanged (not payment-adjacent; run as a sanity check).
8. All test fixtures (2 users, 3 rides) removed via direct `psql` in FK order.

---

Next: the smaller P2 polish items (promo codes, saved places, multi-stop rides, accessibility ride options).
