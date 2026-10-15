# Light SR / STR pages (weak-internet mode)

- `sr.html` -> `src/lite/sr.ts`: sign in (or create account with emailed code) -> pickup/destination -> price -> request -> live status (polls every 6 s, backs off to 60 s on a bad connection, pauses when the screen is hidden). Cancel + pickup code shown.
- `str.html` -> `src/lite/str.ts`: city chips -> text list (photos OFF by default, one toggle) -> details. Last list per city is saved on the phone and opens offline. "Book" opens the full app listing page (dates/payment/host verification stay there).
- No React, no maps, no video. Shared helpers: `src/lite/lite.ts` (same API + same session key as the full app).
- `public/sw-lite.js`: offline shell for the hosted PWA only (scopes /sr.html and /str.html; does not touch `sw.js` push worker). Not registered inside the native app.
- Android flavors (app.sybnb.sr / app.sybnb.str) already add `SYBNBMode/<sr|str>` to the user agent; `index.html` now redirects to `sr.html` / `str.html` before the full bundle loads.
- Web installs: `/sr.html` and `/str.html` have their own manifests (`manifest-sr|str.webmanifest`).
- Build: `npm run build` (vite.config.ts now lists index/sr/str as entries). Then `npx cap sync` and rebuild the flavors.
- Env: `VITE_API_BASE_URL` (required for native), optional `VITE_WEB_URL` (default https://sybnb.app) for the "Book" link inside the native STR app.

Not done yet: SMS/OTP-by-phone flows (Syria profile is email-only), booking inside the lite STR page, ride chat/SOS/rating in lite SR, Vercel rewrites for pretty URLs.
