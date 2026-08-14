# SYBNB — Owner Actions (copy-ready)

Single consolidated list of the **external inputs only the owner (or their counsel/providers) can
supply**. Every code gate is already PASS at runtime RC `e9dfd68` (see `LAUNCH_CHECKLIST.md`). Nothing
here is done automatically: the agent will **not** select vendors, create paid accounts, publish legal
text, deploy, enable payments, or open public access. Complete these, hand the results back, and the
agent wires each one and re-certifies.

Legend: ☐ = owner action pending. Secret **values** never go in git — only variable names below.

---

## 1. Mailboxes (blocks legal contact points) — ref `MAILBOX_SETUP.md`
☐ Create and verify, on the `sybnb.app` domain:
- `support@sybnb.app`  — user support + error-boundary contact
- `legal@sybnb.app`    — Terms / legal notices
- `privacy@sybnb.app`  — Law-25 / privacy requests (access, correction, deletion)

Return to agent: **confirmation each mailbox receives mail.** These strings are already referenced in
the app; no code change is needed unless you choose different local-parts.

## 2. Vendor + data-region selection (blocks Privacy §16/§17) — ref `VENDOR_REGION_MATRIX.md`
For each row, record **vendor name + exact data region + whether a DPA is signed**:
- ☐ Payments processor (Stripe is the certified path; name it only once live)
- ☐ SMS/OTP provider that delivers to the target numbers
- ☐ Object storage (S3 / GCS / R2 / MinIO) — **this is where KYC/ID docs live** (Law-25 transfer flag)
- ☐ Database / app hosting region — primary personal-data residence
- ☐ Monitoring / log sink + error reporting

Return to agent: the completed matrix. Agent then fills the Privacy "Processors" and
"International transfers" sections (docs only — still DRAFT until counsel approves).

## 3. Sandbox / test credentials (blocks real-endpoint certification) — ref `PROVIDER_CERTIFICATION.md`
Provide **test/sandbox** credentials (never live) as environment variables — send them by a secure
channel, **not** in git or chat:
- ☐ `STRIPE_SECRET_KEY` (test mode, `sk_test_…`) + `PAYMENT_WEBHOOK_SECRET` (test `whsec_…`)
- ☐ `SMS_PROVIDER=http` + provider endpoint/key vars for the SMS sandbox
- ☐ `STORAGE_S3_BUCKET` / `STORAGE_S3_REGION` / `STORAGE_S3_ACCESS_KEY_ID` / `STORAGE_S3_SECRET_ACCESS_KEY`
  pointing at a **disposable test bucket**

Return to agent: the vars set in a certification environment. Agent runs each provider's governed
suite against its **real** test endpoint and records PASS/FAIL in `PROVIDER_CERTIFICATION.md`.

## 4. Counsel delivery (blocks legal publication) — ref `docs/legal/COUNSEL_REVIEW_PACKAGE.md`
☐ Send `COUNSEL_REVIEW_PACKAGE.md` + the three `*.draft.md` files to **Québec counsel**
(Law 25 / Québec + Syrian overlay are flagged in the package).
Return to agent: **counsel-approved final Terms & Privacy text + effective date + version 1.0 sign-off.**
Agent wires `server/lib/legal.mjs` from `DRAFT` → `PUBLISHED`, updates `legal-consent.e2e.mjs`, re-runs.
**Until then legal stays DRAFT / launch-blocking — the agent will not invent or publish legal content.**

## 5. Deployment connection (blocks deployed certification) — ref `ACTIVATION_RUNBOOK.md`
☐ Provide an **authenticated deploy target** (host + auth) with:
- production Postgres (agent runs `prisma migrate deploy` — 11 migrations)
- the production env vars from `ACTIVATION_RUNBOOK.md §1` (fail-closed validated)
- `STORAGE_PROVIDER=s3`, `CORS_ORIGIN` set, `OTP_EXPOSE_FOR_TEST`/`STORAGE_ALLOW_LOCAL` **unset**

Return to agent: deploy access. Agent deploys RC `e9dfd68` **with payments off / public access closed**,
runs the deployed smoke + certification, and certifies rollback (see `GO_LIVE_RUNBOOK.md`).

## 6. Reserved go-live switches (explicit authorization each) — nothing implicit
These are **never** done without a separate, explicit owner instruction, one per line:
- ☐ **Enable live payments** (`STRIPE` live keys) — only after §3 test cert + §4 counsel + §5 deploy
- ☐ **DNS / public cutover** — open public access
- ☐ Any real customer SMS / real KYC processing / production data mutation

---

### What the owner does NOT need to do
Application code, schema, migrations, the 17 governed suites, backup/restore + rollback procedure,
fail-closed config, health/readiness, rate limits, secret redaction, and the PaymentProof
uniqueness fix are **already certified** at `e9dfd68`. Those need no owner action.
