# Revenue Guard — Reusable Capsule

**Source request:** User, 2026-10-11 — "I want to see the revenue agent catch all the money and catch any gap or expected gap. For example in SR, maybe the driver after he gets the ride did a deal with the rider and cancelled the order, but he continued with the rider and got cash from him — how will the agent catch that gap?" Then: "build the revenue guard now in all platforms" and "keep it as a capsule we can use it in other platforms."
**Code:** `server/lib/revenue-guard.mjs` (portable core + SYBNB adapter). Contract types in `src/shared/capsules/index.ts` (`RevenueGuardResult`, `RevenueGuardFlagKind`, `CAPSULE_RULES.revenueGuard`).
**Status: BUILT — wired into the server tick + heartbeat, syntax-checked. Verify live after deploy.**

---

## The gap it closes

A provider and a consumer can collude to take a transaction off-platform so the platform earns no commission:

- **SR (the user's example):** a driver accepts a ride, meets the rider, then cancels the order in the app — but still drives the rider and takes cash directly. The platform sees a "cancelled" ride and bills no commission, yet the service was actually delivered.
- **Stays/any division:** a host and a guest who keep "cancelling" bookings but clearly transact anyway; or a repeat side-deal between the same two parties.

None of this is visible from a single record — a cancel looks like a normal cancel. It is only visible as a *pattern* across records, which is what the guard watches for.

## How it catches it — three detectors

The core is pure and data-shaped. It operates on generic transactions `{ id, providerId, consumerId, status: 'CANCELLED' | 'COMPLETED', reachedFulfillment? }`:

1. **`detectReachedThenCancelled(txns)`** — a transaction that reached the fulfilment stage (for SR: the ride logged `PICKUP_VERIFIED` or `IN_PROGRESS`) and was then `CANCELLED`. That is the signature of the driver's cash side-deal: the meter started in the real world, then the record was voided. → `OFFPLATFORM_SUSPECTED`.
2. **`detectCollusionPairs(txns, { threshold })`** — the same `providerId`+`consumerId` pair with ≥ threshold cancellations and **zero** completions. A one-off cancel is noise; the same two people cancelling on each other repeatedly is a relationship that has left the platform. → `COLLUSION_PAIR`.
3. **`detectHighCancelProviders(txns, { minCount, rate })`** — a provider with enough volume (≥ minCount) whose cancel rate is over the threshold. Catches a driver/host running most of their book off-platform. → `HIGH_CANCEL_PROVIDER`.

## The SYBNB adapter — `runRevenueGuard()`

Wraps the pure core for this platform. It:

- Scans SR rides (`CANCELLED` + `COMPLETED`) inside the config window, reads `rideEvent` to mark which cancelled rides had reached `PICKUP_VERIFIED`/`IN_PROGRESS` (sets `reachedFulfillment`), then runs all three detectors.
- Scans Stays bookings (provider = `listing.ownerId`) and runs the collusion + high-cancel detectors.
- **Detector 1** raises a ride-scoped `Incident` (`reporterRole: 'SYSTEM'`, `type: 'REPORT'`, `meta.revenueFlag = 'OFFPLATFORM_SUSPECTED'`), idempotent via `openRevenueFlagExists` so repeated sweeps never duplicate.
- **Detectors 2 & 3** call `notifyAdmin('admin_revenue_flag', …)` with one-per-day idempotency keys.
- Returns `{ ridesScanned, offPlatformFlagged, collusionPairs, highCancelProviders, hostCancelFlagged }`.
- Is entirely best-effort: every path is wrapped, it never throws, and a failure degrades to an empty result so it can never break the tick.

## Config (env-tunable)

`REVENUE_GUARD_CONFIG` — `windowDays` 30, `pairCancelThreshold` 3, `providerMinTxns` 8, `providerCancelRate` 0.40, `maxScan` 5000. Each is overridable by env so a new country/division can tighten or loosen thresholds without a code change.

## Where it runs

Wired into `server/index.mjs` on the same timer as the safety anomaly sweep — both `handleInternalTick` (`/internal/tick`, exposed in the JSON response as `revenueFlags`) and the in-process `runDispatchHeartbeat`. No new infra.

## Design rules (carried in `CAPSULE_RULES.revenueGuard`)

- A flag **raises an admin incident/notification, never an automated penalty**. Humans decide; the guard only surfaces. This keeps a false positive (a genuinely cancelled ride) from auto-charging an innocent driver.
- Detection is a **pattern over records**, so it tolerates individual legitimate cancels and only escalates on repetition or the reached-then-cancelled signature.
- The core is **pure and platform-agnostic**; porting to another app means writing a new adapter that maps that app's records to the `{ providerId, consumerId, status, reachedFulfillment }` shape and choosing where flags land.

## To reuse in another platform

1. Copy `server/lib/revenue-guard.mjs`.
2. Keep the pure detectors as-is.
3. Replace `runRevenueGuard()`'s body: map your domain's records to the generic txn shape, decide `reachedFulfillment` from your own fulfilment signal, and point the flag sink at your incident/notification system.
4. Tune `REVENUE_GUARD_CONFIG` thresholds via env.
5. Call it from your scheduler alongside other periodic sweeps.

## Known follow-ups (not in this build)

- **Detector 4** — post-cancel GPS capture: lift the `status: 'IN_PROGRESS'` gate on location pings so a cancelled-but-still-moving driver's trajectory vs. drop-off can be compared (hard proof of a completed off-platform ride).
- Charge a cancellation fee on IN_PROGRESS driver cancels (currently `cancellationFeeMinor` is left NULL).
- Contact-info redaction beyond messages (listing text, profile, photos) to make the off-platform hand-off harder to arrange in the first place.
- Dunning / suspension for providers who accumulate unpaid commission debt from a pure-cash pattern.
