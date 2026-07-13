# SYBNB V6 — Production Remediation: Landing Page Truthfulness

**Date:** 2026-07-12
**Deployment:** https://sybnb.app (Vercel project `sybnb-v80-export`)
**Type:** Frontend-only remediation, no schema/backend change
**Relationship:** Linked remediation to [`2026-07-12-referral-and-hardening.md`](./2026-07-12-referral-and-hardening.md).
That release record is locked and is **not** modified by this document. This is a separate,
narrow, independently-authorized production change discovered during a non-authenticated public
sanity check of the already-deployed referral-and-hardening release.

## Issue

The public landing page (`sybnb.app`, no login required) displayed three fabricated statistics
presented as real platform metrics:

- `12,450+` "Registered properties" (`عقارات مسجلة`)
- `85K+` "Active users" (`مستخدمون نشطون`)
- A "Covered areas" (`مناطق مغطاة`) count computed as the number of active platform
  divisions/categories plus a fixed `+6`, i.e. also not a real geographic-coverage figure

All three were literal hardcoded values / a value derived from an unrelated internal count, not
computed from real database state. This directly contradicted the referral-and-hardening release
record's own independently-verified fact that production held exactly 1 user and 0
bookings/payments at release time — the same category of fabricated-metric issue that release was
built to eliminate elsewhere in the app, just not caught there because that audit scoped
admin/host-facing surfaces, not the public marketing landing page.

## Scope

Frontend-only removal of the three misleading statistics and their containing section. No
replacement metric was invented — consistent with this engagement's standing rule (see the `C1`
precedent in the guest-facing-offers plan: when no real backing data exists for a claim, remove
it rather than fabricate a substitute).

## Files changed

- `src/modules/landing/LandingPage.tsx` — removed the `<section className="landing-stats">` block
  (three `<div>` stat entries) and the now-unused `activeCount` variable that fed one of them.

No other file was touched as part of this remediation.

## Validation

- `npx tsc --noEmit` — clean, no errors.
- Vercel production build — succeeded (`Build Completed in /vercel/output`, deployment
  `dpl_DtTBLjZGuhUezAR6Qy4nrdZxyK42`, `readyState: READY`).
- Live homepage re-fetched from `sybnb.app` post-deploy: fake stats section confirmed absent,
  rest of homepage content unaffected, no console errors.
- Local dev server (`127.0.0.1:5180`) checked pre-deploy as an additional confirmation step: same
  result.

## Deployment

Direct Vercel production deployment (`vercel --prod --yes`) run from the local working tree,
aliased to `sybnb.app`. Not triggered via git push / CI — this project deploys via the Vercel CLI
directly from the working directory, the same mechanism used for the referral-and-hardening
release.

## Database

No change. No migration. This remediation touches frontend presentation only.

## Git status at time of deployment

The working tree was uncommitted at the time this fix was deployed — not only for this change,
but pre-existing: the entire referral-and-hardening release (session revocation, referral system,
legal pages, cancellation-fee fix, ID-verification gate, gift-expiry fix, admin review cleanup,
and related fixes) was already live in production from an earlier deployment in this same
uncommitted working tree. This remediation's deploy therefore re-shipped that already-live code
unchanged, plus this one isolated fix.

This has since been corrected — see "Git traceability" below.

## Git traceability

Two deliberate commits were created on `security/sybnb-v6-predeployment` after the fact, matching
the working tree exactly as it stood when deployed (no functional changes made during the commit
step, no redeploy performed to create them):

- `b6fd5c1` — "Ship referral program, session revocation, and pre-deploy hardening": every file
  belonging to the referral-and-hardening release (everything documented in
  `2026-07-12-referral-and-hardening.md`), which was already live in production before this
  remediation.
- `69b30de` — "Remove fabricated landing-page metrics": `src/modules/landing/LandingPage.tsx`
  plus this document. Isolated so the remediation has its own traceable commit distinct from the
  larger release.

Not included in either commit: `.claude/launch.json` (local dev-server tooling config, not part
of the deployed application, contains no secrets — Vercel port config only). `.vercel/` was
already gitignored and untracked.

Production (`sybnb.app`) now corresponds exactly to commit `69b30de`. No push has been made — the
branch remains local-only ahead of `origin/security/sybnb-v6-predeployment` until separately
authorized.

## Process-deviation check

Explicit owner authorization was obtained **before** this specific production deployment: the
owner was asked directly ("Deploy this landing-page fix to production now, or hold it?") and
selected "Deploy now, separately" prior to the `vercel --prod` command being run. This was not a
deviation from the deployment-control rule — approval preceded the action, in the same session,
in direct response to an explicit question.

## Production status (unchanged by this remediation)

```text
Deployment:                          COMPLETE
Infrastructure:                      VERIFIED
Public pages:                        VERIFIED
Authenticated functional verification: PENDING
Final production certification:      PENDING
```

This remediation closes the public-facing truthfulness gap found during sanity-checking. It does
not substitute for, and has no bearing on, the authenticated manual verification checklist still
pending against the referral-and-hardening release.
