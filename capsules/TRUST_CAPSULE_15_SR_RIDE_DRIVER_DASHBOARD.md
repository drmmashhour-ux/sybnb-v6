# Trust Remediation — Capsule 15: Driver Dashboard Fake Signals

**Source finding:** Flagged separately while a research agent benchmarked SR Ride against Uber (out of scope for that task) — a batch of fake/placeholder values in `src/modules/driver/DriverDashboardPage.tsx` presented to the driver as real data.
**Commit:** `08dad47` on `candidate/satisfaction-remediation`
**Scope:** Frontend only. No backend route, schema, or money logic touched.
**Status: DONE — verified live, committed.**

---

## What was found (re-verified against current code, not taken on faith)

1. A `"91%"` route-confidence number inside a `mapMock` div — no calculation anywhere behind it.
2. An `"AI suggested"` badge on the first pending-ride offer, driven purely by `index === 0` — no AI or ranking logic exists.
3. A hardcoded `"demand is very high"` message, static regardless of anything real.
4. A fake earnings bar chart — seven literal pixel heights (`[38, 52, 28, 88, 62, 42, 78]`), not derived from any data.
5. A hardcoded next-payout date, `"May 15, 2024"` — already in the past relative to today (2026-08-26).
6. A hardcoded `"AED 540.00"` earnings figure — wrong currency; every other SR Ride amount in this codebase is SYP.
7. A hardcoded `"14 completed rides"` that didn't match the real completed-ride count shown two panels above it (`overview.totals.completed`).
8. A `Connected`/`Disconnected` pill that called no API at all — `"Connected"` just re-ran `loadOverview()` (a refresh) and `"Disconnected"` navigated to `/status`, the unrelated **Platform Status** ops/health page (`PlatformStatusPage.tsx`), not a driver settings or offline flow. Neither button read or wrote any state.

## Investigating #8 before deciding fix vs. remove

`DriverProfile.active` (`prisma/schema.prisma`) looked like the obvious backing field. Repo-wide search before touching anything:

- `grep -rn "driverProfile" server/` — the model is selected in exactly one place (`server/routes/sr-rides.mjs:87`), and only for `vehicleMake`/`vehicleModel`/`vehiclePlate` — never `.active`.
- `grep -rn "\.active\b" server/` — zero hits reading `DriverProfile.active` anywhere, including ride claim (`/api/sr/rides/:id/claim`) and admin assignment (`/api/sr/rides/:id/assign-driver`, which checks `User.status === 'ACTIVE'` — a different field on a different model).
- The admin-assignment "active SR driver" check and the driver-claim endpoint both operate with no online/offline concept at all — any authenticated `DRIVER` can claim any pending ride regardless of connection state.

So the field this toggle would presumably control is dead schema (same conclusion capsule 2 reached about `DriverProfile.active` when removing the fake "Verified driver" checkbox), and the toggle's actual click handlers didn't even point at it — one was a refresh button, the other a link to an unrelated ops page. Wiring it to a real endpoint that flips `DriverProfile.active` would still be decorative, since nothing downstream reads that field. Removed rather than half-wired, consistent with `CAPSULE_RULES.noFakeTrustSignal`.

## The fix — two different treatments for two different situations

**Removed outright (no real data exists to back them, matching the capsule-2 "Verified driver" precedent):**
- The `routePanel` article (91% confidence + "next driver guidance" + demand message) — no route, location, or demand signal is computed anywhere in this codebase.
- The `"AI suggested"` badge and its `suggestedOffer` gold-border style — `index === 0` is not a ranking.
- The fake bar chart.
- The hardcoded next-payout date — confirmed via `prisma/schema.prisma` that **no Payout model or payout-cadence field exists at all**, so there was nothing to compute a real date from. (The task description that flagged this bug suggested "compute from a real cadence" — re-verifying the schema showed that data doesn't exist, so removal was the honest option, not a fabricated computation.)
- The `Connected`/`Disconnected` toggle, per the investigation above.

**Rewired to real data already being fetched (cheap, and the data exists):**
- The "14 completed rides" / "AED 540.00" tile now reads `overview.totals.completed` and `overview.totals.earningsMinor` (`moneyText(..., 'SYP', lang)`) — the exact same real values the stats header above it already computes from `rides.filter(...)`. Relabeled from "Today earnings" to "Completed earnings" (reusing the existing `t.earnings` string) rather than keep a "today" framing the backend has no per-day breakdown to support — the driver route (`server/routes/driver.mjs`) has no date-scoped query, only lifetime totals over the last 50 rides.

Layout: `driverIntelligence` (route panel + docs panel, was a 2-column grid) and `earningsPanel` (was a 3-column grid) each had one real panel left after removal, so both were given an inline `gridTemplateColumns: '1fr'` override rather than left half-empty.

## Verification (live, not code review)

1. `npx tsc --noEmit` — clean.
2. Started the real API (`node server/index.mjs`, port 3051) against the local `sybnb_v6` database (not the drifted `sybnb_v6_dev`) and the real Vite dev server (port 5180) — not the stale `.claude/launch.json` preset.
3. Provisioned a real test account: registered as `GUEST` through the actual email-OTP flow (`/api/otp/send` → `/api/otp/verify` → `/api/auth/register`, using `OTP_EXPOSE_FOR_TEST` for the local dev code — the same server-authoritative path a real signup uses), then granted the `DRIVER` role through the real operator path, `scripts/bootstrap-admin.mjs --role DRIVER` (self-registration for `DRIVER` is intentionally forbidden — confirmed via a live `403 ROLE_REGISTRATION_FORBIDDEN` — so this is the only legitimate provisioning route).
4. Created a second real rider account the same way and requested two real ride requests through `/api/sr/rides`.
5. Signed in as the driver through the real `/api/auth/login` endpoint and loaded `/#/driver` — confirmed live in the rendered page:
   - No Connected/Disconnected pill anywhere.
   - No "91%", no "AI suggested" text, no "demand is very high" text — confirmed via computed styles that all three pending-ride offer cards share identical plain borders (no gold-highlighted first card).
   - No fake bar chart, no "May 15, 2024".
   - Before claiming any ride: "Completed earnings 0 SYP · 0 completed rides" (correct, matches the real stats header).
6. Claimed one real ride, drove it through `DRIVER_ARRIVING` → `IN_PROGRESS` → `COMPLETED` via the actual UI buttons (hitting `/api/driver/rides/:id/status` each step).
7. Re-read the page: stats header showed "Completed: 1 / Completed earnings: 12,500 SYP"; the earnings tile below showed the identical "Completed earnings 12,500 SYP · 1 completed rides" — the exact mismatch from the bug report, now provably resolved with live data instead of a static string.
8. Switched to Arabic and confirmed the same real numbers render correctly with Arabic-Indic digits and RTL layout, no regressions.
9. Checked browser console — the only errors were from my own scripted test-account setup calls (an intentionally wrong OTP path, a forbidden self-registration attempt), not from the app itself.
10. Cleaned up: deleted the two test users, their roles, ride requests, and audit log rows from `sybnb_v6` directly via `psql`; stopped both manually-started servers.

## What this round deliberately did NOT touch

- Did not build a real route-confidence, demand-forecasting, or AI ranking model — that's a genuinely separate, larger initiative with no existing signal to build on.
- Did not build a real payout-cadence/scheduling feature (a Payout model, cadence config, processing-time tracking) — flagged as a real gap, not fixed, since none of that data model exists yet.
- Did not build a real per-day ("today") earnings aggregate — would need a new date-scoped query in `server/routes/driver.mjs`; the existing lifetime total was reused honestly instead of fabricating a "today" figure.
- Did not wire driver online/offline state to a real backend endpoint — confirmed no ride-matching or assignment logic anywhere reads `DriverProfile.active`, so building one now would be a genuinely separate initiative (real-time driver availability into ride dispatch), not a small fix.

---

This closes the driver-dashboard batch of fake trust signals found during SR Ride vs. Uber benchmarking. No further items from that flag remain.
