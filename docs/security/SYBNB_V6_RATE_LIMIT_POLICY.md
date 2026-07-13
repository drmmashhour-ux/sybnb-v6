# SYBNB V6 — Rate Limit Policy

Date: 2026-07-10 (updated 2026-07-11, independent-review follow-up). Describes the abuse-protection
limiter added under security audit finding F-08 (`docs/security/SYBNB_V6_THREAT_MODEL.md`).
Implementation: `server/lib/rate-limit.mjs`, wired into `server/index.mjs`.

**Two bugs found and fixed in the 2026-07-11 pass** (full detail: F-20, F-21 in the threat model):
`TRUST_PROXY` was read once at module-import time, before `.env` had even been loaded, so a
`TRUST_PROXY` set only in `.env` (not a real shell environment variable) would silently never take
effect — now read lazily on every call. `RATE_LIMIT_<NAME>_MAX`/`_WINDOW_MS` overrides were passed
straight through `Number(...)` with no validation — a non-numeric, zero, or negative value could
silently disable the limit (`NaN`) or block every request (`0`) from one environment-variable typo
— now validated, falling back to the coded default on anything invalid, with
`validateProductionConfig()` refusing to start in production if any configured override is bad.

## How it works

An in-memory sliding-window counter keyed by `{ruleName}:{bucketKey}`. Each rule in
`server/index.mjs`'s `RATE_LIMIT_RULES` table matches an HTTP method + path pattern and carries its
own `max` / `windowMs`. On a match, the request either proceeds (and the bucket's count increments)
or receives `429` with a `Retry-After` header and body `{ ok: false, error: { code: 'RATE_LIMITED', message } }`.

**Single-instance only.** Buckets live in this process's memory — running more than one API
process/container behind a load balancer gives each instance its own independent limit, so the
*effective* limit for a client becomes `max × instance count`. A production deployment with more
than one instance needs a shared store (Redis or equivalent) instead of this module. The policy
below (which endpoints, what limits) carries over unchanged to that future implementation.

**Client identification.** Rules marked `byUser` key on the authenticated caller's user id (a
shared office/NAT IP shouldn't throttle every user behind it). Unauthenticated rules key on client
IP. IP is read from the raw socket by default; `TRUST_PROXY=1` opts into trusting
`X-Forwarded-For` instead — only enable this when a real reverse proxy sits in front of the API,
since otherwise a client could set that header themselves to reset their own limit. Current `.env`
in this environment does not set `TRUST_PROXY` — confirmed absent (checked for the key's presence
only, value not inspected/printed), so the raw-socket path is what's actually active here.

**Storage mechanism.** A single in-process `Map` (`buckets`) in `server/lib/rate-limit.mjs`, keyed
by `` `${ruleName}:${bucketKey}` ``. Each entry holds `{ count, resetAt }`. No external store, no
disk persistence.

**Cleanup / memory bounds.** A `setInterval` sweep (`SWEEP_INTERVAL_MS`, 5 minutes) removes any
bucket whose `resetAt` has already passed. The sweeper is skipped when `NODE_ENV=test` (so Vitest
doesn't leave a dangling timer keeping the process alive) and uses `.unref()` so it never blocks
process exit on its own. Memory is bounded by the number of *distinct active* `{rule, key}` pairs
within the last unexpired window per rule — in the worst case (every request from a unique
IP/user, all rules constantly active), this scales linearly with distinct recent clients, not with
request volume. There is no hard cap on total bucket count; an attacker with access to a very
large number of distinct source IPs (well beyond what rate limiting itself is meant to blunt)
could in principle grow the Map faster than the 5-minute sweep reclaims it. Not considered a
practical risk at this deployment's expected scale, but worth flagging as an unbounded-growth
edge case rather than a hard guarantee.

**Restart behavior.** All buckets are in-memory only — a process restart (deploy, crash, manual
restart) resets every client's rate-limit state to zero immediately. This is a *feature* for
recovering from a misconfigured limit locking out legitimate traffic, and a *gap* in that it also
resets any limit an attacker was up against, mid-attack, for free.

**IPv4 / IPv6 handling.** `clientIp()` returns `req.socket.remoteAddress` verbatim — no
normalization. When the server binds to `127.0.0.1` (this deployment's default `API_HOST`),
`remoteAddress` for IPv4 clients is plain dotted-decimal (verified directly:
`net.createServer` on `127.0.0.1` reports `remoteAddress: '127.0.0.1'`, `remoteFamily: 'IPv4'` for
an IPv4 client — no `::ffff:`-mapped form). If a future deployment binds dual-stack
(`API_HOST=::` or `0.0.0.0` under an IPv6-capable stack), IPv4 clients may instead present as
`::ffff:x.x.x.x` while IPv6 clients present as native IPv6 literals — the module does not collapse
these to a comparable form. This does not let a single client evade its own bucket (a given TCP
connection consistently reports one address form), but it does mean **IPv6 clients get one bucket
per individual address** rather than per `/64` or `/56` prefix — a client with an IPv6 allocation
can rotate through effectively unlimited individual addresses within their own prefix to obtain a
fresh bucket each time, in a way an IPv4 client typically cannot (a single IPv4 address is a scarce
resource). Not exploitable today (this deployment binds IPv4-only), but relevant if the bind
address ever changes.

## Current rules

| Rule | Method + path | Max | Window | Keyed by |
|---|---|---|---|---|
| `AUTH_LOGIN` | `POST /api/auth/login` | 10 | 5 min | IP |
| `AUTH_REGISTER` | `POST /api/auth/register` | 5 | 15 min | IP |
| `PUBLIC_SEARCH` | `GET /api/listings` | 60 | 1 min | IP |
| `MESSAGING` | `POST /api/{listings,bookings}/:id/thread/messages` | 20 | 1 min | User |
| `BOOKING_CREATE` | `POST /api/bookings` | 10 | 1 min | User |
| `PAYMENT_PROOF` | `POST /api/payments/{seller-plan-proof,local-wallet-proof}` | 10 | 1 min | User |
| `ADMIN_DECISION` | `PATCH /api/admin/review-queue/:type/:id` | 60 | 1 min | User |
| `DOCUMENT_ACCESS` | `GET /api/{admin/id-document,me/id-document}/:id(/file)` | 30 | 1 min | User |
| `GEOCODING` | `POST /api/sr/{quote,rides}` | 20 | 1 min | User |
| `DRIVER_STATUS` | `PATCH /api/{driver/rides/:id/status,sr/rides/:id/claim}` | 30 | 1 min | User |

These are conservative starting points based on plausible legitimate usage patterns, not numbers
derived from production traffic data (none exists yet for this prototype) — expect to retune after
real usage is observed.

## Overriding without a code change

Every rule's `max` and `windowMs` can be overridden per-deployment via environment variables:
`RATE_LIMIT_<NAME>_MAX` and `RATE_LIMIT_<NAME>_WINDOW_MS` (e.g. `RATE_LIMIT_AUTH_LOGIN_MAX=20`).
`DISABLE_RATE_LIMIT=1` turns off all rate limiting entirely — `validateProductionConfig()`
(`server/lib/env.mjs`) refuses to start with `NODE_ENV=production` if this is set, so it can only
be used in development/testing.

## Production recommendation

**Do not represent this limiter as globally enforced in a multi-instance deployment.** It is
correct and effective for the current single-process deployment. Before running more than one API
instance (horizontal scaling, multi-container, multi-region), replace the in-memory `Map` with a
shared store (Redis `INCR`+`EXPIRE` or equivalent) behind the same `checkRateLimit()` interface —
the rule table and policy (which endpoints, what limits, byUser vs. by-IP) does not need to change,
only the storage backend. Treat distributed rate limiting as a **hard prerequisite for
multi-instance deployment**, not an optional hardening step.

## Testing

`test/unit/rate-limit.test.mjs` exercises the limiter algorithm directly (enforcement, window
reset, independent buckets, env overrides, disable flag, trusted-proxy IP resolution).
`test/security/rate-limit-http.test.mjs` confirms the wiring end-to-end against the real
`/api/auth/login` route, including the `429` response shape and `Retry-After` header.
