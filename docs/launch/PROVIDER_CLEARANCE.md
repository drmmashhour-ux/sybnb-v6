# SYBNB — Provider Clearance Gate (Syria use-case authorization)

Tracks **written** confirmation from each provider that the intended SYBNB / Syria-related use is
permitted, **before any paid resource is created**. Governance only — no provisioning, no runtime,
Docker, Resend, payment, webhook, DNS, or infrastructure change. Preserves: runtime `bf8341f`, prior
rollback `d1fd5b9`, payments OFF, public CLOSED, Resend untouched/certified, infra not provisioned,
verdict CONDITIONAL GO.

> **Rule:** permission is NOT inferred from availability, pricing, or public docs. Classify each
> written reply **strictly** — do not read vague language as approval — and **preserve the verbatim
> conditions** for counsel. Nothing here is legal advice; the sanctions/export determination is for
> qualified counsel.
>
> **Reply classification (use exactly one per provider):**
> - **CONFIRMED** — written statement that the Syria-facing use IS permitted (record any conditions).
> - **RESTRICTED** — permitted only under stated conditions/regions/attestations (record them verbatim).
> - **REJECTED** — written statement that the use is NOT permitted → replace that provider.
> - **INCONCLUSIVE** — no clear written answer / deflection / points to policy without a decision → treat as NOT cleared.
> - **UNCONFIRMED** — not yet asked / no reply received.
>
> Provisioning requires **CONFIRMED** (or **RESTRICTED** whose conditions counsel accepts and we can meet) for **every** provider.
>
> **Outreach order (owner):** Render (API + Render Postgres, one request) → Cloudflare R2 → Resend.
> **Neon** = fallback DB — send only if Render's reply is RESTRICTED/REJECTED/INCONCLUSIVE on the database.

## Clearance status — all providers UNCONFIRMED (as of 2026-08-14)
| Provider | Role | Permitted for Syria use? | Geo/service restrictions | DPA available | Data region(s) | Sanctions/export conditions | Account/business verification | Status |
|---|---|---|---|---|---|---|---|---|
| **Render** | API host | — | — | — | — | — | — | **UNCONFIRMED** |
| **Managed Postgres** (Render PG *or* Neon) | Database | — | — | — | — | — | — | **UNCONFIRMED** (provider also not finally chosen) |
| **Cloudflare R2** | Object storage | — | — | — | — | — | — | **UNCONFIRMED** |
| **Resend** | Email (already technically certified) | — | — | — | — | eu-west-1 (Ireland) recorded | — | **UNCONFIRMED** (delivery works; **Syria-use written confirmation still owed**) |

Each blank cell is filled only from the provider's written reply. Record the ticket/email reference
and date next to each.

## Exact ask to send each provider (owner action — written channel)
Send to the provider's **compliance/legal/support** (not sales). Suggested wording:

> "We operate **9375-7649 QUÉBEC INC.** (Québec, Canada). We intend to run a platform that **serves
> users in Syria** on your service ([API hosting / managed PostgreSQL / object storage / transactional
> email]). Please confirm **in writing**: (1) whether this use is **permitted under your Acceptable
> Use Policy and applicable US/EU sanctions and export-control obligations**; (2) any **geographic or
> service restrictions**; (3) **DPA availability** and how to execute it; (4) the **data region(s)**
> our data would reside in and options; (5) any **sanctions/export conditions or attestations** you
> require; (6) any **account or business-verification** steps. We will not provision until we have
> your written confirmation."

Where to send:
- **Render:** support/compliance ticket (dashboard) → escalate to their legal/compliance for a written AUP+sanctions answer.
- **Postgres provider:** Neon or Render — same, to their compliance/support.
- **Cloudflare R2:** Cloudflare Trust/compliance + support; R2 falls under Cloudflare's AUP + export terms.
- **Resend:** support/compliance (they already host `notifications.sybnb.app`); ask specifically about **Syria-facing sending** + DPA + region.

## What "written evidence available" means (record here as it arrives)
| Provider | Evidence (ticket/email ref + date) | Verdict text (verbatim excerpt) |
|---|---|---|
| Render | *(none yet)* | — |
| Postgres | *(none yet)* | — |
| Cloudflare R2 | *(none yet)* | — |
| Resend | *(none yet)* | — |

## Legal gate (remains OPEN — counsel)
Unresolved, pending qualified counsel:
- **Sanctions/export controls** applicable to a Québec-incorporated operator serving Syria (US/OFAC, EU, Canadian regimes; note regimes change — do not assume permitted or prohibited).
- **Syria service permissibility** overall for this platform + each provider category.
- **Privacy/data-transfer** implications (Law 25 / cross-border) for the selected regions.
- **Selected hosting/data regions** sign-off once providers are chosen/confirmed.

## Stack viability
- **Preferred stack (Render + Render PG/Neon + Cloudflare R2 + Vercel + Resend):** technically viable
  and code-ready (candidate `bf8341f`); **viability is CONDITIONAL on the four written confirmations +
  counsel.** No provider is disqualified yet; none is cleared yet.
- **Provider replacement:** none required on technical grounds. If any provider's written answer is
  **negative or unavailable**, replace only that provider — first with the documented alternative
  (e.g. Neon↔Render PG, R2↔S3), and if no US-jurisdiction provider will confirm Syria service, fall
  back to the **Syria-flexibility stack** (self-managed host + self-managed PG + MinIO/R2) in
  `PROVIDER_SELECTION.md`.

## Deployment note (record only)
Locally observed container **cold start ≈ 10 s** (Node + Prisma client import) before `server_listening`.
When a real Render service is created, health-check **grace/initial-delay and timeout must account for
this cold start** and be **verified against the deployed service** — do **not** hard-code arbitrary
production timing values before observing the real host.

## Provisioning authorization
**BLOCKED.** Provisioning is **not** authorized. Do not create Render services, databases, R2 buckets,
secrets, DNS records, webhooks, or deployments until every row above is **CONFIRMED in writing** and
counsel clears the legal gate. Verdict remains **CONDITIONAL GO**.
