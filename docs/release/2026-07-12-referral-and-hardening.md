# SYBNB V6 — Production Release: Referral Program & Hardening

**Release date:** 2026-07-12
**Deployment:** https://sybnb.app (Vercel project `sybnb-v80-export`)
**Database:** `sybnb-v6-fresh` (Neon), migration `013_referrals`
**Release state:** DEPLOYED AND INFRASTRUCTURE-VERIFIED — not yet BEHAVIOR VERIFIED. See
"Manual verification" below for what's still outstanding and the safe process for completing it.

```text
Deployment:                          COMPLETED
Infrastructure:                      VERIFIED
Production Functional Verification:  IN PROGRESS
Production Monitoring:               LIMITED (manual point-in-time snapshot only, no continuous alerting)
Final Release Certification:         PENDING
```

## What shipped

- Session revocation (F-02): `User.sessionVersion`, real `POST /api/auth/logout`, sessions
  invalidated on logout and password reset.
- Real Terms of Service / Privacy Policy content (replaced the "DRAFT — NOT FINAL" placeholder).
- Cancellation-fee timing fix: the "free cancellation until 3 days before check-in" copy is now
  actually enforced server-side (previously the flat $10 fee applied regardless of timing).
- ID-verification payment gate: `POST /api/payments/stripe/create-checkout-session` and
  `POST /api/payments/local-wallet-proof` now require `context.user.idDocumentRef` before
  accepting payment (previously UI-only, bypassable via direct API call).
- Gift-expiry enforcement: `POST /api/wallet/gifts/:id/claim` now checks `expiresAt` and marks
  expired gifts `EXPIRED` (previously never checked, gifts were claimable indefinitely).
- Referral program: every user gets a shareable code at signup; referee gets a $5 wallet credit
  immediately; referrer gets $10 once the referee's first payment of any kind (STR booking *or*
  seller/dealer/developer plan) is approved. Guarded against self-referral, duplicate rewards, and
  unknown codes.
- Admin Review page cleanup: removed fabricated AI confidence percentages (88/74/82/94/91%),
  a static "Risk Score: LOW" panel, hardcoded KPI stats ("24" bookings, "3" disputes) that didn't
  reflect real data, synthetic fallback payments injected into an empty queue, artificial money
  floors (held funds could never show below 124,000,000 SYP), and a hardcoded "Verified Host"
  badge/score. Replaced with real computed values, a real ID-verification status, and an honestly
  labeled rule-based checklist ("Automated checklist — not AI-generated").
- Fixed 8 other fabricated "AI Brain" claims found during the audit that preceded this release
  (fake payment-confirmation AI claim, fake location-sharing/30-minute-SLA claims on the SOS page,
  a fake "AI Brain review" label on a purely local-storage feature) — see commit history for the
  full list.

## Database migration

`013_referrals` — adds `users.referral_code` (unique, backfilled for existing rows) and the
`referrals` table (uuid PK/FKs matching `users.id`'s real column type, `referral_status` enum,
unique index on `referee_user_id`, index on `(referrer_user_id, status)`).

**A bug was caught and fixed before this ever reached production**: an earlier draft of this
migration typed the foreign key columns as `text`, which would have failed with a type-mismatch
error against the real `uuid`-typed `users.id` (production was provisioned via `migrate deploy`,
which uses native `uuid`, not the `text` that `db push` would infer from bare Prisma schema). This
was caught by first reproducing the exact failure on the local dev database, then fixing the
migration and re-verifying it from scratch: ran the full `001`→`013` migration chain against a new
disposable database, confirmed correct column types and working foreign keys via
`information_schema`/`pg_constraint`, then dropped the disposable database. Only the corrected
version was ever applied to production.

**Rollback**: no down-migration was written (this project's other 12 migrations don't have them
either). Rollback path is: revert to the prior Vercel deployment (`vercel rollback`, or redeploy
the previous git commit), and manually drop the `referrals` table + `users.referral_code` column
if the schema needs to revert too. Given `referral_code` is additive (new column, backfilled, no
existing data altered or removed) and `referrals` is a wholly new table, a rollback of the
*application code* alone (without touching the database) is safe — old code simply won't read the
new column/table.

## Independent verification performed against live production (2026-07-12)

Run directly against `sybnb.app` and the real production database, not just locally:

- Auth error paths: wrong password → `INVALID_CREDENTIALS`; invalid OTP → `INVALID_OR_EXPIRED_CODE`;
  logout without/with garbage token → `401`/`AUTH_REQUIRED`.
- `GET /api/admin/review-queue` requires auth → `401` unauthenticated.
- Database integrity (read-only queries): 0 users missing `referral_code`, 0 duplicate codes,
  0 orphaned `referrals` rows, both FKs present with correct `uuid` types, all 3 expected indexes
  present, 0 users with null `session_version`.
- Legal pages: fetched real rendered content from `sybnb.app/#/terms` and `/#/privacy`, confirmed
  real Terms/Privacy content is live (not the old draft placeholder).
- No `Set-Cookie` headers on the production response — confirms sessions are client-side
  (`sessionStorage`), not cookie-based, so no separate cookie policy applies.
- Vercel build log for the production deployment: clean build, 0 errors.

## Manual verification

The following are covered by 30 dedicated automated tests (all passing, run against the exact
code now deployed) but have **not yet** been exercised against the live production database.
Closing this gap requires a human to actually log in and click through the real site — it cannot
be completed from this side, and it must **not** be attempted by pasting a production OTP into
this (or any) AI chat.

**Safe verification process:**

1. Claude triggers a real OTP send to `info@sybnb.app` (already done for this release — see
   below).
2. The account owner personally enters the code on the live SYBNB login page. The code itself is
   never shared with, pasted into, or requested by Claude — an OTP is a credential-equivalent and
   grants real account access for its validity window.
3. The account owner completes the checks below while signed in.
4. The account owner reports back only the visible results (pass/fail per item, and/or
   screenshots) — never the OTP.
5. Claude records the verified results in this document and updates the release state.

Using a dedicated, minimal-permission production test account instead of the main `info@sybnb.app`
administrator account is a safer option for this and future manual verification passes, and is
recommended going forward.

**Important:** do not insert fake paid records directly into production merely to make the
referral flow pass end to end. That would contaminate financial and audit data. If a real
qualifying payment isn't available to test against, use the smallest safe real transaction or a
payment-provider-approved test method, and say so explicitly in the results rather than
fabricating a passing record.

**Verification activity record:**

```text
Manual production verification initiated.
Authentication method:      Password + OTP
Verification performed by:  Authorized administrator
Verification status:        PENDING
```

(Deliberately not recorded here: OTP codes, or any other transient authentication detail — the
release record documents verification activity and outcomes, not credential events.)

**Verification results** (fill in as each check is completed — PASS / FAIL / N/A):

| Check | Result |
| --- | --- |
| Staff login (password + OTP) | |
| Session revocation on logout | |
| Referral code creation + attribution | |
| Referral reward on first qualifying paid conversion | |
| Duplicate reward prevention | |
| Self-referral blocked | |
| Gift expiry enforced | |
| ID-verification payment gate | |
| Cancellation fee (waived / charged correctly by timing) | |
| Legal pages (Terms / Privacy) render real content | |
| Admin Review page shows real database values | |
| Unauthorized access denied | |

For any `FAIL`, record separately: what was expected, what actually happened, a screenshot or
other evidence reference, an issue ID, and whether production remediation is required.

**Final release state:** to be recorded here once verification results are reported back —
one of `BEHAVIOR VERIFIED — STABLE PRODUCTION RELEASE`, `BEHAVIOR VERIFIED WITH DOCUMENTED
CONDITIONS`, or `PRODUCTION REMEDIATION REQUIRED`. Until then the status block above
(`Production Functional Verification: IN PROGRESS`, `Final Release Certification: PENDING`)
stands.

## Production observation

No continuous monitoring is in place from this side — there is no automated alerting, and log
tailing here is a manual, point-in-time snapshot, not a 24–72h watch. A single snapshot of Vercel
runtime logs was taken at deploy time; no entries were visible in an ~8-second capture window
(consistent with genuinely low traffic on a fresh launch, not evidence of "no errors" over any
longer window). Recommend checking the Vercel dashboard's own log/error-rate view directly for
real monitoring over the next 24–72 hours, since that has actual continuous visibility this
session does not.

## Known Limitations

- Continuous production monitoring is performed through the Vercel dashboard and Neon's own
  tooling, not from this development session — no automated alerting is wired up from this side.
- End-to-end production behavior (referral attribution, reward issuance, gift expiry, ID-gate
  enforcement, cancellation-fee timing, Admin Review data) depends on the manual verification
  pass described above; automated tests cover the same code but not the live production database.
- Payment-provider behavior is verified only through authorized production testing using real or
  provider-approved test transactions — never fabricated records.

## Test suite at release time

175/175 tests passing (66 unit + 90 API + 19 security), `npx tsc --noEmit` clean.

## Production Release Decision

```text
Decision ID:            PRD-2026-07-12-001

Outcome:
  [ ] Released
  [ ] Released with Conditions
  [ ] Rollback Required

Decision Date:
Verified By:
Approved By:
Evidence References:    Independent verification (above), Verification results table (above)
Notes:
```

To be completed once manual verification results are recorded and a final release state is
determined. No further edits to this document should precede that evidence — subsequent changes
should be limited to recording PASS/FAIL results, remediation notes, and this decision block.
