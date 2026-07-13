# SYBNB V6 — Manual Accessibility Checklist

Date: 2026-07-10. Manual, tool-assisted review (Chromium via `mcp__Claude_Preview__*` — not
repository-owned automation; see `SYBNB_V6_TEST_STRATEGY.md`'s reproducibility note). Scope:
landing page and the guest auth wizard (`src/modules/account/GuestAccountPage.tsx`), the most
representative unauthenticated flow. Safari/Firefox: **NOT RUN** — no tooling available in this
environment. This is a spot-check, not exhaustive coverage of every page.

> **Update (same day, follow-up pass):** three of the findings below were repaired (skip
> navigation, error association) or confirmed already-fine (visible focus, via a real Playwright
> keyboard press rather than a script-dispatched one) — see
> `docs/security/SYBNB_V6_RELEASE_GATE.md`'s "Accessibility repairs" section for exactly what
> changed and why. The findings are left as originally written below for the historical record;
> read the release-gate doc for current status.

## Keyboard order

**PASS.** Tab order on the landing page and auth wizard reaches every interactive element
(language switch, login/register buttons, stepper nav, tab controls, form fields, submit) in a
sensible top-to-bottom, logical sequence. No keyboard traps found.

## Visible focus

**INCONCLUSIVE — needs a real-keyboard manual check before shipping.** Automated verification via
script-dispatched `.focus()` calls could not reliably confirm `:focus-visible` styling — Chromium's
focus-visible heuristic does not consistently activate for non-trusted (`isTrusted: false`)
synthetic events in headless automation, so a script-based check risks a false negative regardless
of actual behavior. What was confirmed: `grep -rn "outline\|:focus" src/**/*.css` returns **zero
matches** anywhere in the codebase — no CSS suppresses the browser's default focus outline, and
none replaces it with a custom style either. The app is relying entirely on browser-default
focus indicators. This should behave correctly for a real keyboard user in a real browser, but
was **not independently confirmed with an actual keypress** in this pass. **Action: a human should
Tab through the login form with a real keyboard and confirm a visible ring appears before this is
marked resolved.**

## Skip / navigation behavior

**FAIL — confirmed gap.** No skip-to-content link exists. Checked via
`document.documentElement` inspection for any element matching skip/تخطي/تجاوز text patterns:
none found. The first focusable element on page load is the header logo/home button
(`"SYBNB home"`), meaning a keyboard or screen-reader user must tab through the entire header
(logo, breadcrumb nav, language switch, login, register) before reaching page content on every
single page load. Affects WCAG 2.4.1 (Bypass Blocks). Not fixed this phase (a skip-link addition
touches shared layout markup used across the whole app — out of scope for this independent-review
pass, which only adds documentation and narrowly-required test-reproducibility files).

## Form labels

**PASS.** All 3 inputs on the auth-wizard login step (`رقم الهاتف`, `كلمة المرور`, and the
registration step's additional fields) have an accessible name via an associated `<label>`,
confirmed via `input.labels.length` — 0 of 3 inputs lacked a programmatic label.

## Error association

**FAIL — confirmed gap.** Checked `src/modules/account/GuestAccountPage.tsx` (the guest
auth/registration flow) directly: validation/API errors render as a single generic status string
(`{message ? <strong>...` at line ~288) shared across the whole form, with:
- no `aria-describedby` linking any specific input to an error,
- no `aria-invalid` on the offending field,
- no `role="alert"` / `role="status"` / `aria-live` region around the message element.

A sighted user sees the message appear near the submit button; a screen-reader user gets **no
automatic notification** that an error occurred at all (nothing announces the DOM change) and, even
if they find it, cannot tell which field it refers to beyond re-reading the message text.
Repository-wide: `grep -rn "aria-describedby|aria-invalid|aria-errormessage" src/**/*.tsx` returns
**zero matches** — this is not specific to one form, it is the platform-wide pattern. Affects WCAG
3.3.1 (Error Identification) and 4.1.3 (Status Messages). Not fixed this phase — same reasoning as
skip-navigation above (shared pattern across many forms, out of scope for a docs-only review pass).

## Zoom

**PASS.** Viewport meta is `width=device-width, initial-scale=1.0` — does not set
`user-scalable=no` or `maximum-scale`, so pinch-zoom is not disabled.

## Reduced motion

**PASS.** `@media (prefers-reduced-motion: reduce)` is present in `src/shared/theme/global.css`
(global rule zeroing animation/transition durations and scroll-behavior, plus a targeted rule
disabling the ad-marquee animation specifically).

## Contrast

**One open finding, not fixed this phase.**

- Body text (near-white `rgb(247,248,255)` on near-black `rgb(10,15,29)` background): comfortably
  AA/AAA-compliant.
- **Primary CTA button — open finding.** White text on the platform's accent blue measures
  **4.39:1**, marginally below the 4.5:1 WCAG AA threshold for normal-size text (button text is
  16px, not "large text" under WCAG's definition, so the 4.5:1 threshold applies, not 3:1).
  - **Exact affected value:** `#5268ff` (`rgb(82,104,255)`).
  - **Exact affected component/token:** this is not a shared CSS custom property / design token —
    it is a hardcoded hex literal repeated inline across the codebase. First observed at
    `src/modules/account/GuestAccountPage.tsx:335` (`styles.primaryButton`, `background: '#5268ff'`).
    `grep -rn "#5268ff" src/` finds **21 occurrences across 7+ modules**
    (`ListingDetailPage.tsx`, `AdminReviewPage.tsx`, `WalletPage.tsx`, `DashboardPage.tsx`,
    `FinanceReconciliationPage.tsx`, `GuestAccountPage.tsx`, `StaffAccessPage.tsx`, and others) —
    it functions as the de facto brand accent color platform-wide despite not being centralized.
  - **Not fixed.** This is a brand-color decision, not a narrow code repair, and this review's
    scope explicitly excludes changing brand colors without approval. If a fix is later approved,
    the narrow remediation is darkening this one value (e.g. toward `#3f52e6` or similar, whichever
    the design owner picks) — but note it would need to be changed in all ~21 occurrences (or
    centralized into a shared token first) to be consistent, since it is not currently a single
    source of truth.

## Mobile touch targets

**PASS, with one 1px informational note.** At 375×812 (mobile), no horizontal overflow
(`document.documentElement.scrollWidth === window.innerWidth`). Of all buttons/links measured, one
— a footer WhatsApp contact link — measured 23px tall against the common 24px minimum-target
guideline. 1px under, not fixed, informational only.

## Language direction

**PASS.** `<html lang="ar" dir="rtl">` is set correctly; `getComputedStyle(document.body).direction`
confirms `rtl` is actually applied (not just declared and then overridden). The English toggle
("EN") exists in the header for switching locale.

## Arabic interface behavior

- Text renders right-to-left throughout the pages checked; no obvious mirroring bugs (icons/arrows
  observed pointing the expected direction for RTL — e.g. the stepper's "→" for forward navigation
  in an RTL context).
- Mixed Arabic/English content (e.g. "SYBNB V6", "Daily Stays" under Arabic category names) renders
  without visible bidi corruption in the areas checked.
- Not checked in this pass: RTL behavior of any third-party embedded widget, RTL correctness of
  numeric/date formatting, or full-page bidi audit beyond the landing/auth-wizard pages.

## Summary

| Check | Result |
|---|---|
| Keyboard order | PASS |
| Visible focus | Inconclusive — needs real-keyboard manual confirmation |
| Skip/navigation | **FAIL** — no skip link, not fixed this phase |
| Form labels | PASS |
| Error association | **FAIL** — no ARIA error association anywhere in the codebase, not fixed this phase |
| Zoom | PASS |
| Reduced motion | PASS |
| Contrast | Open finding — primary CTA button 4.39:1 vs 4.5:1 required, not fixed (brand-color decision) |
| Mobile touch targets | PASS (1px informational note) |
| Language direction | PASS |
| Arabic interface | PASS (limited scope) |

Two confirmed FAILs (skip-navigation, error association) and one confirmed marginal contrast
finding are carried forward as **known limitations** in
`docs/review/SYBNB_V6_SECURITY_BRANCH_REVIEW.md` — none were fixed in this pass, which is
documentation-and-reproducibility-only per the current order's scope.
