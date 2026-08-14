# SYBNB — Owner Launch Handoff (RC `c89c495`)

Country separation and local certification are complete. Everything remaining is an **external owner,
counsel, vendor, credential, deployment, or activation action** — no code work remains. Legal stays
DRAFT, live payments disabled, deployment blocked, public access closed until the steps below complete.

Preserved release (Danny SSD): `SYBNB_CLEAN_FINALS/RELEASES/c89c495/` — archive
`sybnb-src-c89c495.tar.gz` (SHA-256 `36e33e1a0479af2db170622e853c8fc60efd1732a968f3eb1ab07b912dfa2581`),
`SHA256SUMS.txt`, `RELEASE_MANIFEST.md`, `IDENTITY.txt`, `CERTIFICATION_EVIDENCE.md`, `ROLLBACK.md`.

## PASS / BLOCKED matrix
| Gate | Status |
|------|--------|
| Application code, 21 governed E2E suites, isolation, bundle-safety | **PASS** (`c89c495`) |
| Build / schema / 11 migrations (fresh DB) / dependency audit | **PASS** |
| Country-neutral master + `countries/syria` + fail-closed selection | **PASS** |
| Reproducible release archive + full SHA-256 manifest (permanently preserved) | **PASS** |
| Clean-room deploy simulation (start/health/shutdown) | **PASS** |
| Mailboxes `info@`/`support@`/`legal@`/`privacy@sybnb.app` (send/receive tested) | **PASS (owner gate complete)** |
| Final Terms/Privacy content approved + published | **BLOCKED-COUNSEL** |
| Production vendors + data regions (payments/SMS/storage/DB/hosting/monitoring) | **BLOCKED-OWNER** |
| Real sandbox-provider certification | **BLOCKED-OWNER** (credentials) |
| Authenticated deploy + deployed rollback certification | **BLOCKED-OWNER** (target) |
| Enable live payments · DNS/public cutover | **RESERVED** (explicit authorization each) |

## Exact owner inputs still required
1. **Counsel-approved legal** — final Terms and Privacy **text**, each **version** (start 1.0) and
   **effective date**, for a Québec-incorporated operator running a **Syria-only** service. → agent
   wires `server/lib/legal.mjs` DRAFT→PUBLISHED and re-runs the legal suite.
2. **Selected vendors** — name the production **payment, SMS, object-storage, database, hosting, and
   monitoring** providers.
3. **Vendor regions + lawful-Syria confirmation** — the exact data **region** per vendor and **written
   confirmation** each supports lawful service to Syria (permitted-country / sanctions-export review),
   plus DPAs. → feeds the Privacy "Processors" / "International transfers" sections.
4. **Sandbox credentials (variable names only; no values here)** — provide by a secure channel, never
   in git/chat: `STRIPE_SECRET_KEY` (test `sk_test_…`) + `PAYMENT_WEBHOOK_SECRET` (`whsec_…`);
   `SMS_HTTP_ENDPOINT` + `SMS_API_KEY`; `STORAGE_S3_BUCKET` / `STORAGE_S3_REGION` /
   `STORAGE_S3_ACCESS_KEY_ID` / `STORAGE_S3_SECRET_ACCESS_KEY` (disposable test bucket). Secure entry:
   set as environment variables in the certification/deploy host or a secret manager — the agent runs
   `scripts/certify-providers.mjs` against the real test endpoints; it never sees or stores the values.
5. **Authenticated deployment target** — host + auth + production `DATABASE_URL`, with the production
   env from `templates/production.env.template` (`SYBNB_COUNTRY=syria` required). → agent deploys
   `c89c495` (payments off), runs smoke, and performs the deployed rollback certification.
6. **Separate explicit authorizations (one each)** — (a) publish legal documents, (b) deploy to
   production, (c) enable live payments, (d) DNS / public cutover.

## Sequence
Counsel (1) and vendors (2–3) can proceed in parallel; sandbox certification (4) follows vendor
selection; deployment (5) follows 1–4; the reserved switches (6) are last and each require their own
authorization. GO is declared only when 1–5 are green and the deployed candidate passes smoke +
rollback.
