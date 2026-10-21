# Rezekme: build, payments and DNS steps

Rezekme = three small apps built from SR and STR. Source: `apps/rezekme-rides`, `apps/rezekme-stay`,
`apps/rezekme-landing`. They share the platform code in `src/` through the `@platform` alias, like SR and STR.

## 1. Build (run on the Mac, in this folder)
- `npm run build:rezekme` builds all three into `dist-apps/rezekme-rides`, `dist-apps/rezekme-stay`, `dist-apps/rezekme-landing`.
- Dev: `npm run dev:rezekme-rides` (port 5191), `npm run dev:rezekme-stay` (5192), `npm run dev:rezekme-landing` (5190).
- Status 2026-10-21: all three apps typecheck (`npx tsc -p apps --noEmit`) and build. Launch fixes are listed in section 5.

## 2. API and database (decided: separate from SYBNB)
- Database: Neon project `rezekme-production` (id curly-heart-75087233, Frankfurt, Postgres 17, database `rezekme`). Created, empty.
- API: a new Render web service `rezekme-api` from this repo (main, Frankfurt, Starter, Docker). CREATED 2026-10-18 (srv-dba3dgtg1s2s73ak9q50, https://rezekme-api.onrender.com).
  Its first deploy fails until the secrets below are set; also set Health Check Path `/api/health/ready`.
- Settings to put on the service (non-secret): NODE_ENV=production, SYBNB_COUNTRY=syria, API_HOST=0.0.0.0,
  CORS_ORIGIN=https://stay.rezekme.com,https://rides.rezekme.com, STORAGE_PROVIDER=s3, STORAGE_S3_REGION=auto,
  STORAGE_S3_FORCE_PATH_STYLE=true, SMS_PROVIDER=sandbox. Pre-Deploy command: `node server/lib/migration-gate.mjs && npx prisma migrate deploy` (the gate refuses reviewed-but-unapproved migrations such as 078-083; do NOT leave plain `npx prisma migrate deploy`). Auto-deploy off.
- Secrets only you enter in Render: DATABASE_URL (copy from the Neon console), AUTH_SECRET, PHONE_HASH_SECRET,
  STORAGE_S3_BUCKET / ENDPOINT / ACCESS_KEY_ID / SECRET_ACCESS_KEY, and the email provider keys.
- Then set `VITE_API_BASE_URL` to the service URL when building the rezekme apps.

## 3. Payments (only you can enter the keys)
- Test mode first: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (test keys), `STRIPE_CURRENCY=usd`.
- Live keys: only after a test payment passes; the code refuses live keys without a real `SYP_PER_USD` rate.
- SR card payments need the charge model chosen in `docs/STRIPE_SR.md` (A: Checkout per trip, B: saved card).

## 4. Hosting and DNS (GoDaddy -> Vercel)
- Create three Vercel projects (landing = rezekme.com, stay = stay.rezekme.com, rides = rides.rezekme.com).
- Vercel shows the exact DNS records for each domain; add them at GoDaddy. Do not change DNS before the projects exist.

## Status 2026-10-18
- API live: https://rezekme-api.onrender.com (health check ok, database connected, all 76 migrations applied).
- House account created in the rezekme database (house@rezekme.com, no login); its id is set as PLATFORM_ACCOUNT_ID on the service.
- Next: build the rezekme apps with `VITE_API_BASE_URL=https://rezekme-api.onrender.com`, create the three Vercel projects, then DNS.


## 5. Launch configuration (v1 = SR Rides, Damascus only, Sham Cash wallet, NO cash, NO Stripe)
Decided scope (2026-10-21): launch Rides only in Damascus, Stays and Food later. Stripe stays OFF: Stripe's published policy
prohibits Syria-linked business and `payment-policy.mjs` has no approved Stripe provider config. Do not set
`PAYMENT_PROVIDER_STRIPE_APPROVED=true` or live Stripe keys unless Stripe approves this business in writing.

Settings on the `rezekme-api` service (non-secret):
- `PLATFORM_BRAND=rezekme` (makes the server refuse to start in production unless `SR_REQUIRE_PREPAY=1`)
- `SR_REQUIRE_PREPAY=1` (no cash rides: the fare must already be in the rider's wallet)
- `SYBNB_PAYMENTS_GATE=enabled`, `PAYMENT_POLICY_ELIGIBLE_DIVISIONS=SR,PLATFORM`
- `PAYMENT_RAIL_MANUAL_PROOF_ENABLED=true` and the manual-proof operation switches you actually use:
  `PAYMENT_OPERATION_MANUAL_PROOF_CREATE_ENABLED=true`, `..._CAPTURE_ENABLED=true`, `..._REFUND_ENABLED=true`,
  `..._PAYOUT_RELEASE_ENABLED=true`, `..._RECONCILIATION_READ_ENABLED=true`
- Fare: `SR_FARE_ROUNDING_USD=1` (default 5 hides the $0.40 per-ring step; fares are whole dollars, so the ring step shows
  every ~2.5 rings). `SR_AIRPORT_BASE_USD=20`, `SR_RIDE_COMMISSION_RATE=0.20` are already the defaults.
- Email: `EMAIL_PROVIDER=brevo`, `BREVO_API_KEY`, `EMAIL_FROM` (secret key entered by you; sender domain SPF/DKIM must be verified in Brevo).
- Front ends (Vercel build env): `VITE_API_BASE_URL=https://rezekme-api.onrender.com`, `VITE_SHAMCASH_QR_URL=<URL of the Rezekme Sham Cash receiving QR>`.

How the money works now (code, this branch):
1. Rider (guest or client) transfers to the Rezekme Sham Cash account and submits amount + transaction reference (`POST /api/wallet/topup-proof`).
2. An ADMIN checks the transfer really arrived (amount, reference, no duplicate) and approves it: only then the wallet is credited.
3. The ride can be requested only when the wallet covers the fare; the fare is held from the wallet, the driver is paid 80% and the platform keeps 20% on completion.
A reference typed into the ride request no longer pays or unlocks anything.

First admin on the rezekme database (needed to approve payments and to issue driver key codes):
`DATABASE_URL=<rezekme database URL> node scripts/bootstrap-admin.mjs --email <your email> --role ADMIN` after that account has signed up once. Run it from your Mac or a Render shell; scripts/ is not in the Docker image.

Only you can do (not code):
- Render dashboard: edit Pre-Deploy command (section 2), add the settings above, Health Check Path `/api/health/ready`.
- Create / confirm the Rezekme Sham Cash receiving account and give the QR image (replace the shared SYBNB QR).
- Add `www.rezekme.com` as a domain on the Vercel landing project (it currently has no TLS certificate) and redirect it to rezekme.com.
- Provide Rezekme logo icons (192/512 PNG) for the installed app; the manifests are Rezekme-named but still reuse the SYBNB icon files.
- Counsel-reviewed Terms and Privacy for the operating entity (the in-app text only swaps the brand name; wording is the SYBNB draft; country profile legal gate is still DRAFT).
- Decisions: refund rules per case, driver payout schedule, route-data retention period, transport permit/insurance requirements, whether private cars may serve the airport.

Pilot acceptance before any real money: run the Sham Cash top-up -> admin approve -> ride -> complete -> 80/20 ledger -> manual payout cycle on a staging copy with test accounts and tiny amounts; check the ledger totals reconcile.

## Admin app (apps/rezekme-admin)

Separate Rezekme operator console (live rides, drivers, vehicles, payment review, money flow, payouts, incidents, customers, promo codes, business accounts). It reuses the existing admin pages; the server still requires the ADMIN role on every call, so a client or driver token gets 403 even if they open the site.

- Build: `npm run build:rezekme-admin` (output `dist-apps/rezekme-admin`). Dev: `npm run dev:rezekme-admin` (port 5192).
- Vercel: create a fourth project from this repo with build command `npm run build:rezekme-admin`, output directory `dist-apps/rezekme-admin`, env `VITE_API_BASE_URL=https://rezekme-api.onrender.com`; suggested domain `admin.rezekme.com`. Add that origin to the API's `CORS_ORIGIN`.
- Admin sign-in uses the normal staff sign-in (email code). The first admin is created with `scripts/bootstrap-admin.mjs` (section 5).
- Known cosmetic: some shared admin pages still show a small "SYBNB · ADMIN" eyebrow label.
