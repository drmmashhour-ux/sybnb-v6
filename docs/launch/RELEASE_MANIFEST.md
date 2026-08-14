# SYBNB V6 — Release Manifest (RC `c89c495`)

Reproducible release metadata for the **final country-separation candidate**. Every artifact is
derived from commit `c89c495` and content-addressed. Regenerate the source archive deterministically:
`git archive --format=tar --prefix=sybnb-c89c495/ c89c495 | gzip -n` (mtime-independent).

## Identity
| Field | Value |
|-------|-------|
| Runtime commit | `c89c495851add173539cccf9a3ae9e2672f9a828` (`c89c495`) |
| Source tree object | `98b73d267c1f05b55396af8a6f3630a9f295fd4c` |
| Tracked files in archive | 367 (archive == committed tree, verified; 0 untracked/uncommitted) |
| Node baseline | 22.x (`node server/index.mjs`) |
| Country selection | `SYBNB_COUNTRY` (fail-closed); this release supports `syria` only |
| Migrations | 11 (`001…011`), applied via `prisma migrate deploy` |
| Governed certification | 21 E2E suites (0 failures) + static isolation check + bundle-safety scan |
| Dependency audit | `npm audit --omit=dev` → 0 vulnerabilities |

## Source archive
| Artifact | SHA-256 |
|----------|---------|
| `sybnb-src-c89c495.tar.gz` (`git archive … | gzip -n`) | `36e33e1a0479af2db170622e853c8fc60efd1732a968f3eb1ab07b912dfa2581` |

Reproducibility: two independent `git archive … | gzip -n` runs produced the identical digest above.
Archive integrity: the archived file list equals `git ls-tree -r c89c495` exactly (367 files) — no
uncommitted, ignored, or unrelated files are included.

## Built frontend (from `npm ci && npm run build` on the packaged source)
| Asset | SHA-256 |
|-------|---------|
| `dist/assets/index-DvYEqNGD.js` | `c329cedc5f612d937c81564c5a93895ede402d46a45969e3b3dc43f14d1d4d26` |
| `dist/assets/index-zy3WqTs9.js` | `a0a7e1bfa518abd7cb495b6b5f29a954c89b8ba45f9d8d27f966f045d5e463b7` |
| `dist/assets/index-EoIaITbQ.css` | `d90c5604f9be2ba7c699b88d3aa4b813509ff72a0e7fdca7b093690fbec0d6ff` |
| `dist/assets/geo-BbYU1P4r.js` (Syria geo data; unchanged since Phase 3) | `26d8a656a1d524b01eb8c68894aab3903c7a47ffa741679546fb9176588566a6` |
| `dist/assets/PaymentCapsule-C2IQ2w-K.js` | `0f3d109cbcc5a60dc53d0f19dc8bfa17fac6c556cb59cf1bb1554512e9fb7dc7` |

(The build produces hashed assets whose filename hash is itself the integrity tag; the full set is
regenerable from source with the pinned lockfile.)

## Key runtime source (integrity anchors — country architecture)
| File | SHA-256 |
|------|---------|
| `server/lib/country.mjs` (neutral loader, fail-closed) | `c21c11fcd6011962bb42db54fd1620ac7355a6043f932cde198cb43d86b81920` |
| `server/lib/geo-adapter.mjs` (geo seam) | `fea8fc1c4aee135e800bbe16787bb17a4fd83d8d4730c324c2471695c993ea7f` |
| `server/lib/env.mjs` (fail-closed + country) | `36d9cae0e1450b24f5c262e23233c9d98245bed559cbd0a392dc1bb99cded479` |
| `server/routes/payments.mjs` (race fix) | `78cfb1752a229c0ca735f454ed8b9445f93565c642d2a106534dd45279a6bdd4` |
| `countries/syria/profile.mjs` (server profile) | `40c580325611fc6d4dc2e389f663cddadf625cbf26b5a7a97bc3ac1e0555ec4b` |
| `countries/syria/presentation.ts` (public profile) | `1884a11f1a73b9b2348f7aa2b3c719e1d8f678a8ae4d7143e56b493b3e39ea90` |
| `countries/syria/payments/localWallet.ts` | `16178ad951b3903ae3b7a0ca4648e45e62ac0049246352183b8f3068994b020a` |
| `countries/syria/geo/geocoding.mjs` | `251462b2e7788dc310f033c8a5675e1250dc30d278352f70e4e503a01cf342c8` |
| `prisma/schema.prisma` | `a65cd1d89217a724c0a52800ef56c3c26b2810d5980b33cb1ae1e0aa50a6652b` |
| `prisma/migrations/011_…/migration.sql` | `d42c86d4bed2a259c17d01f6663a50803b73cc649f1e31526fdb9f1d5b8c6137` |

## Locally certified from the candidate (2026-08-14)
- `npm run build` clean · `prisma validate` valid · `npm audit` 0 vulns.
- Fresh empty-DB `migrate deploy` = 11 migrations, status up-to-date.
- Full governed run: 21 E2E suites, **0 failures** + isolation 0 + bundle-safety 0.
- Clean-room deploy simulation: 13/13 (fail-closed, migrate, health/live+ready, headers, rate-limit,
  redaction, graceful shutdown).
- Country isolation: master reaches `countries/syria/*` only via explicit bridges; **no shims remain**.
- Bundle safety: no server-profile fields or secrets in `dist/`; server profile module not bundled.

## Defaults held OFF (explicit owner authorization required to change)
- **Live payments**: `STRIPE_SECRET_KEY` unset → no live charge path.
- **Public access**: gated at DNS/edge; not opened by this package.
- **Legal**: `server/lib/legal.mjs` = `DRAFT` / launch-blocking until counsel-approved text is wired.
- **Deployment**: no authenticated production deploy performed.

## Rollback points (all reachable)
`c89c495` (this) · `0717fa3` · `290e833` · `0db6c19` · `e212b13` · `1aac064` · `e9dfd68`.
