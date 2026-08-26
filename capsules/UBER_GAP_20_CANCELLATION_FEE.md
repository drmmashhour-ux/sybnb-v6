# SR Ride vs. Uber Gap-Closure — Capsule 20: Cancellation-Fee Policy

**Source finding:** P1 #9 of `sr-ride-vs-uber-benchmark.md` — "No cancellation-fee policy; a rider can cancel for free at any point, even after a driver has already committed and is en route — a driver-protection gap Uber closes with its own cancellation fee."
**Commit:** `2335c6e` on `candidate/satisfaction-remediation`
**Scope:** Schema migration (`027_ride_cancellation_fee`, purely additive). Money-adjacent — reuses the payment mechanism authorized in capsule 19, no new payment infrastructure.
**Status: DONE — verified live, committed.**

---

## What changed

Mirrors Uber's own rule exactly: cancelling before a driver is assigned (`REQUESTED`/`MATCHING`) is always free — there's no one to compensate. Cancelling after a driver has already committed real time and travel (`DRIVER_ASSIGNED`/`DRIVER_ARRIVING`) now assesses a fee, computed server-side from the ride's own locked `fareMinor` — never a client-supplied or invented number.

- **`server/routes/sr-rides.mjs`**: the cancel handler now computes and stores `cancellationFeeMinor` via a new `RIDE_CANCELLATION_FEE_PERCENT` constant (20%). Like the 0%-commission default from capsule 19, this rate is explicitly a placeholder pending a real business decision from the owner — flagged in the code, not silently invented as a "correct" number.
- **`server/routes/payments.mjs`**: the same `local-wallet-proof` route from capsule 19 now also accepts a `CANCELLED` ride, but only when a fee was actually assessed. A free cancellation correctly has nothing to pay and 403s if attempted.
- **`server/lib/finance-ledger.mjs`**: the ledger entry is labelled by the ride's status at approval time — `ride_cancellation_fee` for a fee, `ride_fare` for a real fare — so finance reconciliation can always tell the two apart. This was caught and fixed during this capsule's own live verification, before committing: the first draft reused `ride_fare` for both, which would have made a fee credit indistinguishable from a fare credit in the ledger.
- **`SrRidePage.tsx`**: a warning before the rider commits to an irreversible cancellation ("cancelling now may incur an estimated fee of X"), and the post-cancel payment card reuses the exact same submit/pending/confirmed/rejected flow already built for ride-fare payment in capsule 19 (extracted into a shared `renderPaymentSection()` so there's one flow, not two).

## Verification (live, not code review)

1. Cancelled a `DRIVER_ASSIGNED` test ride (fare 10,000 SYP) → fee correctly computed and stored as exactly **2,000 SYP** (20%).
2. Cancelled a `REQUESTED` test ride (no driver assigned yet) → `cancellationFeeMinor` stayed `null`, confirming free cancellation is genuinely unaffected.
3. Submitted the fee payment proof, approved it as admin → driver's wallet shows **exactly one** `CREDIT` of 2,000 SYP with `referenceType='ride_cancellation_fee'` (confirmed correct only *after* the ledger-label fix above — the bug was caught by re-checking the actual database row, not assumed from the code).
4. Attempted to submit a payment on the free-cancellation ride → `403 PAYMENT_RIDE_FORBIDDEN`, confirming there's genuinely nothing to charge when no fee exists.
5. Static payment-policy-enforcement audit: **114/114 passed**, unchanged — run twice, once before and once after the ledger fix.
6. `tsc --noEmit`, `prisma validate`, `npm run build` — all clean.
7. All test fixtures removed via direct `psql` in FK order (including a rollback recovery when a mid-batch FK violation on a leftover audit-log row silently rolled back an earlier cleanup attempt — redone as a single clean batch and re-verified with a row count of zero).

---

Next: the in-app driver-rider contact channel (P0 #4), reusing the existing `MessageThread`/`Message` pattern.
