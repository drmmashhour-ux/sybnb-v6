# SYBNB — Master Launch Checklist

**Runtime RC:** `e9dfd68` (63f9854 → e9fb4ff error-boundary + dep-CVE → e9dfd68 PaymentProof race fix; all verified below) · **Verdict:** CONDITIONAL GO · **Live payments:** disabled ·
**Legal docs:** DRAFT/launch-blocking. Status legend: **PASS** (done + evidence) ·
**BLOCKED-OWNER** (needs owner input/credentials) · **BLOCKED-COUNSEL** · **PENDING** (agent, gated on
a dependency). Re-verify all code gates with `bash scripts/run-all-e2e.sh`.

> **Independent re-audit 2026-08-14 (RC `e9dfd68`, docs ahead at `72a6d69`):** all 17 suites re-run
> green (0 failures); fresh empty-DB `migrate deploy` = 11 migrations + up-to-date + unique index
> present + cleanly dropped; backup→restore preserved exact row counts (85 users / 1013 listings /
> 100 payment_proofs / 274 wallet_entries) + 37 FKs + unique index; prior RC `e9fb4ff` builds clean
> (rollback **artifact** available — a deployed rollback drill is NOT yet done; it stays in the
> deployment gate, Section E); fail-closed prod start refuses (env_validation_failed, incl. storage-local);
> health/live+ready 200, security headers present, 404 JSON, rate-limit 20→429, **0 secret leaks in
> logs**, graceful `server_shutdown` on SIGTERM; prod build serves (200, root mount, hashed bundle);
> payment-race 4/4. **No new safe blocker found → candidate unchanged at `e9dfd68`.** Owner steps:
> `OWNER_ACTIONS.md`; command sheets: `GO_LIVE_RUNBOOK.md`.

## A. Application code & tests
| Gate | Status | Evidence |
|------|--------|----------|
| Build / typecheck | **PASS** | `tsc && vite build` clean |
| Schema valid | **PASS** | `prisma validate` |
| Migrations apply to fresh DB | **PASS** | `db:migrate:deploy` on disposable DB = up-to-date, 11 migrations, uuid, `provider_ref` unique index present, 26 tables (re-verified 2026-08-14) |
| 17 governed E2E suites | **PASS** | `scripts/run-all-e2e.sh` → 0 failures (marketplace 32, cars 38, buy 40, rentals 42, new-construction 42, sell 37, advertising 35, SR Ride green, wallet 38, otp 20, storage 23, legal 11, operations 14, payment 21, payment-race 4, storage-s3 6, sms 7) |
| Identity: server OTP + registration binding | **PASS** | `test:e2e:otp` 20/20 |
| No public DRIVER self-registration | **PASS** | otp suite; `auth.mjs` |
| Storage: real S3/SigV4 + no prod local-disk | **PASS** | `test:e2e:storage` 23/23, `test:e2e:storage-s3` 6/6 |
| SMS adapter (real endpoint) | **PASS** | `test:e2e:sms` 7/7 |
| Payments (sandbox): webhook/replay/idempotency/refund/reconciliation | **PASS** | `test:e2e:payment` 21/21 ×3 |
| PaymentProof duplicate-reference race | **PASS (remediated)** | DB UNIQUE(provider,provider_ref) + atomic P2002; `test:e2e:payment-race` 4/4 (8 concurrent → 1 created, 7 rejected) |
| Wallet/Gift authorization + IDOR closed | **PASS** | `test:e2e:wallet` 38/38 |
| Operations: logging/headers/limits/health/env-fails-closed | **PASS** | `test:e2e:operations` 14/14 |
| No committed secrets / live keys | **PASS** | secret scan clean |
| Dependency vulnerabilities | **PASS** | `npm audit` → 0 vulnerabilities (nanoid + postcss CVEs patched, lockfile-only) |
| Top-level error boundary (no blank-screen) | **PASS** | prod-build proof: throwing route → recovery UI, not blank; happy path unchanged |
| Backup + restore drill (local) | **PASS** | pg_dump→pg_restore to disposable DB: exact row counts + FKs + unique indexes intact |
| Unknown route handling | **PASS (P2)** | soft-falls back to Landing (no broken page); dedicated 404 page is a post-launch nicety |
| No schedulers/workers (expiry opportunistic-on-read) | **PASS** | documented design; a proactive cron is a post-launch P2 |

## A2. Release packaging (RC `e9dfd68`, packaged 2026-08-14) — see `RELEASE_MANIFEST.md`
| Gate | Status | Evidence |
|------|--------|----------|
| Reproducible source package | **PASS** | `git archive` of tree `16f11094b6150e71144d020d80e0c8caac3306eb`; identical SHA-256 across 2 runs (`849d1f9342aed5932bba469a0d77e2fa16e9b3b74544bf953319e6d1ee162fc9`) |
| Clean install + build from package | **PASS** | `npm ci` (0 vulns) + `npm run build` clean + `prisma validate` valid on the extracted tarball |
| Packaged-API runtime cert | **PASS** | fresh-DB migrate (11) + `health/live`+`ready` 200 + graceful `server_shutdown` + PaymentProof race 4/4, all against the packaged API |
| Deploy config templates (no secrets) | **PASS** | `templates/production.env.template`, `sybnb-api.service.template`, `Dockerfile.template` — placeholders only |
| Release checksums | **PASS** | source tarball + dist bundles + key runtime files digested in `RELEASE_MANIFEST.md` |
| Defaults held OFF | **PASS** | live payments (no `STRIPE_SECRET_KEY`), public access (DNS/edge), legal DRAFT — all off by default |

## B. Legal
| Gate | Status | Owner/Counsel action |
|------|--------|----------------------|
| Versioned consent architecture | **PASS** | `test:e2e:legal` 11/11 |
| Owner commercial decisions (entity/age/wallet/fees/currency/contacts) | **PASS** | recorded in `docs/legal/*` |
| Final Terms/Privacy content approved | **BLOCKED-COUNSEL** | send `COUNSEL_REVIEW_PACKAGE.md` to Québec counsel (Law 25 flagged) |
| Publish `DRAFT`→`PUBLISHED` | **PENDING** | agent, after counsel approval → wires versions, updates legal test |

## C. Owner inputs / accounts
| Gate | Status | Owner action |
|------|--------|--------------|
| Canadian advertising CAD price | **PASS** | CAD $50/week (recorded `cd1c150`) |
| Mailboxes support@/legal@/privacy@ | **BLOCKED-OWNER** | `MAILBOX_SETUP.md` |
| Vendor + region selection | **BLOCKED-OWNER** | `VENDOR_REGION_MATRIX.md` |

## D. Infrastructure & providers (real endpoints)
| Gate | Status | Blocker |
|------|--------|---------|
| Production Postgres provisioned + migrated | **BLOCKED-OWNER** | no prod DB credentials in this env; procedure in `PROVIDER_CERTIFICATION.md` §4 |
| S3 private bucket + IAM + versioning/retention | **BLOCKED-OWNER** | no bucket/keys; code path certified (mock); §1 |
| SMS provider sandbox certified vs real endpoint | **BLOCKED-OWNER** | no provider account; adapter certified (mock); §2 |
| Stripe TEST mode certified vs real endpoint | **BLOCKED-OWNER** | no Stripe keys; architecture certified (sandbox secret); §3 |
| Monitoring/log sink + alerting | **BLOCKED-OWNER** | destination not chosen; code emits redacted structured logs |
| Backup schedule + restore drill | **BLOCKED-OWNER** (procedure PASS) | needs a real DB; `OPERATIONS_RUNBOOK.md` |

## E. Deployment & go-live (reserved)
| Gate | Status | Note |
|------|--------|------|
| Controlled prod-like deploy (payments off) | **BLOCKED-OWNER** | no authenticated deploy target |
| Deployed desktop/mobile + API certification | **PENDING** | after deploy; against the deployed candidate |
| Rollback verification (deployed drill) | **PENDING** | after deploy — build-verified rollback **artifact** (`e9fb4ff`) exists, but restore-on-deployed-target is not yet exercised; part of this gate |
| Enable live payments | **RESERVED** | explicit owner authorization only |
| DNS / public cutover | **RESERVED** | explicit owner authorization only |

## Launch verdict
**CONDITIONAL GO.** All application-code gates PASS at `e9dfd68`. Remaining blockers are **owner
inputs / external accounts / counsel approval / the reserved go-live switches** — none are code
defects. Do not call SYBNB launch-ready until Section B (counsel + publish), C, D are green and the
deployed candidate passes Section E pre-cutover certification.
