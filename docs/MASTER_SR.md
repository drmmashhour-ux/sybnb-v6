# Master SR (ride platform) — country-neutral core + country packs

Saved 2026-10-21. Rezekme SR Rides is the first country (Syria). Everything that is not Syria-specific is the
**master**; everything Syria-specific lives in `countries/syria/`. Another country is a new folder, not a fork.

## What is master (shared, never edit per country)
- Rides, dispatch, wallet/ledger, prepay + card hold, promo codes, business accounts, incidents, AI guide, admin app.
- Server routes: `server/routes/sr-rides.mjs`, `payments.mjs`, `wallet.mjs`; libs under `server/lib/`.
- The pricing admin endpoints (`/api/admin/sr/pricing`) and the Pricing page (`src/modules/sr/AdminPricingPage.tsx`).
- Fail-closed country selection: `SYBNB_COUNTRY` (`server/lib/country.mjs`) and the ride seam
  `server/lib/geo-adapter.mjs`. The master never imports a country directly; unknown country = startup refuses.

## What is a country pack (`countries/<country>/`)
| File | Purpose |
| --- | --- |
| `profile.mjs` | currencies, phone code, locale, launch gates |
| `geo/geocoding.mjs` | place gazetteer, bounds, `quoteSrRide`, and re-exports the pricing capability |
| `geo/sr-pricing.mjs` | cost formula inputs, class profiles, limits, legacy + recommended presets |
| `geo/sr-zones.mjs` | rings, airport anchor, holidays |
| `payments/` | local payment rail (Syria: Sham Cash wallet) |

The pack must export: `resolvePlaceText, haversineKm, quoteSrRide, normalizePricing, storableConfig,
recommendedConfig, getActivePricing, setActivePricing` (checked at startup by the adapter).

## Pricing model (same in every country)
`fare = (base + per-km x km + per-min x min + safety fee + zone/airport/border fees) x (traffic x night x weekend/holiday x schedule x demand x fuel)`,
floored at the **minimum charge**, rounded up to a whole-dollar step.
- **Formula mode:** per-km and per-minute are derived from cost inputs (fuel, maintenance, car wear, insurance, safety reserve,
  empty km, driver income target, traffic cost, platform fee). **Manual mode:** the admin types the rates.
- Stored per country in `admin_settings` (category `pricing`, key `sr_<country>`), audited, version-checked, clamped to limits.
  No stored row = the pack's legacy defaults. No migration needed.
- Admin changes are live within ~15 seconds on every instance. Render env vars remain only as first defaults.

## Add a new country (e.g. Lebanon, Jordan) — in order
1. Create `countries/<country>/profile.mjs` and register it in `server/lib/country.mjs` (REGISTRY).
2. Copy `countries/syria/geo/*` to `countries/<country>/geo/`; replace the gazetteer, bounds, airports, zone centre,
   currency, fuel price, car prices, driver income target and holidays. Keep the exported function names.
3. Register the pack in `server/lib/geo-adapter.mjs` (GEOCODERS).
4. Add the payment rail under `countries/<country>/payments/` and its policy switches (default-deny).
5. Deploy it as its **own** API + database + domain (as Rezekme is separate from SYBNB), with `SYBNB_COUNTRY=<country>`.
6. Run the unit tests, the real-HTTP e2e on a throwaway DB, then the launch checklist. Legal/licensing review is per country.
- Not shared between countries: database, prices, gazetteer, payment rails, legal text, admin accounts.
- Cross-border trips: priced by the pack's border surcharge; whether a driver may carry passengers across needs the
  licensing check in each country first.

## Known gaps in the master
- No separate Taxi class yet (needs enum migration `084`, which is locked until approved).
- Client fallback estimate reads `/api/sr/rates`; the exact quote always comes from the server.
