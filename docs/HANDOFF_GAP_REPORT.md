# SYBNB handoff gap report (vs SYBNB_Claude_Handoff_Master.docx)
Based on repository inspection, 2026-10-11. Status: already implemented / partial / missing.

## P0
| Area | Status | Evidence / note |
|---|---|---|
| Absolute trust claims ("fully protected", "Full SYBNB protection") | FIXED this pass | Neutralised in BookingDetail, Dashboard, PaymentReceipt, TrustProtectionRoutes (ar/en/fr). No "escrow", "10K+", "first in Syria", "AES-256" found in src. |
| OTP security | Implemented | VerificationCode stores codeHash, attempts/maxAttempts, expiresAt; email.mjs avoids logging bodies. Not yet audited: resend cooldown, enumeration-safe errors. |
| Secrets / env validation | Mostly | env.mjs requires AUTH_SECRET, PHONE_HASH_SECRET, DATABASE_URL. No `secret_key` fallback found. |
| Hard-coded FX rate | Partial | No 13,500; but SYP_PER_USD is a single env var (placeholder default in finance-ledger.mjs). Missing: ExchangeRate table with source/time and per-transaction locked rate. NEEDS owner decision on rate source. |
| Booking/payment state machine | Partial | booking-lifecycle.mjs + ledger HOLD/RELEASE exist; not audited for explicit transition table + actor/reason log. |
| Dispute blocks payout | Implemented | admin.mjs payout release requires COMPLETED, past 14-day hold, no open dispute. |
| Privacy claims | Not re-audited | legalContent.ts only has hedged wording ("cannot be guaranteed"). |

## P1
| Area | Status |
|---|---|
| Utility disclosures (electricity/solar/generator/water/internet) | MISSING (no schema fields) |
| Messaging off-platform risk scoring | MISSING for messages (only revenue-guard for ride/stay behaviour) |
| Granular RBAC (compliance / finance / dispute) | MISSING: RoleName has only ADMIN + SUPPORT; ~24 inline role checks |
| Single account, optional host activation | Implemented (roles array, host-activation) |
| Progressive verification | Implemented (host-verification, id-document-storage) |
| Verified-stay reviews + structured utility feedback | Partial / unaudited |
| Mobile/zoom | Viewport allows zoom (no user-scalable=no). Phone overflow fixed f55ddf4. |
| Payout idempotency | Implemented (idempotencyKey @unique on ledger/payment events); concurrency tests exist for payment events |

## P2 / tests
Extensive e2e suite exists (payments, refunds, webhooks, host verification). No automated tests yet for: utility fields, message risk, RBAC split.

## Needs owner/legal decision (do not block engineering)
Whether SYBNB may use "escrow"/hold wording; FX rate source; protection/release window (currently 14 days); legal entity name; data retention; launch programs.

## Suggested next implementation order
1. OTP audit (cooldown/enumeration) + tests  2. ExchangeRate table + locked rate on booking  3. Utility disclosure fields + listing UI  4. Message risk signals (server-side, warn then admin review)  5. RBAC split (FINANCE, COMPLIANCE, DISPUTE roles)
