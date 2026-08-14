#!/usr/bin/env bash
# SYBNB — Production bundle safety scan. Proves the browser bundle (dist/) exposes NO secrets and NO
# server-only country-profile fields. The frontend may contain PUBLIC presentation data (country code,
# locale, calling code, languages, display currency) but must NEVER contain the server profile's
# entity/gates/providers or any secret. Run: bash scripts/scan-bundle-safety.sh
set -uo pipefail
cd "$(dirname "$0")/.."
fails=0
ok(){ echo "  PASS  $1"; }
no(){ echo "  FAIL  $1  -> $2"; fails=$((fails+1)); }

echo "== build production bundle =="
npm run build > /tmp/sybnb-build.log 2>&1 && ok "vite build succeeded" || { no "build" "see /tmp/sybnb-build.log"; exit 1; }
[ -d dist/assets ] || { no "dist" "no dist/assets"; exit 1; }

echo "== server-only country-profile fields must be ABSENT from dist/ =="
# Unique markers of the SERVER profile (countries/syria/profile.mjs) — never client-safe.
for marker in "operatingEntity" "externalGates" "9375-7649" "QUÉBEC" "sanctions/export" "deployment.*blocked"; do
  if grep -rIl "$marker" dist/ >/dev/null 2>&1; then
    no "server-profile marker leaked: '$marker'" "$(grep -rIl "$marker" dist/ | head -1)"
  else
    ok "absent from bundle: '$marker'"
  fi
done

echo "== secrets / server env must be ABSENT from dist/ =="
for secret in "AUTH_SECRET" "PHONE_HASH_SECRET" "DATABASE_URL" "PAYMENT_WEBHOOK_SECRET" "STRIPE_SECRET" "whsec_" "SECRET_ACCESS_KEY" "PHONE_HASH"; do
  if grep -rIl "$secret" dist/ >/dev/null 2>&1; then
    no "secret marker leaked: '$secret'" "$(grep -rIl "$secret" dist/ | head -1)"
  else
    ok "absent from bundle: '$secret'"
  fi
done

echo "== sanity: PUBLIC presentation IS present (proves neutralization wired, not just stripped) =="
grep -rIl "ar-SY" dist/ >/dev/null 2>&1 && ok "public locale 'ar-SY' present (from public profile)" || no "public presentation missing" "ar-SY not found"

echo "== server profile module must NOT be bundled =="
# The server profile is .mjs (node) and must never be imported by browser code.
if grep -rIl "countries/syria/profile" dist/ >/dev/null 2>&1; then
  no "server profile path in bundle" "$(grep -rIl "countries/syria/profile" dist/ | head -1)"
else
  ok "server profile (countries/syria/profile.mjs) not referenced in bundle"
fi

echo "== BUNDLE SAFETY SCAN: $fails failure(s) =="
exit "$fails"
