# SYBNB V6 — Pre-Deployment Readiness Report

Date: 2026-07-10. Branch: `security/sybnb-v6-predeployment` (not merged to `main`). This report
closes out the "SYBNB V6 — Security Hardening and Automated Test Foundation" order. It does not
authorize deployment; see Recommendation at the end.

**Update 2026-07-12 — F-01 resolved, plus a related bug found and fixed in the same pass.**
Password reset is now real: `POST /api/auth/password-reset` requires a real email-OTP
verification (`purpose='password-reset'`) via the existing `/api/auth/email-code/send|verify`
endpoints before it will change a password, and never reveals whether an email matches an
account. Reused the existing `EmailVerificationCode` infrastructure (no new vendor/cost). While
building this, found that staff sign-in (admin/host/driver, `StaffAccessPage.tsx`) had a
verification-code UI that was **entirely client-side and never checked by the server at all**
(`src/engines/security/verificationCodeEngine.ts`, now deleted) — it looked like 2FA but provided
zero real protection. Fixed by gating `/api/auth/login` (and HOST/DRIVER self-registration) on the
same real email-OTP mechanism, purpose='staff-login'. Verified live: wrong/no-OTP login now
returns `403 STAFF_OTP_REQUIRED`; correct OTP + password succeeds; old password is rejected after
reset. All 155 existing automated tests (66 unit + 70 API + 19 security) still pass; the 4 test
files that registered HOST/DRIVER accounts directly were updated to verify email first, matching
the new real requirement. F-02 (session revocation) remains open.

**Update 2026-07-12 — F-02 resolved.** Added `User.sessionVersion` (migration `012_session_version`,
default `0`), embedded as an `sv` claim in every session token (`createSessionToken`) and checked
against the live DB value on every request (`getAuthContext`) — a mismatch is treated as an
expired session even though the token's own signature and `exp` are still valid, since a stateless
HMAC-signed token has no other revocation mechanism before its 7-day TTL. Added a real
`POST /api/auth/logout` (bumps `sessionVersion`, requires auth) and wired the client's
`clearGuestSession`/`clearStoredStaffSession` to call it (best-effort — the local session clears
regardless of whether the network call succeeds). `POST /api/auth/password-reset` now also bumps
`sessionVersion`, so a stolen session token is invalidated the moment the legitimate owner resets
their password, not just on its own expiry. Revocation is coarse-grained (revokes every session for
the user, not a single device/token) — a dedicated `Session` table would be needed for per-device
revocation, judged unnecessary for this launch's scale. All 161 tests pass (66 unit + 76 API + 19
security, including 6 new logout/revocation tests); `npx tsc --noEmit` clean.

**Update 2026-07-12 — Pre-deployment audit sweep: 4 real UI/backend mismatches found and fixed,
migration fidelity re-verified.** Requested explicitly before any production deploy of the F-02
work above. Findings, in order of severity:

1. **ID verification bypass (highest severity).** `BookingDetailPage.tsx` hides the payment button
   behind `hasIdDocument = Boolean(booking?.guest?.idDocumentRef)`, but neither
   `/api/payments/stripe/create-checkout-session` nor `/api/payments/local-wallet-proof`
   (`server/routes/payments.mjs`) checked this server-side — any authenticated guest could pay via
   a direct API call without ever uploading an ID. Fixed: both endpoints now call
   `requireIdDocumentUploaded(context.user)`, mirroring the exact client-side condition (upload
   required, not yet-reviewed status — review still happens async via the admin queue, unchanged).
2. **Cancellation-fee timing mismatch.** Covered in a separate pass just before this one — the
   guest-facing "free cancellation until 3 days before check-in" copy was never enforced by
   `server/routes/bookings.mjs`, which charged the flat $10 fee regardless of timing. Fixed:
   `isWithinFreeCancellationWindow()` now gates the fee on the actual check-in date.
3. **Gift expiry never enforced.** `WalletGift.expiresAt` was always shown to senders/admins (and
   the frontend has a dedicated "expired" error state), but `server/routes/wallet.mjs`'s claim
   endpoint never checked it — a gift could be claimed indefinitely past its displayed expiration.
   Fixed with the same lazy-expire-on-access pattern already used by
   `completeExpiredBookings()`/`expireOldListings()` elsewhere in this codebase.
4. **Dispute-window copy overstated an SLA.** `BookingDetailPage.tsx`'s guarantee row promised
   "dispute support available within 48 hours" — a support-responsiveness claim with no tracking
   or enforcement anywhere. Softened to "you can open a dispute at any time and the SYBNB team will
   review it" rather than building unrelated SLA-tracking infrastructure for a marketing line.

**Also found, judged not to need a code change:** `GET /api/wallet/gifts/:id` (gift preview, used
by a recipient who hasn't claimed yet and may not have an account tied to the gift) requires only
`requireAuth(context)` with no sender/recipient ownership check. This looks like an IDOR at first
read, but the gift's UUID is the actual capability/credential in this flow (same pattern as a
gift-card claim link) — a real recipient's `recipientUserId` isn't set until after claiming, so
requiring ownership would break the legitimate preview-before-claim flow for first-time recipients.
Left as-is; flagged here rather than silently fixed or silently ignored.

**Re-verified clean, no changes needed:**
- **Migration fidelity**, including the new `012_session_version` migration: disposable-database
  diff against `schema.prisma` shows zero drift across all 12 migrations (only the expected
  pre-existing, non-blocking physical-fidelity notes from the original assessment — `id` column
  type and GiST index declarations that `db push` doesn't reproduce from bare `schema.prisma`,
  unrelated to migration correctness).
- **Route/auth coverage**: every mutating endpoint across all 13 route files requires auth with
  correctly-scoped roles and ownership checks; no missing `requireAuth`, no bare `where: { id }`
  lookups on sensitive data.
- **Instant Book, commission percentages (10% STR / 5% marketplace), host payout timing (14-day
  hold)**: all confirmed to match between displayed copy and actual enforcement.
- **Environment/deployment config**: every `process.env.*` the server reads is documented in
  `.env.example` with consistent naming; `vercel.json`'s function/rewrite config is internally
  consistent; `TRUST_PROXY` gating is correctly implemented (no spoofable-header trust without it).

All 168 tests pass (66 unit + 83 API + 19 security, including 5 new tests for the ID-verification
and gift-expiry fixes); `npx tsc --noEmit` clean.

## Code readiness

- TypeScript: clean (`npx tsc --noEmit`, 0 errors).
- Production build: succeeds (`npx vite build`).
- No lint tooling is configured in this repo; not introduced this phase.
- Working tree on this branch contains only files touched by this order's scope — verified via
  `git status --short` against the branch's own history (see `SYBNB_V6_RELEASE_GATE.md`).

## Security readiness

Full detail in `SYBNB_V6_SECURITY_AUDIT_2026_07_10.md` and `SYBNB_V6_THREAT_MODEL.md`. Summary:

- **Repaired this phase:** no rate limiting (F-08/F-04), zero security headers (F-13), CORS
  fallback-to-first-origin (F-14), overly-permissive error exposure (F-15), no `.env.example`
  (F-16), login timing side-channel (F-03), a malformed-token 500 discovered while writing tests
  (F-18), no production-config validation, narrow input validation on the two highest-risk
  unauthenticated endpoints (F-09, partial).
- **Explicitly deferred, flagged for an owner decision (not silently implemented):**
  - **F-01 — no password-reset flow.** Needs a delivery-channel decision (SMS/WhatsApp/email) with
    real cost implications for the Syria-specific context. Not blocking for continued
    internal/controlled testing; recommended before public launch.
  - **F-02 — no server-side session revocation/logout.** Needs a small auth-data-model addition
    (`sessionVersion`); flagged rather than implemented per this order's explicit caution around
    touching authentication architecture. Same launch-blocking posture as F-01.
  - **F-11/F-12 — no malware scanning, no document-retention policy.** Infrastructure/policy
    decisions, not code defects.
- **Known, accepted limitation:** the rate limiter is single-instance (in-memory). Fine for the
  current single-process deployment; a multi-instance production deployment needs a shared store
  first (see `SYBNB_V6_RATE_LIMIT_POLICY.md`).
- **Sessions remain in `sessionStorage`** (not migrated to httpOnly cookies) — F-06 in the threat
  model. Explicitly not changed this phase per the order's instruction. A real frontend-origin CSP
  now provides partial containment (corrected in a later pass — the original API-only CSP did not
  protect the frontend at all; see `docs/security/SYBNB_V6_FRONTEND_CSP_PLAN.md`), but
  `frame-ancestors` still isn't enforceable via the current `<meta>`-tag delivery mechanism
  (EXTERNAL INFRASTRUCTURE REQUIRED once a production static host exists). This is the largest
  remaining architectural item and needs its own dedicated, reviewed effort, not a rushed fix
  folded into this phase.
- No secrets found in this phase's diff or in the full git-history scan performed during the audit
  (see `SYBNB_V6_SECURITY_AUDIT_2026_07_10.md` §"Secrets/config").

## Test readiness

**Updated (same-day follow-up pass):** 114 Vitest tests across 12 files (unit/API/security/guard),
16 smoke checks, and a new repository-owned Playwright suite (15 checks × 2 browser projects), all
running against a genuinely isolated `sybnb_v6_test` database — never the development database. An
earlier version of this suite (93 tests) was found to run against the shared development database;
that gap is now closed with a fail-closed application-level guard, not just a config change — see
`docs/testing/SYBNB_V6_TEST_DATABASE_SETUP.md` for the full design and
`docs/review/SYBNB_V6_SECURITY_BRANCH_REVIEW.md` for the proof (development database confirmed
byte-identical, MD5-verified, across two full suite runs). See `SYBNB_V6_TEST_STRATEGY.md` for the
coverage map and `SYBNB_V6_RELEASE_GATE.md` for the full gate-by-gate run.

## Infrastructure readiness

- Single-process Node HTTP server, no process manager/orchestration configured in this repo.
- Rate limiting and session storage are both single-instance-only by current design — horizontal
  scaling is not yet supported without further work (shared rate-limit store; session model).
- `validateProductionConfig()` fails startup loudly if `NODE_ENV=production` is set without a
  strong `AUTH_SECRET`/`PHONE_HASH_SECRET`, an explicit `DATABASE_URL`, an explicit `CORS_ORIGIN`,
  and rate limiting enabled — this is a real safety net, but it has never been exercised against an
  actual production environment (no such environment exists yet for this project).
- No CI pipeline was found or added — `npm run test:ci` exists and passes locally but is not yet
  wired into any automated pipeline that runs on every push/PR.

## Legal-content readiness

Unchanged from before this phase — legal pages still carry the `"DRAFT — NOT FINAL"` /
`"مسودة — غير نهائية"` badge (`src/modules/legal/LegalPlaceholderPage.tsx`), per the standing
instruction from earlier in this engagement not to publish draft legal content as final. **Not
ready** — this is a business/legal decision outside this order's scope, not a code gap.

## Payment readiness

No live payment provider is wired into this environment. The manual admin-review path
(guest-submitted payment proof → admin approve/reject → wallet ledger entries) is real, tested,
and race-condition-guarded, but there is no Stripe/PSP integration live. **Not ready** for a
deployment that expects automated payment processing; the current manual-review model is a
deliberate, working design for the current stage, not a placeholder.

## Deployment readiness

**Not ready.** This phase explicitly did not authorize deployment, and several items above
(password reset, session revocation, session-storage/XSS containment posture, no CI pipeline, no
live payment provider, draft legal content) are launch-relevant even though none of them are code
defects introduced or missed by this phase — they are pre-existing, known, and now formally
documented gaps.

## Recommendation

**READY FOR INDEPENDENT REVIEW** (unchanged classification; substance strengthened).

*(Updated 2026-07-11: PR #1 was independently reviewed and returned REQUEST CHANGES with 8
findings — all 8 addressed on this same branch; see the "Round 2" section of
`docs/review/SYBNB_V6_SECURITY_BRANCH_REVIEW.md` for the full list and what changed. Two real bugs
were found and fixed in the process — a login email-normalization bug (F-19) and a
`TRUST_PROXY`-read-at-import-time bug (F-20) — neither was a security bypass, both are now
verified fixed with regression tests. The previously-known 320px responsive-overflow bug is now
**fixed**, not just documented (Chromium: 21/21, zero unexplained failures). The frontend CSP
overclaim in this and other docs has been corrected, and a real (if partial) frontend CSP now
exists — see `docs/security/SYBNB_V6_FRONTEND_CSP_PLAN.md`.)*

All work for both review rounds is complete: 175 automated tests (114 Vitest + a 21-check
Playwright suite on Chromium, all passing with zero unexplained failures, plus 19/21 on WebKit —
the 2 remaining are a documented, genuine WebKit/Safari platform default, not an app bug) + 16
smoke checks, all against a genuinely isolated test database, proven twice consecutively with
identical results and an unchanged development database (MD5-verified). Build/types/schema/audit
all clean, `main` untouched, everything committed to `security/sybnb-v6-predeployment` (not
merged), no destructive or unauthorized actions taken against the development database or LECIPM.

It is **not** recommended to jump directly to READY TO MERGE or READY FOR STAGING without: an
explicit decision on F-01/F-02 (password reset, session revocation — deferred, launch-relevant);
the legal/payment items (product decisions this phase deliberately did not make unilaterally).

**Update 2026-07-12:** the migration-fidelity gap is now closed — see the RESOLVED note at the top
of `docs/testing/SYBNB_V6_MIGRATION_FIDELITY_ASSESSMENT.md`. `prisma migrate deploy` can now
bootstrap a correct, complete fresh production/staging database.
