# SYBNB Client Satisfaction / Trust Audit — Full Platform Report
**Date:** 2026-08-27 · **Branch:** `candidate/satisfaction-remediation` · **Repo:** `/Users/mohamedalmashhour/sybnb-v6`

## Why this report exists

Owner's mandate (2026-08-26): *"ok, when you have 10/10 in all actions, run the client satisfaction report — should be no gap everywhere, no fake section, i want it real work 100%."*

After closing all 17 gaps + 2 out-of-scope items from the earlier SR Ride vs. Uber benchmark (31 capsules), this report covers the **whole platform**, not just SR Ride. Five independent audits ran in parallel, each with no context from the others and no access to my own prior "it's done" claims — each was told to be skeptical, verify everything live (real signup, real OTP, real browser clicks, real curl/psql), and report what's actually true, not what the code comments claim.

This is the report the owner asked for. It is honest about what's still broken.

## Methodology (every division)

- Real backend + frontend started fresh on a dedicated port pair, against real Postgres (`sybnb_v6`).
- A genuine account created through the actual signup → email OTP flow (not a synthetic session token).
- Every claim verified against either a live browser click-through, a live curl/API call, or a direct `psql` read — never against "the code looks like it should work."
- Test fixtures deleted afterward; server processes killed by exact PID/port.

## Scorecard

| Area | Trust | Ease | Overall | Status |
|---|---|---|---|---|
| SR Ride | — | — | — | 31/31 benchmark gaps closed; 3 real bugs found by re-audit, **all 3 fixed** |
| STAYS (regression check) | 6/10 → fixed | 8/10 | 6.5/10 → fixed | 7/7 prior fixes hold; 2 new P0s found, **both fixed** |
| RENTALS / BUY (first audit) | 3/10 | 6/10 | 4/10 | 4 P0s found, **3 fixed**, 1 deferred |
| CARS / MARKETPLACE / NEW_CONSTRUCTION (first audit) | 4/4/5 | 4/3/5 | 4/3.5/5 | Most severe platform finding **fixed**; several P1s open |
| Platform-wide (auth/payments/launch-readiness) | — | — | — | **Clean** — no findings |

---

## 1. SR Ride — re-audit after the 31-capsule benchmark arc

An independent agent re-drove the entire SR Ride flow with fresh eyes, explicitly told not to trust my own prior "verified live" claims. It found **3 real bugs** my own capsule-by-capsule testing had missed — including a crash on the single most common action in the whole division.

| Bug | Severity | Root cause | Fix |
|---|---|---|---|
| Ride-request submission crashed the whole app | **P0** | `POST /api/sr/rides` returned a relation-less raw Prisma object; `ride?.stops.map(...)` only guarded `ride`, not `ride.stops` | Server response now matches `GET /api/sr/rides/:id`'s shape; defensive guards added at 4 other call sites |
| A malformed VAPID key crashed the entire Node process, not just push | P1 | `webpush.setVapidDetails()` throws synchronously; called fire-and-forget with no `await`/`.catch()` | Wrapped in try/catch, treated as "push disabled" |
| First-time signups from `/ride` got stranded on the account gate | P1 | `window.location.hash = returnPath` is a no-op when already equal to the current hash | Dispatches the same `sybnb-session-changed` event `StaffAccessPage.tsx` already used |

**Fixed, live-verified, committed:** `ab0345a`.

**Lesson worth keeping:** my own live-verification (real signup + OTP + browser clicks, the same discipline every capsule this arc used) still missed a crash on the most-used action in the flow. An independent re-audit with no attachment to "this should already work" is what caught it. This is why this report exists — self-grading has a blind spot a second set of eyes doesn't.

---

## 2. STAYS — regression check

All 7 previously-fixed trust issues (dispute-status honesty, verified-membership badge, fee-inclusive pricing, no fabricated location fallback, correct trip-state splitting, honest "no photos yet" badge, RTL mobile layout) were re-verified live and **still hold, zero regressions**.

Two new P0s surfaced:

| Bug | Root cause | Fix |
|---|---|---|
| Trip dates off by exactly one calendar day for any viewer west of UTC | `toLocaleDateString(...)` with no `timeZone` option, applied to a midnight-UTC timestamp, in 3 files (`DashboardPage.tsx`, `TrustProtectionRoutes.tsx`, `HostEarningsPage.tsx`) | Added `timeZone: 'UTC'` at all 3 sites |
| Admin payout screen showed "Verified host" unconditionally for every host | Backend query for this view didn't even select `idDocumentStatus` | Server now selects it; frontend derives a real 3-state label (verified / in review / not yet verified), same pattern as the guest membership badge |

**Fixed, live-verified (including a real 3-state API check via a freshly-registered admin account), committed:** `f3725bc`.

---

## 3. RENTALS / BUY — first-ever audit of these divisions

Never audited this way before. Scored **3/10 trust, 4/10 overall** for both divisions (they share one component). Four P0s found.

| Finding | Fixed? |
|---|---|
| **P0-1:** A real `<PaymentCapsule>` component — reused verbatim from STAYS' real-money wallet flow — showed "Ready to pay," a fabricated "payment code" (`RENTAL-CAPSULE`), and the guest's ID documents relabeled "payment proofs," for a division with **zero in-app payment mechanism** (commission/contact-based only) | ✅ Replaced with an honest 3-step status list; real message id used as the reference, not a fabricated code |
| **P0-2:** Document upload captured only the file's *name* — no bytes ever uploaded, despite a real-looking upload UI and instructions buried in text the guest never saw | ✅ Wired to the same real `uploadPaymentProofFile()` path already proven working elsewhere in the codebase |
| **P0-3:** Every RENTALS/BUY listing's public photo is a hardcoded per-division stock image — real seller-uploaded photos are silently discarded | ❌ **Not fixed.** This is a shared-component change (`SellerListingWizard.tsx`) affecting every division's listing creation, including already-verified STAYS. Needs its own careful pass, not a rushed fix. |
| **P0-4:** "Verified host" and "Sham Cash" filters pre-selected with a checkmark, implying an active filter, while doing nothing (only propertyType/price/bedrooms/bathrooms reach the backend) | ✅ `payments` filter group removed entirely (mirrors the SR Ride precedent — RENTALS/BUY structurally can't have one); pre-selected trust/amenity filters now default unselected |

**3 of 4 fixed, live-verified end-to-end (real signup, real file upload confirmed via a real `POST /api/payments/proof-upload` → real storage URL, real inquiry message containing that URL), committed:** `a03e12b`.

---

## 4. CARS / MARKETPLACE / NEW_CONSTRUCTION — first-ever audit

Scored 4/4/5 trust across the three divisions. This audit's own words: **"the single most severe finding across the entire platform-wide audit."**

| Finding | Severity | Fixed? |
|---|---|---|
| Every explicit, filtered search on CARS or MARKETPLACE returned **zero results**, with the UI blaming the user's filter choices | **P0** | ✅ `bedroomsMin`/`bathroomsMin` were sent unconditionally for every division even though CARS/MARKETPLACE listings have no such metadata at all. Now gated to the divisions that actually carry it. |
| 6 of 8 filter groups per division are decorative — selectable, checkmarked, shown in the search summary, never reach the backend (MARKETPLACE's own product-category filter included) | P1 | ❌ Not fixed |
| No numeric price input exists anywhere in the UI, platform-wide — only decorative price-band chips | P1 | ❌ Not fixed |
| Homepage "Featured ads" marquee is fully hardcoded filler with a live "Book your ad" CTA implying real purchased placements | P1 | ❌ Not fixed |
| English listing descriptions collapse to identical generic boilerplate for every listing when the seller wrote Arabic only | P1 | ❌ Not fixed |

**The P0 (broken search) fixed, live-verified via curl repro + a real browser click-through, committed:** `c65233b`.

**Separately found while verifying this fix (not in the original audit):** the search bar defaults every division to a hidden `city=Damascus` filter nobody chose. Verified via `psql` that only 1 of 633 CARS listings has any location data at all, so this independently starves CARS/MARKETPLACE results on top of the bedroomsMin bug. Flagged for a separate session (touches a default shared with already-verified STAYS/SR-Ride search) — **another session appears to be actively fixing this now** (uncommitted `locationTouched` changes observed in the working tree as of this report).

---

## 5. Platform-wide — auth, payments, launch-readiness

**No findings.** This is the one clean area.

- Every sensitive endpoint tested (wallet, admin review-queue, payouts, payment proof, saved places, ID-document files, bookings, Stripe checkout) correctly returned `401 AUTH_REQUIRED` with zero token. Public listing browse correctly stays open.
- The payment-policy-enforcement static audit passed 122/122 — every money-moving route has an enforced policy check, including through wrapper functions, aliased imports, and computed dispatch (which fails closed).
- Wallet debits are race-safe (atomic guarded updates, no TOCTOU window), idempotency-keyed, and every commission split is derived from the real server-trusted paid amount — never from unvalidated seller-supplied metadata.
- The "backend live-unauthenticated / publicAccess has zero code gate" item from an earlier memory note was checked directly: `publicAccess` doesn't exist anywhere in application code — it's a Vercel infra setting, not a code gate, and every code-level route is independently gated regardless of that infra flag.
- One minor naming-only observation: the admin "AI Brain" advisory panel is honestly disclosed as advisory-only with no fabricated numbers (a previous fake "74/82/88/91/94% confidence" score was already removed), but the "AI Brain" branding itself could still read as overclaiming for what is plain conditional logic. Not scored as a gap.

---

## What's still open (in descending severity)

1. **RENTALS/BUY P0-3** — hardcoded stock photos discard real seller-uploaded property images, platform-wide (touches `SellerListingWizard.tsx`, shared by every division).
2. **CARS/MARKETPLACE/NEW_CONSTRUCTION P1s** — 6 of 8 filter groups decorative, no price input anywhere, fake "Featured ads" marquee, generic English descriptions.
3. **The `city=Damascus` default-filter bug** — likely being fixed by a concurrent session; verify it lands before considering CARS/MARKETPLACE search fully healthy.
4. **RENTALS/BUY P1s (from the original audit, not yet actioned):** the date filter is entirely cosmetic; there are two inconsistent request flows for the same listing with different requirements/behavior.
5. **STAYS "In trip" badge** doesn't distinguish "booked, not yet arrived" from "guest has actually arrived" — contradicts the stepper directly below it on the same screen (P1, from the STAYS re-audit, not yet actioned).

## What's genuinely solid, confirmed live (not assumed)

- Auth/payment gating platform-wide.
- SR Ride's full 31-capsule benchmark arc (live map, driver photo, trip-sharing, in-app contact, payment, cancellation policy, push notifications, business accounts, ride-pooling, and more).
- STAYS' full guest lifecycle: signup → booking → payment-gate → dispute → resolution, all real, no client-side shortcuts.
- RENTALS/BUY's inquiry flow is now honest end-to-end: no fake payment step, real file uploads, real reference numbers.
- The "no fake trust signal" discipline is real and self-enforcing in places (SR Ride's payments-filter omission was the actual precedent used to fix RENTALS/BUY's fake payment filter this session).

## Commits

- `ab0345a` — SR Ride: 3 bugs fixed
- `f3725bc` — STAYS: 2 bugs fixed
- `c65233b` — CARS/MARKETPLACE: search P0 fixed
- `a03e12b` — RENTALS/BUY: 3 of 4 P0s fixed
