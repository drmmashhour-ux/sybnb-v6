/**
 * UX-4A fix (Priority A, 2026-08-31). Pure, framework-free so it can be
 * unit-tested with a plain Node script (see tests/sr-ride-location-guard.test.mjs)
 * -- this repo has no component-test framework (vitest/jest/testing-library),
 * and adding one wasn't authorized in this round. requestRide() in
 * SrRidePage.tsx and the submit button's `disabled` attribute both call this
 * SAME function, so the enforcement can't drift between the two call sites.
 */
export interface SrRideLocationGuardInput {
  readonly pickupTouched: boolean
  readonly dropoffTouched: boolean
  readonly pickup: string
  readonly dropoff: string
}

/**
 * A location is confirmed once the rider actually supplied it -- by typing,
 * by picking a saved place, or via a successful GPS fix (all three set the
 * *Touched flag in SrRidePage.tsx) -- and the resulting text isn't blank.
 * The hardcoded display defaults never flip *Touched, so they alone can
 * never satisfy this check regardless of what their text says.
 */
export function isSrRideLocationConfirmed(input: SrRideLocationGuardInput): boolean {
  return (
    input.pickupTouched &&
    input.dropoffTouched &&
    input.pickup.trim().length > 0 &&
    input.dropoff.trim().length > 0
  )
}
