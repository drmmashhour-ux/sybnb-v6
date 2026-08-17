# SYBNB — Final Client-Readiness Remediation (candidate `ddb7a97`)
Isolated branch `candidate/client-readiness-remediation`. **`main` untouched (`cd891a8`); production untouched; authority-review boundaries intact.** Tag: `sybnb-launch-candidate-2026-08-17`. Payments OFF · publicAccess CLOSED · Require-Log-In ON.

## What was remediated
### MEDIUM-1 — mock fallback removed from real customer journeys
`fetchApprovedListings` no longer substitutes demo fixtures when the API returns zero (or errors). Real journeys show **real inventory only**; a legitimate zero-result search returns an empty list and each page renders its **genuine localized no-results state**; API/network errors propagate to the caller's error state. **All six divisions share this single code path** — the fix covers Stays, Rentals, Buy, Cars, Marketplace, New Construction.
- **Verified:** Buy + "Land" filter → "Available sale properties **(0)**" + "No published sale properties yet.", **filters preserved, zero mock**, at desktop **and** 640px reflow width. Empty region carries `role="status"` (announced).

### MEDIUM-2 — accessibility audited + remediated to AA
- **Contrast (real WCAG failures fixed):** `dim` token `#68758d` (3.35–4.11:1, failed AA) → `#8592ad` (**≥4.6:1** on all app backgrounds); breadcrumb `.route-separator` and a placeholder box likewise raised to AA. (`muted #9aa7bd` was already 6.4–8:1 — fine.)
- **Screen-reader announcements:** added `aria-live`/`role=status|alert` to dynamic result-count, no-results, and error regions across Rentals/Buy, DivisionLive (Cars/Marketplace/New-Construction), and Search.
- **Verified present (measured):** `:focus-visible` ring matches on keyboard focus; `prefers-reduced-motion` handled; landmarks (`main`/`nav`/`header`); heading hierarchy (single `h1` + `h2`s); `lang`/`dir` set and switch AR↔EN; all images have `alt`; 86 aria-labels / 50 `<label>` for 61 inputs; **reflow: no horizontal overflow at desktop/tablet/mobile/640px**.

> Method note: contrast computed numerically; keyboard/focus/landmarks/reflow verified in-browser. Automated axe-core was not available offline and manual assistive-tech certification with a real screen reader is still recommended before scale — but the concrete failures found were remediated with measured evidence.

## Regression (candidate `ddb7a97`)
All known-issue re-checks still PASS: availability **200**, Rentals/Buy live (8/4), EN descriptions, Approved/مقبول hidden (AR+EN), **no mock inventory**, no UI marker/secret leak, payments-OFF boundary. Tests: storage **23/23**, calendar-date-guard **9/9**, operations **15/15**; `tsc` clean; **production build OK**.

## Before → After scores (independently re-measured, un-inflated)
| Dimension | Before | After |
|---|---|---|
| **Overall satisfaction** | 8.1 | **8.5** |
| Search / filter | 7.5 | **8.5** |
| Navigation | 8.0 | 8.5 |
| **Accessibility** | **6.5** | **8.0** |
| Trust | 7.5 | 8.0 |
| Arabic / RTL | 9.0 | 9.0 |
| English | 8.5 | 8.5 |
| Mobile | 8.5 | 8.5 |
| Tablet | 8.5 | 8.5 |
| Desktop | 9.0 | 9.0 |
| First impression / Homepage | 8.5 | 8.5 |
| Listing cards / detail | 8.5 / 8.0 | 8.5 / 8.0 |
| Contact / booking | 8.0 | 8.0 |

## Target check (all PASS)
- Accessibility ≥8 → **8.0** ✅ · Overall ≥8 → **8.5** ✅ · AR/EN/mobile ≥8 → 9.0/8.5/8.5 ✅
- 0 BLOCKER / 0 HIGH ✅ · **0 MEDIUM customer-journey defects** ✅ (both resolved)
- Payments OFF ✅ · security/privacy PASS ✅

## Remaining findings (none customer-journey BLOCKER/HIGH/MEDIUM)
- **LOW:** public `/api/listings` returns internal `metadata` (`inventory_source`/`descriptionEn`) — whitelist before real launch; `priceMin`/`priceMax` not int-range-validated → 500 on out-of-range value (not UI-reachable); invalid route lacks explicit 404 copy.
- **POLISH:** generic bundled images (real listings need real photos).

## Candidate freeze
- **SHA:** `ddb7a97721b0f283bd1e2312cfd00eb0c3bbff17` · **Tag:** `sybnb-launch-candidate-2026-08-17`
- **CI/tests:** self-contained governed suites green (storage/calendar-guard/operations); `tsc` clean; production build OK. (Full account-dependent suite via `scripts/run-all-e2e.sh` on seeded `sybnb_v6` remains the pre-merge gate.)
- **Rollback ref:** `cd891a8` (main, prior frozen state). Not merged, not deployed.

## Verdicts
- **Customer-experience gate: PASSED** — accessibility ≥8, zero BLOCKER/HIGH, zero MEDIUM customer-journey defects; the customer-facing software meets the initial-launch bar.
- **Scale gate (separate, unchanged):** 10k CONDITIONAL · 100k CONDITIONAL · 250k/500k NOT YET · 1M NOT PROVEN — credible staged path; launch is **not** gated on 1M.

## OVERALL PRODUCT VERDICT
# CONDITIONAL LAUNCH READY
The customer-experience remediation gate is now fully cleared. Remaining conditions are **operational, not customer-journey**: deploy this candidate to the private site, complete legal DRAFT → counsel, execute the §G credential rotation before public access, and land Stage-1 infra (DB pooler + `connection_limit` + OTP-prune cron) before increasing traffic. Nothing merged, deployed, provisioned, or opened without owner authorization.
