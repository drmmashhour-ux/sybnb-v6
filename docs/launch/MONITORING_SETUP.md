# SYBNB — Monitoring & Alerting Setup (instructions; owner provisions the sink)

The app already emits everything a monitor needs; what's missing is an **owner-selected destination**
(a vendor decision — see `VENDOR_REGION_MATRIX.md`). No monitoring vendor is chosen or purchased here.

## What the app already provides (RC e9dfd68)
- **Structured JSON logs** to stdout/stderr with **secret redaction** (verified: 0 raw secrets in logs).
- **`x-request-id`** on every response and in logs → end-to-end request correlation.
- **`GET /api/health/live`** — liveness (no dependencies); 200 = process up.
- **`GET /api/health/ready`** — readiness incl. DB check; `{status:"ready", database.ok:true}`.
- **Redacted error summaries** on exceptions (no PII/stack leakage to clients; top-level error boundary on the SPA).

## Owner steps once a sink is chosen
1. **Ship stdout/stderr JSON logs** to the chosen log sink (the platform's log drain / a collector
   sidecar). No app change — it already logs structured JSON.
2. **Uptime checks**: point the monitor at `GET /api/health/ready` (recommended interval 30–60s).
   Alert if non-200 or `database.ok:false` for N consecutive checks.
3. **Liveness/restart**: the process manager (systemd/container) restarts on exit; `health/live`
   backs the orchestrator's liveness probe.
4. **Alert routes** (owner sets recipients): (a) readiness failing, (b) error-rate spike by
   `x-request-id` volume, (c) DB connection errors, (d) 5xx rate, (e) rate-limit 429 surge (possible abuse).
5. **Retention/region**: logs are redacted but still transit a vendor → record the region for the
   privacy "Processors"/"International transfers" sections (Law-25 relevant).

## Confirm it works
- Hit `GET /api/health/ready` from the monitor → expect 200 + `database.ok:true`.
- Force a readiness failure in staging (stop DB) → confirm the alert fires, then recovers.
- Grep the shipped logs for any secret value → must be **zero** (redaction check).

## Not included (reserved)
No monitoring vendor selected/purchased; no real alert recipients configured; no production log data
routed. These are owner actions after the vendor/region decision.
