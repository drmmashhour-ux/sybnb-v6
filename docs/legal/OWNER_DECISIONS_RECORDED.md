# SYBNB — Owner Decisions (recorded / provisional)

Provisional owner positions captured from the owner's review of the 24-item decision list. This
records intent so approved items can be wired once **confirmed**; it does not publish anything and
does not substitute for counsel on legal-conclusion items. Legend:
**[OWNER ✓ provisional]** = owner proposed, ready to finalize on confirmation ·
**[OWNER — INPUT NEEDED]** = only the owner can supply the value ·
**[COUNSEL]** = legal conclusion, for Syrian counsel.

| # | Topic | Recorded position | Status |
|---|-------|-------------------|--------|
| 1 | Operating entity | Exact registered entity to be supplied by owner | **[OWNER — INPUT NEEDED]** |
| 2 | Contacts | `info@sybnb.app` + WhatsApp `+963 998 191 422`; possibly add `legal@`/`privacy@` | **[OWNER — INPUT NEEDED]** (keep one vs split) |
| 3 | Role | Technology marketplace/intermediary, not seller/owner/employer/carrier except where SYBNB itself offers a service | [OWNER ✓ provisional] + **[COUNSEL]** (Syrian licensing) |
| 4 | Drivers/SR Ride | Independent, vetted before activation (ID, licence, vehicle docs, required insurance/permits); no unrestricted public self-registration | [OWNER ✓ provisional] + **[COUNSEL]** (status/licences) |
| 5 | Minimum age | 18+ to create an account and transact | [OWNER ✓ provisional] + **[COUNSEL]** (capacity) |
| 6 | Bank/MTL status | Not intended as a bank/money-transmitter; payments via authorized third-party processors | [OWNER ✓ provisional] + **[COUNSEL]** (wallet/gift obligations) |
| 7 | Commission | Daily Stays 10% (to confirm); other divisions **not yet set**. Use a separate **fee schedule** referenced by Terms | **[OWNER — INPUT NEEDED]** (per-division rates) |
| 8 | Refunds/cancellations | **Division-specific** policies (not one shared rule) | [OWNER ✓ provisional] + **[COUNSEL]** |
| 9 | Card processor | Describe as "an authorized third-party payment processor"; name **Stripe only once confirmed** as the live provider | [OWNER ✓ provisional] |
| 10 | Taxes/currency | Display transaction currency; **no specific tax treatment promised** | [OWNER ✓ provisional] + **[COUNSEL/accountant]** |
| 11 | Wallet/Gifts | Promotional platform credit; no cash withdrawal; not transferable except via authorized gift; may expire; not cash-exchangeable | [OWNER ✓ provisional] + **[COUNSEL]** (not e-money) |
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
- **A. Registered legal entity name** (#1).
- **B. Contact-email strategy** — one address vs `legal@`/`privacy@` (#2).
- **D. Per-division commission/fee schedule** — Daily Stays 10% to confirm; Cars, Buy/Sell, Rentals,
  New Construction, SR Ride, Advertising still unset (#7).
- **Vendor finalization** for the processor list + regions (#16, #17).

## Owner confirmations recommended (owner adopts; agent will not decide)
- **C. 18+** for transactional accounts (#5) — recommended.
- **E. Wallet/Gift = promotional credit only**, no cash withdrawal, not a bank/e-wallet holding
  customer money (#11) — matches the certified architecture.

## Counsel-only items (do not draft ourselves)
#14 liability/indemnity, #15 lawful bases, #23 governing law/disputes — plus the Syrian-law overlay
on #3, #4, #5, #6, #8, #11, #12, #13, #18–#21.

> Nothing is published. `server/lib/legal.mjs` stays `DRAFT` / launch-blocking until counsel-approved
> final text is supplied and the owner authorizes publication.
