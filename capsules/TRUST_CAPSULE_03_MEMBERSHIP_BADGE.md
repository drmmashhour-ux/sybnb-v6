# Trust Remediation — Capsule 3: Real Membership Verification Badge

**Source finding:** P0 #3 of `sybnb-client-satisfaction-trust-audit.md` (2026-08-26) — "STAYS 'Verified membership' badge shown to unverified accounts."
**Commit:** `b750814` on `candidate/satisfaction-remediation`
**Scope:** Frontend only. No backend route, schema, or money logic touched.
**Status: DONE — verified live, committed.**

---

## The problem

The dashboard header showed "Verified membership" (العضوية الموثقة) next to every guest's name, unconditionally — a static string with no tie to the guest's actual verification state. The audit confirmed this by creating a fresh account through the real signup flow, deliberately skipping ID verification (`idDocumentStatus: null` confirmed via API), and seeing the badge anyway. It directly contradicts the Trust Center's own honest copy ("Uploading an approved ID document increases how much hosts and buyers trust your account") — one screen says verification isn't automatic, another claims it already happened.

## Why this was a quick, low-risk fix

This exact problem was already solved correctly, elsewhere, in this same codebase: `HostDashboardPage.tsx` computes `isDocumentVerified = overview?.host.idDocumentStatus === 'APPROVED'` and `isDocumentPendingReview = ... === 'PENDING_REVIEW'`, then picks between "Verified host" / "Verification in review" / "Not verified yet". The guest dashboard just never got the equivalent logic. `overview.user.idDocumentStatus` was already present in the `/api/me/overview` response and typed in `PlatformOverview` — no backend change needed, purely a matter of reading data that was already there.

## The fix

`src/modules/dashboard/DashboardPage.tsx` now computes `isMembershipVerified` / `isMembershipPendingReview` off the real `overview.user.idDocumentStatus`, and renders one of three real states next to "SYBNB STAYS":

- **`APPROVED`** → "Verified membership" (the only state where this copy is now shown, and now it's true).
- **`PENDING_REVIEW`** → "Verification in review".
- **Anything else** (`null`, `REJECTED`, undefined) → a real, clickable **"Verify your identity"** link that navigates straight to `/trust-center/verification` — turning the removed false claim into an honest, actionable nudge instead of a plain deletion.

## A finding surfaced, not fixed here (kept out of scope deliberately)

While reading this area for the correct reference pattern, found the **same bug on the driver side**: `DriverDashboardPage.tsx` (~line 283) shows `"Verified identity: Verified"`, `"License: Valid"`, `"Car insurance: Expiring soon"` — all hardcoded ternaries, not real data. This wasn't part of the client-satisfaction audit's scope (guest-facing STAYS + SR Ride only), so it was **flagged as a separate background task** rather than fixed in this round, to keep this capsule narrowly scoped to what was actually audited. It's a real, confirmed bug worth its own round.

## Verification (live, not code review)

1. `npx tsc --noEmit` and `npm run build` (`tsc && vite build`) — both clean.
2. Registered a fresh, unverified guest via the real OTP → register flow.
3. Loaded the real dashboard — confirmed "SYBNB STAYS · وثّق هويتك" ("Verify your identity") renders as a real, focusable button (not the old static "Verified membership" text).
4. Clicked it — confirmed it navigates to the real ID Verification screen (`/#/trust-center/verification`).
5. Set `idDocumentStatus = 'PENDING_REVIEW'` via direct DB update, reloaded — confirmed "التوثيق قيد المراجعة" ("Verification in review").
6. Set `idDocumentStatus = 'APPROVED'`, reloaded — confirmed "العضوية الموثقة" ("Verified membership") — now a true claim.
7. Deleted the test fixture (wallet, roles, user, stray verification codes) from the local DB afterward.

## What this round deliberately did NOT touch

- The driver dashboard's equivalent bug — flagged separately (see above), not fixed here.
- Any other "Verified X" label elsewhere in the app (host/seller dashboards already appear to do this correctly per the reference pattern used here; not independently re-audited this round).

---

All 3 P0 findings from the audit are now done (capsules 1–3). Next up, per the audit's priority list: the P1 tier — no driver identity shown to SR Ride riders, no SOS access during a ride, STAYS pre-booking price omitting real fees, and the fabricated "Damascus" location fallback.
