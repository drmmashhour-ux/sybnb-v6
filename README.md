> **WARNING (branch `step5-admin-foundation`): deploying this code to a production-connected Render service WILL apply migrations 078-082 (admin security foundation). A migration approval gate stops the deploy unless `APPROVED_MIGRATIONS=082_security_foundation_closure` is set. Read `docs/admin/MIGRATION_082_RUNBOOK.md` first.**

# SYBNB V6 Clean Build

Clean, GitHub-ready package for the SYBNB V6 rebuild.

## What Is Included

- V6 landing page with division cards.
- Search engine preview with Syria governorate/city/area/street data.
- AI Brain learned-place capture for missing streets/areas.
- Seller entry and listing prototype flow.
- Syrian local wallet / QR manual payment prototype.
- Gift wallet flow and payment engines.
- PostgreSQL/PostGIS backend foundation schema for users, listings, bookings, wallet ledger, gifts, admin audit, and SR rides.
- Figma handoff files for short-term stays A-to-Z simulation.

## What Is Excluded

- `node_modules`
- `dist`
- old prototype folders
- experimental work outside the clean V6 folder

## Run Locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Backend Foundation

V6 is now prepared for PostgreSQL + PostGIS:

```text
prisma/schema.prisma
prisma/migrations/001_platform_foundation/migration.sql
prisma/seed/platform.seed.json
src/backend/contracts.ts
docs/backend/FOUNDATION.md
```

Database validation commands after Prisma is installed:

```bash
cp .env.example .env
npm run db:validate
npm run db:generate
npm run db:migrate:dev
```

Run the V6 API locally:

```bash
npm run api:dev
```

The API defaults to `http://127.0.0.1:3051`.

For deployment preparation, set these environment variables:

```bash
DATABASE_URL="postgresql://..."
API_HOST=0.0.0.0
API_PORT=3051
CORS_ORIGIN="https://your-frontend-domain.example"
VITE_API_BASE_URL="https://your-api-domain.example"
AUTH_SECRET="long-random-secret"
PHONE_HASH_SECRET="long-random-secret"
```

Build the frontend after `VITE_API_BASE_URL` is set so the deployed app points at the deployed API.

## Important Folders

```text
src/
  app/
  engines/
  modules/
  shared/

docs/
  V6_BUILD_PLAN.md
  MERGE_STATUS_2026_07_01.md
  SYRIAN_LOCAL_WALLET_PAYMENT_FLOW.md
  SR_CLIENT_LOCATION_ENGINE.md

handoffs/
  FIGMA_ORDER_STAYS_A_TO_Z_SIMULATION_2026_07_01.md
  STAYS_FLOW_LISTING_SEARCH_IMMOCONTACT_FOR_FIGMA_2026_07_01.md
  STAYS_SYMBOL_FILTERS_FROM_V5_FOR_FIGMA_2026_07_01.md
```

## Current Rule

This package is for clean review and Figma polishing. Do not merge experimental folders into production until each division is approved.
