# SR Ride vs. Uber Gap-Closure — Capsule 18: Real Verified-Driver Badge

**Source finding:** P1 #11 of `sr-ride-vs-uber-benchmark.md` — "No rider-facing 'verified driver' trust signal, despite the backend already tracking real ID-review status internally."
**Commit:** `8cecfe0` on `candidate/satisfaction-remediation`
**Scope:** No schema change. Backend field exposure + frontend badge only.
**Status: DONE — verified live, committed.**

---

## Built carefully, on purpose

A **fake** version of this exact badge (pre-checked, never backed by anything) was already found and removed elsewhere in this remediation arc (capsule 2). This capsule builds the real one: `GET /api/sr/rides/:id` now returns `driver.isVerified` — a clean boolean derived from `idDocumentStatus === 'APPROVED'`, reusing the same review pipeline already used for guest/host verification. Never the raw internal status string (a rider only needs yes/no; `PENDING_REVIEW` vs `REJECTED` is meaningful to the account owner, not a third party). The rider's tracking screen shows a real "✓ Verified identity" badge only when true — nothing renders otherwise.

## Verification (live, not code review)

1. `tsc` + `vite build` — clean.
2. Direct API checks against three real driver states: `APPROVED` → `isVerified: true`; no status set → `false`; `PENDING_REVIEW` → also `false` (only `APPROVED` counts, not "any review activity at all").
3. Confirmed the response leaks no raw `idDocumentStatus`, email, or phone — only the derived boolean plus the already-established safe fields.
4. Test fixtures cleaned up afterward.

---

Next: cancellation-fee policy for rides (P1 #9), then the in-app driver contact channel (P0 #4).
