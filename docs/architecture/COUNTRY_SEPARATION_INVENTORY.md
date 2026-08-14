# SYBNB — Country Separation Inventory (Syria-specific files outside `countries/syria`)

Classification of every file that carries Syria-specific content, so moves happen incrementally
behind stable interfaces. **No file is moved by this document** — it is the map for the phased moves.

Legend: **MOVE** → relocate into `countries/syria` behind an adapter/re-export ·
**NEUTRALIZE** → keep in master, drive the country bit from the active profile ·
**STAY** → country-neutral core/UI, no change · **DATA** → country dataset.

## Tier A — concentrated Syria modules (move behind adapters)
| File | Importers | Class | Target |
|------|-----------|-------|--------|
| `src/engines/search/syriaData.ts` | `engines/search/{osmSyriaRoads,index}` | **MOVE/DATA** | `countries/syria/data/geo.ts` (re-export shim at old path) |
| `src/engines/search/osmSyriaRoads.ts` | `engines/search/{syriaData,index}` | **MOVE/DATA** | `countries/syria/data/roads.ts` |
| `src/engines/payments/syrianLocalWallet.ts` + `.seed.json` | `engines/payments/index`, `SyrianLocalWalletPaymentPage` | **MOVE/adapter** | `countries/syria/payments/localWallet.ts` behind a master payment-adapter interface |
| `server/lib/sr-geocoding.mjs` | `server/routes/sr-rides.mjs` | **MOVE/adapter** | `countries/syria/geo/geocoding.mjs` behind a master geocoding seam |

Each Tier-A move is **one phase**: relocate → leave a thin re-export at the old path (no importer edits
in the same phase) → focused test + full governed cert → report → (later phase) update importers to the
new path and delete the shim.

## Tier B — neutralize via the country profile (keep in master)
| File(s) | Syria bit | Action |
|---------|-----------|--------|
| `src/shared/i18n/display.ts`, `src/shared/booking/cancellationPolicy.ts`, `HostEarningsPage`, `HostDashboardPage` | `ar-SY` locale literal | read `profile.defaultLocale` (already `ar-SY` for syria) |
| `SellerAccountPage.tsx`, `WalletPage.tsx`, `SyrianLocalWalletPaymentPage.tsx`, `GiftFlowRoutes.tsx` | `+963` phone placeholder/default | read `profile.phoneCountryCode` |
| `server/routes/payments.mjs` (`STRIPE_CURRENCY`/`SYP_PER_USD`) | SYP settlement note | already env-driven; document as profile-scoped, no literal move |

Tier B keeps the code in master but removes the **hard-coded** country value, sourcing it from the
active profile — this is what makes master genuinely country-neutral.

**Phase 6 status (done):** a browser-safe public `CountryPresentationProfile`
(`countries/syria/presentation.ts` + resolver `src/shared/country/presentation.ts`) now supplies
locale/phone. Neutralized: `display.ts#moneyText`, `cancellationPolicy.ts`, and every page-level
`ar-SY/en-US` locale (Host/Admin/Dashboard/GiftAdminAudit → `localeForLang`), plus the Seller phone
placeholder (`phonePlaceholder()`). **Intentionally NOT changed (sample content, not presentation
policy):** demo/mock phone values in `platformApi.ts` fixtures, `StaffAccessPage` demo logins,
`useState` seed defaults, the masked example in `GiftCodeVerify`, and the `GiftRecipientLanding`
per-language copy string — these are illustrative content a user overwrites, not a country default;
sourcing them from the profile would change UX and is out of scope. The server profile is never
imported by browser code (isolation + bundle-safety scan enforce this).

## Tier C — STAY (country-neutral; only incidental Syria mentions)
`server/contracts.mjs`, `src/backend/contracts.ts` (API descriptions naming "Syrian local wallet"),
`AdminReviewPage`, `RentalsPage`, `LandingPage`, `SearchPreviewPage`, `LocationCascade`,
`DashboardPage`, `FinanceReconciliationPage`, gift-flow components, `platformApi.ts` (fixtures/labels),
`prisma/*` (schema/seed/migrations — DB is country-scoped by *deployment*, one DB per country; no move).
These reference Syria only as data/labels or consume Tier-A/B via interfaces — no relocation needed.

## Phasing (each phase: stop + report; preserve `e9dfd68` & `1aac064`)
- **Phase 2 (this):** `AGENTS.md` policy + this inventory. No code move. Full cert unchanged.
- **Phase 3:** MOVE `syriaData` + `osmSyriaRoads` → `countries/syria/data/` behind re-export shims (barrel-mediated, lowest risk).
- **Phase 4:** MOVE `syrianLocalWallet` (+seed) → `countries/syria/payments/` behind a master payment-adapter interface.
- **Phase 5:** MOVE `sr-geocoding` → `countries/syria/geo/` behind a master geocoding seam.
- **Phase 6:** NEUTRALIZE Tier B (locale/phone from profile); remove hard-coded literals.
- **Phase 7:** delete re-export shims; update importers to `countries/syria/*`; prove master imports nothing Syria-specific implicitly.
- **Phase 8:** regenerate release archive + manifest + SHA-256s + templates + certification against the **final** candidate.

## Phase 8 — remaining sample-phone-literal audit (report only; not changed)
15 `+963` literals remain in `src/`, all **sample/demo/copy content**, none in a country-selection,
profile, or config path (verified: no `+963` under any country/profile/config module). They do **not**
violate fail-closed country isolation, so Phase 8 leaves them unchanged:
- `src/shared/api/platformApi.ts` (×4) — mock fixture phone values.
- `src/modules/account/StaffAccessPage.tsx` (×3) — demo staff-login numbers.
- `src/modules/payments/SyrianLocalWalletPaymentPage.tsx` (×2), `WalletPage.tsx`, `GiftFlowRoutes.tsx` (×2) — `useState` seed defaults / masked example.
- `src/modules/wallet/gift-flow/GiftRecipientLanding.tsx` (×2), `GiftCodeVerify.tsx` — per-language UI copy / masked example.
Optional future cleanup: source the visible placeholders/masked examples from `phonePlaceholder()` and
replace mock fixtures with neutral sample values — a cosmetic follow-up, not an isolation requirement.

## Isolation proof to run each phase
- `grep -rE "countries/syria" server/ src/` in **master** must show only the neutral loader path,
  never a direct Syria-data/legal/provider import outside an adapter.
- `SYBNB_COUNTRY` unset / unsupported / incomplete → startup refuses (country suite).
- No master module reads Syria legal text, credentials, providers, DB, or deployment settings implicitly.
