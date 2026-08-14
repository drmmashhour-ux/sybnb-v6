#!/usr/bin/env bash
# SYBNB — run the full governed E2E suite reproducibly against a local API + sybnb_v6.
# Dev/certification tool only (not part of the app runtime). Never used in production.
#
# Prereqs: local Postgres with the schema-correct `sybnb_v6` DB, and the synthetic user ids below.
# Usage:  bash scripts/run-all-e2e.sh
# Env (override as needed):
#   DB_URL, AUTH_SECRET, PHONE_HASH_SECRET, PAYMENT_WEBHOOK_SECRET, SELLER1, SELLER2, BUYER, ADMIN
set -uo pipefail
cd "$(dirname "$0")/.."

DB_URL="${DB_URL:-postgresql://$(whoami)@127.0.0.1:5432/sybnb_v6?schema=public}"
export AUTH_SECRET="${AUTH_SECRET:-dev-e2e-secret}"
export PHONE_HASH_SECRET="${PHONE_HASH_SECRET:-dev-e2e-phone}"
export PAYMENT_WEBHOOK_SECRET="${PAYMENT_WEBHOOK_SECRET:-whsec_sandbox_test}"
export SELLER1="${SELLER1:-1fdde54d-20f1-41ae-9f9a-2a4482f13c69}"
export SELLER2="${SELLER2:-f845e528-dff8-404f-b9ef-6f096fefd9c5}"
export BUYER="${BUYER:-b2cf0295-8b24-4be0-a014-8b9321c44e0a}"
export ADMIN="${ADMIN:-c6b57605-18aa-4093-bd99-264185de4b26}"
export SENDER="$SELLER1" RECIPIENT="$BUYER" OTHER="$SELLER2"
export DRIVER_ID="${DRIVER_ID:-$(psql -d sybnb_v6 -tAc "SELECT u.id FROM users u JOIN user_roles r ON r.user_id=u.id WHERE r.role='DRIVER' AND u.status='ACTIVE' LIMIT 1;" 2>/dev/null | tr -d '[:space:]')}"

psql_reset() { psql -d sybnb_v6 -tAc "DELETE FROM seller_profiles WHERE user_id IN ('$SELLER1','$SELLER2'); DELETE FROM payment_proofs WHERE provider='seller_plan';" >/dev/null 2>&1; }

echo "== build + schema =="
npm run build 2>&1 | grep -oE "built in [0-9.]+s|error TS" || true
DATABASE_URL="postgresql://x@127.0.0.1:5432/x" npx prisma validate 2>&1 | grep -oE "is valid|error" || true

echo "== start API (OTP_EXPOSE_FOR_TEST + sandbox payment secret) =="
pkill -9 -f "server/index.mjs" 2>/dev/null; sleep 1
DATABASE_URL="$DB_URL" API_HOST=127.0.0.1 API_PORT=3051 OTP_EXPOSE_FOR_TEST=true SYBNB_COUNTRY=syria \
  node server/index.mjs > /tmp/sybnb-e2e-api.log 2>&1 &
API_PID=$!
sleep 3

fails=0
run() { # name script [needs_reset]
  [ "${3:-}" = "reset" ] && psql_reset
  node "tests/e2e/$2" > /tmp/sybnb-e2e-out.log 2>&1
  local rc=$?   # governed suites process.exit(fail?1:0); sr-ride exits 0 on success
  printf "  %-18s %s  (exit %s)\n" "$1:" "$(tail -1 /tmp/sybnb-e2e-out.log)" "$rc"
  [ "$rc" -ne 0 ] && { fails=$((fails+1)); tail -5 /tmp/sybnb-e2e-out.log; }
}

echo "== self-contained integration certs =="
run "storage-s3" storage-s3-integration.e2e.mjs
run "sms"        sms-integration.e2e.mjs
run "country" country-selection.e2e.mjs

echo "== api-backed governed suites =="
run "otp"              otp-identity.e2e.mjs
run "storage"          storage.e2e.mjs
run "legal"            legal-consent.e2e.mjs
run "operations"       operations.e2e.mjs
run "wallet"           wallet-gift.e2e.mjs
run "payment"          payment-sandbox.e2e.mjs
run "payment-race"     payment-proof-race.e2e.mjs
run "marketplace"      marketplace.e2e.mjs      reset
run "cars"             cars.e2e.mjs             reset
run "buy"              buy.e2e.mjs              reset
run "rentals"          rentals.e2e.mjs          reset
run "new-construction" new-construction.e2e.mjs reset
run "sell"             sell.e2e.mjs             reset
run "advertising"      advertising-payment-tunnel.e2e.mjs reset
run "sr-ride"          sr-ride.e2e.mjs

kill "$API_PID" 2>/dev/null
echo "== suites with failures: $fails =="
exit "$fails"
