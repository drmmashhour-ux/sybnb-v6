# Trust Remediation — Capsule 2: Removed Fake "Verified Driver" Claim

**Source finding:** P0 #2 of `sybnb-client-satisfaction-trust-audit.md` (2026-08-26) — "SR Ride 'Verified driver' checkbox is fake."
**Commit:** `a8a989a` on `candidate/satisfaction-remediation`
**Scope:** Frontend only. No backend route, schema, or money logic touched.
**Status: DONE — verified live, committed.**

---

## The problem

The SR Ride request form's "Ride features" filter panel showed a pre-checked "Verified driver" (سائق موثق) option. Two separate problems compounded:

1. **It claimed something false.** No verification concept exists anywhere in the driver data model. `DriverProfile` (`prisma/schema.prisma`) has `licenseHash`, `vehicleMake/Model/Plate`, and an `active` boolean — no verified/checked field of any kind. Worse, a full repo search confirmed `DriverProfile` is currently **unreferenced by any backend route at all** — the entire model is dead schema, not just missing one field.
2. **It was never real input.** The filter selection state (`rideFilters.srRideFeatures`) is never included in the actual `createPrototypeSrRide` API payload — confirmed by reading `SrRidePage.tsx`'s `requestRide()` function, which only reads `pickup`/`dropoff`/`category`/`currency`/`lowDataMode`/`accuracyMeters`/`pickupCoords`.

A rider seeing "Verified driver" checked on their own request would reasonably infer their driver was vetted. That inference was false — actively worse than showing no trust signal at all, per the audit's framing.

## Why removal, not a "coming soon" gray-out

Drivers on this platform are only ever provisioned by an operator (`scripts/bootstrap-admin.mjs`) — never self-registered — so there's an implicit vetting step already, but nothing that maps to a per-ride "verified" concept a rider could check. Building a real one (wiring up `DriverProfile`, adding an admin review step, exposing it to the rider) is a genuinely separate, larger initiative — out of scope for a single capsule fix, and exactly the kind of thing that would need its own scoping discussion if the owner wants it built later. Until that exists, showing anything here — checked or unchecked, grayed or not — would either be false or a promise with nothing behind it. Removing it was the only honest option.

## The fix

Removed `verifiedDriver` at every touchpoint:
- `src/engines/filters/visualFilterDefinitions.ts` — the filter option itself, its photo-src map entry, and its entry in the `visualFilterArtOptions` manifest array.
- `src/engines/filters/filterTypes.ts` — the `'sr-ride-verified-driver'` member of the `VisualFilterArt` type union.
- `src/modules/sr/SrRidePage.tsx` — removed from the default pre-selected filter state.

A short comment was left at the removal site (matching this file's existing convention for honesty-driven removals — see `TrustSos`/`GuaranteeTiers` in `TrustProtectionRoutes.tsx` from an earlier round) pointing at the new governance rule, so a future engineer doesn't reflexively re-add it as "a missing feature."

## The reusable capsule

This is a governance-rule capsule, not a component (there was nothing left to extract once the fake claim was removed). New `CAPSULE_RULES.noFakeTrustSignal` in `src/shared/capsules/index.ts`:

> "A filter option, checkbox, or badge that implies vetting (verified, checked, approved) must be backed by a real, backend-tracked field. If no such field exists, remove the claim instead of showing it decoratively or pre-checked."

Registered as a new "Trust Signal Rule" line in `capsules/SYBNB_REUSABLE_CAPSULES.md`, alongside the existing Filter Capsule entry it directly constrains. This rule now governs:
- This fix.
- The still-pending STAYS "Verified membership" badge (P0 #3 — same underlying bug pattern, different screen).
- Any future division's filter panel (CARS, marketplace, new-construction) before a "verified seller"/"verified listing" style badge gets added.

## Verification (live, not code review)

1. `npx tsc --noEmit` — clean.
2. `npm run build` (`tsc && vite build`) — clean.
3. Started the real API (port 3051) + frontend (port 5180) against the local `sybnb_v6` database.
4. Loaded the real SR Ride page (`/#/ride`) and read its rendered filter panel: "Ride features" now lists Instant confirm / A/C / Wi-Fi / Luggage / Child seat / Family friendly — no "Verified driver" (سائق موثق) anywhere.
5. Confirmed the default selection (Instant confirm + A/C, both checked) still renders correctly with the reduced list.
6. Checked browser console for new errors — none attributable to this change (pre-existing/unrelated 404/401/WebSocket noise from the local dev harness, not this fix).

## What this round deliberately did NOT touch

- Did not build a real driver-verification feature (see "Why removal, not a gray-out" above) — that's a separate, larger initiative if the owner wants it.
- Did not touch the other decorative SR Ride filters (route type, payment method) that also never reach the backend — those are tracked separately under P2 #10 in the audit ("most of the filter panel does nothing"), a broader friction issue, not a false-claim issue, and out of scope here.
- Did not remove the now-orphaned `verified-driver.webp` asset file under `public/assets/filter-photos/sr-ride/` — a harmless, unreferenced static asset, not worth a separate change.

---

Next up: P0 #3 (STAYS "Verified membership" badge shown to unverified accounts) — the same `noFakeTrustSignal` rule applies directly.
