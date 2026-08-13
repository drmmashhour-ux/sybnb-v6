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
