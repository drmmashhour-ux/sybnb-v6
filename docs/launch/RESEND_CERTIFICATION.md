# SYBNB — Resend Email Certification (Gate 2)

Resend is an **email API** (delivery + webhooks + idempotency) — **never** treated as SMS. This is the
certification procedure and current status. **The API key is never printed or committed.**

## Status: PREPARED — actual certification BLOCKED-OWNER
The code path is built and partially verified offline; live verification needs owner-provided inputs
(sending domain + DNS access + a Resend **API key**). Nothing below has been run against a live key.

| Item | Status |
|------|--------|
| Email adapter (`server/lib/email.mjs`): sandbox default + `resend` provider, fails closed, key never logged | **PASS (code)** |
| Idempotency support (`Idempotency-Key` header on send) | **PASS (code)** |
| Webhook signature verification (`verifyResendWebhook`, Svix HMAC, constant-time) | **PASS (offline test)** |
| Log redaction (adapter never logs body/key; errors exclude headers/body) | **PASS (code)** |
| Sending **domain** + required sender addresses configured | **BLOCKED-OWNER** |
| SPF / DKIM / DMARC verified | **BLOCKED-OWNER** (DNS + Resend dashboard) |
| Live delivery / failure / retry-idempotency / bounce+complaint webhooks (safe test addresses) | **BLOCKED-OWNER** (API key) |
| Resend processing region + written lawful-Syria confirmation | **BLOCKED-OWNER** |

## Owner inputs required (no secret values in git)
1. **Sending domain** on `sybnb.app`; sender addresses (e.g. `no-reply@sybnb.app`, plus `support@`/
   `legal@`/`privacy@`/`info@` already configured).
2. **DNS records** from the Resend dashboard: SPF (TXT), DKIM (CNAMEs), DMARC (TXT) — publish, then
   confirm "Verified" in Resend. (Agent verifies status via API/DNS lookup — never handles the key.)
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
