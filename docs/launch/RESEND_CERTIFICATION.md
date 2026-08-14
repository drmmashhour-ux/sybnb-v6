# SYBNB — Resend Email Certification (Gate 2)

Resend is an **email API** (delivery + webhooks + idempotency) — **never** treated as SMS. This is the
certification procedure and current status. **The API key is never printed or committed.**

## Status: CERTIFIED (live delivery + idempotency PASS) — remaining: written Syria-service confirmation + DPA
`notifications.sybnb.app` is **Verified** in Resend (2026-08-14, region eu-west-1). DNS is managed by
**Vercel** (not GoDaddy); the DKIM + SPF records were written via Resend's **Auto configure** into
Vercel — the root `sybnb.app` MX / Google Workspace mailboxes were **not** touched, and inbound
("Enable Receiving") was left OFF. Remaining: create a Resend **API key** (owner) and run
`scripts/certify-resend.mjs` for live send + idempotency; offline checks (webhook
signature+replay+dedup, suppression) already **PASS**. Key is never printed/committed.

| Item | Status |
|------|--------|
| Email adapter (`server/lib/email.mjs`): sandbox default + `resend` provider, fails closed, key never logged | **PASS (code)** |
| Idempotency support (`Idempotency-Key` header on send) | **PASS (code)** |
| Webhook signature verification (`verifyResendWebhook`, Svix HMAC, constant-time) | **PASS (offline test)** |
| Webhook timestamp/replay window + duplicate-event guard | **PASS (offline test)** — `email-security` 11/11 |
| Bounce/complaint suppression (block repeat delivery to bad addresses) | **PASS (offline lib)** — persistence store wired at live-webhook time |
| Log redaction (adapter never logs body/key; errors exclude headers/body) | **PASS (code)** |
| Sending **domain** `notifications.sybnb.app` configured | **PASS** — added; DNS via **Vercel** (Auto configure); root `sybnb.app` MX / Google Workspace untouched |
| SPF + DKIM verified (domain **Verified** in Resend, 2026-08-14) | **PASS** — DKIM TXT `resend._domainkey.notifications` + SPF MX/TXT `send.notifications`; region **Ireland (eu-west-1)** |
| DMARC | **RECOMMENDED (optional)** — not required by Resend for verification; owner may add a `_dmarc.notifications` TXT policy later |
| Live delivery (real send to a safe inbox) | **PASS** — 2026-08-14, Sending-access key, delivered to `info@sybnb.app` (msg ids `241ba082…`, `5edb3098…`) |
| Retry / idempotency (same Idempotency-Key → one email) | **PASS** — same request returned the same message id (no duplicate) |
| Webhook signature + timestamp/replay + duplicate-event + suppression | **PASS (offline)** — `email-security` 11/11 + `certify-resend` offline checks |
| Live bounce/complaint webhook wiring (endpoint + `RESEND_WEBHOOK_SECRET`) | **PENDING** — add a webhook route + secret when going live (verifier + suppression already built/tested) |
| Resend processing region + written lawful-Syria confirmation | **PARTIAL** — region recorded (**eu-west-1, Ireland**); written Syria-service confirmation + DPA still **BLOCKED-OWNER** |

## Dedicated sending subdomain (does NOT touch existing mailboxes / MX)
Use a **dedicated sending subdomain** — `notifications.sybnb.app` — for Resend. This keeps the
existing **Google Workspace** mailboxes (`info@`/`support@`/`legal@`/`privacy@`) and the **root-domain
MX** records **unchanged**: transactional email is sent from `notifications.sybnb.app` while inbound
mail to `@sybnb.app` continues to flow to Google Workspace untouched. Sender address, e.g.
`no-reply@notifications.sybnb.app`.

## Owner inputs required (no secret values in git)
1. In Resend, add the domain **`notifications.sybnb.app`** (not the root domain) → Resend displays the
   exact DNS records to publish.
2. **DNS record TYPES Resend will show** (publish the EXACT values from the Resend dashboard — the
   agent does NOT invent DNS values):
   - **SPF** — a `TXT` on `notifications.sybnb.app` (Resend's `include:` value).
   - **DKIM** — one or more `CNAME` (or `TXT`) records on `resend._domainkey.notifications…` (or as shown).
   - **DMARC** — a `TXT` on `_dmarc.notifications.sybnb.app` (policy per the dashboard).
   - **MX for the SENDING SUBDOMAIN only** (bounce handling), scoped to `notifications.sybnb.app` —
     this does **not** alter the root `sybnb.app` MX used by Google Workspace.
   Publish, then confirm "Verified" in Resend. (Agent then verifies status via `dig`/API — never handles the key.)
3. **`RESEND_API_KEY`** + **`EMAIL_FROM`** as environment variables in a certification host / secret
   manager (never in git/chat). Set `EMAIL_PROVIDER=resend`.
4. **Webhook signing secret** (`whsec_…`) for delivery/bounce/complaint events → `RESEND_WEBHOOK_SECRET`.
5. **Written confirmation from Resend** of the data-processing **region** and that it permits the
   intended lawful **Syria-facing** service (for the Privacy processors/transfer sections + counsel).

## Certification procedure (run once inputs exist)
```bash
# With EMAIL_PROVIDER=resend, RESEND_API_KEY, EMAIL_FROM set in the cert host (values never printed):
EMAIL_PROVIDER=resend node -e "import('./server/lib/email.mjs').then(m=>m.emailProviderStatus())"  # configured:true, live:true
# Send to a SAFE test inbox (e.g. Resend's test address / an owned inbox); confirm 200 + message id.
# Re-send the SAME request with the same Idempotency-Key → provider de-duplicates (no double email).
# Trigger a bounce/complaint via Resend's test addresses; confirm the webhook is received and its
# signature verifies via verifyResendWebhook (RESEND_WEBHOOK_SECRET); reject a tampered payload.
# Confirm process logs contain NO key and NO email body (redaction).
```
SPF/DKIM/DMARC: verify "Verified" in the Resend dashboard and via `dig TXT`/`dig CNAME` — record
status (not the key). Then update this file's matrix to PASS with the date and evidence.

## Guardrails
No key printed/committed; live delivery only to safe test addresses during certification; production
send stays off until the domain is verified and the owner authorizes. Legal DRAFT, payments disabled,
deployment blocked, public access closed remain unchanged.
