# SYBNB Client Satisfaction Report — Re-Audit Follow-Up
**Date:** 2026-08-27 · **Branch:** `candidate/satisfaction-remediation` · **Repo:** `/Users/mohamedalmashhour/sybnb-v6`

This is a follow-up to `client-satisfaction-report-2026-08-27.md`. Since that report, 9 more fix commits landed (STAYS trip badge, RENTALS/BUY's remaining P0, the fake ad marquee, description boilerplate, dead CARS/MARKETPLACE filters). Owner said "run client satisfaction report" again — per this session's own established standard, that means independent re-verification, not a changelog. Two fresh audit agents, with no context from the fixing work itself, re-drove the real app end-to-end.

## What they were asked to do

Not "read the code and confirm it looks fixed." Each agent started a real backend + frontend on its own dedicated ports, created real accounts through the real OTP flow, drove the real UI (or, where the sandboxed browser can't touch a native file picker, dispatched real File objects into real `<input>` elements — a legitimate simulation of file selection, not a shortcut around the app's own upload logic), and cross-checked every claim against live network traffic or direct `psql` reads. Both were explicitly told to find new problems, not just confirm what they were told.

## Result: every claimed fix holds. Three new bugs were found — one of them worse than anything in the original audit.

### RENTALS/BUY re-audit — Trust 3/10 → 6/10

All 5 claimed fixes confirmed genuinely true, with live evidence (real network requests, real files on disk, real `psql` rows) — not just "the code looks right."

**New problems found, same day, same session:**

| Finding | Severity | Status |
|---|---|---|
| Seller-side wizard still shows a fake "Payment methods" filter for RENTALS/BUY listings — only the guest-facing search side had been fixed | P0 | Flagged for a coordinated follow-up (`task_2196b9cb`) rather than rushed — the fix needs the exact wizard region a separate in-progress session is also editing |
| 4 more decorative "Added" checklist buttons in the listing wizard (Plan payment proof / Ownership proof / Add authorization / Plan or deed) — identical bug class to the "Property photos" button already fixed, missed the first time | P0 | **Fixed, commit `f9d0211`** |
| Signing up via the RENTALS/BUY account gate redirected to `/stays`, discarding the in-progress request | P1 | **Fixed, commit `26f8f60`** |

### CARS/MARKETPLACE/NEW_CONSTRUCTION + STAYS re-audit

All 5 claimed fixes confirmed genuinely true.

**New problems found — the first one is the most severe finding of this entire audit process, original report included:**

| Finding | Severity | Status |
|---|---|---|
| **The "Book advertising space" CTA was writing ad purchases as real MARKETPLACE product listings, with no exclusion from public search — 62 approved ads appeared as real products in genuine buyer search results.** | **P0** | **Fixed, commit `c411043`** |
| MARKETPLACE's "Condition" filter returns zero results for every value (0 of 545 listings have it) | P0 | Being addressed by an already-in-progress fix for the related `marketCategory` gap (`task_1b81b482`) |
| Search filter state leaks across divisions (a CARS brand selection can follow into a MARKETPLACE search) | P1 | Flagged for follow-up (`task_2c0f42fb`), blocked file |

## The advertising bug, in plain terms

Clicking "Book advertising space" on the homepage always led to a real transaction (an ad purchase, Sham Cash payment, admin review) — that part was genuine. The bug was downstream: once an admin approved the ad, it sat in the same `listings` table as every real product for sale, tagged `division='MARKETPLACE'`, and the search endpoint had no idea it was an ad. A shopper searching MARKETPLACE would see a real product ("Toyota Camry, 15,000,000 SYP") sitting next to "Featured campaign banner, 15,000 SYP, Request item" — a paid advertisement masquerading as something for sale. 140 such rows existed; 62 were already live and approved.

Fixed by excluding `metadata.advertising = true` listings from the public search endpoint. Worth noting for the record: the first attempt at this fix — a standard Prisma `NOT` clause on the JSON field — silently broke search entirely, zeroing out all 424 real MARKETPLACE listings, because of a classic SQL three-valued-logic trap (`NOT (NULL = true)` evaluates to `NULL`, not `TRUE`, so every listing that had never touched the advertising flow got excluded too). That was caught by re-testing the fix itself before committing, not just the original bug — the same discipline this report is built on.

## Commits since the last report

- `6acd251` — STAYS "In trip" badge
- `aff0c2d` — RENTALS/BUY photo pipeline + date filter
- `c8c4ce1` — fake "Featured ads" marquee removed
- `13393a4` — English description boilerplate
- `4bb36ec` — dead CARS/MARKETPLACE/NEW_CONSTRUCTION trust/payment filters
- `c411043` — **fake ad listings excluded from MARKETPLACE search** (this audit's most severe finding)
- `26f8f60` — RENTALS/BUY signup redirect fix
- `f9d0211` — decorative fake-upload buttons removed from the listing wizard

## What's still open

- Two items already tracked and being actively worked by concurrent sessions: the hidden `city=Damascus` search default, and MARKETPLACE's `marketCategory`/`condition` real-filtering build.
- Two new items flagged this round, not yet started: the seller-side fake payment filter for RENTALS/BUY/NEW_CONSTRUCTION (`task_2196b9cb`), and cross-division search filter state leakage (`task_2c0f42fb`).
- Everything already listed as open in the original report (RENTALS/BUY's two-inconsistent-flows design question, `amenities`/`views`/`access` dead platform-wide).

## Take from this round

Every fix claimed in the last report was genuinely true when independently checked — that's the encouraging part. But the re-audit still surfaced the single worst finding across the entire process (fake products in real search results), and it did so specifically by testing something the original audit and the fixing work never exercised: a live purchase flow that writes real data into a shared table. That's the value of running this a second time rather than treating one clean audit as the finish line.
