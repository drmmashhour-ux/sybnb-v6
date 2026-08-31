/**
 * UX-4A fix (Priority A, 2026-08-31; refined twice after Google's
 * adversarial review, then a second adversarial pass from the owner
 * catching a gap in the first refinement). Pure, framework-free so it can
 * be unit-tested with a plain Node script (see
 * tests/sr-ride-location-guard.test.mjs) -- this repo has no
 * component-test framework (vitest/jest/testing-library), and adding one
 * wasn't authorized. requestRide() in SrRidePage.tsx and the submit
 * button's `disabled` attribute both call this SAME function, so
 * enforcement can't drift between the two call sites.
 *
 * Two rounds of adversarial review shaped this:
 *
 * Round 1 (Google): a bare `touched: boolean` degenerates under real
 * interaction sequences -- it can't distinguish a genuine GPS fix from a
 * later hand-edit that invalidates those coordinates. Fixed by modeling
 * each endpoint's SOURCE ('default' | 'manual' | 'saved' | 'gps') instead
 * of a single flag.
 *
 * Round 2 (owner): SOURCE alone still isn't enough -- a rider could edit
 * the seeded default by one character (source flips to 'manual') and then
 * restore the exact original text, ending up with source='manual' but
 * text identical to the placeholder. That must still be rejected: editing
 * and reverting to literal placeholder text is not a genuine location.
 * Fixed by additionally comparing MANUAL-source text against the known
 * seeded default text for that field -- but only for 'manual'. A 'gps' or
 * 'saved' source is trusted regardless of what the resulting text says,
 * because those sources come from a real external selection (a geolocation
 * fix, or a rider's own saved place), not from typing -- if a saved place
 * or GPS reverse-geocode genuinely happens to read identically to the
 * placeholder text, that's still a real, independently-established
 * location, not the untouched placeholder.
 */
export type SrRideLocationSource = 'default' | 'manual' | 'saved' | 'gps'

export interface SrRideLocationGuardInput {
  readonly pickupSource: SrRideLocationSource
  readonly dropoffSource: SrRideLocationSource
  readonly pickup: string
  readonly dropoff: string
  /** The literal seeded placeholder text for pickup, in whichever locale this session started in. */
  readonly pickupDefaultText: string
  /** The literal seeded placeholder text for dropoff, in whichever locale this session started in. */
  readonly dropoffDefaultText: string
}

function isConfirmedEndpoint(source: SrRideLocationSource, text: string, defaultText: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0) return false
  if (source === 'default') return false
  if (source === 'manual') return trimmed !== defaultText.trim()
  // 'gps' and 'saved' are trusted regardless of text content -- both come
  // from a real external selection, not from typing, so even a coincidental
  // match against the placeholder text represents a genuine location.
  return true
}

/**
 * A location is confirmed once the rider actually supplied it through a
 * real, currently-valid source: manual entry that isn't the literal
 * placeholder text, a saved place, or a real GPS fix -- AND the resulting
 * text is non-blank right now. "Manual entry" intentionally accepts any
 * non-blank, non-placeholder free text without requiring it to resolve to
 * real coordinates -- SR Ride's existing product design already supports
 * addresses its own geocoder can't recognize (see `manualHint`/
 * `addressUnrecognized` in SrRidePage.tsx: "the request can continue
 * without GPS through manual addresses"), so this guard does not invent a
 * new geocoding requirement on top of that established behavior.
 */
export function isSrRideLocationConfirmed(input: SrRideLocationGuardInput): boolean {
  return (
    isConfirmedEndpoint(input.pickupSource, input.pickup, input.pickupDefaultText) &&
    isConfirmedEndpoint(input.dropoffSource, input.dropoff, input.dropoffDefaultText)
  )
}
