#!/usr/bin/env bash
# SYBNB — CLEAN-ROOM DEPLOY SIMULATION (local, disposable). RC e9dfd68.
# Exercises the production deploy sequence end-to-end WITHOUT a real target:
#   fresh DB -> migrate deploy -> start -> smoke (health/headers/404/rate-limit/redaction)
#   -> graceful shutdown -> teardown. Also asserts true-production fail-closed refusal.
# No secrets, no external calls, no production access. Never used in production.
# Usage: bash scripts/deploy-simulation.sh
set -uo pipefail
cd "$(dirname "$0")/.."
PORT=3058
DB="sybnb_deploysim_$$"
WHO="$(whoami)"
DBURL="postgresql://$WHO@127.0.0.1:5432/$DB?schema=public"
fails=0
ok(){ echo "  PASS  $1"; }
no(){ echo "  FAIL  $1  -> $2"; fails=$((fails+1)); }

echo "== 0. build + schema =="
npm run build 2>&1 | grep -oE "built in [0-9.]+s|error TS" | head -1
DATABASE_URL="postgresql://x@127.0.0.1:5432/x" npx prisma validate 2>&1 | grep -oE "is valid|error" | head -1

echo "== 1. TRUE-PRODUCTION FAIL-CLOSED (no S3/secrets -> must refuse) =="
OUT=$(NODE_ENV=production API_PORT=$PORT node server/index.mjs 2>&1 & P=$!; sleep 2; kill -9 $P 2>/dev/null; true)
echo "$OUT" | grep -q "env_validation_failed" && ok "production refuses on missing config (fail-closed)" \
  || no "production fail-closed" "no env_validation_failed"

echo "== 2. clean-room DB provision + migrate deploy =="
createdb "$DB" || { echo "cannot create DB"; exit 2; }
MIG=$(DATABASE_URL="$DBURL" npx prisma migrate deploy 2>&1 | grep -c "Applying migration")
[ "$MIG" = "11" ] && ok "11 migrations applied to fresh DB" || no "migrate deploy" "applied=$MIG"
IDX=$(psql -d "$DB" -tAc "SELECT 1 FROM pg_indexes WHERE indexname='payment_proofs_provider_provider_ref_key';" | tr -d '[:space:]')
[ "$IDX" = "1" ] && ok "provider_ref unique index present" || no "unique index" "missing"

echo "== 3. boot with prod-like config (storage-local ALLOWED only because no S3 creds in clean-room) =="
DATABASE_URL="$DBURL" AUTH_SECRET=clean-room-secret PHONE_HASH_SECRET=clean-room-phone \
  PAYMENT_WEBHOOK_SECRET=whsec_sandbox_test CORS_ORIGIN=https://sim.local \
  STORAGE_PROVIDER=local STORAGE_ALLOW_LOCAL=true \
  API_HOST=127.0.0.1 API_PORT=$PORT node server/index.mjs > /tmp/deploysim.log 2>&1 &
API=$!; sleep 3

echo "== 4. smoke tests =="
[ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/api/health/live)" = "200" ] && ok "health/live 200" || no "health/live" "not 200"
curl -s http://127.0.0.1:$PORT/api/health/ready | grep -q '"status": *"ready"' && ok "health/ready ready" || no "health/ready" "not ready"
H=$(curl -s -D - -o /dev/null http://127.0.0.1:$PORT/api/health/live)
echo "$H" | grep -qi "x-content-type-options: nosniff" && ok "security header nosniff" || no "nosniff" "missing"
echo "$H" | grep -qi "content-security-policy" && ok "CSP header present" || no "CSP" "missing"
echo "$H" | grep -qi "x-request-id" && ok "request-id present" || no "request-id" "missing"
NF=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/api/does-not-exist)
[ "$NF" = "404" ] && ok "unknown API route 404" || no "404" "got $NF"
codes=""; for i in $(seq 1 25); do codes="$codes $(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:$PORT/api/auth/login -H 'content-type: application/json' -d '{"phone":"+10000000000","password":"x"}')"; done
R=$(echo $codes | tr ' ' '\n' | grep -c 429)
[ "$R" -ge 1 ] && ok "rate-limit engages (429 x$R after burst)" || no "rate-limit" "no 429"
grep -qE "clean-room-secret|whsec_sandbox_test" /tmp/deploysim.log && no "secret redaction" "raw secret in logs" || ok "no raw secrets in logs"

echo "== 5. graceful shutdown =="
kill -TERM $API; sleep 2
tail -1 /tmp/deploysim.log | grep -q '"event":"server_shutdown"' && ok "graceful server_shutdown on SIGTERM" || no "graceful shutdown" "no shutdown log"
ps -p $API >/dev/null 2>&1 && { kill -9 $API; no "process exit" "still running"; } || ok "process exited on SIGTERM"

echo "== 6. teardown =="
dropdb "$DB" && ok "disposable DB dropped" || no "teardown" "dropdb failed"

echo "== DEPLOY SIMULATION: $fails failure(s) =="
exit "$fails"
