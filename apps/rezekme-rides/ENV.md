# SR Rides app: environment variables

These are Vite build-time variables (read from the repo-root `.env*` files, `envDir` = repo root).
They end up in the browser bundle, so never put a secret in a `VITE_*` variable.

| Variable | Required | What it does |
| --- | --- | --- |
| `VITE_API_BASE_URL` | yes (production) | Base URL of the Rezekme API, for example `https://api.example.com`. If unset the app falls back to `http://127.0.0.1:3051` (local dev), the same default as the platform client. |
| `VITE_GOOGLE_MAPS_API_KEY` | no | Turns on Google Maps (map, Places address search, reverse geocoding for dropped pins). **If missing, or if Google fails to load or rejects the key, the app automatically uses the free Leaflet / OpenStreetMap map and plain text address inputs.** |
| `VITE_MAP_TILE_URL` / `VITE_MAP_TILE_ATTRIBUTION` | no | Raster tile URL for the keyless Leaflet map (default: standard OpenStreetMap tiles). For the current, detailed look set `VITE_GOOGLE_MAPS_API_KEY` instead. Providers that need a key (CARTO, MapTiler, Stadia) go here with the key in the URL. |
| `VITE_MAPS_COUNTRY` | no | Two-letter country code (for example `ca`) to restrict address suggestions. Empty means worldwide; no country is built in. |
| `VITE_MAPS_DEFAULT_CENTER` | no | `lat,lng` used as the first map view when nothing is known yet (no pins and no remembered GPS position). Empty means Syria (centre 34.8, 38.5, zoom 7). |

## About the Google Maps key (please read)

- A browser Maps key is **public**: anyone can read it from the page source. The protection is the
  restriction you set on it, not secrecy.
- In Google Cloud, restrict the key to:
  - **Application restrictions**: the app's web origins (HTTP referrers, for example
    `https://rides.example.com/*`), and for the Android app the package name `app.sybnb.sr` with its
    signing certificate.
  - **API restrictions**: only the **Maps JavaScript API** and the **Places API**
    (plus the **Geocoding API** if you want pin labels as addresses). The route line no longer
    uses the browser key: it goes through the API (see the last section).
- These Google services are **billed** per use (map loads, autocomplete sessions, geocoding,
  directions). Set a budget and quota alert in Google Cloud before going live.
- Never commit a real key. Put it in an uncommitted `.env.local`.
- The address search uses Google's `Autocomplete` widget (Places library). Google restricts that legacy
  widget for some newer Cloud projects; if suggestions do not appear, the app simply keeps working with
  plain text input.

- `VITE_SHAMCASH_QR_URL`: URL of the Rezekme Sham Cash receiving QR shown on the payment step (falls back to the shared SYBNB asset, which must not be used for Rezekme money).

## Road-following route line (server side)

The route line follows streets through the API endpoint `GET /api/sr/route` (cached, rate limited). Set on the API (Render):

- `ROUTING_OSRM_URL` (optional): your own OSRM-compatible router. Default is the public OSRM demo server, which is fine for testing but has no uptime promise; use your own or a paid router before real traffic.
- `GOOGLE_ROUTES_API_KEY` (optional, secret): when set, Google Routes is tried first (billed per route by Google), then OSRM. If both fail, the app shows a plain line and keeps working.
