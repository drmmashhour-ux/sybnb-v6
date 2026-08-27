# Trust Remediation — Capsule 1: Case Status Capsule

**Source finding:** P0 #1 of `sybnb-client-satisfaction-trust-audit.md` (2026-08-26) — "STAYS dispute-closed screen lies."
**Commit:** `660687d` on `candidate/satisfaction-remediation`
**Scope:** Frontend only. No backend route, schema, or money logic touched.
**Status: DONE — verified live, committed.**

---

## The problem

A guest who filed a real dispute on a booking was shown, within the same second, a screen reading:

> **Case Closed** — ✓ Dispute opened ✓ Evidence collected ✓ SYBNB decision ✓ Case closed
> "The case is closed and the decision was saved to the booking record."

This was hardcoded copy in `DisputeClosedFeedback` (`src/modules/trust/TrustProtectionRoutes.tsx`) — it took no input from the API at all. The real backend call (`PATCH /api/bookings/:id/dispute`) only ever sets `booking.status = 'DISPUTED'`: a freshly opened, unreviewed case. No evidence was collected and no decision was made. Compounding it, the dashboard gave no indication afterward that a guest had an open dispute — the trip card kept saying "In trip" regardless.

## The fix

1. **`DisputeClosedFeedback` now fetches the real booking on mount** (`fetchPrototypeBooking`, same pattern already used by `BookingProtectionHub` in the same file) and renders strictly off its actual `status`:
   - `DISPUTED` → "Dispute Submitted" — under review, honestly pending.
   - `CONFIRMED` (admin dismissed / ruled for host) → "Dispute Reviewed" — booking confirmed, no change.
   - `CANCELLED` (admin ruled against host) → "Dispute Reviewed" — booking cancelled, **refund was requested and is being processed** (deliberately not "refunded" — actual wallet-credit execution is a separate, later admin step in this codebase; claiming completion here would just be a new version of the same lie).
   - Anything else / fetch failure / booking not found → an honest, generic, non-committal fallback. Never a hard crash, never a fabricated "closed" claim.
2. **Dashboard indicator**: the active-trip card now shows a real amber "Dispute open" pill + explanatory copy when `activeBooking.status === 'DISPUTED'`, using translation strings (`t.disputeOpen`, `t.disputeCopy`) that already existed in the file but were never wired to anything.

## The reusable capsule

New: `src/shared/capsules/CaseStatusCapsule.tsx` — a generic status-timeline renderer with no SYBNB-STAYS-specific or dispute-specific copy baked in. It takes:

- `status: string` — the real backend status value, never a locally-tracked one.
- `steps: CaseStatusStepDef[]` — an ordered, caller-owned step list (`{ key, label }`).
- `statusMap: CaseStatusMap` — maps real status values to `{ stepIndex, pending?, title, body }`.
- `fallback: CaseStatusOutcome` — used for any status not in the map, or a failed/empty fetch.
- `loading` / `loadingLabel` / `caseLabel`.

It never marks a step done, a decision made, or a case closed on its own — every claim comes from data the caller supplies for the real status it was given. This is registered as a new contract in `src/shared/capsules/index.ts` (`CaseStatusCapsuleState` type + `CAPSULE_RULES.noFabricatedResolution`) and listed in `capsules/SYBNB_REUSABLE_CAPSULES.md`, alongside the existing Account Gate / Search / Payment / Map / Admin Decision / Location capsules.

**Where else this is ready to use, unmodified:** any future SR Ride ride-complaint status screen, a marketplace/CARS dispute flow, or an equivalent "case status" screen on a different platform — swap in that domain's real status enum and copy, same component.

## Verification (live, not code review)

Ran against the real API (`node server/index.mjs`, port 3051) and real frontend (`vite`, port 5180) on the local `sybnb_v6` database:

1. Registered a fresh guest via the real OTP → register flow, minted a real session token.
2. Inserted a `CONFIRMED` test booking for that guest against a real published listing.
3. Loaded the real dashboard — confirmed baseline "In trip" (not yet disputed).
4. Filed a real dispute through the actual `DisputeFlow` UI (chip selection, textarea, submit button) — no shortcuts.
5. Confirmed via direct `psql` query that the booking's real status is `DISPUTED`.
6. Confirmed the post-submit screen shows "Dispute Submitted / ⏳ Under review by SYBNB" — no "closed", no fake checkmarks.
7. Reloaded the dashboard — confirmed the new amber "Dispute open" pill + notice now render.
8. Transitioned the booking to `CONFIRMED` via `psql` (simulating an admin dismissing the dispute), reloaded the status screen — confirmed "Dispute Reviewed... confirmed, no change."
9. Transitioned to `CANCELLED` (simulating a ruling against the host), reloaded — confirmed "Dispute Reviewed... cancelled... refund was requested and is being processed" (not "refunded").
10. Tested a nonexistent booking ID — confirmed the honest generic fallback, no crash.
11. Toggled to Arabic — confirmed correct RTL layout and translated copy for the same real state.
12. `npx tsc --noEmit` and `npm run build` (`tsc && vite build`) both clean.
13. Deleted the test fixture (booking, wallet, roles, audit log, user) from the local DB afterward — nothing left behind.

## What this round deliberately did NOT touch

- The dashboard's separate, already-known bugs: `pastTrips`/`activeStep` mislabeling an upcoming trip as "Completed" and the stepper flooring at step 2 regardless of real arrival date (P2 #8 in the audit — its own future round).
- The dispute note itself isn't persisted anywhere queryable by the guest afterward (only stashed in the admin audit log) — a real, minor secondary gap noticed while reading this code, not part of the P0 scope, and not fixed here. Worth a follow-up capsule if/when the guest's own dispute history becomes a real feature.
- No backend, Prisma schema, or money/refund logic was touched — the backend already returned everything this fix needed.

---

Next up (per the audit's priority list): P0 #2 (SR Ride's fake pre-checked "Verified driver" checkbox) and P0 #3 (STAYS "Verified membership" badge shown to unverified accounts).
