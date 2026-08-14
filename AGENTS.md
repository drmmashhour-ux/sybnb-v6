# SYBNB — Agent Operating Policy (multi-country platform)

**Every agent working in this repository MUST follow this policy.** It encodes the owner's
architecture and safety decisions. It overrides convenience. When in doubt, stop and report.

## 1. Architecture: country-neutral master + `countries/<country>`
- The **master platform** (`server/`, `src/`, `prisma/`) is **country-neutral**. Do **not** bake any
  single country's values (currency, phone prefix, locale, legal text, provider, entity, geo data)
  into master code.
- Each supported country is an **isolated implementation** under `countries/<country>` with its own
  profile, and (as separation proceeds) its own data, adapters, legal versions, and configuration.
- The active country is selected by **`SYBNB_COUNTRY`** and loaded via `server/lib/country.mjs`.
  This release supports **`syria`** only. Québec/Canada is the **operating entity's incorporation**,
  **not** a service market.

## 2. Fail-closed country selection (never weaken)
- Startup **refuses to run** when the country profile is missing, unsupported, or incomplete.
- **No country inherits another's** secrets, database, storage, providers, legal text, currency, or
  deployment settings — implicitly or explicitly. Currency/config is validated against the *active*
  profile only.

## 3. Separation is incremental (no bulk moves)
- Move Syria-specific modules into `countries/syria` **one small, reviewable phase at a time**, behind
  **stable interfaces/adapters** — never one uncontrolled bulk copy that will drift.
- After **every** phase: run focused tests **and** the full governed suite (`bash scripts/run-all-e2e.sh`),
  then **stop and report** SHA, exact file movements/runtime delta, test evidence, rollback, next phase.
- See `docs/architecture/COUNTRY_ARCHITECTURE.md` and `MIGRATION_PLAN_COUNTRY_FOLDERS.md`.

## 4. Preserve rollback points
- Keep verified candidates reachable: **`e9dfd68`** (pre-country) and **`1aac064`** (country selector).
  Do not rewrite history over them. New candidates advance forward only.

## 5. Reserved / never without explicit owner authorization
- Do **not**: enable live payments, deploy to production, change DNS / open public access, publish
  legal documents, select vendors, purchase services, or expose/commit secrets.
- Keep **legal DRAFT, payments disabled, deployment blocked, public access closed** until the
  country-specific review passes.
- Do **not** claim compliance (Syrian, Canadian, or otherwise) without qualified legal + provider
  confirmation. Do not invent legal, tax, financial, employment, or compliance conclusions.

## 6. Do not change financial/legal semantics silently
- Preserve ledger, commission, wallet (promotional credit), and consent semantics. Any change to
  money/legal behavior must be explicit, tested, and reported — never a side effect.

## 7. Certification discipline
- The runtime app tree is `server/ src/ prisma/ countries/`. Docs/scripts changes do **not** advance
  the runtime candidate. Report the runtime delta explicitly each phase.
- Regenerate the release archive, manifest, SHA-256 hashes, deploy templates, and certification
  evidence against the **final** candidate once separation completes — not against an older SHA.
