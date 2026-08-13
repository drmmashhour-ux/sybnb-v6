# SYBNB V6 — Governed E2E Evidence

Integration end-to-end tests that exercise the real V6 API against a schema-correct
staging database. They assert product behavior only — **no test moves real money, enables
Stripe, or touches production.**

## Prerequisites

1. A schema-correct Postgres database (uuid listing ids) — the authoritative local/staging DB
   is `sybnb_v6`. Do **not** use the drifted `sybnb_v6_dev` (text listing ids) as authoritative.
2. The V6 API running against that DB:

   ```bash
   DATABASE_URL="postgresql://<user>@127.0.0.1:5432/sybnb_v6?schema=public" \
   AUTH_SECRET=<secret> PHONE_HASH_SECRET=<secret> \
   node server/index.mjs
   ```

3. Synthetic user ids (SELLER role x2, GUEST, ADMIN) present in that DB, passed via env. Tokens
   are minted with `server/lib/security.mjs#createSessionToken` using the same `AUTH_SECRET`.

## Suites & expected counts

All are integration E2Es against a running API + schema-correct `sybnb_v6`. Reset the two seller
profiles before division/sell/advertising runs (paid-plan gate observes pristine state):
`DELETE FROM seller_profiles WHERE user_id IN ('<SELLER1>','<SELLER2>');`

| Suite | Script | Expected |
|-------|--------|----------|
| Marketplace | `npm run test:e2e:marketplace` | 32/32 |
| Cars | `npm run test:e2e:cars` | 38/38 |
| Buy | `npm run test:e2e:buy` | 40/40 |
| Rentals | `npm run test:e2e:rentals` | 42/42 |
| New Construction | `npm run test:e2e:new-construction` | 42/42 |
| Sell | `npm run test:e2e:sell` | 37/37 |
| SR Ride | `npm run test:e2e:sr-ride` | full lifecycle green |
| Advertising | `npm run test:e2e:advertising` | 35/35 |
| Wallet / Gift | `npm run test:e2e:wallet` | 33/33 |
| OTP / Identity | `npm run test:e2e:otp` (needs `OTP_EXPOSE_FOR_TEST=true` on the API) | 20/20 |
| Production Storage | `npm run test:e2e:storage` (needs `AUTH_SECRET` matching the API) | 20/20 |

Env: division/sell/advertising suites use `SELLER1 SELLER2 BUYER ADMIN`; wallet uses
`SENDER RECIPIENT OTHER ADMIN`; SR Ride uses `BUYER` + `DRIVER_ID`. All need `AUTH_SECRET`
matching the running API.

## Advertising / Payment Tunnel

```bash
AUTH_SECRET=<secret> SELLER1=<uuid> SELLER2=<uuid> BUYER=<uuid> ADMIN=<uuid> \
npm run test:e2e:advertising
```

Reset the two seller profiles before a clean run so the paid-plan gate observes its pristine
state:

```sql
DELETE FROM seller_profiles WHERE user_id IN ('<SELLER1>', '<SELLER2>');
```

Expected: **35 passed, 0 failed.**

Covers: advertiser mock payment proof; admin approval; paid-plan entitlement unlock; ad listing
create/media/submit; listing moderation; visibility only after approval; rejected-proof
behavior; duplicate/replayed payment reference; double approval; invalid amount/reference;
advertiser/admin authorization; cross-advertiser isolation; unknown campaign handling. No real
money movement.

## Wallet / Gift

```bash
AUTH_SECRET=<secret> SENDER=<uuid> RECIPIENT=<uuid> OTHER=<uuid> ADMIN=<uuid> \
npm run test:e2e:wallet
```

Expected: **33 passed, 0 failed.**

Money model: Wallet = stored value (`cachedBalanceMinor` + append-only `WalletEntry` ledger with
a UNIQUE idempotency key). Gift = a phone-targeted claimable entitlement (6-digit HMAC claim code
from `AUTH_SECRET`); small gifts (< 100000) are created `SENT`, large gifts (>= 100000) are
`CLAIM_PENDING` and require admin approval to become `SENT`. Claiming credits the claiming user's
wallet as a promotional/platform-funded `CREDIT` (no sender debit — not a double-entry transfer).
Claims are code-verified, brute-force locked (3 fails → 10 min), single-use (row-locked
`SENT`→`CLAIMED`), and expiry-enforced.

Covers: create/claim, ledger credit + exact balance, replay/double-claim blocked (no double
credit), wrong-phone / wrong-code / brute-force lock, expiry rejection, admin approval of large
gifts, admin-route authorization, wallet self-scoping, ledger invariants (non-negative, gift
CREDIT entries present). No real money movement.

Reversal/revocation after claim: **NOT SUPPORTED** (a claimed gift's CREDIT is not un-doable;
pre-claim, a `CLAIM_PENDING` gift can be admin-rejected → `ADMIN_BLOCKED`).

### Product gap (documented, NOT SUPPORTED)

The landing **"Featured ads" marquee is static** (hardcoded `AD_SPONSORS` in
`src/modules/landing/LandingPage.tsx`). Approved advertising campaigns do **not** dynamically
appear there; an approved ad surfaces as a normal `APPROVED` listing in its division. Dynamic ad
placement is intentionally **not implemented** — it is a product decision outside the
payment-tunnel scope, recorded here so the gap is not mistaken for a regression.
