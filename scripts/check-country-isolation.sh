#!/usr/bin/env bash
# SYBNB — Country isolation check. Proves the neutral master reaches Syria-specific modules ONLY
# through controlled, explicit bridges (the profile loader + named compatibility shims), never by
# scattered implicit direct dependencies. Run: bash scripts/check-country-isolation.sh
set -uo pipefail
cd "$(dirname "$0")/.."
fails=0
ok(){ echo "  PASS  $1"; }
no(){ echo "  FAIL  $1  -> $2"; fails=$((fails+1)); }

echo "=== SERVER MASTER isolation ==="
# server/ may reference countries/ only in the neutral loader.
SRV=$(grep -rln "countries/" server/ 2>/dev/null | grep -v "server/lib/country.mjs" || true)
[ -z "$SRV" ] && ok "server/ reaches countries/ only via server/lib/country.mjs" || no "server leak" "$SRV"

echo "=== FRONTEND MASTER isolation (Phase 3: only the named shims bridge to countries/syria/data) ==="
# Any src file importing countries/syria/data must be one of the two compatibility shims.
BRIDGES=$(grep -rln "countries/syria/data" src/ 2>/dev/null || true)
EXPECTED="src/engines/search/osmSyriaRoads.ts
src/engines/search/syriaData.ts"
GOT=$(echo "$BRIDGES" | sort)
if [ "$GOT" = "$(echo "$EXPECTED" | sort)" ]; then
  ok "countries/syria/data imported only through the 2 named shims"
else
  no "unexpected direct import of countries/syria/data" "got: $GOT"
fi

echo "=== FRONTEND MASTER isolation — payments (only shim + neutral resolver bridge to countries/syria/payments) ==="
# src files importing countries/syria/payments must be exactly: the compat shim + the adapter resolver.
PBRIDGES=$(grep -rln "countries/syria/payments" src/ 2>/dev/null || true)
PEXPECTED="src/engines/payments/manualPaymentAdapter.ts
src/engines/payments/syrianLocalWallet.ts"
if [ "$(echo "$PBRIDGES" | sort)" = "$(echo "$PEXPECTED" | sort)" ]; then
  ok "countries/syria/payments imported only via the shim + country-neutral resolver"
else
  no "unexpected direct import of countries/syria/payments" "got: $PBRIDGES"
fi

echo "=== shims are re-export only (no logic) ==="
for f in src/engines/search/syriaData.ts src/engines/search/osmSyriaRoads.ts src/engines/payments/syrianLocalWallet.ts; do
  # allow comments + a single 'export * from' line; reject any other statement.
  BODY=$(grep -vE "^\s*//|^\s*$" "$f")
  if echo "$BODY" | grep -qvE "^export \* from '"; then
    no "shim has logic: $f" "$(echo "$BODY" | head -1)"
  else
    ok "shim is pure re-export: $f"
  fi
done

echo "=== profile loader is the only importer of the Syria profile ==="
PROF=$(grep -rln "countries/syria/profile" server/ src/ 2>/dev/null || true)
[ "$PROF" = "server/lib/country.mjs" ] && ok "Syria profile imported only by server/lib/country.mjs" || no "profile leak" "$PROF"

echo "== ISOLATION CHECK: $fails failure(s) =="
exit "$fails"
