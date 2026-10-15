# MSH rewards draft — V6

The signed-in MSH page (`#/wallet/msh`) now has a rule calculator. Rates start blank. The member can enter 0–100 whole test MSH units per completed stay and per completed ride, with at least one positive rate. This is an unsaved per-view simulation, not a program setting, entitlement ledger, monetary reward, or token issuance. Rewards remain disabled. There is no wallet requirement, enrollment, claim, redemption, signing or transfer action.

`GET /api/me/msh-rewards-preview` requires authentication. It returns only the authenticated guest's stays and rider's rides; client-supplied account IDs are ignored. Each service query is capped at its latest 100 completed records, plus a sentinel to report truncation. This is explicitly not a lifetime total. The two queries run in a read-only RepeatableRead snapshot. Reads do not trigger booking completion or the existing loyalty awarding sweep.

An entry qualifies for preview only when its status is COMPLETED, its amount is a positive integer, and same-currency APPROVED payment proofs cover the amount. Any associated REFUNDED proof or positive reserved, succeeded or accepted refund amount holds the preview entry. Alternate payment paths without qualifying proofs, missing or zero amounts, and unpaid completions remain held. The projection uses stable service+record references and does not multiply activity when a record appears twice. Refresh reads current state; it does not preserve an earlier eligibility decision.

Hosts/drivers do not receive preview awards in this phase. Cancelled/disputed/in-progress services are not included. Existing loyalty points and their redemption, money ledgers, refunds, booking prices and the 15% stays commission have no runtime changes. No database migration, provider configuration, legal publication, public access change, mainnet deployment or payment activation is included.

## Validation

Run `npm run test:unit`, then `npm run build`. Start a loopback preview and run `MSH_PREVIEW_URL=http://127.0.0.1:<port> python scripts/msh/rewards-browser-check.py` with Playwright/Chromium. Browser tests mock the new API; they do not certify real database behavior. The existing `scripts/msh/browser-check.py` checks the read-only wallet flow (port 5187).

Database/API and full governed validation remain required in the isolated test database. The unmodified governed runner contains broad process-stop and database defaults; use the delivered isolated helper, not the runner against a personal or production database. In this cloud instance, Prisma checksum download previously returned HTTP 403. On the owner's Mac, Docker startup is currently blocked by internal IPC timeouts.

## Next phase

Owner-reviewed rules must be versioned and saved server-side before enabling earning. A future award system requires durable idempotent entries, cancellation/refund reversals, concurrency tests, limits and reconciliation. Any token issuance requires a separate treasury/signing design and explicit authorization. Monetary redemption and a live transferable token require separate product, security and legal review. Do not convert this projection into a financial balance.
