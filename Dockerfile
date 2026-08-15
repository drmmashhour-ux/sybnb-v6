# SYBNB V6 API — production container (RC advances with the 0.0.0.0/PORT bind fix).
# Builds the raw Node HTTP API only (the Vite SPA deploys separately to Vercel). No secrets are baked
# in; all secrets are injected at RUN time via the host's secret store. Migrations run as a SEPARATE
# deploy step (see RENDER_DEPLOY.md), not in this image.
FROM node:22-slim AS build
WORKDIR /app
# openssl/ca-certificates: required by the Prisma query engine on Debian slim.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY server ./server
COPY countries ./countries

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
# Runtime needs: generated Prisma client (node_modules), the API (server), the active country
# implementation (countries/ — imported by server/lib/country.mjs + geo-adapter.mjs), and the Prisma
# schema/migrations. The SPA (dist/) is NOT served by the API and is intentionally omitted.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/countries ./countries
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
# The API binds 0.0.0.0 and honors the host-injected PORT (server/index.mjs). EXPOSE is informational.
EXPOSE 3051
# Node receives SIGTERM directly → graceful shutdown (logs server_shutdown, drains, exits).
STOPSIGNAL SIGTERM
CMD ["node", "server/index.mjs"]
