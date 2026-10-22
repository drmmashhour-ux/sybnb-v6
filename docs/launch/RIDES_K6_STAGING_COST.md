# Rezekme Rides: staging k6 test, itemized cost estimate

**Status: estimate only. Nothing below has been created or started; it waits for your approval.**

- Prices are public list prices, read on 21 Oct 2026 (sources at the end).
- Render, Neon and Grafana bill in USD. CAD uses 1 USD = **1.4063 CAD** (USD/CAD mid-rate, 21 Oct 2026).
- Quebec GST/QST (14.975%) may be added to CAD card charges; it is not included below.

## Assumptions

| Item | Assumption |
|---|---|
| Test runs | `staging-launch` (~19 min), then `staging-step` (~44 min), then `staging-soak` (~35 min): **~1.6 h of load**. Allow 1.5× for reruns, about 2.5 h. |
| Staging lifetime | The staging API exists **8 hours** (deploy, seed, smoke, the runs above, reruns), then is deleted. |
| Staging API size | **1 CPU / 2 GB** (Render `1c-2g`, the "Standard" size), the recommended launch size. An optional second run on **2 CPU / 4 GB** (`2c-4g`) shows how it scales. |
| Staging database | A **separate, empty** Neon project seeded with synthetic users (200k registered, 1.3k drivers, 1.1k riders; about 150–250 MB). It is **not** a branch of production: that would copy real riders and drivers, and on the Free plan it would use up production's compute allowance. |
| Load generator | Open-source k6 on your Mac (no charge). k6 Cloud is optional (Frankfurt load zone). |
| Traffic volume | ≈ 610k HTTP requests across all runs (step ≈ 485k, soak ≈ 110k, launch ≈ 15k). At ~2–5 KB per response that is **≈ 1.5–3 GB** out of the API. |
| Current plans (read today) | Neon project `rezekme-production` is on the **Free** plan (`free_v3`). Render `rezekme-api` is the `starter` instance; I could not read the workspace plan, so Hobby (5 GB bandwidth) is assumed as the worst case. |

## One-time test cost

| # | Item | How calculated | USD | CAD |
|---|---|---|---|---|
| 1 | Render staging API, `1c-2g`, 8 h | $25/month ÷ 730 h × 8 h, billed per second | $0.27 | $0.38 |
| 2 | *Optional:* second API run on `2c-4g`, 8 h | $85 ÷ 730 × 8 | $0.93 | $1.31 |
| 3 | Neon staging database, **Free plan, separate project** | 100 CU-hours included per project. The test uses ≤ 2 CU × 8 h = 16 CU-h. Storage < 0.5 GB; 5 GB egress included. | $0.00 | $0.00 |
| 3b | *If Neon is on Launch (pay-as-you-go) instead* | up to 4 CU × 8 h = 32 CU-h × $0.106, plus storage 0.5 GB × $0.35 × 8/730 | $3.39 | $4.77 |
| 4 | Render bandwidth | 1.5–3 GB. Included in the workspace allowance (Hobby 5 GB, Pro 25 GB); over that it is $0.15/GB. Worst case: all 3 GB over the allowance. | $0.00–0.45 | $0.00–0.63 |
| 5 | Neon data transfer | DB→API ≈ 1–2 GB, inside the 5 GB (Free) or 500 GB (Launch) included | $0.00 | $0.00 |
| 6 | k6, open source, on your Mac | free software | $0.00 | $0.00 |
| 7 | *Optional:* Grafana k6 Cloud instead of your Mac | see the comparison below | $0–$99 | $0–$139 |
| | **Recommended total** (1 + 3 + 4 + 6) | | **$0.27–$0.72** | **$0.38–$1.01** |
| | **With the optional 2-CPU run** (+2) | | **$1.20–$1.65** | **$1.69–$2.32** |
| | **All in k6 Cloud, Neon on Launch** (1+2+3b+4+7 high) | | **≈ $104** | **≈ $146** |

### k6 open source (your Mac) vs Grafana k6 Cloud

- **Cloud pricing:** k6 Cloud bills virtual-user hours (VUh): the number of VUs in a test × its hours.
  - Free tier: 500 VUh per month.
  - Pro: $19/month, which includes 500 VUh, then $0.15 per VUh, cheaper at volume.

| Run | Peak VUs (≈) | Hours | VUh |
|---|---|---|---|
| staging-launch | ~80 | 0.32 | ~25 |
| staging-step | ~1,240 (800 drivers + pre-allocated ride/browse VUs) | 0.73 | ~910 |
| staging-soak | ~160 | 0.58 | ~90 |
| **Total** | | | **~1,030** |

| Option | Cost | Notes |
|---|---|---|
| Your Mac, open source | $0 | Results include ~90–110 ms of Canada→Frankfurt round trip on every request. |
| k6 Cloud Free, launch + soak only (~115 VUh); step on the Mac | $0 | Fits the 500 VUh free tier. |
| k6 Cloud Pro, everything (~1,030 VUh) | $19 + 530 × $0.15 = **$98.50 USD / $138.52 CAD** | Plus $19/month while the plan stays active. |

## Ongoing monthly cost

| Item | If deleted after the test (recommended) | If kept running |
|---|---|---|
| Render staging API `1c-2g` | $0 | $25.00 USD / $35.16 CAD per month |
| Neon staging project (Free) | $0 | $0, within 100 CU-h if it auto-suspends when idle; over that, compute stops until next month |
| k6 Cloud Pro | $0 (cancel) | $19.00 USD / $26.72 CAD per month |
| **Total** | **$0** | **$44 USD / $62 CAD per month** |

## Important, outside the test: production database allowance

Production Neon is on the Free plan, with 100 CU-hours per project per month.
- The production database has been active almost continuously since 18 Oct: ~96 active hours at 0.25 CU = **~24 CU-h in 4 days**.
- A full month at that rate is about **186 CU-h**, above the free 100. Neon suspends compute when the allowance runs out, so the API would lose its database part-way through a month.
- Moving production to Neon Launch at the same 0.25 CU costs about 182.5 CU-h × $0.106 ≈ **$19.35 USD / $27.21 CAD per month**, plus storage at $0.35/GB-month.

This needs a decision before launch, whatever happens with the load test.

## Sources (read 21 Oct 2026)

- Render pricing (instance sizes, workspace plans, bandwidth): https://render.com/pricing
- Neon pricing (CU-hour, storage, branches, transfer, plan limits): https://neon.com/pricing
- Grafana Cloud k6 pricing (VUh, Pro fee): https://grafana.com/pricing/
- USD/CAD mid-rate 21 Oct 2026: https://www.poundsterlinglive.com/history/USD-CAD-2026
- Current plans: Neon project `rezekme-production` (`subscription_type: free_v3`, 0.25 CU) and Render `rezekme-api` (`plan: starter`), read through the account tools without changing anything.
