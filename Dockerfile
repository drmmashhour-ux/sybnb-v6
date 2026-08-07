# SYBNB V6 API image (node:http + Prisma). The frontend is a separate static
# Vite build (see docs/DEPLOY_STAGING.md) — this image serves the API only.
FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# Install all deps (prisma + @prisma/client live in devDependencies and are
# required at runtime for generate/migrate/client).
COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY server ./server

ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3051
EXPOSE 3051

# Apply migrations, then serve. DATABASE_URL / AUTH_SECRET / PHONE_HASH_SECRET
# must be provided at runtime (env / secrets).
CMD ["sh", "-c", "npx prisma migrate deploy && node server/index.mjs"]
