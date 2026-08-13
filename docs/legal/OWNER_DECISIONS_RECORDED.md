# SYBNB — Owner Decisions (recorded / provisional)

Provisional owner positions captured from the owner's review of the 24-item decision list. This
records intent so approved items can be wired once **confirmed**; it does not publish anything and
does not substitute for counsel on legal-conclusion items. Legend:
**[OWNER ✓ provisional]** = owner proposed, ready to finalize on confirmation ·
**[OWNER — INPUT NEEDED]** = only the owner can supply the value ·
**[COUNSEL]** = legal conclusion, for Syrian counsel.

| # | Topic | Recorded position | Status |
|---|-------|-------------------|--------|
| 1 | Operating entity | **9375-7649 QUÉBEC INC.** (Québec, Canada) | **[OWNER ✓]** · open: address/reg#; **[COUNSEL]** Québec/Law-25 |
| 2 | Contacts | Separate `support@`/`legal@`/`privacy@sybnb.app` (owner-recommended) + `info@`, WhatsApp `+963 998 191 422` | **[OWNER ✓]** · open: create mailboxes |
| 3 | Role | Technology marketplace/intermediary, not seller/owner/employer/carrier except where SYBNB itself offers a service | [OWNER ✓ provisional] + **[COUNSEL]** (Syrian licensing) |
| 4 | Drivers/SR Ride | Independent, vetted before activation (ID, licence, vehicle docs, required insurance/permits); no unrestricted public self-registration | [OWNER ✓ provisional] + **[COUNSEL]** (status/licences) |
| 5 | Minimum age | **18+ (confirmed)** | **[OWNER ✓]** + **[COUNSEL]** (capacity wording) |
| 6 | Bank/MTL status | Not intended as a bank/money-transmitter; payments via authorized third-party processors | [OWNER ✓ provisional] + **[COUNSEL]** (wallet/gift obligations) |
| 7 | Commission | **RESOLVED** — Fee Schedule set (Daily Stays 10%, Rentals 50% of 1 month, Buyer free/Seller 1%, New Construction 1%, Cars 1%, SR Ride 12%, Advertising USD $50/wk non-Canada, **CAD $50/wk Canada**); waived through 31 Dec 2026; not auto-activated | **[OWNER ✓]** |
| 8 | Refunds/cancellations | **Division-specific** policies (not one shared rule) | [OWNER ✓ provisional] + **[COUNSEL]** |
| 9 | Card processor | Describe as "an authorized third-party payment processor"; name **Stripe only once confirmed** as the live provider | [OWNER ✓ provisional] |
| 10 | Currency/taxes | **Currency RESOLVED** — Canada=CAD; Syria+non-Canada `$`=USD; no silent conversion. Taxes/VAT/invoicing still open | [OWNER ✓] + **[COUNSEL/accountant]** |
| 11 | Wallet/Gifts | **Confirmed:** promotional platform credit only; no cash withdrawal; not a bank/e-wallet holding customer money; may expire | **[OWNER ✓]** + **[COUNSEL]** (not e-money) |
| 12 | Prohibited content | Fraud, impersonation, illegal goods/services, misleading listings, harassment, discriminatory/abusive content, IP infringement, malware/spam, unlawful content | [OWNER ✓ provisional] + **[COUNSEL]** (final wording + takedown) |
| 13 | Suspension/termination | Restrict/suspend for fraud, safety, payment abuse, false info, repeat violations, legal need; support/appeal channel unless legally barred | [OWNER ✓ provisional] + **[COUNSEL]** |
| 14 | Liability/indemnity | Not chosen by owner/agent | **[COUNSEL]** only |
| 15 | Lawful bases | Agent to give counsel a precise collection/purpose map; counsel decides bases | **[COUNSEL]** |
| 16 | Processors | List only vendors actually selected; anticipated: payments, SMS/OTP, object storage/cloud hosting, monitoring | **[OWNER — INPUT NEEDED]** (finalize vendors) |
| 17 | International transfers | Open until hosting/S3/SMS/payment regions chosen | **[OWNER — INPUT NEEDED]** |
| 18 | Retention | Explicit schedule before launch; KYC not indefinite; payment/audit per legal minimums | [OWNER ✓ provisional] + **[COUNSEL/accountant]** (periods) |
| 19 | KYC | Collect only where required (esp. drivers/higher-trust); private access + retention/deletion already built | [OWNER ✓ provisional] + **[COUNSEL]** (basis/retention) |
| 20 | Privacy rights | Provide access/correction/deletion where applicable, subject to fraud/records/legal holds | [OWNER ✓ provisional] + **[COUNSEL]** (statutory rights/periods) |
| 21 | Breach | Investigate/contain/document promptly; counsel sets notification recipients/deadlines | [OWNER ✓ provisional] + **[COUNSEL]** |
| 22 | Changes to docs | Versioned; may require re-consent; communicate material changes before/at effect | [OWNER ✓ provisional] (already implemented) |
| 23 | Governing law/disputes | Syrian law a likely starting point; not final until counsel confirms venue/arbitration/language | **[COUNSEL]** |
| 24 | Version/effective date | Start approved docs at **1.0**; effective date inserted at authorized publication | [OWNER ✓ provisional] |

## Still blocking finalization (owner inputs only you can give)
- **Create/confirm** the `support@`/`legal@`/`privacy@sybnb.app` mailboxes (#2).
- **Vendor + region finalization** for the processor list (#16, #17) — once production providers chosen.
- (RESOLVED: A entity = 9375-7649 QUÉBEC INC.; C age 18+; E wallet promotional-credit; D fee schedule + currency.)

## Confirmed by owner
- A entity **9375-7649 QUÉBEC INC.**; C **18+**; E **Wallet/Gift = promotional credit only** (no cash
  withdrawal, not customer money held); D **Fee Schedule + currency policy**.
- **Material for counsel:** Québec-incorporated operator → Canadian/Québec law (incl. Law 25 privacy)
  likely applies in addition to Syrian considerations.

## Counsel-only items (do not draft ourselves)
#14 liability/indemnity, #15 lawful bases, #23 governing law/disputes — plus the Syrian-law overlay
on #3, #4, #5, #6, #8, #11, #12, #13, #18–#21.

> Nothing is published. `server/lib/legal.mjs` stays `DRAFT` / launch-blocking until counsel-approved
> final text is supplied and the owner authorizes publication.
