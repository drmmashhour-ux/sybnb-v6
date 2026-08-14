#!/usr/bin/env bash
# SYBNB — Country isolation check. Proves the neutral master reaches Syria-specific modules ONLY
# through a controlled, explicit set of bridge files (barrels, adapters, resolvers, profile loader),
# never by scattered implicit dependencies. Post-Phase-7: no compatibility shims remain.
# Run: bash scripts/check-country-isolation.sh
set -uo pipefail
cd "$(dirname "$0")/.."
fails=0
ok(){ echo "  PASS  $1"; }
no(){ echo "  FAIL  $1  -> $2"; fails=$((fails+1)); }

assert_bridges() { # label  needle  expected-newline-list
  local label="$1" needle="$2" expected="$3"
  local got
  got=$(grep -rlnE "from ['\"][^'\"]*$needle" server/ src/ 2>/dev/null | sort || true)
  if [ "$got" = "$(echo "$expected" | sort)" ]; then ok "$label"; else no "$label" "got: ${got:-<none>}"; fi
}

echo "=== SERVER MASTER isolation (only sanctioned bridges may reach countries/) ==="
# Allowed server bridges (post-Phase-7, no shims): profile loader + geo resolver seam.
SRV=$(grep -rlnE "from ['\"][^'\"]*countries/" server/ 2>/dev/null \
  | grep -vE "server/lib/(country|geo-adapter)\.mjs" || true)
[ -z "$SRV" ] && ok "server/ reaches countries/ only via country.mjs + geo-adapter.mjs" || no "server leak" "$SRV"

echo "=== SERVER routes do NOT import a country module directly (use the neutral seam) ==="
ROUTELEAK=$(grep -rlnE "from ['\"][^'\"]*countries/" server/routes/ 2>/dev/null || true)
[ -z "$ROUTELEAK" ] && ok "no server/routes/* imports countries/* directly (they use master seams)" || no "route leak" "$ROUTELEAK"

# Direct-bridge allowlists (post-Phase-7): each country subtree is reached only by these explicit files.
assert_bridges "countries/syria/geo imported only via the geo-adapter resolver" "countries/syria/geo" \
"server/lib/geo-adapter.mjs"

assert_bridges "countries/syria/data imported only via the search barrel" "countries/syria/data" \
"src/engines/search/index.ts"

assert_bridges "countries/syria/payments imported only via barrel + resolver + wallet page" "countries/syria/payments" \
"src/engines/payments/index.ts
src/engines/payments/manualPaymentAdapter.ts
src/modules/payments/SyrianLocalWalletPaymentPage.tsx"

echo "=== no compatibility shims remain (Phase 7 removed them) ==="
SHIMS=$(ls src/engines/search/syriaData.ts src/engines/search/osmSyriaRoads.ts src/engines/payments/syrianLocalWallet.ts server/lib/sr-geocoding.mjs 2>/dev/null || true)
[ -z "$SHIMS" ] && ok "all four compatibility shims deleted" || no "shim still present" "$SHIMS"

echo "=== SERVER profile is loaded only by the server loader (never by browser code) ==="
# Match actual import statements only (not comments/prose that mention the path).
PROF=$(grep -rlnE "from ['\"][^'\"]*countries/syria/profile" server/ src/ 2>/dev/null || true)
[ "$PROF" = "server/lib/country.mjs" ] && ok "server profile imported only by server/lib/country.mjs (not by src/)" || no "server profile leak" "$PROF"

echo "=== PUBLIC presentation profile reached from browser only via the neutral resolver ==="
PRES=$(grep -rlnE "from ['\"][^'\"]*countries/syria/presentation" src/ 2>/dev/null || true)
[ "$PRES" = "src/shared/country/presentation.ts" ] && ok "public presentation imported only by src/shared/country/presentation.ts" || no "presentation access leak" "$PRES"

echo "=== browser code must NOT import the server-only country profile ==="
SRVPROF_IN_SRC=$(grep -rlnE "from ['\"][^'\"]*countries/syria/profile" src/ 2>/dev/null || true)
[ -z "$SRVPROF_IN_SRC" ] && ok "no src/* imports the server country profile" || no "server profile in browser" "$SRVPROF_IN_SRC"

echo "=== SMS adapter is reachable ONLY through the country-gated OTP path ==="
# sendSms may be imported only by the OTP route (the single gated caller). No other module calls it.
SMS_IMPORTERS=$(grep -rlnE "from ['\"][^'\"]*lib/sms" server/ src/ 2>/dev/null || true)
[ "$SMS_IMPORTERS" = "server/routes/otp.mjs" ] && ok "sendSms imported only by server/routes/otp.mjs" || no "sendSms imported elsewhere" "$SMS_IMPORTERS"
# The single sendSms call site must be guarded by channelEnabled('sms') (fail-closed for Syria).
if grep -q "channelEnabled('sms')" server/routes/otp.mjs && grep -q "OTP_CHANNEL_NOT_ENABLED" server/routes/otp.mjs; then
  ok "sendSms call site gated by channelEnabled('sms') (Syria: sms=false -> unreachable)"
else
  no "sendSms not gated" "missing channelEnabled('sms') guard in otp.mjs"
fi

echo "== ISOLATION CHECK: $fails failure(s) =="
exit "$fails"
