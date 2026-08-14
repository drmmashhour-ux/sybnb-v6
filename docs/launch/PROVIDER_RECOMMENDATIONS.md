# SYBNB — Provider Recommendation Package (Gate 3)

2–3 options per remaining infrastructure category, to inform Mohamed's selection. **No vendor is
selected, no account created, no credential used.** Every option is **conditional on written provider
confirmation** that it permits the intended **lawful Syria-facing service**, plus counsel review of
sanctions/export and data-residency. Region availability and policies change — verify against each
provider's **current official documentation** before acceptance.

> ⚠️ **Syria is the decisive gate, not price.** Many US-based providers restrict or prohibit service
> connected to Syria under sanctions/export rules; some rules have shifted recently. Do **not** assume
> eligibility from this document — require **written confirmation per provider** and **counsel sign-off**.
> **Payments** is the hardest category and may require a regional/local processor.

Columns to confirm per option: region availability · Syria-service policy (written) · pricing class ·
data-processing terms/DPA · operational complexity · lock-in · launch suitability.

## Hosting / runtime
| Option | Notes (verify) |
|--------|----------------|
| Hetzner (DE/FI) | EU regions, low cost, plain VMs (higher ops); confirm Syria-facing acceptable-use in writing |
| OVHcloud (EU) | EU regions, VMs/managed; confirm policy |
| Self-managed VM on a Syria-permissive host | maximum control; most ops; requires counsel + provider confirmation |

## Managed PostgreSQL
| Option | Notes (verify) |
|--------|----------------|
| Neon (serverless PG) | EU region available; branch/scale-to-zero; confirm Syria policy + DPA |
| Supabase (managed PG) | EU region; includes auth/storage extras (lock-in tradeoff); confirm policy |
| Self-managed Postgres on the chosen host | no third-party PG policy; you own backups/HA; pairs with self-managed hosting |

## Object storage (KYC/ID, payment proofs, media — private)
| Option | Notes (verify) |
|--------|----------------|
| Cloudflare R2 | S3-compatible (code already SigV4); no egress fees; confirm Syria policy |
| Backblaze B2 | S3-compatible; low cost; confirm region + policy |
| Self-hosted MinIO | S3-compatible, self-controlled (our client supports `STORAGE_S3_ENDPOINT`); most ops |

## Payments (hardest — likely needs regional/local processor)
| Option | Notes (verify) |
|--------|----------------|
| Regional/local Syrian-market processor | most likely path for a Syria-only service; requires counsel + written confirmation; code path is provider-agnostic (webhook-verified) |
| Manual payment-proof rails (already built: Sham Cash / local wallet / bank transfer) | no card processor dependency; admin-reviewed; usable at launch without a card gateway |
| International card processor (e.g. Stripe) **only if** it confirms lawful Syria service in writing | historically restricted; do not assume — counsel + written confirmation mandatory |

## Monitoring / error tracking
| Option | Notes (verify) |
|--------|----------------|
| Self-hosted (Grafana/Loki or Uptime Kuma) | no third-party data-transfer of logs; you run it; pairs with self-managed host |
| Sentry (errors) | mature; SaaS region choice; logs are redacted already; confirm region/DPA |
| Better Stack / hosted logs | uptime + logs; confirm region/policy |

## Recommended stacks (conditional — pending written confirmations)
**Preferred (control + Syria-flexibility):** self-managed VM (Syria-permissive host) + self-managed
Postgres + MinIO (S3) + manual payment-proof rails (+ regional processor when confirmed) +
self-hosted monitoring. Rationale: minimizes third-party Syria-policy dependencies; the app already
supports S3-compatible storage and provider-agnostic payments.

**Fallback (more managed, less ops):** Hetzner/OVH host + Neon Postgres + Cloudflare R2 + regional
processor + Sentry. Requires each SaaS to confirm Syria-facing service in writing.

**Email is settled:** Resend (Gate 2) — pending domain/DNS verification + Resend's written
Syria-service + region confirmation.

## Acceptance rule
An option is **accepted only** after: (1) the provider's **written confirmation** of lawful
Syria-facing service, (2) its data region recorded, (3) a DPA in place, and (4) counsel sign-off on
sanctions/export + transfer. Until then every row is a candidate, not a decision.
