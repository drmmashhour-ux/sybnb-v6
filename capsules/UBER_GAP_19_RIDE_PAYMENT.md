# SR Ride vs. Uber Gap-Closure — Capsule 19: In-App Ride Payment

**Source finding:** P0 #2 of `sr-ride-vs-uber-benchmark.md` — "No in-app payment for rides; fare is settled entirely outside the platform, unlike Uber where payment is the whole point of not touching cash."
**Commit:** `22ce3a0` on `candidate/satisfaction-remediation`
**Scope:** Schema migration (`026_ride_payment_proof`, purely additive). Money-adjacent — built only after explicit confirmation.
**Status: DONE — verified live end to end, committed.**

---

## Why this one needed sign-off first

Unlike the other 16 gaps in this arc, this one moves money. Before starting, the choice of *how* to build it was put to the user directly: build it exactly like the existing STAYS manual-proof rail (reuse the proven pattern — manual proof, admin review, wallet ledger, gated behind the same global `payments=DISABLED` flag everything else already respects), or something bespoke. The user chose the reuse path. That discipline shows in the diff: there is no new payment mechanism here, only a new *subject* (`rideId` alongside the existing `bookingId`) flowing through the same route, the same admin review queue, and the same ledger function that STAYS/CARS/MARKETPLACE/NEW_CONSTRUCTION already use.

## What changed

- **`server/lib/payment-policy.mjs`**: `'SR'` added to `DIVISIONS`. This alone does *not* enable ride payments — a division being listed is necessary but not sufficient. `PAYMENT_POLICY_ELIGIBLE_DIVISIONS` (env) and `gates.payments === 'enabled'` (per-country profile, never true for the real Syria profile today) both still have to agree. Verified below.
- **`server/routes/payments.mjs`**: `POST /api/payments/local-wallet-proof` now accepts `rideId` as an alternative to `bookingId`. The ride must belong to the calling rider and be `COMPLETED`. `amountMinor` is always derived server-side from `ride.fareMinor` — never trusted from the client, the same anti-tampering discipline the booking path already has. A duplicate-submission guard is scoped to `PENDING_ADMIN_REVIEW`/`APPROVED` only, so a rejected proof can be corrected and resubmitted rather than permanently locking the rider out.
- **`server/lib/finance-ledger.mjs`**: `approvePaymentProof()` gains a `rideId` branch — on approval, 100% of the fare is credited straight to the driver's wallet. No HOLD-then-release two-step like a stay gets, because a completed ride doesn't have a multi-day dispute/cancellation window the way a multi-night stay does. This is a 0%-commission placeholder, flagged here the same way the CARS/MARKETPLACE/NEW_CONSTRUCTION defaults already are — a real commission number is a business decision for the owner, not something to invent silently.
- **`server/routes/sr-rides.mjs`**: `GET /api/sr/rides/:id` now includes the ride's latest payment proof (id/status/amount/currency) so the rider's screen can reflect real state.
- **`src/modules/sr/SrRidePage.tsx`**: a payment section on the completed-ride screen — a submit form when nothing's on file yet (or the last attempt was rejected, with a visible warning), a "pending review" message while an admin decision is outstanding, and a confirmed message once approved.
- **`prisma/migrations/026_ride_payment_proof`**: one nullable FK column, `payment_proofs.ride_id → ride_requests.id`. Additive only.

## Verification (live, not code review)

Proved the system was **safe before proving it was capable** — fail-closed first, happy path second.

1. **Fail-closed, real production-default env** (no test override vars set at all): `POST /api/payments/local-wallet-proof` with a real `rideId` correctly returned `503 PAYMENT_POLICY_DENIED`. Adding `'SR'` to `DIVISIONS` did not weaken the platform's default-deny posture.
2. **Full happy path, permissive test env** (the same flags `run-all-e2e.sh` uses): submit → `201 PENDING_ADMIN_REVIEW` → admin approves (including the existing Sham Cash reconciliation gate, which this reuses unmodified since it keys off `provider === 'syrian_local_wallet'`) → driver's wallet shows **exactly one** `CREDIT` of 14,500 SYP, `referenceType='ride_fare'`, `referenceId` = the ride's id, cached balance 14,500 (no double-crediting).
3. **Duplicate submission while pending** → `409 PAYMENT_RIDE_ALREADY_SUBMITTED`.
4. **Resubmission while approved** → `409 PAYMENT_RIDE_ALREADY_SUBMITTED`.
5. **Resubmission after rejection** (separate test ride) → `201`, accepted — proves the rejected-then-corrected path actually works, not just the happy path.
6. `GET /api/sr/rides/:id` correctly surfaces the approved proof to the rider.
7. Static payment-policy-enforcement audit: **114/114 passed**, unchanged.
8. `tsc --noEmit`, `prisma validate`, `npm run build` — all clean.
9. All test fixtures (2 rides, 2 users, 1 wallet, 3 payment proofs) created and removed via direct `psql` in FK-dependency order; no shared fixture data touched.

---

Next: cancellation-fee policy for rides (P1 #9) — now reconsidered with a real payment mechanism to give it teeth — then the in-app driver-rider contact channel (P0 #4).
