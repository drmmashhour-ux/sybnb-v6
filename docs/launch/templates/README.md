# SYBNB — Deploy Config Templates (placeholders only)

These are **templates for RC `c89c495`**. They contain **no secrets** — every sensitive value is a
`<placeholder>`. The agent will not fill real credentials, select vendors, or deploy. Fill these on
the deploy host or in a secret manager, per `../OWNER_ACTIONS.md`.

| File | Purpose |
|------|---------|
| `production.env.template` | Production env vars (fail-closed set). Payments off / public access closed by default. |
| `sybnb-api.service.template` | systemd unit; secrets via `EnvironmentFile` (chmod 600), SIGTERM graceful stop. |
| `Dockerfile.template` | Multi-stage container build; secrets injected at run time, never baked into the image. |

## Rules
- **Never commit filled copies.** Keep real `.env` / `EnvironmentFile` out of git (already git-ignored).
- Production refuses to start if required vars are missing or if `STORAGE_PROVIDER=local`
  (validated by `server/lib/env.mjs`).
- Live payment keys and DNS/public cutover are **reserved switches** — set only under a separate,
  explicit owner authorization, not as part of normal deploy config.

See `../GO_LIVE_RUNBOOK.md` for the deploy/smoke/rollback command sequence and
`../RELEASE_MANIFEST.md` for artifact checksums.
