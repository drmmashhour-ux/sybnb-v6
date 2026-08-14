# SYBNB — Resend Domain Setup + Certification Runbook (`notifications.sybnb.app`)

Step-by-step for the owner to add the **dedicated sending subdomain** and for the agent to certify it.
**Critical:** this touches only `notifications.sybnb.app`. The existing **Google Workspace** mailboxes
and the **root `sybnb.app` MX** are **NOT changed** — inbound mail keeps flowing to Google Workspace.
**Do not invent DNS values — publish exactly what Resend shows.** The Resend **API key is never
shared with, printed by, or committed by the agent.**

## Step 1 — Owner: add the domain in Resend
1. Resend → **Domains** → **Add Domain**.
2. Enter **`notifications.sybnb.app`** (the subdomain, **not** the root `sybnb.app`).
3. Choose the region (record it — see Step 4).
4. Resend shows a **DNS-record screen**. **Copy it verbatim** (screenshot or copy each row). It lists,
   for `notifications.sybnb.app`, records of these **types** (exact host + value are shown by Resend):
   - **MX** — on a Resend-specified host (typically `send.notifications…`) for bounce/complaint. This
     is scoped to the subdomain and does **not** affect the root `sybnb.app` MX / Google Workspace.
   - **TXT (SPF)** — on the Resend-specified host.
   - **TXT or CNAME (DKIM)** — on `resend._domainkey.notifications…` (as shown).
   - **TXT (DMARC)** — on `_dmarc.notifications…` (policy as shown).

## Step 2 — Owner: publish in GoDaddy (values FROM Resend, verbatim)
GoDaddy → your `sybnb.app` domain → **DNS** → **Add**. For each Resend row, add a record. GoDaddy's
**Host/Name** is written **relative to `sybnb.app`** (drop the trailing `.sybnb.app`):
| Resend shows (example host) | GoDaddy Type | GoDaddy Host/Name | GoDaddy Value | Notes |
|---|---|---|---|---|
| `send.notifications.sybnb.app` | **MX** | `send.notifications` | *(exact from Resend)* | priority as shown; subdomain-scoped |
| SPF host from Resend | **TXT** | `send.notifications` *(or as shown)* | *(exact SPF string)* | |
| `resend._domainkey.notifications.sybnb.app` | **TXT/CNAME** | `resend._domainkey.notifications` | *(exact DKIM value)* | long key — paste exactly |
| `_dmarc.notifications.sybnb.app` | **TXT** | `_dmarc.notifications` | *(exact DMARC policy)* | |

**Do NOT** add or edit any record whose host is the bare root `@`/`sybnb.app` (that is Google
Workspace's MX/SPF — leave untouched). Only `*.notifications.sybnb.app` hosts are added here.

## Step 3 — Owner: verify + provide the key securely
1. Back in Resend, click **Verify** until all records show **Verified** (DNS can take minutes–hours).
2. Provide, via a secure channel (never git/chat): `RESEND_API_KEY`, `EMAIL_FROM`
   (`no-reply@notifications.sybnb.app`), and — for webhooks — `RESEND_WEBHOOK_SECRET` (`whsec_…`).
   Set them as environment variables in the certification host / secret manager.

## Step 4 — Agent: certify (once verified + key provided)
```bash
EMAIL_PROVIDER=resend RESEND_API_KEY=… EMAIL_FROM='no-reply@notifications.sybnb.app' \
  RESEND_CERT_TO='<a safe inbox you own>' RESEND_DOMAIN=notifications.sybnb.app \
  node scripts/certify-resend.mjs        # domain=verified, live send, idempotency de-dupe
```
- Confirms domain **verified**, live delivery to a **safe** address, and idempotency (same
  `Idempotency-Key` → one email). Webhook signature + timestamp/replay + duplicate-event + suppression
  are already PASS offline (`email-security` 11/11). The key is never printed.
- Also confirm SPF/DKIM/DMARC "Verified" in the dashboard and via `dig TXT`/`dig CNAME`
  `…notifications.sybnb.app` — record the status (not the key).

## Step 5 — Record (for Privacy + counsel)
Fill in `RESEND_CERTIFICATION.md`: Resend **processing region**, **data-processing terms/DPA**
reference, and **written confirmation from Resend** that service is permitted for the **Syria**
implementation. These feed the Privacy "Processors"/"International transfers" sections and counsel review.

## Guardrails
Email-only auth and **SMS unreachable** are unchanged. No deploy, no legal publication, no payments,
no public access. Runtime candidate `d1fd5b9` and its release archive are preserved as rollback evidence.
