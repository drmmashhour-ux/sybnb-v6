# SR Ride vs. Uber Gap-Closure — Capsule 28: Promo Codes

**Source finding:** P2 #12 of `sr-ride-vs-uber-benchmark.md` — "No promo codes."
**Commit:** `3c9ac7b` on `candidate/satisfaction-remediation`
**Scope:** New tables (`034_ride_promo_codes`, purely additive). Owner confirmation required before building — obtained via AskUserQuestion.
**Status: DONE — verified live, committed.**

---

## Why this one needed an answer first

Every other money-adjacent gap closed this arc — ride-payment commission, the cancellation fee — had a safe, honest, disclosed default to build against ("0% until a real business decision is made"). A promo code has no equivalent neutral default: a code worth 0% is just decoration. So before writing anything, the discount/redemption model was put to the owner directly: **"Simple % or flat-off, admin-created"** — admins create codes in the admin panel (e.g. "WELCOME20" = 20% off, capped at a max discount, single redemption per rider), confirmed 2026-08-26.

## What changed

- **`PromoCode`**: code, discount type (`PERCENT`/`FLAT`), discount value, an optional max-discount cap (percent only), active flag, optional expiry.
- **`PromoRedemption`**: its `UNIQUE(promo_code_id, user_id)` constraint *is* the single-redemption-per-rider rule — an atomic database guarantee, not a read-then-write check that a race could slip through.
- **`server/lib/promo-code.mjs`**: validates a code is active and not expired; computes the discount always from the ride's own already-locked fare — never a client-supplied discount amount, the same discipline every other money-adjacent field in this codebase follows.
- **Ride creation**: an optional promo code is validated read-only first, then the ride *and* its redemption row are created in a single transaction — a concurrent double-submission of the same code by the same rider rolls the whole ride creation back rather than leaving a discounted ride with no valid redemption record.
- **Admin routes**: create/list/deactivate a code, at `/api/admin/sr/promo-codes`.
- **`AdminPromoCodesPage.tsx`**: a small, dedicated admin page — deliberately not merged into the large existing STAYS-focused admin dashboard, matching this arc's pattern of small self-contained SR-Ride pages.
- **`SrRidePage.tsx`**: an optional promo-code field on the request form, and the applied discount shown on the completed-ride receipt.

## Verification (live, not code review)

1. A 20%-off code capped at 3,000 SYP, redeemed on a 30,000 SYP fare → correctly charges 27,000 (the cap wins over the uncapped 6,000 discount).
2. The same rider redeeming the same code again → `409 PROMO_CODE_ALREADY_USED`, and the database confirms **no orphaned ride or extra redemption row** was left behind — exactly one ride, one redemption — proving the transaction rollback actually works, not just that the error response looked right.
3. An invalid/nonexistent code, and a code already past its expiry → both `400 PROMO_CODE_INVALID`.
4. A flat 5,000 SYP code correctly deducts exactly 5,000 from a 12,500 fare → 7,500.
5. Deactivating a code via the admin toggle → a different rider's redemption attempt on that now-inactive code is correctly refused.
6. `tsc --noEmit`, `prisma validate`, `npm run build` — all clean.
7. Static payment-policy-enforcement audit: **114/114 passed**, unchanged — no wallet-touching code path was added; the discount only ever affects `fareMinor` before any payment happens.
8. All test fixtures (2 users, 2 rides, 3 promo codes) removed via direct `psql` in FK order.

---

**This closes every numbered gap from the Uber benchmark except push notifications**, which remains genuinely blocked — it needs real external credentials (VAPID keys, or a push-provider account) that only you can supply.
