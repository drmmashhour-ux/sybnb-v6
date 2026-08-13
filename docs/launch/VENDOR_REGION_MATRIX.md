# SYBNB — Vendor & Data-Region Decision Matrix (owner selects)

Choose the production vendor and data region for each service. **The agent will not select vendors
or purchase services** — this records the options, the technical fit (the code already integrates
each category via a provider seam), and the privacy implications so the owner + counsel can decide.
Selections then feed the Privacy "Processors" (#16) and "International transfers" (#17) sections.

**Cross-cutting privacy note (material):** the operator is **9375-7649 QUÉBEC INC.** (Québec, Canada),
so **Québec Law 25** (and possibly Canadian PIPEDA) likely applies. Law 25 imposes obligations when
personal information is **communicated outside Québec** (assessment + safeguards) and for engaging
service providers. Where the platform serves **Syria**, sanctions/export and data-localization
questions also arise. **Region choice is a legal decision — flag every cross-border flow to counsel.**

## Decision table (fill the "Chosen" column)

| Service | Code integration (ready) | Candidate vendors | Region considerations | Personal data handled | Chosen |
|---------|--------------------------|-------------------|-----------------------|-----------------------|--------|
| **Payments** | Stripe SDK path (gated) + provider-agnostic webhook (certified) | Stripe (test→live) | Stripe entity/region; SYP not a Stripe settlement currency (FX/settlement decision) | payment refs/events; **no full card data stored** (provider handles cards) | `[[OWNER]]` |
| **SMS / OTP** | `SMS_PROVIDER=http` adapter (certified vs mock) | `[[a provider that delivers to Syrian numbers]]` | provider region; deliverability to Syria; sanctions | phone number (hashed at rest); OTP delivered (code hashed) | `[[OWNER]]` |
| **Object storage** | S3/SigV4 client (certified vs mock); private buckets | AWS S3 / GCS (S3-interop) / Cloudflare R2 / MinIO(self-host) | **bucket region** = where KYC/proof/media live → key Law-25 transfer question | **KYC/ID documents**, payment-proof docs, listing media | `[[OWNER]]` |
| **Database / hosting** | Postgres via `DATABASE_URL`; `migrate deploy` certified | managed Postgres (e.g. RDS/Cloud SQL/Neon/Supabase) + app host | **DB region** = primary personal-data residence | all account/listing/message/wallet/payment data | `[[OWNER]]` |
| **Monitoring / logs** | structured JSON logs (secrets redacted) ready to ship | log sink + APM + alerting (e.g. hosted logging/APM) | logs are redacted but still transit a vendor | redacted request metadata (no secrets/PII values) | `[[OWNER]]` |
| **Error reporting** | errors logged as redacted summaries | error-tracking service | vendor region | redacted error metadata | `[[OWNER]]` |

## What to record per selection
- Vendor name + the **specific region** the data resides in.
- Whether a **Data Processing Agreement** is in place.
- For any flow that leaves Québec/Canada: the Law-25 transfer assessment + safeguard.
- For Syria-facing flows: sanctions/export review.

## After selection
Give the agent the vendor names + regions and it will (docs-only) fill the Privacy Policy
"Processors" and "International transfers" sections and update the decision list — **without** creating
accounts or purchasing anything. Configuring each provider against its real **sandbox** endpoint (and
recording evidence) happens once you hand over test credentials.
