# SYBNB — Provider Clearance Emails (drafts to send from the company email)

Ready-to-send drafts for the written Syria-use clearance. **Send from your company address**
(e.g. `legal@sybnb.app` or `info@sybnb.app`). Route each to the provider's **compliance / legal /
support** channel (open a support ticket and ask it be escalated to compliance/legal; CC their privacy
contact for the DPA). **The agent sends nothing** — you send these and paste the written replies into
`PROVIDER_CLEARANCE.md`. Order: Render → (Neon fallback) → Cloudflare R2 → Resend.

Fill the bracketed bits: `[registration # / address]`, ticket references, your name/title.

---

## 1) Render — API hosting + Render Postgres
**Subject:** Written confirmation request — permitted use (Syria-facing platform) + sanctions/DPA/data region

Hello Render Compliance/Support,

We are **9375-7649 QUÉBEC INC.** (a company incorporated in Québec, Canada; [registration # / address]).
We intend to use **Render to host our API (a containerized Node web service) and a managed
Render PostgreSQL database** for **SYBNB**, a short-term-rental technology platform (an online
marketplace/intermediary) whose users are located in **Syria**.

Before we create any paid resources, please **confirm in writing**:
1. Whether a **Canadian company operating a short-term-rental technology platform serving users in
   Syria** is **permitted** under Render's Acceptable Use Policy and your applicable **US/EU/Canadian
   sanctions and export-control** obligations.
2. Any **sanctions/export-control restrictions, conditions, or attestations** you require for this use.
3. Any **account or business-verification** steps required.
4. The **data region(s)** available for the API and the Postgres database, and any region limitations.
5. **DPA availability** and how to execute it.
6. Any **Syria-specific limitations** we should know about.

We will not provision until we have your written confirmation. Thank you.

[Name, title] — 9375-7649 QUÉBEC INC.

---

## 2) Neon — managed PostgreSQL (FALLBACK; send only if Render Postgres is restrictive)
**Subject:** Written confirmation request — permitted use (Syria-facing platform) + sanctions/DPA/data region

Hello Neon Compliance/Support,

We are **9375-7649 QUÉBEC INC.** (Québec, Canada). We are evaluating **Neon managed PostgreSQL** as the
database for **SYBNB**, a short-term-rental technology platform (marketplace/intermediary) whose users
are located in **Syria**.

Before creating any paid resources, please **confirm in writing**:
1. Whether this use (Canadian company; STR platform serving users in **Syria**) is **permitted** under
   your AUP and applicable **US/EU/Canadian sanctions and export-control** obligations.
2. Any **sanctions/export restrictions, conditions, or attestations** required.
3. Any **account/business-verification** steps.
4. The **data region(s)** available and any limitations.
5. **DPA availability** and execution.
6. Any **Syria-specific limitations**.

We will not provision until we have your written confirmation. Thank you.

[Name, title] — 9375-7649 QUÉBEC INC.

---

## 3) Cloudflare — R2 object storage
**Subject:** Written confirmation request — permitted use (Syria-facing platform) + sanctions/DPA/data region

Hello Cloudflare Trust & Safety / Compliance,

We are **9375-7649 QUÉBEC INC.** (Québec, Canada). We intend to use **Cloudflare R2** for object
storage (private application files, e.g. verification documents and listing media) for **SYBNB**, a
short-term-rental technology platform whose users are located in **Syria**.

Before creating any paid resources, please **confirm in writing**:
1. Whether this use (Canadian company; STR platform serving users in **Syria**) is **permitted** under
   Cloudflare's Acceptable Use / Self-Serve Terms and applicable **US sanctions and export-control**
   obligations.
2. Any **sanctions/export restrictions, conditions, or attestations** required.
3. Any **account/business-verification** steps.
4. The **data region/location** options for R2 and any limitations.
5. **DPA availability** and execution.
6. Any **Syria-specific limitations**.

We will not provision until we have your written confirmation. Thank you.

[Name, title] — 9375-7649 QUÉBEC INC.

---

## 4) Resend — transactional email (domain already verified)
**Subject:** Written confirmation request — Syria-facing sending permitted? + sanctions/DPA/data region

Hello Resend Support/Compliance,

We are **9375-7649 QUÉBEC INC.** (Québec, Canada). We have already verified the sending domain
**`notifications.sybnb.app`** on Resend (region eu-west-1) and confirmed delivery. Our platform,
**SYBNB**, is a short-term-rental technology platform whose users are located in **Syria**, and we will
send **transactional email** (verification codes, account/booking notifications) to those users.

Please **confirm in writing**:
1. Whether **sending transactional email to recipients in Syria** for a Canadian company is
   **permitted** under Resend's AUP and applicable **US/EU sanctions and export-control** obligations.
2. Any **sanctions/export restrictions, conditions, or attestations** required.
3. Any **account/business-verification** steps for this use.
4. The **processing region(s)** for our data (we are on eu-west-1) and any options/limitations.
5. **DPA availability** and how to execute it.
6. Any **Syria-specific limitations**.

We will not rely on production sending until we have your written confirmation. Thank you.

[Name, title] — 9375-7649 QUÉBEC INC.

---

### After you send
- Record each **ticket/email reference + date** and the **verbatim** reply in `PROVIDER_CLEARANCE.md`.
- A provider is **CONFIRMED** only on a written "permitted" answer (with its conditions); otherwise it
  stays **UNCONFIRMED**. Share replies with counsel for the sanctions/export + privacy determination.
- **No provisioning** until all four are CONFIRMED in writing and counsel clears the legal gate.
  Runtime `bf8341f` frozen · payments OFF · public CLOSED · Resend untouched · verdict CONDITIONAL GO.
