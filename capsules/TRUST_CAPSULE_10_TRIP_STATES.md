# Trust Remediation — Capsule 10: Real Trip States on the Dashboard

**Source finding:** P2 #8 of `sybnb-client-satisfaction-trust-audit.md` (2026-08-26) — "STAYS dashboard mislabels an upcoming trip (10 days out) as 'Completed' under 'Previous trips'" + the related stepper finding under "STAYS ease-of-use problems" — "The trip-progress stepper force-shows '✓ Arrival' for a trip 25 days out."
**Commit:** `7f96880` on `candidate/satisfaction-remediation`
**Scope:** Frontend only, one file. No backend/schema touched.
**Status: DONE — verified live, committed.**

---

## The problem

Two related bugs in `DashboardPage.tsx`, both root-caused to the same habit: deriving trip state from array position or booking-existence instead of the real status/date fields already available.

1. **`activeBooking = overview?.bookings[0]`** — the most recently *created* booking, not the most relevant one. **`pastTrips = bookings.slice(1, 3)`** — whatever landed at array positions 1–2, with an unconditional `"Completed"` badge regardless of actual status. A guest with an upcoming, paid, CONFIRMED trip could see it filed under "Previous trips" marked "Completed" just because a different booking happened to be created more recently.
2. **`activeTripStep()`** returned step 2 ("Arrival" marked done) the instant a booking reached `CONFIRMED` — regardless of whether the real check-in date had actually passed. A trip weeks away could show "✓ Arrival" the moment it was paid for.

## The fix

- `activeBooking` is now the most recent **non-terminal** booking (`!['COMPLETED','CANCELLED'].includes(status)`), found via `.find()` over the already-`createdAt desc`-ordered list from the backend. Trusting `status` here is safe, not naive: the backend's `completeExpiredBookings()` (called at the top of every `/api/me/overview` request, confirmed by reading `server/lib/booking-lifecycle.mjs`) already flips `CONFIRMED` → `COMPLETED` the moment `checkOut` passes — so by the time this renders, status is a reliable signal.
- `pastTrips` is now genuinely `COMPLETED`/`CANCELLED` bookings only, excluding whatever is shown as active, each with a real `statusText()`-derived badge (reusing the same helper already used elsewhere in the app) instead of a hardcoded `"Completed"` string.
- `activeTripStep()` now only marks "Arrival" done once the real `checkIn` date has passed *and* the booking is genuinely paid — not merely on `CONFIRMED`.

## A second bug found one level deeper, fixed in the same pass

While rewriting `activeTripStep()`, found it also fell back to `overview?.payments[0]` (the guest's single most recent payment **across every booking**) whenever the specific booking's own `payments` array was empty — meaning an unrelated payment from a *different* booking could leak into this booking's progress calculation. Scoped it to `booking.payments[0]` only. Small, directly inside the function already being rewritten for the audit's own finding — not separate scope creep.

## Verification (live, not code review)

1. `npx tsc --noEmit` and `npm run build` — both clean (one intermediate typecheck error on a nullable-date narrowing, fixed before rebuilding).
2. Reproduced the audit's exact scenario: created an **older** `CONFIRMED` booking with check-in 10 days out, and a **newer** genuinely `COMPLETED` booking, for the same fresh test guest.
3. Confirmed the upcoming trip now renders as the dashboard's current trip (not buried in Previous Trips), with the stepper showing Booked+Paid done, Arrival/Departure correctly still pending.
4. Confirmed the genuinely completed trip shows in Previous Trips with a real "Completed" label.
5. Moved the same booking's check-in date into the past (still before checkout) — confirmed Arrival flips to done while Departure stays pending, matching real arrival/departure semantics exactly.
6. Cleaned up the test fixtures afterward.

## What this round deliberately did NOT touch

- The `t.inTrip` ("In trip") label shown for any active, non-disputed booking — left as a single generic label for "there's an active trip," since the audit's specific complaint was about the *terminal*-state mislabeling, not about sub-dividing the active states further.
- Removed the now-dead `t.completed` translation key (English/Arabic) since nothing references it anymore — the badge is fully `statusText()`-driven now.

---

Next up: P2 #9 (identical stock photo on every search result), then the SR Ride P2 #10 sub-findings (receipt/rating, nonsense-address acceptance, decorative filters), then P2 #11 (RTL/mobile header-clipping bug).
