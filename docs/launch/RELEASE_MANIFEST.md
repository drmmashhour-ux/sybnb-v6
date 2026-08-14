# SYBNB V6 — Release Manifest (RC `e9dfd68`)

Reproducible release metadata. Every artifact below is derived from commit `e9dfd68` and is
content-addressed. Regenerate the source tarball deterministically with:
`git archive --format=tar --prefix=sybnb-e9dfd68/ e9dfd68 | gzip -n` (mtime-independent).

## Identity
| Field | Value |
|-------|-------|
| Runtime commit | `e9dfd689e5b9d729b2e9194e3d487e79ea36279b` (`e9dfd68`) |
| Source tree object | `16f11094b6150e71144d020d80e0c8caac3306eb` |
| Docs commit (this manifest) | see `git log` — docs advance without changing the runtime tree |
| Node baseline | 22.x (`node server/index.mjs`) |
| Migrations | 11 (`001…011`), applied via `prisma migrate deploy` |
| Governed suites | 17 (492 checks), `bash scripts/run-all-e2e.sh` → 0 failures |
| Dependency audit | `npm audit --omit=dev` → 0 vulnerabilities |

## Source package
| Artifact | SHA-256 |
|----------|---------|
| `sybnb-src-e9dfd68.tar.gz` (git archive) | `849d1f9342aed5932bba469a0d77e2fa16e9b3b74544bf953319e6d1ee162fc9` |

Reproducibility: two independent `git archive … | gzip -n` runs produced the identical digest above.

## Built frontend (from `npm ci && npm run build` on the package)
Entry/large bundles (full set regenerable from source; deterministic given the pinned lockfile):
| Asset | SHA-256 |
|-------|---------|
| `dist/assets/index-d-9WE-m3.js` | `5325bcc7cdaa423eb5daa3341aca454a750c3bd56ef213d73ee4e3358165a6fd` |
| `dist/assets/index-CREsDXVO.js` | `08b595480812525b52f04539d9a3ca8fb4933f15a7304bfdcce70a8952430e22` |
| `dist/assets/index-EoIaITbQ.css` | `d90c5604f9be2ba7c699b88d3aa4b813509ff72a0e7fdca7b093690fbec0d6ff` |
| `dist/assets/syriaData-BbYU1P4r.js` | `26d8a656a1d524b01eb8c68894aab3903c7a47ffa741679546fb9176588566a6` |
| `dist/assets/PaymentCapsule-CaiUpYta.js` | `d75c27004dac7aa3fa4b3f432821457b761d998e8c46a068d3cd233e8a0c9059` |

(The build produced 37 hashed assets; the content hash in each filename is itself the integrity tag.)

## Key runtime source (integrity anchors)
| File | SHA-256 |
|------|---------|
| `server/index.mjs` | `ac6d4fc7d659039db94307d620741c371f7343ec1d0b44138a54055c07734081` |
| `server/routes/payments.mjs` (race fix) | `78cfb1752a229c0ca735f454ed8b9445f93565c642d2a106534dd45279a6bdd4` |
| `server/lib/env.mjs` (fail-closed) | `b5208dce39c397dea46801ae9de7a062913985f5f6f1a5fb042be6c835ce9bbf` |
| `server/lib/security.mjs` | `7f1653695f6f83cec0f70e58153fca4314d5d4ef8ef1ac1ace1431fbb14cc606` |
| `prisma/schema.prisma` | `a65cd1d89217a724c0a52800ef56c3c26b2810d5980b33cb1ae1e0aa50a6652b` |
| `prisma/migrations/011_…/migration.sql` | `d42c86d4bed2a259c17d01f6663a50803b73cc649f1e31526fdb9f1d5b8c6137` |

## Locally certified from the package (2026-08-14)
- `npm ci` clean (0 vulns) · `npm run build` clean · `prisma validate` valid.
- Fresh empty-DB `migrate deploy` = 11 migrations, status up-to-date, `provider_ref` unique index present.
- Packaged API: `health/live` 200, `health/ready` 200 (DB ok), graceful `server_shutdown` on SIGTERM.
- PaymentProof concurrency against the packaged API: **4/4** (8 concurrent → 1 created, 7 duplicate 409).
- Backup→restore drill (prior same-runtime audit): exact row counts + 37 FKs + unique index preserved.
- Fail-closed: production start with missing/invalid config logs `env_validation_failed` and exits.

## Defaults held OFF (require explicit owner authorization to change)
- **Live payments**: `STRIPE_SECRET_KEY` unset → no live charge path. Legal payments stay sandbox/test.
- **Public access**: gated at DNS/edge, not opened by this package.
- **Legal**: `server/lib/legal.mjs` = `DRAFT` / launch-blocking until counsel-approved text is wired.
