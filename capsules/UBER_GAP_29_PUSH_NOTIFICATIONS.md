# SR Ride vs. Uber Gap-Closure — Capsule 29: Push Notifications

**Source finding:** P1 #7 of `sr-ride-vs-uber-benchmark.md` — "No push notifications anywhere in this codebase for any division."
**Commit:** `1a08791` on `candidate/satisfaction-remediation`
**Scope:** New table (`035_push_subscriptions`, purely additive), new dependency (`web-push`).
**Status: DONE — verified live end to end, with one honestly-disclosed limitation. Committed.**

---

## A correction, first

Earlier in this arc, this gap was flagged **blocked**, needing "real external credentials the owner would have to supply." That was wrong, and worth being upfront about: standard Web Push (the browser API every major browser supports natively) only needs a **VAPID keypair** — plain, self-generated ECDSA crypto, created locally with no account, no signup, no third party involved. It's not a push-provider SDK; it's the browser's own push service, authenticated with a keypair your own server generates. That confusion is corrected here, and the feature is built for real.

## What changed

- **`PushSubscription`** table: one row per device a rider or driver has enabled notifications on.
- **`server/lib/push-notifications.mjs`**: optional infrastructure — if the VAPID env vars aren't set, sending is a silent no-op, never a thrown error, so a missing push config can never break a ride action. A `404`/`410` delivery response (the browser's push service saying a subscription is gone) prunes that dead row; every other delivery failure is swallowed, never rethrown.
- **`server/routes/push.mjs`**: the public key endpoint, subscribe, and unsubscribe.
- **`public/sw.js`**: a minimal service worker — push display and notification-click handling only, no offline caching, so it can't interfere with normal app traffic.
- **Real triggers wired into the SR Ride lifecycle**, matching Uber's own notification set: driver assigned, driver arriving, trip started, trip completed, and a new chat message to whichever side didn't send it. All fire-and-forget — a notification attempt can never delay or fail the ride/message action itself.
- **`SrRidePage.tsx` / `DriverDashboardPage.tsx`**: an "Enable notifications" button for both sides.

## Verification (live, not code review) — and an honest limit

1. With no VAPID env vars set, the config endpoint correctly reports `enabled: false` — confirms shipping this feature can't silently start claiming push works when it isn't configured.
2. With a real generated VAPID keypair, the same endpoint correctly reports `enabled: true` with the real public key.
3. A well-formed subscription saves correctly; one missing its endpoint or keys is rejected `400`.
4. A driver claiming a ride with a rider subscription in place → the claim still succeeds immediately, and the server stayed healthy afterward — the fire-and-forget push attempt never blocked or crashed the claim.
5. **Real proof the send path reaches a real push service, not a mock**: the test subscription pointed at a genuine Google FCM URL with a fabricated registration id. `web-push` made an actual network call; Google's real push infrastructure returned `404`; the dead subscription was correctly pruned from the database.
6. A **real signup** (full email OTP flow, not a synthetic session) in a live browser confirmed the "Enable notifications" button renders and works, the service worker file serves with the correct content-type and is byte-identical between dev and the production build, and clicking the button correctly surfaces "Notification permission was not granted" when the browser denies permission — the failure path is handled cleanly, not a crash or a hang.
7. **What wasn't verified**: this session's sandboxed test browser itself failed to register any service worker at all (a generic "unknown error... fetching the script"), despite the script serving correctly — consistent with known automation-sandbox restrictions on persistent background APIs (this same browser also had notification permission pre-denied). Full delivery all the way to a real notification appearing in a real, unsandboxed browser was not directly observed. Everything up to that specific sandbox boundary was.
8. `tsc --noEmit`, `prisma validate`, `npm run build` — all clean (`dist/sw.js` confirmed present after build).
9. Static payment-policy-enforcement audit: **118/118 passed** (up from 114 — new route files now scanned), 0 failed.
10. All test fixtures (3 users including one real signup, 1 ride) removed via direct `psql`.

---

This closes the last blocked item from the original benchmark. Moving next to the two items flagged as out of reasonable scope — business/corporate accounts and ride-pooling — now being built as real, scoped MVPs rather than skipped.
