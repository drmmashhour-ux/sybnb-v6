# Trust Remediation — Capsule 11: No-Photo Badge on Search Results

**Source finding:** P2 #9 of `sybnb-client-satisfaction-trust-audit.md` (2026-08-26) — "STAYS: every search result (real listing included) renders the same hardcoded per-division stock photo — zero photos carry real information."
**Commit:** `6630c92` on `candidate/satisfaction-remediation`
**Scope:** Frontend only, two files (component + shared stylesheet). No backend/schema touched.
**Status: DONE — verified live, committed.**

---

## The problem, and what it actually was

`listingImage()` in `SearchPreviewPage.tsx` already correctly preferred a listing's own uploaded media and only fell back to a generic per-division stock image when none existed — this logic was not broken. The real problem: nothing distinguished a real photo from the fallback. Confirmed the exact listing the audit flagged ("Seafront Luxury Apartment - Latakia") genuinely has **zero** rows in `listing_media` — the fallback wasn't a bug ignoring real data, it was an honest reflection of missing data that looked exactly like a real photo anyway. A guest browsing search results had no way to tell which listings had genuine photos and which didn't.

## The fix

Added `hasRealPhoto()` — deliberately mirrors `listingImage()`'s own real-media check rather than deriving the signal a second, possibly-divergent way — and a small "No photos yet" (لا توجد صور بعد) badge overlaid on the bottom corner of any result image that's showing the generic fallback. Restores the lost distinguishing signal without inventing any new photo assets: a guest can now tell at a glance which results are backed by a real upload.

## Verification (live, not code review)

1. `npx tsc --noEmit` and `npm run build` — both clean.
2. Loaded the real STAYS search results (50 results, the exact "Seafront Luxury Apartment - Latakia" listing included) — confirmed via DOM query that all 50 currently show the "No photos yet" badge, cross-checked against the ground truth (`select count(*) from listing_media` returns 0 for every one of them) — not a false positive, an accurate reflection of the real data.
3. Confirmed via `getComputedStyle` that the badge actually renders with real positioning/background (`position: absolute`, dark semi-transparent background, bottom-corner placement) — not just present in the DOM but invisible. (First check caught a stale-CSS-cache false negative from not hard-reloading; a hard reload confirmed it renders correctly.)
4. Confirmed the RTL mirror: switching to Arabic swaps the badge from the left edge to the right edge (`right: 10px` vs `left: 10px`), matching this codebase's established `[dir='rtl']`/`[dir='ltr']` convention for absolute-positioned elements (the exact pattern already used elsewhere, e.g. `.admin-activity-chip::after`).

## What this round deliberately did NOT touch

- Did not attempt to source or upload real photos for any listing — that's a content/data problem, not a code fix, and outside what a capsule can reasonably do.
- Noted but did not chase: some rows that DO exist in `listing_media` for other (non-STAYS) listings turned out to themselves point at generic per-division stock asset paths (a seed-data quality issue, not a code-logic issue) — `hasRealPhoto()` correctly reports "has media" for those since that's genuinely what the data says; whether that seed data itself is meaningful is a separate, already-known concern (the audit's own note that "~90% of search results are test-data clutter").

---

Next up: the SR Ride P2 #10 sub-findings (nonsense-address acceptance, decorative filters, no receipt/rating), then P2 #11 (RTL/mobile header-clipping bug).
