# SYBNB V6 — Security Audit

Date: 2026-07-10
Branch: `security/sybnb-v6-predeployment`
Scope: `server/` (Node HTTP API, hand-rolled router, Prisma/Postgres) and `src/` (React/Vite frontend).
Method: direct code review with file:line evidence, live git-history secret scan, and cross-referencing
against fixes already applied earlier in this engagement. This is a code-level audit, not a penetration
test against a running deployment — no external network scanning, no fuzzing, no live exploit attempts
against production infrastructure (none exists yet).

Findings are IDed F-01 through F-17 below, then formally classified with severity in the companion risk
register (`SYBNB_V6_THREAT_MODEL.md` §Risk Register) per Phase 3 of the security order.

---

## 1. Authentication

**Files reviewed:** `server/lib/security.mjs`, `server/routes/auth.mjs`, `server/lib/auth-context.mjs`.

### What's implemented and correct
- **Password storage**: `scrypt` (memory-hard KDF) with a random 16-byte salt per user, 64-byte
  derived key, stored as `scrypt:v1:<salt>:<key>`. Comparison uses `crypto.timingSafeEqual`
  (`security.mjs:44-51`). This is a sound, modern choice — not a weak/legacy hash.
- **Session tokens**: a custom HMAC-SHA256-signed structure (`base64url(payload).base64url(hmac)`),
  not a third-party JWT library, but equivalent in security properties. Signature verification uses
  `timingSafeEqual` (`security.mjs:81-97`).
- **Fresh authorization on every request** (this is the standout strength): `getAuthContext()`
  (`auth-context.mjs:4-20`) re-fetches the user row and their current roles from the database on
  *every single request* — it does **not** trust the `roles` array embedded in the token payload for
  authorization decisions. This means an admin revoking a role, or suspending an account
  (`user.status !== 'ACTIVE'`), takes effect on the attacker's very next request, not after token
  expiry. This avoids the classic stale-JWT-claims footgun.
- **Registration** correctly restricts self-registerable roles to `GUEST/HOST/SELLER/DRIVER`
  (`auth.mjs:5,12-18`) — `ADMIN`/`SUPPORT` cannot be self-registered, confirmed and relied upon
  throughout this engagement's testing (admin test accounts were always provisioned via
  register-as-HOST-then-grant-role-via-SQL, never direct self-registration).
- **Login** returns a generic `"Invalid login credentials."` message regardless of whether the
  identifier or the password was wrong (`auth.mjs:83-89`) — does not leak *which* part was incorrect.

### F-01 — No password-reset flow exists
`grep` across all of `server/` for reset/forgot-password logic returns nothing. A user who forgets
their password has no self-service recovery path at all. The only workaround would be an
out-of-band, unaudited manual DB update by whoever has database access — which is itself worse for
security than a proper reset flow.

### F-02 — No server-side session revocation / no logout endpoint
`grep` across all of `server/routes/auth.mjs` and the whole `server/` tree for a logout route returns
nothing. Sessions are purely stateless HMAC tokens with a 7-day TTL (`SESSION_TTL_SECONDS`,
`security.mjs:4`) and no server-side revocation list. Consequences:
- "Logout" observed throughout this engagement is client-side only (clearing `sessionStorage`) — the
  token itself remains cryptographically valid for up to 7 days after the user believes they've
  logged out.
- If a token is compromised (e.g. via a compromised browser extension or a supply-chain issue —
  see §2), there is no way to invalidate that *specific* token without either waiting out the 7-day
  window or rotating `AUTH_SECRET` platform-wide (which would also log out every other user).
- There is no "sign out of all devices" capability and no visibility into how many active
  sessions a user has.

### F-03 — Login has a timing side-channel for account enumeration
`auth.mjs:83`: `if (!user || user.status !== 'ACTIVE' || !verifyPassword(...))`. Because of
short-circuit evaluation, `verifyPassword` (which runs a ~expensive `scryptSync`) is **never invoked**
when no matching user exists. An attacker measuring response latency can distinguish "no such
account" (fast) from "account exists, wrong password" (slow, scrypt runs), enabling account/phone
enumeration even though the error *message* is identical in both cases.

### F-04 — No login attempt throttling / no account lockout
Ties into rate limiting (§4). Nothing currently prevents unlimited password-guessing attempts against
a single account or across accounts.

### F-05 — No account deletion/deactivation endpoint (Informational)
No `DELETE`-style account endpoint was found. This may be an intentional current-scope decision, not
necessarily a defect, but is worth an explicit product decision given eventual data-subject-rights
obligations.

---

## 2. Token storage and XSS exposure

**Files reviewed:** all of `src/`, `index.html`.

The frontend stores bearer tokens in `sessionStorage` (confirmed throughout this engagement — e.g.
`sybnb-v6-guest-token`, `sybnb.v6.guestSession`, and the equivalent staff-session keys), which is
readable by any JavaScript executing on the page's origin. This is the single architectural decision
the order specifically asked to have assessed rather than automatically changed.

**What was actually checked, with evidence, rather than assumed:**
- `grep -rn "dangerouslySetInnerHTML" src/` → **zero matches**. No component renders raw
  attacker-influenced HTML.
- `grep -rn "\beval(\|new Function(" src/` → **zero matches**.
- `grep -rn "document\.write" src/` → **zero matches**.
- `index.html` loads exactly one script: `/src/main.tsx`, self-hosted, bundled by Vite. **No
  third-party `<script src="...">` tags at all** — no CDN-hosted analytics, ads, chat widgets, or
  similar first-party-trusted-but-externally-served code that could be compromised upstream and
  inject a token-stealing payload.
- The one `window.location.href = ...` assignment in the whole codebase
  (`src/modules/bookings/BookingDetailPage.tsx:208`) assigns a URL that originates from Stripe's own
  Checkout Session API response, round-tripped through our own backend — not from a client-controlled
  query parameter — so it is not an open-redirect vector.
- All `returnPath`/`redirectTo`-style values found (`AppShell.tsx`, `App.tsx`) are internal hash-router
  paths (always start with `/`, compared with `.startsWith('/rentals')` etc.), never treated as a full
  external URL — no open-redirect vector there either.

**Conclusion:** the application's *own* first-party code presents essentially no first-party XSS
injection surface as written today. The realistic residual risk to a `sessionStorage`-held token is
not "this app has an XSS bug" but a **supply-chain compromise of an npm dependency** that executes
arbitrary JS in-page. `npm audit` reporting 0 known vulnerabilities (confirmed this session) does not
rule this out — it only covers packages with *publicly disclosed* CVEs, not a deliberately malicious
package or an undisclosed 0-day.

### F-06 — No Content-Security-Policy, so there's no defense-in-depth if the above ever changes
Given the above, `sessionStorage`-based tokens are a defensible choice for the current architecture —
but there is currently **zero CSP header** (see §6) that would contain the blast radius if a
dependency were ever compromised. This is the concrete, actionable gap, not the storage location
itself.

**Recommendation (per the order's explicit instruction not to auto-migrate):** do not move tokens off
`sessionStorage` in this phase. Add a CSP restricting `script-src`/`connect-src` as
defense-in-depth (Phase 6) — **on the frontend origin that actually holds the token**, not the API.
A cookie+CSRF-token architecture is the long-term safer pattern but is a breaking
authentication-model change explicitly out of scope for "narrow, evidence-supported repairs"
per this order's own stop condition (Phase 3).

**Correction (independent-review pass, 2026-07-11):** the Phase 6 repair that followed this
recommendation added a CSP header to the API (`server/lib/security-headers.mjs`) only — it does
not protect the frontend/`sessionStorage` this section is actually about, since the API never
serves the frontend's HTML/JS. This was flagged in independent review and corrected: a real
frontend-origin CSP now exists (a `<meta>` tag in `index.html`), documented in full in
`docs/security/SYBNB_V6_FRONTEND_CSP_PLAN.md`, including what it covers and what's still
EXTERNAL INFRASTRUCTURE REQUIRED / OWNER DECISION REQUIRED (`frame-ancestors` cannot be delivered
via `<meta>` at all; the production `connect-src` origin isn't decided since no production
environment exists yet).

---

## 3. Authorization

**Files reviewed:** every route file — `admin.mjs`, `auth.mjs`, `bookings.mjs`, `driver.mjs`,
`host.mjs`, `listings.mjs`, `me.mjs`, `messages.mjs`, `payments.mjs`, `reviews.mjs`, `sr-rides.mjs`,
`wallet.mjs`.

Every sensitive endpoint gates through `requireAuth(context, [roles])`
(`server/lib/auth-context.mjs:22-38`), which throws `401` if unauthenticated and `403` if the caller's
*current* (freshly re-fetched) roles don't intersect the required set. Confirmed present on every
route file above via systematic grep, not spot-checked.

**Specific patterns already verified correct (several fixed earlier in this engagement, re-confirmed
here as part of this audit rather than assumed still-correct):**
- ID-document *approval* is `ADMIN`-only, not `SUPPORT` (`admin.mjs`, the review-queue decision
  endpoint) — stricter than the queue-*viewing* GET, which does allow `SUPPORT`.
- ID-document *file serving* resolves the storage key server-side from the target `userId`
  (`admin.mjs:196-215`), never accepting a client-supplied storage key directly — no IDOR, and the
  storage key itself is revalidated against a strict regex before any filesystem access
  (`id-document-storage.mjs:54-65`), which also closes path traversal even against a corrupted value.
- Stripe checkout-session confirmation checks `session.metadata.guestId === context.user.id`
  (`payments.mjs:174-180`) — guest A cannot confirm/hijack guest B's Stripe session.
- Message-thread creation prevents a listing owner from opening/fabricating a thread for an arbitrary
  `guestId` they have no relationship with (`messages.mjs`, fixed earlier this engagement).
- Host/seller data endpoints scope every query by `ownerId: context.user.id` /
  `where: { id: context.user.id }` rather than accepting a client-supplied user id — the correct
  DB-layer enforcement pattern (mass-assignment / horizontal-escalation protection by construction,
  not by a separate check that could be forgotten).
- Users cannot set their own `idDocumentStatus` — it's a read-only projection on
  `/api/host/overview` (added this engagement) and is only ever *written* from the
  `ADMIN`-only review-queue decision path.

### F-07 — Horizontal-escalation coverage confirmed by pattern inspection, not by exhaustive live adversarial testing
The query-scoping pattern above (`where: { ownerId: context.user.id }`) is present and correct
everywhere reviewed, which is the right way to enforce this at the data layer. This audit did **not**
additionally fire a live "host A requests host B's specific booking ID" HTTP request against every
single endpoint to empirically confirm each one individually. Phase 5 adds automated tests for the
highest-value cases (host/seller/driver cross-account access, non-admin verification approval,
listing-owner thread fabrication, self-verification-status writes) so this becomes a continuously
re-verified property rather than a one-time code-reading judgment.

---

## 4. Rate limiting and abuse controls

**Files reviewed:** entire `server/` tree; `package.json` dependencies.

`grep -rln "rateLimit\|rate-limit\|express-rate\|Retry-After" server/` → **zero matches**. There is no
rate limiting, throttling, or abuse control anywhere in this API — not on login, registration,
password-adjacent flows (once they exist), verification-code requests, search, messaging, booking
creation, payment-proof submission, admin decisions, document access, geocoding, or driver status
changes.

### F-08 — No rate limiting exists anywhere (High)
This is the most concrete, unambiguous gap in the audit. Every endpoint listed in the order's
high-risk list is currently unthrottled. Addressed in Phase 6 (implementation) with a configurable,
in-memory limiter appropriate for the current single-instance deployment, explicitly documented as
**not sufficient for a multi-instance production deployment** (would need a shared store — Redis or
equivalent — at that point).

---

## 5. Input validation

**Files reviewed:** all route files; `package.json`.

No schema-validation library (`zod`, `joi`, `yup`, etc.) exists in `package.json` — validation is
hand-written per endpoint. This is workable and, encouragingly, **every write path reviewed uses
explicit field allow-listing into Prisma's `data:` object** (e.g. `auth.mjs:33-44`) rather than a raw
`...body` spread — meaning there is no mass-assignment vulnerability found anywhere in the reviewed
code (a client cannot smuggle an extra field like `idDocumentStatus: 'APPROVED'` into a write it
doesn't construct explicitly). That said:

### F-09 — Validation is per-developer discipline, not systematically enforced (Low-Medium)
Because there's no central schema layer, correctness depends on every future endpoint remembering to
allow-list fields explicitly and validate types/ranges by hand. Recommend introducing a lightweight
schema library for new and high-risk existing endpoints, without a full rewrite of working code.

---

## 6. Database and transaction safety

**Files reviewed:** `server/lib/finance-ledger.mjs`, `server/lib/booking-lifecycle.mjs`, and every
route file with a `$transaction`/`updateMany` call.

- **ORM usage**: exclusively Prisma; no string-concatenated SQL found. One `$executeRaw` tagged-template
  call exists (`sr-rides.mjs`, writing PostGIS geometry columns) — Prisma's tagged-template form
  auto-parameterizes `${}` interpolations, which is the safe form; confirmed this call uses that form,
  not string concatenation.
- **Concurrency guards**: WHERE-guarded `updateMany` (re-checking the expected prior state in the
  `WHERE` clause, not just the read-then-write's initial read) is used consistently across
  booking-status transitions, payment-proof approval, admin review-queue decisions, and driver
  ride-status transitions — this is the correct optimistic-concurrency pattern and was specifically
  verified/fixed at several of these sites earlier in this engagement.
- **Idempotency**: `recordWalletEntry()` (`finance-ledger.mjs`) computes a deterministic
  `idempotencyKey` from the operation's identifying parts and looks up an existing entry before
  writing — confirmed this prevents duplicate ledger postings even if the same logical event fires
  twice (e.g. a retried Stripe webhook).
- **Financial correctness**: this engagement independently re-derived and verified the
  cancellation-protection-fee and admin-share-reversal arithmetic earlier today (see the finance
  commit's message for the full trace) — not re-litigated here, but incorporated as audit evidence.
- **Payout eligibility**: strictly gated on `booking.status === 'COMPLETED'` plus the 14-day hold —
  a cancelled/rejected booking can never become payout-eligible by construction, confirmed in
  `booking-lifecycle.mjs`.

No new findings in this section beyond what was already identified and fixed earlier in this
engagement (finance-ledger commit). Recorded here for audit completeness.

---

## 7. File/document security

**Files reviewed:** `server/lib/id-document-storage.mjs`, the admin document-serving/upload endpoints.

This is a genuinely well-implemented section:
- File type allow-list (JPEG/PNG/PDF only), 8MB size cap, and a **random UUID storage key** — not
  derived from the user's id or the original filename, so a guessed/enumerated URL can't be used to
  find other users' documents (`id-document-storage.mjs:14-52`).
- `readIdDocument`/`deleteIdDocument` **re-validate the storage-key shape with a strict regex before
  touching the filesystem** even though the key is always machine-generated — explicit
  defense-in-depth against path traversal even from a corrupted/tampered value
  (`id-document-storage.mjs:54-70`).
- The serving endpoint sets `cache-control: private, no-store` on document responses
  (`admin.mjs:210-215`) — prevents caching of sensitive document bytes.

### F-11 — No malware-scanning integration point (Informational)
Uploaded files are stored and served as-is with no scanning step. Given the small file-type allowlist
and that files are only ever viewed by ADMIN/SUPPORT (never executed, never served to arbitrary
users), the practical risk is low, but there's no hook in the current code where a scanner could be
added later.

### F-12 — No explicit retention/deletion policy (Informational)
Documents persist indefinitely once uploaded; there's no automatic purge after a review decision or
after account closure. `deleteIdDocument()` exists and is correctly used in the *update* path for
document replacement, but nothing calls it as a scheduled retention job.

---

## 8. HTTP and browser security

**Files reviewed:** `server/index.mjs` (the entire server bootstrap and response pipeline).

### F-13 — Zero security headers anywhere (High)
`server/index.mjs` sets exactly four response headers, all CORS-related
(`access-control-allow-origin`, `vary`, `access-control-allow-methods`, `access-control-allow-headers`,
lines 118-121). There is no `Content-Security-Policy`, no `X-Content-Type-Options`, no
`X-Frame-Options`, no `Referrer-Policy`, no `Permissions-Policy`, and no `Strict-Transport-Security`
anywhere in the codebase. This is the second concrete, unambiguous, high-priority gap alongside rate
limiting. Addressed in Phase 6.

### F-14 — CORS fallback behavior is unnecessarily permissive-looking (Low)
`setCors()` (`index.mjs:113-122`): when the request's `Origin` header isn't in the configured
allowlist, the server still sets `access-control-allow-origin` to the *first* configured allowed
origin, rather than omitting the header or rejecting the request. This is **not an actual bypass** —
browsers only grant script access to the response if the returned header matches the *actual*
requesting origin, and a mismatched fallback value doesn't satisfy that — but it's needlessly
confusing and should be tightened to omit the header entirely for disallowed origins, both for
clarity and as defense-in-depth against any future refactor that might change how the header is
consumed.

### F-15 — Error-response exposure logic is more permissive than the `expose` flag alone suggests (Low)
`responses.mjs:55-67`: `message: error.expose ? error.message : error.statusCode ? error.message : '...'`.
Any error with a `.statusCode` set — even without `.expose = true` — still has its raw `.message`
returned to the client. Every intentional error found in this codebase already sets both together
consistently, so this has not been observed to leak anything in practice, but the pattern itself is
fragile: a future error path that sets `.statusCode` without deliberately setting `.expose` would leak
its message by default rather than by design. Recommend simplifying to gate strictly on
`error.expose === true`.

---

## 9. Secrets and configuration

- `.env` is git-ignored and was never committed — confirmed via `git check-ignore -v .env` and
  `git ls-files | grep .env` (empty) earlier this engagement.
- **Full git-history secret scan** (not just this session's diff — every commit, `git log --all -p`)
  for Stripe live/test key patterns, hardcoded `AUTH_SECRET`/`PHONE_HASH_SECRET`/`STRIPE_SECRET_KEY`
  assignments, hardcoded passwords, and PEM private-key headers: **zero matches** across all commits.
- Frontend bundle (`dist/`) contains no `AUTH_SECRET` and only the two `VITE_`-prefixed values that
  are designed for client exposure (`VITE_API_BASE_URL`, `VITE_STRIPE_PUBLISHABLE_KEY` — Stripe
  publishable keys are meant to be public).
- Development fallback values exist for CORS origins (`DEFAULT_CORS_ORIGIN`, `index.mjs:24-30`) —
  all `127.0.0.1`/`localhost` — appropriate as a *local* default, but production deployment must set
  `CORS_ORIGIN` explicitly or this fallback list becomes the effective (wrong) production allowlist.

### F-16 — No `.env.example` file
No template exists documenting which environment variables are required (`AUTH_SECRET`,
`PHONE_HASH_SECRET`, `DATABASE_URL`, `CORS_ORIGIN`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_CURRENCY`, `SYP_PER_USD`, `API_PORT`, `API_HOST`). Low severity, but real friction/risk for
anyone provisioning a new environment without knowing the full required set. Addressed in Phase 6/9.

---

## 10. Audit integrity

**Files reviewed:** every write path that touches `admin_audit_logs`.

Confirmed atomic (same `$transaction`) audit-log writes alongside the state change they document for:
review-queue decisions (booking/listing/payment-proof/id-document), SR driver assignment and
self-claim, and driver ride-status transitions. `before`/`after` snapshots capture the domain object
(booking, ride, etc.) — reviewed several of these directly and did not find password hashes, bearer
tokens, or full identity-document bytes stored in any audit-log payload.

### F-17 — No systematic denial-event auditing (Informational)
`403`/`401` authorization denials are not currently written to the audit log — only successful
state-changing admin actions are. For a system this size, that's a reasonable current tradeoff (denial
logging at the HTTP-access-log level would be the more standard place for this), but worth noting
explicitly rather than silently assuming it's covered.

---

## Summary

17 findings. Two are unambiguous, high-priority, narrow-scope repairs (F-08 rate limiting, F-13
security headers) — both addressed directly in Phase 6. The remainder are either genuine but
lower-severity gaps (missing password reset, missing logout/revocation, timing side-channel,
error-exposure fragility, CORS fallback tidiness, missing `.env.example`), informational
notes for a system this size (malware scanning, retention policy, denial-event auditing), or
confirmations that existing patterns (password/token handling, authorization scoping, financial
idempotency, file-storage safety) are already sound. No critical, deployment-blocking vulnerability
was found in this pass. Formal severity classification and per-finding remediation status are in
`SYBNB_V6_THREAT_MODEL.md`.
