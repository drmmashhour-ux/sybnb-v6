# SR Ride vs. Uber Gap-Closure — Capsule 25: Accessibility Ride Options

**Source finding:** P2 #16 of `sr-ride-vs-uber-benchmark.md` — "No accessibility ride options."
**Commit:** `adf9621` on `candidate/satisfaction-remediation`
**Scope:** Schema migration (`031_ride_accessibility`, purely additive).
**Status: DONE — verified live, committed.**

---

## Built carefully, on purpose

The obvious shortcut was to add "Wheelchair accessible" as one more checkbox in the existing ride-features multi-select (A/C, WiFi, luggage, etc.). That list is explicitly documented elsewhere in this codebase as *"recorded... but no driver-matching logic reads these yet"* — an acceptable gap for a soft preference like A/C, but wrong for a genuine accessibility need: promising a matched vehicle without actually enforcing it would repeat the exact mistake this whole remediation arc already found and fixed once — a pre-checked "Verified driver" filter option that implied vetting which never happened, removed under `CAPSULE_RULES.noFakeTrustSignal`.

So this is built for real instead: two genuine database columns, and an actual eligibility check enforced at the moment a driver tries to claim the ride — not a badge nobody has to honor.

## What changed

- **`DriverProfile.accessibilityCapable`** — self-declared, at the same trust level the vehicle make/model/plate fields already carry (shown to riders as real data, never dressed up as a verified badge).
- **`RideRequest.accessibilityRequired`** — set by the rider at request time.
- **The claim route** now checks it: a driver who hasn't self-declared as accessibility-capable is refused with `403 RIDE_ACCESSIBILITY_MISMATCH`, leaving the ride available for a driver who actually can accommodate it. A normal ride is completely unaffected — any driver can still claim it.
- **Driver dashboard**: a self-declare checkbox, plus a visible accessibility badge on both pending-ride offers (so a driver can make an informed decision *before* attempting to claim) and their own already-claimed rides.
- **Rider's request form**: a checkbox, plus a visible indicator on the tracking screen once set.

## Verification (live, not code review)

1. A driver who has **not** self-declared attempts to claim an accessibility-required ride → `403 RIDE_ACCESSIBILITY_MISMATCH`, and the ride is confirmed still unclaimed afterward — no partial side effect from the rejected attempt.
2. A driver who **has** self-declared → claims the same ride successfully.
3. A normal (non-accessibility) ride remains claimable by a driver who is not accessibility-capable — confirming no over-restriction was introduced.
4. The accessibility flag is correctly visible to a driver browsing the pending-rides list, before they ever attempt to claim.
5. `tsc --noEmit`, `prisma validate`, `npm run build` — all clean.
6. Static payment-policy-enforcement audit: **114/114 passed**, unchanged (not payment-adjacent; run as a sanity check).
7. All test fixtures (3 users, 2 driver profiles, 2 rides) removed via direct `psql` in FK order.

---

Next: promo codes (P2 #12), saved places (P2 #13), and multi-stop rides (P2 #14) — the remaining P2 polish items.
