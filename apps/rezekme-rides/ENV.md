# SR Rides app: environment variables

These are Vite build-time variables (read from the repo-root `.env*` files, `envDir` = repo root).
They end up in the browser bundle, so never put a secret in a `VITE_*` variable.

| Variable | Required | What it does |
| --- | --- | --- |
| `VITE_API_BASE_URL` | yes (production) | Base URL of the Rezekme API, for example `https://api.example.com`. If unset the app falls back to `http://127.0.0.1:3051` (local dev), the same default as the platform client. |
| `VITE_MAP_STYLE_URL` | no | MapLibre style URL for the ride map. Default: OpenFreeMap `liberty` (OpenStreetMap data, **no key, no account, no billing**). Address entry is typed text, saved places or a dropped pin; there is no Google dependency in this app. |
| `VITE_MAPS_COUNTRY` | no | Two-letter country code (for example `ca`) to restrict address suggestions. Empty means worldwide; no country is built in. |
| `VITE_MAPS_DEFAULT_CENTER` | no | `lat,lng` used as the first map view when nothing is known yet (no pins and no remembered GPS position). Empty means Syria (centre 34.8, 38.5, zoom 7). |

## Road-following route line (server side)

The route line follows streets through the API endpoint `GET /api/sr/route` (cached, rate limited). Set on the API (Render):

- `ROUTING_OSRM_URL` (optional): your own OSRM-compatible router. Default is the public OSRM demo server, which is fine for testing but has no uptime promise; use your own or a paid router before real traffic.
- `GOOGLE_ROUTES_API_KEY` (optional, secret): when set, Google Routes is tried first (billed per route by Google), then OSRM. If both fail, the app shows a plain line and keeps working.
