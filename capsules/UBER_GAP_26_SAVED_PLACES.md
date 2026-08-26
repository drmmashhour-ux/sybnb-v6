# SR Ride vs. Uber Gap-Closure — Capsule 26: Saved Places

**Source finding:** P2 #13 of `sr-ride-vs-uber-benchmark.md` — "No saved places (Home/Work)."
**Commit:** `e7fa48c` on `candidate/satisfaction-remediation`
**Scope:** New table (`032_saved_places`, purely additive).
**Status: DONE — verified live, committed.**

---

## What changed

Riders can now save a named address (e.g. "Home", "Work") and reuse it as a one-tap pickup or dropoff instead of retyping it every time.

- **New `SavedPlace` table**: `userId`, `label`, `address`, optional `lat`/`lng`. Plain float columns, not PostGIS geometry — a saved place is only ever stored and played back into the request form, never spatially queried, so the extra machinery the ride pickup/dropoff columns need would buy nothing here.
- **`GET`/`POST /api/me/saved-places`, `DELETE /api/me/saved-places/:id`** — generic under `/api/me/`, not `/api/sr/`: nothing about a saved place is ride-specific. Delete is scoped to the caller's own `userId` in the query itself, so a mismatched id is a clean 404, never a chance to touch someone else's data.
- **`SrRidePage.tsx`**: a quick-select chip row above the pickup field — each chip can be applied to either pickup or dropoff, or removed — plus a small "save this pickup address" form.

## Verification (live, not code review)

1. List starts empty; a real `POST` creates a row; the list reflects it immediately after.
2. `POST` without a label or address → `400 SAVED_PLACE_INVALID`.
3. A real but unrelated account attempting to delete someone else's saved place → `404`, and the place is confirmed still present in the database afterward — no partial effect from the rejected attempt.
4. The actual owner deleting it → succeeds, list is subsequently empty.
5. `tsc --noEmit`, `prisma validate`, `npm run build` — all clean.
6. Static payment-policy-enforcement audit: **114/114 passed**, unchanged (not payment-adjacent; run as a sanity check).
7. All test fixtures (2 users) removed via direct `psql`.

---

Next: promo codes (P2 #12, money-adjacent — will confirm the design before building) and multi-stop rides (P2 #14).
