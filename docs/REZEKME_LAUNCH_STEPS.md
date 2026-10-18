# Rezekme: build, payments and DNS steps

Rezekme = three small apps built from SR and STR. Source: `apps/rezekme-rides`, `apps/rezekme-stay`,
`apps/rezekme-landing`. They share the platform code in `src/` through the `@platform` alias, like SR and STR.

## 1. Build (run on the Mac, in this folder)
- `npm run build:rezekme` builds all three into `dist-apps/rezekme-rides`, `dist-apps/rezekme-stay`, `dist-apps/rezekme-landing`.
- Dev: `npm run dev:rezekme-rides` (port 5191), `npm run dev:rezekme-stay` (5192), `npm run dev:rezekme-landing` (5190).
- Not built or tested yet: the cloud workspace could not install the npm packages.

## 2. API and database (decided: separate from SYBNB)
- Database: Neon project `rezekme-production` (id curly-heart-75087233, Frankfurt, Postgres 17, database `rezekme`). Created, empty.
- API: a new Render web service `rezekme-api` from this repo (main, Frankfurt, Starter, Docker). CREATED 2026-10-18 (srv-dba3dgtg1s2s73ak9q50, https://rezekme-api.onrender.com).
  Its first deploy fails until the secrets below are set; also set Health Check Path `/api/health/ready`.
- Settings to put on the service (non-secret): NODE_ENV=production, SYBNB_COUNTRY=syria, API_HOST=0.0.0.0,
  CORS_ORIGIN=https://stay.rezekme.com,https://rides.rezekme.com, STORAGE_PROVIDER=s3, STORAGE_S3_REGION=auto,
  STORAGE_S3_FORCE_PATH_STYLE=true, SMS_PROVIDER=sandbox. Pre-Deploy command: `npx prisma migrate deploy`. Auto-deploy off.
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
