#!/usr/bin/env bash
# Builds the web bundle for the Capacitor apps WITHOUT the bundled promo videos (~113 MB).
# Usage: MEDIA_BASE=https://sybnb.app bash scripts/build-native-web.sh
set -euo pipefail
cd "$(dirname "$0")/.."
: "${MEDIA_BASE:?Set MEDIA_BASE to the public website origin that serves /assets/videos (e.g. https://sybnb.app)}"
API="${VITE_API_BASE_URL:-https://sybnb-backend.onrender.com}"
VITE_API_BASE_URL="$API" VITE_MEDIA_BASE_URL="$MEDIA_BASE" npm run build
rm -rf dist/assets/videos
echo "dist size now: $(du -sh dist | cut -f1)"
npx cap sync
