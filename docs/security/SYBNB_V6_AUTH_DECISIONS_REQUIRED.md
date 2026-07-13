# SYBNB V6 — Authentication Decisions Required

Date: 2026-07-10. Covers the two authentication-architecture items explicitly deferred in
`SYBNB_V6_THREAT_MODEL.md` (F-01 password reset, F-02 session revocation). **Nothing in this
document has been implemented.** This is a decision-support comparison only, per this order's
explicit instruction not to implement either item.

---

## 1. Password reset

Current state: `server/routes/auth.mjs` has no reset/forgot-password route at all — confirmed by
`grep` across `server/` during the original audit. A locked-out user has no self-service recovery
path.

| Option | Security benefit | Operational requirement | Syria-specific delivery limitation (needs confirmation) | Database impact | API impact | UX impact |
|---|---|---|---|---|---|---|
| **Verified email reset** | Standard, well-understood pattern; time-limited signed token, single-use. No new delivery infrastructure if email deliverability is already solved. | Needs a transactional email provider with reasonable deliverability into Syrian/regional mail providers, plus a `passwordResetToken` (hashed, expiring) table or column. | Email is not the primary identifier for many users on this platform today (`email` is optional at registration — `phone` alone is a valid signup path per `server/routes/auth.mjs`). A phone-only user has **no reset path at all** under an email-only design unless email becomes mandatory. | New table or two nullable columns (`resetTokenHash`, `resetTokenExpiresAt`) on `User`. Narrow. | 2 new endpoints: `POST /api/auth/password-reset/request`, `POST /api/auth/password-reset/confirm`. Both need their own rate-limit rule (reuse the `AUTH_LOGIN`-style pattern). | Familiar pattern for users who have email; unusable for phone-only accounts. |
| **Verified SMS reset** | Matches the existing phone-first identity model — most users already have a verified phone from registration. | Needs a **real SMS provider integration**, which does not exist yet: `docs/SYBNB_SMS_OTP_DELIVERY_ARCHITECTURE.md` documents the *design* for backend-driven OTP delivery, but the current implementation (`src/engines/security/verificationCodeEngine.ts`) is explicitly described there as "local testing only... not production SMS." Building password-reset-over-SMS on top of an OTP system that itself isn't production-wired yet means this option has a **hard prerequisite dependency**, not just an add-on. | SMS delivery reliability/cost into Syria specifically (carrier coverage, international SMS gateway pricing, delivery latency) is unverified in this environment — no live provider is configured to test against. This needs a real-world confirmation step (send test messages via the chosen provider to real Syrian numbers) before committing to this as the primary channel. | Reuses/extends whatever `VerificationCode`-shaped table the OTP work introduces (per the SMS architecture doc) rather than a separate table. | Same 2-endpoint shape as email, keyed by phone instead. | Matches how most users already verify identity (phone), but blocked on the SMS provider integration landing first. |
| **Administrator-assisted recovery** | No new automated attack surface (no new public unauthenticated endpoint that emails/texts a reset link/code). Reuses the existing, already-tested, already-rate-limited admin-decision infrastructure (`/api/admin/review-queue/...` pattern). | Needs a documented internal process: user contacts support (already have a WhatsApp/email support channel per `server/routes/admin.mjs`'s "WhatsApp/email ID-submission channel" pattern), an admin verifies identity out-of-band, then triggers a reset. | None specific to Syria — this sidesteps the SMS/email deliverability question entirely by using the support channel that already exists and is already used for ID-document submission. | One new endpoint's worth of schema: a `PATCH /api/admin/users/:id/reset-password` action, reusing the existing admin-audit-log pattern (every reset gets an audit trail — arguably *better* auditability than a fully self-service flow). | 1 new admin-only endpoint, `requireAuth(context, ['ADMIN'])`, mirroring the existing `id-document/:id/upload` admin-assisted pattern. | Slower for the user (requires human involvement), but works today with zero new delivery infrastructure, and fits the platform's already-established "admin-assisted channel" pattern for WhatsApp/email ID submission. |
| **Temporary deferral with registration restrictions** | Zero new attack surface — nothing to build or secure. | None. | N/A. | None. | None. | Locked-out users have no recovery at all except contacting support informally (no formal process). Only reasonable as a short-term stance for a controlled/internal testing phase, not for any real user base. |

**Recommended option: Administrator-assisted recovery now, as a bridge to verified SMS reset once
the SMS/OTP provider integration lands.** Reasoning: it requires no new delivery infrastructure,
reuses already-tested admin/audit patterns from this exact codebase, and avoids committing to
email as primary (which the phone-first registration model doesn't fully support) before the SMS
provider question is actually resolved. Verified SMS reset is the better long-term fit for this
platform's phone-first identity model, but should not be built until the underlying OTP delivery
work (already scoped in `SYBNB_SMS_OTP_DELIVERY_ARCHITECTURE.md`) is production-real, not local-only.

---

## 2. Session revocation / logout

Current state: `server/lib/security.mjs`'s `createSessionToken`/`verifySessionToken` are fully
stateless HMAC-signed tokens with a 7-day TTL (`SESSION_TTL_SECONDS`). There is no server-side
record of issued tokens and no logout endpoint anywhere in `server/`. A compromised token, or a
token issued before a password change, remains valid until its natural 7-day expiry.

| Option | Security benefit | Operational requirement | Syria-specific limitation | Database impact | API impact | UX impact |
|---|---|---|---|---|---|---|
| **Short-lived access tokens only** (shrink TTL, no other change) | Reduces the exposure window of a compromised token without adding server-side state. | None beyond changing `SESSION_TTL_SECONDS`. | None. | None. | None. | Users would need to re-login far more often (e.g. hourly) with no refresh mechanism — this alone is a poor UX trade-off without also adding a refresh token, and doesn't actually provide *revocation* (an attacker with a stolen token still has it until it expires, just sooner). |
| **Server-side session records** (a `Session` table, one row per login, token references a session id, checked every request) | Full revocation control — delete the row, the token is instantly dead. Enables "log out everywhere," per-device visibility, and immediate revocation on password change. | Every authenticated request now needs a DB read against the session table (this already effectively happens — `getAuthContext` already re-fetches the user fresh on every request, so this is a natural extension of an existing pattern, not a new class of cost). | None specific to Syria. | New `Session` table (id, userId, createdAt, lastSeenAt, userAgent/IP metadata optional, revokedAt). | New `POST /api/auth/logout` (revoke current session), optionally `POST /api/auth/logout-all`. `getAuthContext` gains one more check. | Users get a real "log out" button that actually does something server-side (today, "logout" can only mean "the client discards the token locally," which does not invalidate it). |
| **Refresh-token rotation** (short-lived access token + longer-lived, rotating refresh token) | Standard high-security pattern (limits access-token exposure window while keeping UX smooth via silent refresh); rotation detects token theft (reuse of an old refresh token signals compromise). | Meaningfully more complex: needs a refresh-token store, rotation-on-use logic, and reuse-detection handling (revoke the whole family on detected reuse). Frontend needs a silent-refresh flow. | None specific to Syria, but this is the most complex option to implement correctly — reuse-detection bugs are a common source of real-world auth incidents if rushed. | New table for refresh tokens (hashed, family id, rotation chain). | 2+ new endpoints (`refresh`, `logout`), plus every existing endpoint's auth path changes shape (access token becomes short-lived, client must handle 401-then-refresh transparently). | Best UX-vs-security trade-off *if built correctly*, but the most invasive change to the existing stateless-token architecture — this is the option most likely to introduce new bugs if implemented under time pressure. |
| **Token-version revocation** (`sessionVersion`/`tokenNotBefore` counter on `User`, bumped on logout/password-change, checked against the token's `iat`) | Cheap, narrow: one integer column, one comparison in `getAuthContext`. Enables "log out everywhere" and automatic invalidation on password change, without a full session table. Does **not** give per-device logout (bumping the counter invalidates *all* of a user's tokens, not one). | Minimal — add the column, bump it in the password-change and logout code paths, compare in `getAuthContext`. | None. | One new column (`sessionVersion Int @default(0)`) on `User`. Smallest possible schema change of any option here. | 1 new endpoint (`POST /api/auth/logout`, bumps the counter) plus embedding `sessionVersion` in the token payload at issuance and checking it in `getAuthContext`. | Users get working logout and automatic invalidation on password change; cannot selectively log out one device while staying logged in on another (an all-or-nothing revoke). |
| **Device/session management** (session records + a UI listing active sessions/devices, individually revocable) | Best user-facing security posture — matches what users expect from major platforms (see a device, revoke it individually). | Requires server-side session records (above) as a prerequisite, plus UI work, plus reliable device/user-agent fingerprinting (inherently imperfect). | None specific to Syria. | Same as server-side session records, plus richer metadata per row. | Same as server-side sessions, plus `GET /api/me/sessions`, `DELETE /api/me/sessions/:id`. | Most user-friendly and most implementation effort of any option. |

**Recommended option: Token-version revocation, as the narrow first step; server-side session
records (with device/session management) as a later, larger effort if warranted.** Reasoning: this
matches the threat model's own original assessment (F-02) that a `sessionVersion` column is "a
small but real" addition consistent with the order's caution about touching authentication
architecture — it is the smallest change of any option here that actually achieves *revocation*
(not just shorter exposure windows), fits naturally into the existing `getAuthContext` fresh-fetch
pattern, and does not require building a refresh-token flow (the option most likely to introduce
new bugs). It does not provide per-device logout — if that becomes a real product requirement
later, it is a natural upgrade path from token-version revocation to full session records, not a
wasted step.

---

Neither recommendation above has been implemented. Both require an explicit go-ahead before any
code is written, per this order's instruction.
