# Trust Remediation — Capsule 6: Driver's Own Docs-Status Panel

**Source finding:** Not on the original numbered list in `sybnb-client-satisfaction-trust-audit.md` — found in passing while implementing P0 #3 (STAYS "Verified membership" badge), deliberately not touched at the time to keep that round narrow.
**Commit:** `0a35f93` on `candidate/satisfaction-remediation` (the `fetchDriverIdentityStatus()` helper this capsule relies on landed slightly earlier, incidentally, inside `f57ee77` — capsule 4/5's commit — see the concurrency note below for why).
**Scope:** Frontend. The one backend-reuse piece (no schema change, no new route) is already covered by `f57ee77`.
**Status: DONE — verified live, committed.**

---

## Triage: is this P0/P1/P2-equivalent?

**P0.** `DriverDashboardPage.tsx`'s "Safety and document status" panel showed:

```
Verified identity   Verified
Driver license       Valid
Vehicle insurance    Expiring soon
```

— unconditionally, on every load, regardless of the actual signed-in driver. This is the exact same bug class as P0 #2 (fake SR Ride "Verified driver" checkbox) and P0 #3 (fake STAYS membership badge): a screen asserts something the backend never confirmed. It's arguably sharper here than #2/#3 — this isn't a rider evaluating trust in the abstract, it's a driver being told their **own** compliance documents are fine when the app has no idea whether that's true. `CAPSULE_RULES.noFakeTrustSignal` (added in capsule 2) governs this directly.

## Investigation: is there real data to back an honest version?

Checked before deciding fix-vs-remove, per `DriverProfile` in `prisma/schema.prisma` (line 198): `licenseHash`, `vehicleMake/Model/Plate`, `active`. Re-confirmed this session, same as capsule 2's finding: `grep -rn "driverProfile" server/` returns **nothing** — `DriverProfile` is still unreferenced by any backend route. There is no license-expiry field, no insurance field, anywhere in the schema. `licenseHash` is presence-only (a hash was stored at onboarding) — it says nothing about current validity.

Split result, one field at a time:

- **"Verified identity"** — fixable honestly, no schema change. `User.idDocumentStatus` already exists and is already the platform's real verification signal (used by host approval, listing-publish gating, and capsule 3's membership badge). The only gap: `/api/driver/rides` (`server/routes/driver.mjs`) hand-builds its `driver` object as `{ id, email, displayName, roles }` and never selects `idDocumentStatus`. But `/api/me/overview` (`server/routes/me.mjs`) is role-agnostic (`requireAuth(context)`, no role restriction) and already returns `idDocumentStatus` for whichever user calls it — guest, host, seller, or driver. So this can reuse an existing endpoint the same way `fetchSellerOverview` already does for the seller session, with zero backend changes.
- **"Driver license" / "Vehicle insurance"** — no honest version exists. No expiry date, no insurance record, no review flow, nowhere in the schema. Same conclusion and same reasoning as capsule 2's "Verified driver" removal: building this for real (new schema fields, an admin review step, a driver upload flow) is a genuinely separate, larger initiative, not a capsule-sized fix. Removed both lines and the unconditional "renew insurance within 14 days" warning that hung off the fake insurance state.

## The fix

- `src/shared/api/platformApi.ts`: added `fetchDriverIdentityStatus()` — reuses the driver staff session (`ensurePrototypeDriverSession`) against the existing `/api/me/overview` endpoint, returns `overview.user.idDocumentStatus`. No new backend route, no schema change. (Written as part of this capsule; ended up committed inside `f57ee77` rather than this capsule's own commit — see concurrency note.)
- `src/modules/driver/DriverDashboardPage.tsx`: fetches this on mount, renders "Verified identity" as one of three real states — `APPROVED` → Verified/موثق, `PENDING_REVIEW` → Pending review/قيد المراجعة, anything else (including never-submitted) → Not verified/غير موثق. Removed the "Driver license"/"Vehicle insurance"/renew-insurance lines entirely, matching capsule 2's removal precedent.

## Verification (live, not code review)

Ran against the real API (`node server/index.mjs`, `sybnb_v6` DB) and real frontend, both started manually for this session (see note below on why). All three identity states walked through the *actual* mechanisms that produce them, not DB shortcuts:

1. Registered a fresh account through the real OTP flow (`/api/otp/send` → `/api/otp/verify` → `/api/auth/register`).
2. Granted `DRIVER` via `scripts/bootstrap-admin.mjs` (the real operator-provisioning path), logged in for a fresh token carrying the role.
3. Loaded `/#/driver`: docs panel showed **"Not verified" / "غير موثق"** — correct, no ID ever submitted.
4. Submitted a real ID document via `PATCH /api/me/id-document` (the actual endpoint the Trust Center upload flow uses) → DB confirms `idDocumentStatus: PENDING_REVIEW`. Reloaded: panel showed **"Pending review" / "قيد المراجعة"**.
5. Granted the same test account `ADMIN` and approved the document via the real admin review endpoint (`PATCH /api/admin/review-queue/iddocument/:id`, `{decision: 'APPROVED'}`) — the same mechanism a real admin uses. Reloaded: panel showed **"Verified" / "موثق"**.
6. Confirmed in English too (all three strings render correctly, no leftover "Driver license"/"Vehicle insurance" lines in either language).
7. `npx tsc --noEmit` clean, both before and after the full round.
8. Deleted the test fixture (user, roles, wallet, audit log rows) from the local DB afterward.

**Environment note:** this machine's global `~/.claude/launch.json` has a `sybnb-dev-5180` entry pointing at an unrelated stale checkout (`/Volumes/.../SYBNB_STR_FINAL_UPDATED_FOR_CLAUDE_2026_07_05`), which shadows this repo's own `.claude/launch.json` when the preview tool resolves servers by name. First verification pass unknowingly ran against that stale build (explaining an unrelated, more-evolved docs-status implementation appearing under test). Caught via a disk-vs-served content mismatch, worked around by running `vite`/the API directly from this repo's directory instead of by server name. Worth fixing the global launch.json separately; not done here to keep this capsule scoped.

**Concurrency note:** a second session was concurrently working the audit's own priority list (P1 #4, SR Ride driver identity — became capsule 5, `f57ee77`), with in-flight changes to `server/routes/sr-rides.mjs`, `src/modules/sr/SrRidePage.tsx`, and a `driver.driverProfile` type addition inside the *same* `platformApi.ts` file this capsule also touched. First isolated this capsule's own `platformApi.ts` hunk into the index via a scoped patch (`git apply --cached`) so an early commit wouldn't sweep in their unrelated WIP. Before that commit happened, though, the other session staged and committed the whole working tree's state of `platformApi.ts` as part of `f57ee77` — which, since both hunks coexisted cleanly in the file at that point, picked up this capsule's `fetchDriverIdentityStatus()` addition too. Confirmed via `git show f57ee77 -- src/shared/api/platformApi.ts` that the function is present and correct there; nothing was lost, it just landed in their commit instead of this one. Re-verified `tsc --noEmit` clean afterward and left their commit as-is rather than trying to unwind or re-split it.

## What this round deliberately did NOT touch

- Did not build real license-expiry or insurance tracking (see "Investigation" above) — a separate, larger initiative if the owner wants it: new schema fields, an admin review step, a driver document-upload flow.
- Did not touch `DriverProfile` itself, still dead schema referenced by no backend route.
- Did not touch P1 #4 (SR Ride driver identity shown to riders) — a different, already in-progress finding on a different screen.
- Did not fix the global `~/.claude/launch.json` stale-checkout shadowing issue noted above.

---

Rejoins the audit's own priority order after this: P1 #4-7, then P2 #8-11 (see `sybnb-client-satisfaction-trust-audit.md`) — this finding was additive, discovered outside that list, not a substitute for it.
