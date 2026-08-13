# SYBNB — Legal Package for Counsel (cover + review checklist)

**For:** qualified Canadian/Québec counsel (with Syrian-market input as needed).
**Purpose:** review and finalize SYBNB's Terms of Service and Privacy Policy before launch.
**Status:** DRAFT — not in effect. The platform treats these as launch-blocking until approved.

## Operator (material)
**9375-7649 QUÉBEC INC.** — a **Québec (Canada)** company operating a multi-division platform
serving primarily the **Syrian** market. This dual context is the crux of the review.

## Documents in this package
1. `TERMS_OF_SERVICE.draft.md` — draft Terms.
2. `PRIVACY_POLICY.draft.md` — draft Privacy Policy (describes processing **as implemented**).
3. `FEE_SCHEDULE.draft.md` — owner-confirmed commercial rates + currency policy.
4. `OWNER_COUNSEL_DECISION_LIST.md` — the 24 decisions (owner-resolved vs counsel-required).
5. `OWNER_DECISIONS_RECORDED.md` — owner's confirmed positions.

## What is already decided by the owner (do not re-open unless legally required)
- Entity 9375-7649 QUÉBEC INC.; **18+**; **intermediary** model; **drivers vetted**, no public
  self-registration; **Wallet/Gift = promotional platform credit** (no cash, not customer money held);
  **Fee Schedule** (Daily Stays 10%, Long-Term Rentals 50% of one month, Real-estate Buyer free /
  Seller 1%, New Construction 1%, Cars 1%, SR Ride 12%, Advertising USD $50/wk non-Canada / CAD $50/wk
  Canada); **all fees waived through 31 Dec 2026, not auto-activated**; currency **Canada=CAD,
  non-Canada=USD, no conversion**; separate `support@`/`legal@`/`privacy@` mailboxes.

## Counsel review checklist (the decisions the drafter deliberately did not make)
**Applicable law & structure**
- [ ] Governing law, jurisdiction/venue, dispute resolution/arbitration, controlling language.
- [ ] Does the **Québec incorporation** make Québec/Canadian law (incl. **Law 25**, possibly PIPEDA)
      apply? How does that interact with serving Syria (incl. sanctions/export considerations)?
- [ ] Licensing/registration for any division (real estate, vehicle sales, **transport/SR Ride**,
      advertising, **payments**) in the relevant jurisdictions.
- [ ] Confirm the **intermediary/not-a-party** characterization is enforceable.

**Payments, wallet & consumer protection**
- [ ] SYBNB is not a bank/MTL/payment institution — or identify the licence.
- [ ] Confirm **Wallet/Gift promotional credit** avoids regulated stored-value/e-money treatment.
- [ ] Division-specific **cancellation/refund** terms; consumer-protection compliance.
- [ ] Tax/VAT, invoicing, settlement, and **cross-currency FX disclosure**.

**Privacy (Law 25 focus)**
- [ ] Lawful bases / consent model; **privacy-officer** requirement.
- [ ] **Cross-border transfer** assessment + safeguards (KYC/DB/SMS/payment provider regions).
- [ ] **Retention schedule** per category (accounts, **KYC**, payments, messages, logs, append-only
      wallet ledger/audit) — KYC must not be indefinite.
- [ ] Data-subject **rights** + response periods; **breach-notification** recipients/deadlines.
- [ ] Processors list + DPAs (owner to finalize vendors — see `VENDOR_REGION_MATRIX.md`).

**Content, liability & mechanics**
- [ ] Prohibited-content wording + **notice-and-takedown / IP** procedure.
- [ ] Enforcement/appeal process.
- [ ] **Disclaimers, limitation of liability, indemnity** (drafter asserted none).
- [ ] Change/versioning notice mechanics (system supports versioned re-consent).

## What the platform already implements (facts for the privacy review)
Server-side OTP (codes hashed, never returned to clients, registration bound to a verified OTP);
passwords scrypt-hashed; phone numbers stored hashed; **private** KYC storage with signed,
time-limited retrieval (admin-only); ownership-scoped access to wallet/listing/inquiry/payment data;
rate limiting on credential/verification endpoints; security headers; body-size limits; structured
logs with **secret redaction**; append-only wallet ledger + admin audit log.

## After counsel approves
Return the final approved text + the version string (e.g. `1.0.0`) and effective date. The agent will
wire them into `server/lib/legal.mjs` (flip `DRAFT`→`PUBLISHED`, bump versions), update
`npm run test:e2e:legal`, and only then does the launch checklist's "Legal content approved" flip to
YES.
