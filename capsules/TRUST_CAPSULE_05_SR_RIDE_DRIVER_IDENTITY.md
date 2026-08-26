# Trust Remediation — Capsule 5: Real Driver Identity for Riders

**Source finding:** P1 #4 of `sybnb-client-satisfaction-trust-audit.md` (2026-08-26) — "SR Ride: rider is shown their driver only as `driverId.slice(0,8)` — no name/photo/rating anywhere in the schema at all."
**Commit:** `f57ee77` on `candidate/satisfaction-remediation`
**Scope:** Frontend + a small backend query change (no schema migration). Money/payment logic untouched.
**Status: DONE — verified live end-to-end, committed.**

*(Note: this repo's capsule numbering has a `TRUST_CAPSULE_04_DRIVER_DOCS_STATUS.md` claimed by a separately-flagged, concurrently-running fix for a different finding on the driver's own dashboard — see "A concurrent fix, not this one" below. This report is numbered 05 to avoid colliding with it.)*

---

## The problem

The SR Ride live-tracking screen showed the rider only `ride.driverId.slice(0, 8).toUpperCase()` — the first 8 characters of the driver's database id, e.g. `49BC4FB1` — as the entire "Driver" field. No name, no vehicle, nothing. A rider was asked to get into a stranger's car with less information than a QR code gives them.

## Why this needed no schema change

The audit's framing suggested the underlying data didn't exist at all. On inspection, most of it already did — it was just never surfaced:

- **Name**: every `User` record (drivers included) already has a real `displayName`, set at account creation.
- **Vehicle**: `DriverProfile.vehicleMake` / `vehicleModel` / `vehiclePlate` already exist as schema fields.
- **The actual gap**: `GET /api/sr/rides/:id` (`server/routes/sr-rides.mjs`) — the exact endpoint the rider's tracking screen polls — never included the `driver` relation in its query at all.

What genuinely doesn't exist yet, confirmed while researching this: a **driver photo** field (no avatar/photo column anywhere on `User`) and a **ride rating system** (no rating model for rides at all — the audit's own P2 #10 finding). Both would need real new backend work (file upload/storage for a photo; an entire new model, admin surface, and rider-facing UI for ratings) — genuinely separate, larger initiatives, not a same-capsule fix. This capsule closes the part that was pure unplumbed data.

## The fix

- **`server/routes/sr-rides.mjs`**: `GET /api/sr/rides/:id` now `include`s the driver relation with a scoped `select` — `id`, `displayName`, and `driverProfile.{vehicleMake, vehicleModel, vehiclePlate}` only. Deliberately never the driver's email, phone hash, or password hash — a rider has no legitimate reason to see those, even though the relation technically allows selecting them.
- **`src/shared/api/platformApi.ts`**: `PlatformRideRequest` gained an optional `driver` field matching that shape.
- **`src/modules/sr/SrRidePage.tsx`**: new `driverIdentityLabel()` helper renders `"Name · Make Model · Plate"`, gracefully omitting any piece the API didn't return (`.filter(Boolean)`), and shows a real "Not assigned yet" (not a placeholder that could be mistaken for a real driver) when `ride.driver` is null. Governed by the same `CAPSULE_RULES.noFakeTrustSignal` rule from capsule 2/3 — it renders only what the API actually returned, never a fabricated value.

## A concurrent fix, not this one

While implementing this, a separately-flagged background task (spawned earlier this session, targeting `DriverDashboardPage.tsx`'s own hardcoded "Verified"/"Valid"/"Expiring soon" labels — a different bug, on the driver's own dashboard, not the rider-facing screen this capsule touches) was running at the same time in a different local session, editing some of the same shared files (`src/shared/api/platformApi.ts`). Their work was carefully left untouched: only the exact hunk belonging to this fix was staged and committed (`git add -p` + a pathspec-scoped `git commit`), verified before and after via `git diff --cached`/`git diff` that their staged `fetchDriverIdentityStatus` addition was neither included in this commit nor lost. Their commit is theirs to make separately.

## Verification (live, not code review)

Ran the full real lifecycle, not a shortcut:

1. `npx tsc --noEmit` — clean.
2. Created an isolated test driver (real name "Yousef Haddad", vehicle "Kia Rio", plate "DAM-4521") and a fresh test rider — new rows, not shared fixture data, to avoid any interference with the concurrent session's own testing.
3. Started an isolated API + frontend pair on non-default ports (to avoid clashing with the concurrent session's own dev server, which was already running on the usual 3051/5180) with an explicit `CORS_ORIGIN` covering the test port.
4. As the rider, requested a real ride through the actual UI (not a direct DB insert) — confirmed "Ride saved."
5. As the driver, claimed it through the real `PATCH /api/sr/rides/:id/claim` endpoint (the same self-accept endpoint a real driver app would call).
6. Refreshed the rider's tracking screen through the real UI — confirmed it now reads **"Yousef Haddad · Kia Rio · DAM-4521"** where it used to show a hex fragment.
7. Independently called `GET /api/sr/rides/:id` directly and confirmed the JSON response contains exactly `id`/`displayName`/`driverProfile.vehicle*` for the driver — no email, phone, or password hash.
8. Deleted every test row created (ride, driver profile, both users, roles, wallets, audit logs) afterward.
9. Stopped only my own isolated verification servers — confirmed the concurrent session's servers (ports 3051/5180) were untouched throughout.

## What this round deliberately did NOT touch

- Driver photo — no field exists; would need real upload/storage work.
- Ride ratings — no model exists for rides at all; a genuinely separate feature (also P2 #10 in the audit).
- The concurrent driver-dashboard fix (`DriverDashboardPage.tsx`) — a different bug, a different session's work, deliberately left alone (see above).

---

Next up: P1 #5 (no SOS access on the SR Ride tracking screen), P1 #6 (STAYS pre-booking price omitting real fees), P1 #7 (fabricated "Damascus" location fallback).
