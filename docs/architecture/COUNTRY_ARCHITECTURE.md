# SYBNB — Country Architecture (master + countries/<country>)

**Decision:** SYBNB is a **country-neutral master platform**. Each supported country is an isolated
implementation under `countries/<country>`, adapted to its own legal, financial, provider, language,
currency, data-region, and operational requirements. This release ships **`countries/syria`** only.
Future countries are added separately and are **out of scope** here.

## Principles
1. **Master stays country-neutral.** No single country's values are baked into `server/` or `src/`.
2. **Fail-closed country selection.** Startup refuses to run when the country profile is missing,
   unsupported, or incomplete (`SYBNB_COUNTRY` → `countries/<country>/profile.mjs`).
3. **No cross-country inheritance.** Each country has its own secrets, database, storage, providers,
   legal versions, currency, deployment, release evidence, and activation gates. None inherits another's.
4. **Shared core + explicit config/adapters** — not uncontrolled full-code copies that drift.
5. **Preserve verified candidates.** The prior runtime candidate `e9dfd68` is preserved; the
   country-folder architecture must pass its **own** governed certification before it supersedes it.

## What exists now (implemented this pass — additive, not a file move)
| Piece | Location | Classification |
|-------|----------|----------------|
| Country selection loader (neutral, fail-closed) | `server/lib/country.mjs` | **Master / country-neutral** |
| Env fail-closed wiring | `server/lib/env.mjs` (`countryProblems`) | **Master / country-neutral** |
| Syria profile (currency, locale, phone, entity, gates) | `countries/syria/profile.mjs` | **Syria-specific** |
| Country-selection governed test | `tests/e2e/country-selection.e2e.mjs` | **Master / country-neutral** |
| `SYBNB_COUNTRY` in env templates + run scripts | `.env.example`, `templates/`, `scripts/` | **Master / country-neutral** |

## Classification of the Syria market corrections
- **Country-neutral core (master):** currency-override validation *mechanism* (allowed set comes from
  the active profile), fail-closed selection, health/readiness, storage/S3, payments architecture,
  OTP, wallet, moderation — none of these hard-code a country.
- **Syria-specific (`countries/syria`):** currency set `SYP/USD`, advertising `USD $50/wk`, `+963`
  phone default, `ar-SY` locale, the Québec operating-entity identity, Syrian local wallet, legal
  DRAFT versions, and the Syria external gates (providers/sanctions/data-region/tax).
- **Future-country work (excluded):** any non-Syria profile, its legal text, providers, currency,
  data region, or deployment. **Not built here.**

## Owner / counsel decisions (NOT decided here)
Semantics for financial, legal, tax, employment, and compliance remain owner/qualified-counsel
decisions per country. No Syria compliance is claimed without qualified legal + provider confirmation.
See `MIGRATION_PLAN_COUNTRY_FOLDERS.md` for the deferred restructure and its risks.
