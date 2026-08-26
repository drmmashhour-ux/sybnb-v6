# Trust Remediation — Capsule 9: No More Fabricated Locations

**Source finding:** P1 #7 of `sybnb-client-satisfaction-trust-audit.md` (2026-08-26) — "STAYS: listing with no location silently fabricates `\"\${title}, Damascus, Syria\"` (hardcoded fallback city) — reproduced showing '...Latakia, Damascus, Syria' contradicting the listing's own title."
**Commit:** `11e1d64` on `candidate/satisfaction-remediation`
**Scope:** Frontend only, two files (the shared capsule + its one consumer). No backend/schema touched.
**Status: DONE — verified live, committed.**

---

## The problem

`listingMapTarget()` (`src/shared/maps/googleMapCapsule.ts`) — the single shared function behind every location display on a listing page (the prominent header, the location tab, the offline-map snapshot) — silently fell back to `"${title}, Damascus, Syria"` whenever a listing had no real address text. The audit reproduced this on "Seafront Luxury Apartment - Latakia": the header confidently read "...Latakia, Damascus, Syria" — two Syrian cities roughly 350km apart, stated as fact, directly contradicting the listing's own title. No caveat appeared anywhere prominent — only a small, easy-to-miss note buried in a tab most guests wouldn't open.

## The fix

`listingMapTarget()` now distinguishes three real states instead of always inventing a city:

1. **Real address text exists** — unchanged, shows the real address.
2. **GPS coordinates exist but no address text** — new: shows an honest **"Pinned location"** (a real pin does exist, even without a text address — this is a true, if minimal, claim).
3. **Nothing at all** — new: shows an honest **"Location not provided"**, in both English and Arabic.

"Syria" alone was kept as a fallback in the map-*search query* (not the displayed label) — SYBNB is Syria-only today, so that much genuinely is true — but the specific, disprovable city ("Damascus") is never invented again. A new `hasRealLocation` field on `GoogleMapTarget` lets any consumer tell real data from a placeholder.

Because this is the one shared function every consumer already routes through, fixing it here fixed the header, the location tab, and the offline-map snapshot simultaneously — no per-screen patching needed.

## A small follow-on tightened in the same capsule

While verifying, found that `ListingDetailPage.tsx`'s own small caption under the map pin still said "Approximate location from listing data" even when there was *no* location data at all — a contradiction my own fix would otherwise have newly surfaced (previously this exact combination never rendered, since the label always showed *some* fabricated city). Fixed in the same commit: that caption now only shows when `hasRealLocation` is true (i.e., there's real address text, just no precise GPS pin); it's silent when there's genuinely nothing to caveat, since the "Location not provided" label above it already says so.

## Verification (live, not code review)

1. `npx tsc --noEmit` and `npm run build` — both clean.
2. Confirmed the exact listing the audit flagged (`355956c2-18a7-40de-b541-e50f3d9634e9`, "Seafront Luxury Apartment - Latakia") genuinely has empty `metadata` and no `location_id` in the database — this is the real, reproducible case, not a hypothetical.
3. Loaded the real listing page — header now reads **"Location not provided"** instead of the fabricated city, in both English and Arabic (⌖ لم يتم تحديد الموقع).
4. Checked the Location tab — same honest label, and the now-correctly-suppressed "Approximate location" caption (confirmed it doesn't appear).
5. **Regression check**: loaded a different, real listing with genuine city metadata — confirmed it still displays its real city ("Damascus," this time actually backed by real metadata) unaffected by the fix.

## What this round deliberately did NOT touch

- Any backend geocoding or location-storage logic — this was purely a display-fallback fix in a function that already receives whatever location data exists.
- The SR Ride geocoder's own, separate fallback behavior (silently defaulting to a fixed 5km estimate for unrecognized addresses) — that's part of the audit's P2 #10 finding, a different code path, tracked separately.

---

This closes the last of the audit's P1 tier (findings #4–#7, misrepresenting-reality and real-gap severity). Remaining: the P2 tier (#8–#11) — mislabeled trip states, identical stock photos on every search result, SR Ride's missing receipt/rating and decorative filters, and a real RTL/mobile layout bug — lower stakes, still open.
