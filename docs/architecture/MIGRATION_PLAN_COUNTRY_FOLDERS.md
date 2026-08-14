# SYBNB — Migration Plan: existing Syria-specific files → `countries/syria` (NOT YET EXECUTED)

Per the architecture decision, Syria-specific assets currently living in the shared tree should move
under `countries/syria`. **This is a large restructure and is deliberately NOT performed yet** — this
plan must be reviewed first. The country-neutral selection layer (`server/lib/country.mjs` +
`countries/syria/profile.mjs`) is already in place and is additive; moving the files below is the
remaining, riskier step.

## Candidate files to relocate (Syria-specific)
| Current path | Nature | Proposed target |
|--------------|--------|-----------------|
| `src/*/syriaData*` (governorate/geo data) | data | `countries/syria/data/` |
| `src/engines/payments/syrianLocalWallet.*` | provider adapter + seed | `countries/syria/payments/` |
| `src/modules/payments/SyrianLocalWallet*.tsx` | UI (Syria wallet) | `countries/syria/ui/` (or keep in master behind profile flag) |
| `docs/legal/*.draft.md`, fee schedule, decisions | legal versions | `countries/syria/legal/` |
| `+963` phone defaults, `ar-SY` locale defaults | localization | driven by `profile.phoneCountryCode` / `profile.defaultLocale` |

## Before moving anything — required analysis (this is the gate)
1. **Affected imports:** enumerate every `import` referencing the paths above (TS path aliases,
   relative imports, dynamic imports) and the re-export surface needed to avoid a breaking change.
2. **Tests:** which E2E/unit suites import these paths; update or add country-scoped fixtures.
3. **Migrations:** DB is country-scoped by deployment (separate DB per country) — confirm no schema
   change is needed, only a separate `DATABASE_URL` per country. No data migration in this step.
4. **Deployment workflows:** one build, N country deployments — each with its own env/secrets/DB/
   storage/domain. Document per-country pipelines; ensure `SYBNB_COUNTRY` is set per environment.
5. **Rollback strategy:** the move is code-only; rollback = revert the relocation commit + rebuild.
   Keep `e9dfd68` (and the current post-change candidate) as tagged fallbacks.
6. **Compatibility risks:** Vite/TS alias resolution for `countries/`, SSR/none (SPA only), bundle
   splitting, asset paths for relocated `public/` data, and import cycles.

## Sequencing (each step its own commit + full governed cert before the next)
1. ✅ Add neutral selection layer + `countries/syria/profile.mjs` (done; additive).
2. Move **data** (`syriaData`) → `countries/syria/data/` behind a thin master re-export. Re-cert.
3. Move **payments adapter/UI** → `countries/syria/` with a master adapter interface. Re-cert.
4. Move **legal versions** → `countries/syria/legal/`; `legalManifest()` reads the active country. Re-cert.
5. Drive `+963`/`ar-SY` defaults from the profile (remove literals from shared components). Re-cert.
6. Tag the country-architecture candidate only after it passes its **own** full governed certification.

## Guardrails
- **Preserve current verified candidate** `e9dfd68` until step 6 passes.
- Do **not** copy whole trees per country (drift risk) — share core, isolate config/adapters/legal.
- No country inherits another's credentials, legal text, currency, provider, DB, or deployment.
- Keep legal DRAFT, payments disabled, deployment blocked, public access closed throughout.

**Status:** plan only. Steps 2–6 await review/authorization. No existing file has been moved.
