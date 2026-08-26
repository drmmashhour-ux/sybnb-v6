# Trust Remediation — Capsule 7: SOS Access During an SR Ride

**Source finding:** P1 #5 of `sybnb-client-satisfaction-trust-audit.md` (2026-08-26) — "SR Ride: no SOS access on the live-tracking screen, despite a real SOS feature existing elsewhere (trust center + a prominent driver-dashboard SOS button)."
**Commit:** `4a5e9df` on `candidate/satisfaction-remediation`
**Scope:** Frontend only, one file. No backend, schema, or money logic touched.
**Status: DONE — verified live, committed.**

---

## The problem

The platform already has a real safety feature: the Trust Center's SOS/support page, and a prominent SOS button on the driver's own dashboard. But the rider's live-tracking screen — the one screen a rider is actually looking at while in a car with a stranger — had zero reference to it. Not a fake promise this time, just a real absence at exactly the moment it would matter most.

## The fix

Added an SOS button to `SrRidePage.tsx`'s status card, using the exact same destination and behavior as the existing driver-dashboard button (`window.location.hash = '/trust-center/sos'`) — no new safety mechanism invented, just real access to what already exists. Visible only while `ride && ACTIVE_RIDE_STATUSES.includes(ride.status)` — i.e., from the moment a ride is requested through in-progress — not on the blank request form before any ride exists, where it would have no purpose.

The destination screen itself (`TrustSos` in `TrustProtectionRoutes.tsx`) was already corrected in an earlier round this session: it honestly states "If you are in real danger, call local emergency services immediately. This button opens a chat with SYBNB support" and "Nothing is contacted automatically." This capsule just gives the rider a path to that honest screen from where they actually need it.

## Verification (live, not code review)

1. `npx tsc --noEmit` and `npm run build` — both clean.
2. Registered a fresh rider, navigated to the SR Ride page — confirmed **no** SOS button renders on the blank request form (correct: nothing to escalate yet).
3. Requested a real ride through the actual UI — confirmed the SOS button appears immediately, right after the "Waiting for a nearby driver..." message.
4. Clicked it — confirmed it lands on the real Trust Center SOS/support screen with its honest copy, not a placeholder or dead link.
5. Cleaned up the test rider/ride from the local DB afterward.

## What this round deliberately did NOT touch

- Did not build any new emergency-dispatch mechanism — the honest existing support-chat flow is all that exists anywhere in this platform, and this capsule only makes it reachable from a screen that was missing it, matching the same behavior already established (and already corrected for honesty) elsewhere.

---

Next up: P1 #6 (STAYS pre-booking price omitting real fees), P1 #7 (fabricated "Damascus" location fallback).
