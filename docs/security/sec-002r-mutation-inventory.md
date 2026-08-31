# SEC-002R — commit-boundary mutation inventory

**Status:** working artifact, maintained across remediation rounds. Not a pass/fail verdict.
**Scope:** every mutating route in `server/routes/*.mjs` plus the money/privilege primitives in
`server/lib/` (`finance-ledger.mjs`, `session-store.mjs`, `gift-lifecycle.mjs`,
`stripe-checkout-apply.mjs`, `payment-event-pipeline.mjs`).
**Last updated:** SEC-002R round 3 (this round's 6 fixes + the round-1/round-2 rows re-stated).

---

## 1. Why this file exists

Rounds 1 and 2 each produced a full Class A/B/C inventory — and each one existed only inside a chat
report. An independent spot-check of round 2 correctly recorded "missing inventory artifact" as a
finding in its own right: an inventory that lives in a conversation cannot be diffed, cannot be
reviewed against the code it describes, and cannot be checked for drift by the next round. This file
is that inventory, persisted, with the same depth the round-2 chat report carried.

## 2. The defect being tracked (finding N4)

`server/index.mjs` calls `getAuthContext()` **once**, before the route handler has read the request
body, and the resulting `context` is trusted for the remainder of that request's life. Nothing
re-checks it before a mutation commits. Proven live: an in-flight `PATCH` was admitted with valid
ADMIN authority, the acting admin's session was revoked (logout-all) while the body was still
arriving, and the mutation nevertheless committed.

`reauthorizeAtCommit(tx, context, {action, requiredRoles, interestedPartyIds, selfDealingError})`
(`server/lib/commit-authorization.mjs`) closes that window for the operations where the consequence
justifies the cost. It runs **inside the caller's own transaction**, re-asserts exactly what
`getAuthContext()` asserts (session exists / owned by this user / not revoked / not expired; account
exists and ACTIVE; `session_epoch` still equal to the admitted epoch; at least one required role still
held; actor still not an interested party) and takes `SELECT ... FOR UPDATE` row locks on
`user_sessions` (this session) then `users` (this actor) — the two rows every revocation path writes —
holding them to the caller's commit.

## 3. Classification rules

| Class | Definition | Treatment |
|---|---|---|
| **A** | Irreversible financial or security/privilege mutation. Money that cannot be un-moved, privilege that cannot be un-granted, or destruction of evidence. | `reauthorizeAtCommit()` inside the same transaction as the write, before any effect-producing statement. |
| **B** | Reversible, or security-sensitive but with no ledger entry and no privilege change; every downstream money movement is itself Class A-protected. | Admission-time authorization only. Reason recorded per row. |
| **C** | Ordinary mutation (profile, media, messages, consent, OTP, subscriptions). Worst case of a late commit is "a harmless write landed 40ms after a logout". | Untouched by design. A second authorization round trip on every request is a real permanent cost paid against a negligible window. |

## 4. Lock-order invariant (applies to every Class A row)

`user_sessions` → `users`, everywhere, matching the order `revokeUserAccess()` writes them in.
`setAccountStatus()` was reordered in round 1 (revoke first, then write the status) for exactly this
reason; it is one transaction either way, so the reordering is invisible to callers and to final DB
state. `user_roles` is **read but not locked**: every role REMOVAL goes through `applyRoleChange()`,
which bumps `session_epoch` on the `users` row in the same transaction, so the `users` lock already
blocks it. (The one documented exception, the seller-plan SELLER grant in `finance-ledger.mjs`, is
grant-only and cannot remove authority.)

On the payment-event rails the order is `payment_events` row → `user_sessions` → `users`, in both the
claim phase and the apply phase, so the two phases cannot deadlock against each other.

---

## 5. Class A — protected

Every row: **auth checked** = what `reauthorizeAtCommit` was asked to assert. **Rows locked** =
`user_sessions` (actor's session) + `users` (actor) unless noted. **Lock order** = as §4.
**Revocation paths sharing that state** = `revokeSession` (user_sessions), `revokeUserAccess`
(user_sessions → users), `setAccountStatus` and `applyRoleChange` (both, via `revokeUserAccess`),
`revokeAfterCredentialReset` — all in `server/lib/session-store.mjs`, all writing one or both locked
rows, for every row below. Only the row-specific detail is repeated per entry.

### 5.1 Round 1 (`e244bae`) — 10 endpoints

| # | Endpoint / service | File:line | What it does | Class | Verdict |
|---|---|---|---|---|---|
| A1 | `PATCH /api/admin/payouts/:bookingId/release` | `server/routes/admin.mjs:120` (call `:193`) | Host payout — wallet RELEASE entry | A | atomicity guaranteed |
| A2 | `PATCH /api/admin/bookings/:id/finalize-cancellation` | `server/routes/admin.mjs:233` (call `:330`) | Commission reversal + cancellation fee | A | atomicity guaranteed |
| A3 | `PATCH /api/admin/refunds/:id/execute` | `server/routes/admin.mjs:379` (call `:422`) | Wallet CREDIT to the payer | A | atomicity guaranteed |
| A4 | `PATCH /api/admin/refunds/:id/legacy-accept` | `server/routes/admin.mjs:444` (call `:513`) | Refund finalization + counters | A | atomicity guaranteed |
| A5 | `PATCH /api/admin/review-queue/:type/:id` | `server/routes/admin.mjs:1158` (call `:1203`) | Six decisions in one transaction | A | atomicity guaranteed |
| A6 | `PATCH /api/admin/users/:id/status` | `server/routes/admin.mjs:854` (call `:892`) | Suspension / deletion | A | atomicity guaranteed |
| A7 | `PATCH /api/admin/users/:id/roles` | `server/routes/admin.mjs:914` (call `:958`) | Privilege grant / removal | A | atomicity guaranteed |
| A8 | `POST /api/admin/payment-events/:id/replay` | `server/routes/payment-intents.mjs:709` (hook `:815`) | Re-applies a real payment | A | **bounded race remains** — see §7 |
| A9 | `POST /api/wallet/gifts` | `server/routes/wallet.mjs:21` (call `:51`) | Wallet DEBIT | A | atomicity guaranteed |
| A10 | `POST /api/wallet/gifts/:id/claim` | `server/routes/wallet.mjs:150` (call `:203`) | Wallet CREDIT | A | atomicity guaranteed |

Detail, per entry:

- **A1 payout release.** Auth checked: ADMIN role live, session/account/epoch. Mutation:
  `recordWalletEntry` RELEASE against the host's wallet. Interested parties resolved from a
  `freshBooking` read taken **inside** the transaction (`admin.mjs:172-178`), so the self-dealing
  comparison is a genuine commit-boundary one, not a replay of the admission-time one. Audit: written
  after commit, in its own transaction (Class B gap, §6.1).
- **A2 finalize-cancellation.** Auth checked: ADMIN. Mutation: commission reversal + cancellation-fee
  ledger entries. Interested parties from an in-transaction read. Audit: post-commit (§6.1).
- **A3 refund execute.** Auth checked: ADMIN. Mutation: wallet CREDIT to the payer. Interested parties
  from an in-transaction read of the refund's `paymentProof.userId`. Audit: post-commit (§6.1).
- **A4 legacy-refund-accept.** Auth checked: ADMIN. Mutation: refund finalization + attempt counters.
  Interested parties from an in-transaction read. Audit: post-commit (§6.1).
- **A5 review queue.** Auth checked: ADMIN. Mutation: whichever of the six decision branches applies —
  payment approve/reject (HOLD + platform CREDIT + protection fee + SELLER role grant + driver fare),
  gift approve/block (sender refund), booking confirm/reject (refund request + platform-share
  reversal), KYC approve (publishing entitlement), listing/campaign approve. All six write inside the
  same transaction, so one re-authorization covers every branch and a future seventh branch cannot be
  added past it. `interestedPartyIds` is deliberately **not** passed here: `updateReviewEntity()`
  re-reads the entity inside the same transaction and calls `assertNoSelfReview()` on that fresh row
  — itself a commit-boundary check; duplicating it against a staler copy would be weaker. Audit: the
  audit row **is** inside this transaction (`admin.mjs:1208`).
- **A6 account status.** Auth checked: ADMIN, plus `interestedPartyIds: [targetUserId]`. Mutation:
  `setAccountStatus()` run with the caller's `tx`, so the suspension and the re-authorization share
  one transaction and one lock set. Audit: post-commit (§6.1).
- **A7 role change.** Auth checked: ADMIN, plus `interestedPartyIds: [targetUserId]`. Mutation:
  `applyRoleChange()` with the caller's `tx`. Audit: post-commit (§6.1).
- **A8 payment-event replay.** See §7 — this is the one entry whose verdict is not "atomicity
  guaranteed".
- **A9 gift send / A10 gift claim.** Auth checked: session/account/epoch only (`requiredRoles` empty —
  these routes' own `requireAuth(context)` takes no roles). Mutation: wallet DEBIT / CREDIT via
  `recordWalletEntry` in the same transaction.

### 5.2 Round 2 (`6cb808b` → `1d75718`) — 4 findings + 9 newly-classified

| # | Endpoint / service | File:line | What it does | Class | Verdict |
|---|---|---|---|---|---|
| GAP-1 | `POST /api/payments/stripe/confirm` | `server/routes/payments.mjs:242`; `server/lib/stripe-checkout-apply.mjs:116` | PaymentProof create + `approvePaymentProof` | A | atomicity guaranteed |
| G1 | `PATCH /api/admin/id-document/:userId/upload` | `server/routes/admin.mjs:980` (call `:1043`) | Rewrites another user's KYC state + **irreversibly deletes** their previous ID document | A | atomicity guaranteed |
| G2 | `POST /api/admin/sr/promo-codes` | `server/routes/sr-rides.mjs:735` (call `:773`) | Creates a live discount instrument | A | atomicity guaranteed |
| R2-1 | `PATCH /api/admin/reviews/:id/hide` | `server/routes/admin.mjs:23` (call `:44`) | Attributed moderation state, no un-hide route | A | atomicity guaranteed |
| R2-2 | `PATCH /api/admin/sr/promo-codes/:id` | `server/routes/sr-rides.mjs:810` (call `:831`) | On/off switch for a live discount instrument | A | atomicity guaranteed |
| R2-3 | `POST /api/admin/sr/business-accounts` | `server/routes/sr-rides.mjs:850` (call `:926`) | Privilege grant — `adminUserId` **is** business-admin authority | A | atomicity guaranteed (self-dealing closed in round 3, §5.3) |
| R2-4 | `POST /api/business/members` | `server/routes/business.mjs:61` (call `:90`) | Grants a rider corporate ride-billing authority | A | atomicity guaranteed |
| R2-5 | `DELETE /api/business/members/:userId` | `server/routes/business.mjs:112` (call `:120`) | Revokes it; no undo route | A | atomicity guaranteed |
| R2-6 | `PATCH /api/bookings/:id/cancel` | `server/routes/bookings.mjs:20` (call `:75`) | Marks proofs REFUNDED + `createRefundRequest` **reserves refund capacity in the ledger** | A | atomicity guaranteed |
| R2-7 | `PATCH /api/host/requests/:id` | `server/routes/host.mjs:161` (call `:227`) | Same ledger reservation, host side | A | atomicity guaranteed |
| R2-8 | `PATCH /api/sr/rides/:id/claim` | `server/routes/sr-rides.mjs:462` (call `:517`) | Mutates `fareMinor` on up to two riders' rides + dispatches a driver to a live passenger | A | atomicity guaranteed |
| R2-9 | `registerFailedGiftClaim()` | `server/routes/wallet.mjs:255` | Claim-attempt counter + 10-minute lockout on **another party's** WalletGift row | A | atomicity guaranteed |

Detail, per entry:

- **GAP-1.** Auth checked: GUEST (mirrors the route's own `requireAuth(context, ['GUEST'])`).
  `beforeEffects` is a first-class parameter of `finalizeStripeSession` and runs inside that
  function's own transaction before the first effect-producing statement, so both rails now use one
  mechanism. Session ownership (`session.metadata.guestId === actor`) is checked by the route against
  Stripe's authenticated response and is not re-derivable inside the transaction, so it stays where it
  is; what the hook adds is the account/session/role half, which is re-derivable and lockable.
- **G1.** Auth checked: ADMIN **or** SUPPORT (the route admits both; narrowing to ADMIN would break
  SUPPORT's real workflow). Rows locked: as §4, plus the target `users` row via the `tx.user.update`.
  Mutation: target KYC state + audit row, **both inside the transaction**. The filesystem cannot join
  a Postgres transaction, so ordering carries the destructive half: new blob first (inert until
  referenced) → transaction → superseded blob deleted only **after** commit → new blob deleted if the
  transaction is refused. The previous ref is re-read inside the transaction so a concurrent upload's
  document is never the one destroyed.
- **G2 / R2-2 promo codes.** Auth checked: ADMIN. Audit row inside the transaction.
- **R2-3 business-account onboarding.** Auth checked: ADMIN, and (round 3) `interestedPartyIds:
  [designated.id]` resolved from an in-transaction re-read by email. Audit row inside the transaction.
- **R2-4 / R2-5 business membership.** Auth checked: GUEST (the route's own list — "business admin" is
  not a role, it is `businessAccount.adminUserId === context.user.id`). No audit row exists on these
  routes.
- **R2-6 / R2-7 booking cancel + host decision.** Auth checked: GUEST, and HOST/SELLER respectively —
  each mirroring its route's own `requireAuth` list exactly. The ledger reservation performed by
  `createRefundRequest` is what makes these Class A rather than Class B. Audit: post-commit (§6.1).
- **R2-8 driver claim.** Auth checked: DRIVER. Mutation: `fareMinor` on up to two rides + the
  assignment, in one transaction. Audit: post-commit (§6.1).
- **R2-9 failed gift claim.** Auth checked: session/account/epoch. Mutation: counter + lockout on a
  third party's row.

### 5.3 Round 3 (this round) — 6 items

| # | Endpoint / service | File:line | What it does | Class | Verdict |
|---|---|---|---|---|---|
| R3-1 | `PATCH /api/me/id-document` | `server/routes/me.mjs:11` (call `:59`) | Rewrites the actor's own KYC state + **irreversibly deletes** their previous ID document | A | atomicity guaranteed |
| R3-2 | `PATCH /api/sr/rides/:id/assign-driver` | `server/routes/sr-rides.mjs:380` (call `:425`) | Dispatches a named driver to a live passenger | A | atomicity guaranteed |
| R3-3 | `PATCH /api/sr/rides/:id/cancel` | `server/routes/sr-rides.mjs:296` (call `:344`) | Writes `cancellationFeeMinor` — a real money field with no reversal endpoint | A | atomicity guaranteed |
| R3-4 | `PATCH /api/driver/rides/:id/status` → `COMPLETED` | `server/routes/driver.mjs:166` (call `:206`) | Makes a fare billable to a corporate account and payable to a driver | A | atomicity guaranteed |
| R3-5 | `POST /api/admin/sr/business-accounts` (self-dealing) | `server/routes/sr-rides.mjs:850` (call `:926`) | An ADMIN naming themselves the business-admin of a company they create | A | atomicity guaranteed for the boundary; **residual: collusion / second identity**, §8.1 |
| R3-6 | A8 reversal mechanism | `server/lib/payment-event-pipeline.mjs` | Compensating reversal of a refused claim | A | **bounded race remains** — see §7 |

Detail, per entry:

- **R3-1 self-service KYC upload.** *Auth checked:* session exists / owned by this user / not revoked
  / not expired; account exists and ACTIVE; `session_epoch` equals the admitted epoch. `requiredRoles`
  is deliberately **empty** — this route's own `requireAuth(context)` takes no roles, so the re-check
  asserts exactly what admission asserted and nothing more. No `interestedPartyIds`: the actor
  legitimately *is* the subject. *Rows locked:* `user_sessions` (actor's session), `users` (actor —
  which is also the row being mutated, so the mutation target and the authority row are the same
  locked row). *Lock order:* `user_sessions` → `users`. *Mutation:* `idDocumentRef`,
  `idDocumentMimeType`, `idDocumentSubmittedAt`, `idDocumentStatus → PENDING_REVIEW`,
  `idDocumentReviewedById → null`, `idDocumentReviewedAt → null`. *Audit side effects:* none — this
  route never wrote an audit row, and adding one is a separate change, recorded in §8.3 rather than
  made silently. *Non-transactional side effect:* the blob store, handled by ordering exactly as G1
  does — new blob written first (inert until referenced), superseded blob deleted **only after the
  transaction commits**, new blob deleted if the transaction is refused or throws. A refused request
  therefore destroys nothing and leaves nothing behind. *Verdict: atomicity guaranteed* — no
  revocation can commit inside the window, and the irreversible delete is unreachable on a refused
  path.
- **R3-2 assign-driver.** *Auth checked:* ADMIN **or** SUPPORT — matching the route's own
  `requireAuth(context, ['ADMIN','SUPPORT'])` exactly, neither widened nor narrowed. *Rows locked:*
  `user_sessions` + `users` (actor), then the `ride_requests` row via the guarded `updateMany`.
  *Lock order:* `user_sessions` → `users` → `ride_requests`. *Mutation:* `driverId`,
  `status → DRIVER_ASSIGNED`, guarded on the status read before the transaction (optimistic
  concurrency, unchanged). *Audit side effects:* `SR_DRIVER_ASSIGNED` audit row, written after commit
  in its own transaction (§6.1). *Verdict: atomicity guaranteed.*
- **R3-3 rider cancel.** *Auth checked:* GUEST — matching the route's own
  `requireAuth(context, ['GUEST'])`. `interestedPartyIds` is deliberately **not** passed: the route is
  self-scoped (`existing.riderId !== context.user.id` → 404), so the actor legitimately is the
  interested party and passing it would refuse every real cancellation. *Rows locked:* `user_sessions`
  + `users` (actor), then the `ride_requests` row. *Mutation:* `status → CANCELLED` and
  `cancellationFeeMinor` (0–20% of the ride's own locked `fareMinor`, only when a driver was already
  committed). The self-scope is now carried **into** the guarded write's WHERE clause
  (`riderId: context.user.id`) so the protected statement stands on its own rather than trusting the
  pre-transaction read. *Audit side effects:* `SR_RIDER_CANCELLED`, post-commit (§6.1). *Verdict:
  atomicity guaranteed.*
- **R3-4 driver COMPLETED.** *Auth checked:* DRIVER — matching `requireAuth(context, ['DRIVER'])`.
  Self-scoped via `driverId: context.user.id`, so no `interestedPartyIds`. *Rows locked:*
  `user_sessions` + `users` (actor), then the `ride_requests` row. *Mutation:* `status → COMPLETED`,
  guarded on the read status **and** on `driverId`. *Why Class A:* `server/routes/business.mjs`'s
  `/api/business/usage` totals corporate spend as
  `rides.filter(r => r.status === 'COMPLETED').reduce((sum, r) => sum + r.fareMinor, 0)`, and
  `server/routes/driver.mjs`'s own overview computes `earningsMinor` the same way — writing COMPLETED
  is the act that turns a trip into money owed. There is no un-complete endpoint. *Audit side
  effects:* `DRIVER_COMPLETED`, post-commit (§6.1). *Scope note:* the other transitions on this route
  (`DRIVER_ARRIVING`, `IN_PROGRESS`) are Class B — see §6.2 — and were deliberately not wrapped.
  *Verdict: atomicity guaranteed for the COMPLETED transition.*
- **R3-5 business-account self-dealing.** See §8.1 for the full mechanism.
- **R3-6 A8 reversal.** See §7.

---

## 6. Class B — reversible or non-privilege, deliberately not commit-boundary re-authorized

### 6.1 The out-of-transaction audit-log write (A2, A3, A6, A7, A8, booking-cancel, host-decision, driver-claim, R3-2, R3-3, R3-4)

These handlers write their `AdminAuditLog` row **after** the protected mutation commits, in a separate
transaction. Classified **Class B** by the independent round-2 spot-check and preserved as such:
bounded, no auth bypass, no financial impact. A crash between the two leaves a real mutation with no
audit row — a completeness gap in the trail, not a way to alter the protected action itself. This
classification is preserved unless new evidence shows the gap can alter the **protected action**, not
merely the record of it. Round 3 looked for such evidence and found none; no audit write was moved
into a protected transaction this round. (A5 and G1/G2/R2-2/R2-3 already write their audit row inside
the transaction; those are not part of this gap.)

### 6.2 Everything else classified B

| Endpoint / service | File:line | Reason it is B, not A |
|---|---|---|
| `PATCH /api/driver/rides/:id/status` → `DRIVER_ARRIVING`, `IN_PROGRESS` | `server/routes/driver.mjs:166` | Neither status is summed by any money computation in this codebase; neither is financially irreversible. Only the COMPLETED transition is (R3-4). |
| Advertising-payment binding on listing create | `server/routes/listings.mjs` | Released again by campaign rejection; no ledger entry. |
| `PATCH /api/admin/id-document/:userId/upload` — *original round-1 classification* | `server/routes/admin.mjs:980` | **Superseded.** Round 1 called this B on the reasoning that it only ever REMOVES an entitlement (fail-safe). That reasoning missed the irreversible `deleteIdDocument()` of the target's prior document. Reclassified A and fixed in round 2 as G1. Kept here as a record of a classification that was wrong. |
| `PATCH /api/sr/rides/:id/assign-driver`, promo codes, business accounts — *original round-1 classification* | `server/routes/sr-rides.mjs` | **Superseded.** Round 1 called these "reversible admin config". Promo codes and business accounts were reclassified A in round 2; assign-driver was reclassified A in round 3 (R3-2) — it is the same durable effect as `/claim`, which round 2 had already protected. |
| `PATCH /api/sr/rides/:id/cancel` — *original classification* | `server/routes/sr-rides.mjs:296` | **Superseded.** Not separately listed by rounds 1–2; reclassified A in round 3 (R3-3) because it writes a real money field. |
| `POST /api/auth/logout`, `POST /api/auth/logout-all` | `server/routes/auth.mjs` | They only ever REDUCE authority. Protecting them would be self-defeating: a revoked session must still be able to complete its own logout. |
| `PATCH /api/host/listings/:id/status`, `/instant-book`, `/availability` | `server/routes/host.mjs:582`, `:636`, `:387` | Host-controlled listing configuration, fully reversible by the same actor, no ledger entry. |
| `PATCH /api/bookings/:id/dispute` | `server/routes/bookings.mjs:171` | Opens a dispute; blocks payout rather than moving money. The payout release it blocks is itself A1. |
| `PATCH /api/host/requests/:id/checkin` | `server/routes/host.mjs:325` | Lifecycle marker; the money consequence (payout eligibility) runs through A1. |

## 7. Class C — untouched by design

Profile fields, saved places (`server/routes/me.mjs:118`, `:161`), listing media, messages, driver
location (`server/routes/driver.mjs:23`), driver accessibility flag (`:44`), driver photo (`:59`), ride
share links, legal consent, OTP issue/verify, push subscribe/unsubscribe. Adding a second DB
authorization round trip to every one of these buys a theoretically smaller window on operations whose
worst case is "a harmless write landed 40ms after a logout".

> Note: `POST /api/push/subscribe` (`server/routes/push.mjs:15`) has a **separate, unrelated**
> cross-user subscription-hijack defect. It is not a commit-boundary issue, is explicitly out of scope
> for SEC-002R, and needs its own security ticket. Its Class C status here refers only to the
> commit-boundary question.

---

## 8. Class A verdicts that are NOT "atomicity guaranteed"

### 8.1 R3-5 — business-account self-dealing: closed at the boundary, residual is collusion

**The attack.** `businessAccount.adminUserId` is the entirety of a business account's authority:
`loadOwnBusinessAccount()` (`server/routes/business.mjs:13`) derives "is this caller the company's
admin" from `businessAccount.adminUserId === context.user.id` and nothing else. A platform ADMIN who
named themselves there walked straight into `POST /api/business/members` and granted any rider standing
authority to bill real rides to that company, whose corporate usage `business.mjs` then totals as
genuine money owed. One admin, acting alone, creating the company and holding its purse.

**The fix** (`server/routes/sr-rides.mjs:926`). The same predicate the other nine admin decision paths
use (`115aa09`'s `assertNotInterestedParty`/`assertNoSelfReview`), via the **same shared mechanism** —
`reauthorizeAtCommit`'s `interestedPartyIds` — not a parallel one. The designated admin's id is re-read
**inside** the transaction, by the same email, immediately before the check, so an account swap
committing between the outer lookup and this write cannot slip past it. The refusal carries its own
code, `BUSINESS_ACCOUNT_SELF_DEALING` (403), via the new `selfDealingError` option on
`reauthorizeAtCommit` — the predicate is shared, only the wording of the refusal is per-call-site, so
an operator is told which rule they hit rather than reading review-queue language.

**Residual, stated plainly.** This blocks the actor naming **themselves**. "Any account they control"
is **not determinable** in this codebase: there is no account-ownership or delegation graph, so an
admin who controls a second, unrelated account can still name that one. That is a collusion /
second-identity problem, not something this check can see, and it is not closed. Two admins colluding
are likewise not addressed — the same limit every self-review check in this codebase has.

### 8.2 A8 / R3-6 — payment-event replay reversal: bounded race remains

**What was claimed and what was true.** Round 2 reported A8 as "atomicity guaranteed". Two parts of
that were overstated:

1. **The claim CAS + `authorizeClaim` sharing one transaction is correct** and was not touched this
   round. A revoked actor's claim rolls back with the event row untouched, and round 2's suite proves
   it (`commit-boundary-reauthorization-round2.e2e.mjs` §7).
2. **`priorStatus` was read without a lock**, by a plain `findUnique`, *before* the locking CAS
   `updateMany` — two statements, two snapshots, and under READ COMMITTED a plain SELECT never blocks
   on another transaction's row lock. A concurrent transaction committing between them could make
   `priorStatus` stale. Concretely: `findUnique` reads `FAILED`; a concurrent transaction commits
   `DEAD_LETTERED`; the CAS (for which DEAD_LETTERED is equally claimable) claims the row; the reversal
   below then writes `FAILED` back — **silently un-dead-lettering a real payment event**, putting it
   back on the automatic retry path a human had already been made responsible for.
3. **The compensating reversal is a separate transaction whose failure was silently swallowed** by a
   bare `.catch(e2 => log.error(...))`.

**What round 3 changed.**

- (2) is **closed**. `priorStatus` is now read `SELECT processing_status FROM payment_events WHERE
  id = $1 FOR UPDATE` as the **first statement of the claim transaction**, so the row lock is taken
  before the CAS and held for the whole transaction. Either a concurrent writer committed before our
  lock was granted (and this SELECT observes its value, which *is* the true prior status) or it blocks
  until we commit. There is no third ordering. Lock order is unchanged: `payment_events` row →
  `user_sessions` → `users`, the same order the rails' own apply transactions use
  (`verifyAndLockClaim` then `beforeEffects`), so the claim phase and a concurrent apply phase still
  cannot deadlock.
- (3) is **mitigated, not eliminated**. The reversal is bounded-retried (3 attempts, 50 ms × attempt),
  and if it still cannot be applied it is **not swallowed**: a durable, actorless
  `PAYMENT_EVENT_REAUTH_REVERSAL_FAILED` audit row is written naming the event, the claim token still
  holding it, and the status the reversal intended to restore; and a distinguishable
  `PAYMENT_EVENT_REAUTH_REVERSAL_FAILED` error is raised **instead of** the re-authorization error, so
  the caller — and, on the admin replay route, that route's own audit row — records a stranded claim
  rather than reporting a clean refusal over a row left at APPLYING with an inflated attempts count.

**Why the reversal cannot join the failed transaction (architecture, not laziness).** The
re-authorization throws *inside the rail's own `apply()` transaction*, which Postgres then rolls back
in full — by construction nothing written there can survive, so the compensation cannot live in it.
Nor can the claim simply be deferred until re-auth is known to pass:

- the claim's `APPLYING` marker plus `claimExpiresAt` is what makes concurrent workers lose the CAS,
  and what makes a crashed worker's abandoned claim recoverable at all (round 6's fix); and
- `attempts` **must survive a failed apply** — if the increment rolled back with the effects,
  `DEAD_LETTER_THRESHOLD` could never be reached, and the bounded retry ceiling that protects every
  legitimate caller would silently become an infinite retry loop with no dead-lettering.

Merging the claim and apply phases would break exactly those two behaviours for every honest webhook
delivery. That is the trade, stated precisely.

**Verdict: bounded race remains.** The residual, after round 3, is: a re-authorization refusal landing
in the claim-commit → apply window whose compensating reversal then *also* fails three times **and**
whose durable marker write also fails, leaves the event row at `APPLYING` with `attempts` one higher
than it should be, until its claim expires (`CLAIM_DURATION_MS`, 120 s) and any later delivery or admin
replay reclaims it. **No money moves on that path** — the apply transaction rolled back in full, so no
`PaymentProof`, no wallet entry, no booking/intent transition ever committed; the only reachable state
is bookkeeping on the event row itself, and the row remains reclaimable by design. This is not closed
and is not described as closed.

### 8.3 Known gaps recorded here rather than fixed

- **`/api/me/id-document` writes no audit row at all** (before or after this round). The admin-side
  equivalent (G1) does. Not added in round 3 — out of the scoped 8 items.
- **An ADMIN who also holds DRIVER self-assigning via `/api/sr/rides/:id/assign-driver`** is a distinct
  policy question (the endpoint validates the target holds DRIVER and is ACTIVE, but does not compare
  the target to the actor). Not decided in round 3.
- **Out of SEC-002R scope entirely, tracked elsewhere:** the host-listing ADMIN owner-scope bypass
  (`server/routes/host.mjs`, `PATCH /api/host/listings/:id`) — a standing-authorization/IDOR issue on a
  separate track; and the `POST /api/push/subscribe` cross-user subscription-hijack bug. Neither is
  touched by any SEC-002R round.

---

## 9. Evidence

| Suite | Covers |
|---|---|
| `tests/e2e/commit-boundary-reauthorization.e2e.mjs` | Round 1, 79 checks. **Frozen** — reproduction record for the round-1 FAIL verdict. |
| `tests/e2e/commit-boundary-reauthorization-round2.e2e.mjs` | Round 2, 227 checks. **Frozen.** |
| `tests/e2e/commit-boundary-reauthorization-stripe-round2.e2e.mjs` | Round 2, stripe_checkout replay rail, 19 checks. **Frozen.** |
| `tests/e2e/commit-boundary-reauthorization-round3.e2e.mjs` | Round 3, items 1–6, 92 checks — including the business-account self-dealing rule (§5), the A8 reversal branch on **both** rails, and the differential proof of the stale-`priorStatus` fix (§6b). |
| `tests/e2e/admin-self-review-protection.e2e.mjs` | The nine `115aa09` self-dealing paths. Round 3 changed only its booking fixture (a dedicated fresh listing instead of a shared one) — no assertion changed. |

**Not covered by any test, code-verified only:** the *failure* leg of A8's reversal — the bounded
retry exhausting and the `PAYMENT_EVENT_REAUTH_REVERSAL_FAILED` marker + distinguishable error being
raised. Reaching it requires injecting a database fault mid-compensation, which this harness has no
safe way to do. §6a-5 and §6a-12 assert the *converse* (a clean reversal raises no stranded error and
writes no marker), so the branch is proven not to fire spuriously; that it fires correctly when the
database genuinely fails is code-review only, and is stated as such.

All suites are registered in `scripts/run-all-e2e.sh` and run against local `sybnb_v6` only.
