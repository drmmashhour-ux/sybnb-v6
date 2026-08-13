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

### Product gap (documented, NOT SUPPORTED)

The landing **"Featured ads" marquee is static** (hardcoded `AD_SPONSORS` in
`src/modules/landing/LandingPage.tsx`). Approved advertising campaigns do **not** dynamically
appear there; an approved ad surfaces as a normal `APPROVED` listing in its division. Dynamic ad
placement is intentionally **not implemented** — it is a product decision outside the
payment-tunnel scope, recorded here so the gap is not mistaken for a regression.
