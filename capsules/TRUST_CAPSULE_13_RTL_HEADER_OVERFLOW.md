# Trust Remediation — Capsule 13: RTL Mobile Header Overflow

**Source finding:** P2 #11 of `sybnb-client-satisfaction-trust-audit.md` (2026-08-26) — "STAYS: real RTL/mobile bug — at 375px in Arabic the account header is measurably pushed 66px past the viewport's left edge (LTR is fine at the same width)."
**Commit:** `6dffee3` on `candidate/satisfaction-remediation`
**Scope:** One shared stylesheet, two scoped rules. No component logic touched.
**Status: DONE — verified live, committed.**

---

## Diagnosis, not guesswork

This finding wasn't fixed by reading CSS and making an educated guess — it was root-caused through direct, empirical DOM testing, each step confirmed before moving to the next:

1. Measured the actual overflow: `document.documentElement.scrollWidth` (444px) vs `clientWidth` (375px) at a real 375px viewport in Arabic — a genuine 69px overflow, matching the audit's reported 66px almost exactly. `scrollLeft: -69.5` confirmed the negative RTL scroll offset that makes overflow visible on the left in RTL specifically, while LTR's default left-anchored scroll position just scrolls the *identical* overflow out of view without actually fixing anything — which is why "LTR is fine" was never evidence the bug was RTL-specific code, only that RTL's scroll behavior happens to reveal it.
2. Hid `header.top-nav` → overflow gone. Hid `main` (the dashboard content) → overflow unchanged. This proved the shared header, not `DashboardPage.tsx`, was responsible.
3. Shortened the test account's display name to a single character → overflow gone entirely. This proved the account-greeting text was the proximate trigger.
4. Traced the greeting button's CSS chain and found `min-width: 0` already present — the button *could* shrink. The real question became: why wasn't there enough space in the header to begin with?
5. Measured every header item's width directly: the logo (`.brand-lockup`) was consuming **148px** — its full *desktop* size — despite an existing `@media (max-width: 760px) { .top-nav-logo { width: 72px; height: 38px; } }` rule that should have shrunk it. Reading `BrandLogo.tsx` revealed why: it sets `width`/`height` as a **React inline style** (`style={{...SIZE_STYLES[size]}}`), which beats a plain CSS class selector at any specificity, regardless of media query. The mobile override had been silently dead the entire time.

## The fix — two parts, addressing two distinct, real risks

1. **The actual root cause**: added `!important` to the existing `.top-nav-logo` mobile rule — the standard, well-established way to override an inline style from a stylesheet without touching the component. Deliberately scoped to this one class rather than editing `BrandLogo.tsx` itself: that component is reused by 4+ other pages (seller pages, admin review) that call it with `size="nav"` but **without** `className="top-nav-logo"` — editing the component's inline-style logic risked regressing all of them. The `!important` rule only ever matches the one call site that passes this exact class.
2. **Defense in depth**: hardened `.public-auth-actions .menu-action` (the greeting button) with `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` and `min-width: 0` on its container — a real account display name will often be longer than a test string, so this needed fixing regardless of the logo bug, as protection against the same class of overflow recurring for an unrelated reason later.

## Verification (live, not code review)

1. `npx tsc --noEmit` and `npm run build` — both clean.
2. At a real 375px viewport in Arabic: confirmed `scrollWidth === clientWidth` exactly (0px overflow, down from 69px).
3. Confirmed the logo now renders at the intended 72×38 mobile size.
4. Confirmed the same fix in English/LTR: `scrollWidth === clientWidth` (was previously overflowing by the same 69px, just invisibly, since LTR's default scroll position hides it).
5. Confirmed a genuine desktop viewport (1280px) still renders the logo at its full 148×48 size — the `!important` override is correctly scoped to the mobile media query only, no regression.
6. Measured every header element's final position — logo, language switch, greeting, sign-out — confirmed none overlap and all fit within the 375px viewport.
7. Confirmed a short test name no longer gets needlessly truncated now that the logo fix freed up real header space (a secondary check on the ellipsis fix's proportionality).
8. Cleaned up the test fixture afterward.

## What this round deliberately did NOT touch

- `BrandLogo.tsx` itself — the shared component's inline-style approach was left as-is to avoid any risk to its other call sites; the fix lives entirely in the stylesheet, scoped to the one class that needed it.
- Any other page's mobile header rendering — this fix's scope is the shared `.top-nav`/`.top-nav-logo`/`.public-auth-actions` rules used across the app, but only the specific overflow mechanism reported for the account/dashboard page was investigated and verified.

---

This closes every item from the audit's P2 tier except the SR Ride receipt/rating gap, which needs a new database table (`ride_reviews`) — that migration is written but currently blocked pending your go-ahead (see the separate note in chat), since it's the first schema change in this remediation arc.
