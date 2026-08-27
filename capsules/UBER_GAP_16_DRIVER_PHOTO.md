# SR Ride vs. Uber Gap-Closure — Capsule 16: Real Driver Photo

**Source finding:** P0 #2 of `sr-ride-vs-uber-benchmark.md` (2026-08-26) — "No driver photo anywhere in the schema or UI."
**Commit:** `9686b40` on `candidate/satisfaction-remediation`
**Scope:** New schema fields (migration 025), new storage bucket, new route, frontend upload + display. First capsule in the Uber gap-closure arc.
**Status: DONE — verified live end-to-end, committed.**

---

## The problem

Riders identified their driver by name + vehicle text only — no photo existed anywhere in the data model. Uber shows a driver photo the moment a rider is matched; this is one of the cheapest, highest-trust gaps to close.

## The fix

- **Schema**: `DriverProfile.photoRef` / `photoMimeType` (migration `025_driver_photo`), purely additive.
- **Storage**: a new private `driver-photo` bucket in `server/lib/storage.mjs`, matching the exact same discipline already used for KYC documents and listing media — random server-generated keys, MIME/size validation, retrieval only via a short-lived signed URL, never a bare public path.
- **Upload**: `PATCH /api/driver/photo` (`server/routes/driver.mjs`), a near-exact mirror of the existing `PATCH /api/me/id-document` route — same validation shape, same "delete the old file only after the new one is safely written" ordering.
- **Display**: `GET /api/sr/rides/:id` now includes a signed photo URL when a driver is assigned; the rider's tracking screen (`SrRidePage.tsx`) renders it. The driver dashboard gained a real upload control (file picker + submit, mirroring the existing ID-verification upload UI pattern).

## Two real bugs found and fixed while wiring this up — not guessed, caught live

Both were surfaced by actually loading the image in a real browser and reading the console, not by reasoning about the code in the abstract.

1. **Signed-URL churn interrupting the image load.** `signDriverPhotoUrl()` mints a fresh signature and expiry on every call, and the rider screen polls `GET /api/sr/rides/:id` every 4 seconds — so the `<img src>` kept changing before the browser could finish loading the previous one, and the image would appear broken. Fixed by only re-resolving the photo URL when `ride.driverId` actually changes, not on every poll of the same already-assigned driver.

2. **A global security header silently blocking the entire feature.** `server/index.mjs` sets `Cross-Origin-Resource-Policy: same-origin` on every response — correct for a JSON API, but fatal for a route whose entire job is serving embeddable binary content to a *different* origin (the frontend and API are on different ports in dev, and different domains in production). Any `<img>` pointed at this signed URL was silently blocked by the browser (`net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`) even though the server logged a clean `200` for every request — the browser blocks the *embed*, not the network fetch, so `fetch()` calls to the same URL succeeded while `<img>` failed, which is what made this genuinely confusing to trace. This was the first time anything in this codebase attempted a plain cross-origin `<img src>` against this route, so the bug had never been exercised before. Fixed narrowly: the storage route's own success response overrides the header to `cross-origin` (the signature itself *is* the access control, not same-origin) — the global default, and this same route's own error responses, are untouched.

## Verification (live, not code review)

1. `npx prisma validate`, `npx tsc --noEmit`, `npm run build` — all clean.
2. Uploaded a real PNG through the actual `PATCH /api/driver/photo` endpoint — confirmed the exact bytes landed in storage (`file` command confirmed a valid PNG; byte-for-byte diff against the fetched copy came back identical).
3. Created and claimed a real ride through the real UI and the real driver-claim API.
4. Confirmed the rider's tracking screen renders the photo with a real, non-zero `naturalWidth`/`naturalHeight` (not just a present-but-broken `<img>` tag) — the meaningful signal that an image genuinely decoded and displayed, not just that a tag exists in the DOM.
5. Waited across a full poll cycle and confirmed the signed URL stays identical (the churn fix holds) and the image stays loaded.
6. Confirmed a tampered signature is still correctly rejected with `403 STORAGE_SIGNATURE_INVALID` — the CORP relaxation doesn't weaken the actual access control, only what the browser is willing to render it as.
7. Cleaned up every test fixture (rides, driver, rider, the uploaded file) from the local database and disk afterward.

## What this round deliberately did NOT touch

- No admin review/moderation step for driver photos — drivers are already admin-provisioned (per this session's earlier research), so a photo upload by an already-vetted driver account goes live immediately, same trust level as their vehicle info.
- No photo shown anywhere except the rider's own matched-ride screen — no public driver directory, no photo on the driver's own dashboard preview.

---

Next: surfacing aggregated driver ratings (P1 #8), then the rider-facing verified-driver badge (P1 #11).
