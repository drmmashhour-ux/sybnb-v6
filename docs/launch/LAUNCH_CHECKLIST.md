# SYBNB — Master Launch Checklist

**Runtime RC:** `63f9854` (frozen) · **Verdict:** CONDITIONAL GO · **Live payments:** disabled ·
**Legal docs:** DRAFT/launch-blocking. Status legend: **PASS** (done + evidence) ·
**BLOCKED-OWNER** (needs owner input/credentials) · **BLOCKED-COUNSEL** · **PENDING** (agent, gated on
a dependency). Re-verify all code gates with `bash scripts/run-all-e2e.sh`.

## A. Application code & tests
| Gate | Status | Evidence |
|------|--------|----------|
| Build / typecheck | **PASS** | `tsc && vite build` clean |
| Schema valid | **PASS** | `prisma validate` |
| Migrations apply to fresh DB | **PASS** | `db:migrate:deploy` on disposable DB = up-to-date, 10 migrations, uuid |
| 16 governed E2E suites | **PASS** | `scripts/run-all-e2e.sh` → 0 failures (marketplace 32, cars 38, buy 40, rentals 42, new-construction 42, sell 37, advertising 35, SR Ride green, wallet 38, otp 20, storage 23, legal 11, operations 14, payment 21, storage-s3 6, sms 7) |
| Identity: server OTP + registration binding | **PASS** | `test:e2e:otp` 20/20 |
| No public DRIVER self-registration | **PASS** | otp suite; `auth.mjs` |
| Storage: real S3/SigV4 + no prod local-disk | **PASS** | `test:e2e:storage` 23/23, `test:e2e:storage-s3` 6/6 |
| SMS adapter (real endpoint) | **PASS** | `test:e2e:sms` 7/7 |
| Payments (sandbox): webhook/replay/idempotency/refund/reconciliation | **PASS** | `test:e2e:payment` 21/21 ×3 |
| Wallet/Gift authorization + IDOR closed | **PASS** | `test:e2e:wallet` 38/38 |
| Operations: logging/headers/limits/health/env-fails-closed | **PASS** | `test:e2e:operations` 14/14 |
| No committed secrets / live keys | **PASS** | secret scan clean |

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
| Rollback verification | **PENDING** | after deploy |
| Enable live payments | **RESERVED** | explicit owner authorization only |
| DNS / public cutover | **RESERVED** | explicit owner authorization only |

## Launch verdict
**CONDITIONAL GO.** All application-code gates PASS at `63f9854`. Remaining blockers are **owner
inputs / external accounts / counsel approval / the reserved go-live switches** — none are code
defects. Do not call SYBNB launch-ready until Section B (counsel + publish), C, D are green and the
deployed candidate passes Section E pre-cutover certification.
