# SYBNB — Stripe Connect Implementation Plan

Status: **design for review** (nothing built yet). Author: build session 2026-10-10.
Scope: how to give each platform/brand its **own private invoices and fund routing** via Stripe Connect, and how SYBNB's **driver/seller payouts** can move onto Connect — without blocking the single-account card launch already in progress.

---

## 0. TL;DR / recommendation

- **Keep the current single-account SYBNB card launch on its own track.** It already works in test mode (saved-card auto-charge proven). Connect is a *separate, larger* initiative and must not destabilise it.
- Connect solves **two different needs** for you. Treat them as two phases:
  - **A — your own brands** (SYBNB, Design Innovacia, Joblop) each get their **own branded invoices/receipts** → model each brand as a **Standard** connected account; create charges/invoices *on* that account.
  - **B — SYBNB's marketplace** (drivers, and later sellers/hosts) get paid **directly by Stripe** instead of via the in-app wallet → model each driver as an **Express** connected account; use **destination charges with an application fee**.
- **Recommended sequence:** finish the single-account card launch → Phase A (brand separation, lower risk) → Phase B (driver payouts, bigger money-flow change).

---

## 1. Where you are today (the baseline)

- **One Stripe account** ("SYBNB", formerly the real-estate DBA), USD default settlement → RBC USD account.
- **Direct charges only.** The backend (`server/routes/payments.mjs`, `server/lib/stripe-checkout-apply.mjs`, `server/lib/ride-auto-charge.mjs`) charges cards on this one account. One business name, one logo, one set of invoices.
- **Driver/platform split is internal.** `server/lib/finance-ledger.mjs` credits the driver's share and the 15% platform commission to an **in-app wallet/ledger**; drivers withdraw via `createDriverPayoutRequest`. Stripe is not involved in paying drivers.
- **Consequence:** a single account can print only **one** brand on invoices, and driver money sits in an internal ledger rather than reaching the driver's bank through Stripe.

Connect is what changes both of those.

---

## 2. Connect building blocks (the three choices that define everything)

### 2.1 Connected-account type

| Type | Who onboards / dashboard | Compliance owner | Branding on invoices | Best for |
|---|---|---|---|---|
| **Standard** | Account owner, full Stripe dashboard | The connected account | Fully its own | **Your separate brands** (Phase A) |
| **Express** | Stripe-hosted lightweight onboarding | Stripe + platform shared | Stripe-assisted, platform-themed | **Drivers/sellers** (Phase B) |
| **Custom** | You build 100% of the UX | **You** (most liability) | Fully platform-controlled | Only if you need total UX control |

- **Phase A → Standard.** Each of your brands is a real business you control; Standard gives each its own dashboard, bank, verification and **its own invoice identity**, while your SYBNB account stays the platform that can see/route across them. Lowest platform liability.
- **Phase B → Express.** Drivers are individuals; Express gives them a fast hosted onboarding + a payouts view without you owning full KYC UX.

### 2.2 Charge model

| Model | Merchant of record | Who is invoiced-as | Use |
|---|---|---|---|
| **Direct charge** (on the connected account) | Connected account | The brand | **Phase A** per-brand invoices |
| **Destination charge** (`on_behalf_of` + `transfer_data.destination`) | Platform (or connected acct if `on_behalf_of`) | Platform/brand | **Phase B** rider→driver with commission |
| **Separate charges & transfers** | Platform | Platform | Splitting one payment across *several* parties |

- **Phase A (per-brand invoices):** create the charge/**Invoice on the connected account** (Stripe-Account header). The invoice then carries *that brand's* name, logo and footer automatically. This is the literal answer to "private invoice per platform."
- **Phase B (driver payout):** **destination charge with `application_fee_amount`** = your 15% commission. Rider is charged the fare; Stripe routes `fare − commission` to the driver's connected account and your 15% stays on the platform. Replaces the wallet credit.

### 2.3 Fees

- Platform commission is taken as **`application_fee_amount`** on each charge (Phase B) — Stripe splits it automatically, so the ledger no longer has to compute/hold the driver's net.
- Note Stripe's **Connect fees** (e.g. a per-active-account/Express payout fee) are additional to normal processing fees — factor into unit economics before go-live.

---

## 3. Target architecture

```
                         ┌───────────────────────────────┐
                         │   SYBNB platform Stripe acct   │  ← this account (platform)
                         │   (application fees land here) │
                         └───────────────┬───────────────┘
            Phase A: own brands          │          Phase B: marketplace
      ┌───────────────┬───────────────┐  │  ┌───────────────┬───────────────┐
      ▼               ▼               ▼  │  ▼               ▼               ▼
 ┌─────────┐   ┌──────────────┐  ┌───────────┐      ┌──────────┐     ┌──────────┐
 │ SYBNB   │   │ Design       │  │ Joblop    │      │ Driver A │ ... │ Driver N │
 │ (Std)   │   │ Innovacia(Std)│ │ (Std)     │      │ (Express)│     │ (Express)│
 │ own     │   │ own invoices │  │ own       │      │ gets     │     │ gets     │
 │ invoices│   │ + bank       │  │ invoices  │      │ fare−15% │     │ fare−15% │
 └─────────┘   └──────────────┘  └───────────┘      └──────────┘     └──────────┘
```

- **Phase A** connected accounts each produce their own branded invoices and settle to their own bank.
- **Phase B** driver accounts receive ride payouts directly; the platform keeps the application fee.
- The two phases are independent — you can ship A without B.

---

## 4. Backend changes (concrete to this codebase)

### Shared / enablement
- Enable **Connect** in the Stripe dashboard (platform profile, branding for Express, webhook endpoints for Connect events).
- Config: `STRIPE_CONNECT_ENABLED`, and store the platform account id; Connect webhooks → a new `connect` endpoint (separate signing secret from the main webhook).

### Data model (Prisma, new migration)
- **Phase A:** a `BrandAccount` table (or reuse an org/division record): `{ brandKey, stripeConnectAccountId, displayName, status }`.
- **Phase B:** add `stripeConnectAccountId` + `connectOnboardingStatus` to the **driver** (`DriverProfile`/`User`), analogous to the `stripeCustomerId`/`defaultCardPmId` fields just added.

### Endpoints
- **Onboarding:** `POST /api/connect/onboard` → creates a connected account + an **Account Link** (hosted onboarding URL), returns it for redirect; `GET /api/connect/status` → onboarding/verification state.
- **Charging (Phase B):** extend the ride-fare charge path (`ride-auto-charge.mjs` + the Checkout/confirm paths) to add, when the ride's driver has a connected account: `on_behalf_of` / `transfer_data.destination = driverAccountId` and `application_fee_amount = commission`. Gate behind `STRIPE_CONNECT_ENABLED` so the current direct-charge path stays the default.
- **Invoicing (Phase A):** create Invoices with the `Stripe-Account: <brandAccountId>` header so they render with that brand's identity.
- **Webhooks:** handle `account.updated` (onboarding/verification), `payout.*`, `transfer.*`, `application_fee.*` — mirror the existing durable-intake pattern in `payment-event-pipeline.mjs`.

### Ledger reconciliation
- Phase B changes the meaning of the driver wallet: for Connect-paid drivers, Stripe holds/pays the money, so `finance-ledger.mjs` records it as **settled-via-Stripe** rather than an internal payable. Cash rides stay on the current commission-debt model. This dual model must be explicit so reporting stays correct.

### Policy / gates
- New operations in `payment-policy.mjs` for the Connect rail (create connected account, onboard, transfer, application-fee refund), each behind its own `PAYMENT_OPERATION_*` flag, same discipline as the stripe_checkout flags.

---

## 5. Phases & sequencing

| Phase | Goal | Key work | Risk |
|---|---|---|---|
| **0 — Launch (in progress)** | Single-account card payments live | *Done in test;* flip to live keys + fix live webhook endpoint | Low |
| **A — Brand separation** | Per-brand private invoices | Connect enablement, Standard accounts per brand, invoice-on-connected-account, onboarding flow | Medium (new onboarding, no change to rider money flow) |
| **B — Driver payouts on Connect** | Stripe pays drivers directly | Express onboarding for drivers, destination charges + application fee, Connect webhooks, ledger dual-model, reconciliation | **High** (re-architects the driver money flow) |
| **C — Sellers/hosts (optional)** | Same for STAYS hosts / marketplace sellers | Reuse B's machinery | Medium |

Each phase ships independently and is reversible by leaving `STRIPE_CONNECT_ENABLED` off.

---

## 6. Risks & decisions to lock before building

- **Is Connect even needed for your own brands, or are plain separate Stripe accounts simpler?** Connect shines when the platform routes money among *different* parties (drivers). For brands *you alone own*, separate Standard accounts give per-brand invoices with less platform liability — Connect mainly adds a single oversight/login layer. Worth confirming A is worth the Connect overhead vs. just separate accounts.
- **Business-model match / compliance:** this account is currently verified as a Québec **real-estate** business (`lecipm.com`). Processing **ride** payments and onboarding **drivers** is a different risk category — Stripe may review. Align the account's stated business with what it actually processes before live Connect.
- **Connect fees** change unit economics (per-account/payout fees on top of processing) — model the 15% commission net of these.
- **Driver onboarding friction:** every driver must pass Stripe KYC to get paid via Connect — more friction than the current wallet. Keep the wallet path as a fallback.
- **Country support:** connected-account availability and payout methods vary by the driver's/brand's country (Syria vs Canada) — verify Stripe supports payouts to the countries each party banks in.

---

## 7. What happens in parallel (the launch track)

Independent of all of the above, the single-account SYBNB card launch continues:
1. Finish test-mode validation (save-card proven; run a full trip once a driver account exists).
2. Switch to **live** keys + create a **live** webhook endpoint pointing at the backend (the existing live webhook points at `sybnb.app`, which must proxy to the backend or be repointed).
3. Redeploy the **public** frontend (`sybnb.app` on Vercel) — it's currently stale and missing all the new card/tipping/safety UI.
4. Go live on cards for SYBNB on this one account, invoices branded "SYBNB".

Connect Phase A/B then layers on top without redoing any of this.

---

## 8. Immediate next actions (when you approve)

- [ ] Confirm: Connect for **(1) own brands**, **(2) driver marketplace**, or **(3) both phased** — and whether A is worth Connect vs. separate accounts.
- [ ] I enable Connect in the dashboard and scaffold the data model + onboarding endpoints behind `STRIPE_CONNECT_ENABLED` (no behaviour change until turned on).
- [ ] Align the Stripe account's stated business with ride-hailing before any live Connect.
- [ ] Keep the single-account card launch moving (live keys, live webhook, Vercel redeploy).
