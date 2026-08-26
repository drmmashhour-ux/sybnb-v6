# Trust Remediation — Capsule 8: Real Pre-Booking Price

**Source finding:** P1 #6 of `sybnb-client-satisfaction-trust-audit.md` (2026-08-26) — "STAYS: pre-booking price (listing page) omits the 5% cleaning fee + 2% tax that the real receipt adds — guest evaluates a number ~7% lower than what they're actually charged."
**Commit:** `d52994e` on `candidate/satisfaction-remediation`
**Scope:** Frontend only, one file. Money path unchanged (verified by diff, not just claimed).
**Status: DONE — verified live, committed.**

---

## The problem

The listing page's live booking summary (`ListingDetailPage.tsx`) showed only the bare rent amount as the price — no cleaning fee, no tax. The real receipt for a completed booking on the same listing (`BookingDetailPage.tsx`, via `guestFeeSummary()`) adds a 5% cleaning fee and 2% tax on top. A guest evaluating a listing saw a number roughly 7% lower than what they'd actually be charged — a classic hidden-fee reveal, except the reveal only happened after the guest had already committed to booking.

## The fix

Reused `guestFeeSummary()` — the exact function `BookingDetailPage.tsx` already uses for the real receipt — instead of the listing page's own duplicate, protection-fee-only math (`Math.round(total * 0.03)`, which only ever accounted for the optional cancellation-protection add-on, never the cleaning fee or tax). Both price options ("Standard rate" and "Protected rate") now show the real, full total, each with a visible "Includes cleaning fee and taxes" note, plus a line-item breakdown (booking amount / cleaning fee / taxes) directly under the price choice — mirroring the receipt's own already-clear breakdown, just shown at the point a guest is actually deciding whether to book. The generic "Price" info row further down the page was also switched to the same total, so the page no longer shows two different numbers for the same listing.

## What was deliberately left untouched — the actual money path

This is a display fix, not a new pricing code path. Confirmed directly via diff, not just by reasoning about it:

- `createPrototypeBooking({ amountMinor: displayedTotalMinor, ... })` — the line that actually creates the booking — does not appear anywhere in the diff. `displayedTotalMinor` (the base rent amount, no fees) is unchanged.
- The cancellation-protection fee sent to booking creation now comes from `guestFeeSummary()`'s `cancellationProtectionFeeMinor` instead of a duplicate local calculation, but it's the exact same formula (3% of stay amount) — same value, single source of truth instead of two copies of the same math that could drift apart later.

## Verification (live, not code review)

1. `npx tsc --noEmit` and `npm run build` — both clean.
2. Loaded the real listing page for the exact listing the audit flagged ("Seafront Luxury Apartment - Latakia," 250,000 SYP rent).
3. Confirmed **Standard rate** now shows **267,500 SYP** with "Includes cleaning fee and taxes," and the breakdown line reads "Booking amount: 250,000 · Cleaning fee: 12,500 · Taxes and local fees: 5,000" — sums exactly to 267,500.
4. Confirmed **Protected rate** shows "Protection fee: 7,500 SYP" (3% of 250,000, exact) and "Total due: 275,000 SYP" (267,500 + 7,500, exact).
5. Confirmed the generic "Price" row lower on the page now matches (267,500), no longer a mismatched number.
6. Confirmed the same in Arabic, with correct Arabic-Indic numeral formatting (٢٦٧٬٥٠٠ ل.س).
7. Independently re-read the diff to confirm `createPrototypeBooking`'s `amountMinor` argument and the actual cancellation-protection-fee value sent were untouched.
8. Registered a fresh test guest to prepare a real booking-creation check, then cleaned it up (didn't need to complete a full date-picker flow given the diff-level guarantee above was already conclusive for a pure-display change).

## What this round deliberately did NOT touch

- Any other division's listing page (this fix is scoped to `ListingDetailPage.tsx`, shared by all divisions, but `guestFeeSummary()`'s cleaning-fee/tax computation is already gated to `division === 'STAYS'` — other divisions see no change in the numbers shown, only STAYS listings gain the fee breakdown).
- The still-fabricated "Damascus" location fallback visible on the same page (`⌖ ...Latakia, Damascus, Syria`) — that's the next, separate finding (P1 #7).

---

Next up: P1 #7 (fabricated "Damascus" location fallback).
