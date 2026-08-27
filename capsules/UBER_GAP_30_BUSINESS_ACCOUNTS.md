# SR Ride vs. Uber Gap-Closure — Capsule 30: Business/Corporate Accounts

**Source finding:** benchmark item, previously assessed as out of reasonable scope.
**Commit:** `109217c` on `candidate/satisfaction-remediation`
**Scope:** New tables (`036_business_accounts`, purely additive). No new money-movement logic.
**Status: DONE — verified live, committed.**

---

## What "real MVP" means here

This was one of two items flagged earlier as too large to build honestly within this arc. Rather than leave it undone or fake it, this capsule builds the real, load-bearing core — company onboarding, real membership, real ride attribution, a real usage report — and deliberately stops short of inventing things that need an actual business-policy decision (invoicing cadence, spend limits, net payment terms). That line is the same one that made promo codes need a real answer from the owner first: a discount value can't be invented, and neither can a billing model. What's real here doesn't need one — it's genuine data plumbing, not a policy choice.

## What changed

- **`BusinessAccount`** / **`BusinessAccountMember`**: a company, its designated admin, and its members (existing riders, added by email).
- **No new auth role.** A "business admin" is just a signed-in rider whose id matches `businessAccount.adminUserId` — the same ownership-check pattern already used everywhere in this codebase (a rider owns their own ride, a driver owns their own claim), not a new permission system.
- **Platform admin onboards a company** (`/api/admin/sr/business-accounts`) — the designated admin must already be a real, existing user found by email, the same "never invent a backing record" discipline used for driver-photo review and promo codes.
- **The company's own admin is then fully self-service** from `/api/business/*` — add/remove members, view a real usage report — no further platform-admin involvement needed.
- **Ride attribution is real, not client-trusted**: a rider can only bill a ride to a company they're an actual, currently-active member of, checked server-side — never a client-supplied business account id.
- **Billing itself changes nothing about payment**: a business-tagged ride still goes through the exact same per-ride manual-proof rail every other ride uses. This capsule adds attribution and reporting, not a new money-movement path.

## Verification (live, not code review)

1. A real, unrelated account attempting to manage a business account it doesn't administer → `403 BUSINESS_ACCOUNT_NOT_ADMIN`.
2. The real designated company admin can view their account.
3. Adding a real employee by email succeeds; adding the same one again → `409 BUSINESS_MEMBER_DUPLICATE`; adding an email with no account → `404 BUSINESS_MEMBER_USER_NOT_FOUND`.
4. A real member requesting a ride with billing enabled → the ride is correctly tagged with the real business account id; a non-member attempting the same → `403 BUSINESS_ACCOUNT_NOT_MEMBER`.
5. The usage report correctly totals a completed billed ride's real fare.
6. Removing a member takes effect immediately — their next billing attempt is correctly refused.
7. `tsc --noEmit`, `prisma validate`, `npm run build` — all clean.
8. Static payment-policy-enforcement audit: **122/122 passed** (up from 118), 0 failed — confirms no new money-movement code path was introduced, only attribution.
9. All test fixtures (3 users, 1 business account, 1 membership, 1 ride) removed via direct `psql` in FK order.

---

Next: ride-pooling, the last remaining item — also being built as a real, honestly-scoped MVP rather than skipped or faked.
