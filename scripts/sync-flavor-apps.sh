#!/usr/bin/env bash
# Build the standalone SR and STR apps and drop them into their Android flavors, so
# app.sybnb.sr opens apps/sr and app.sybnb.str opens apps/str (the 'full' flavor is unchanged).
# Run on your Mac:  VITE_API_BASE_URL=https://sybnb-backend.onrender.com bash scripts/sync-flavor-apps.sh
set -euo pipefail
cd "$(dirname "$0")/.."
: "${VITE_API_BASE_URL:?Set VITE_API_BASE_URL (the live backend URL) so the native apps can reach the API}"
npm run build:apps
for app in sr str; do
  dest="android/app/src/$app/assets/public"
  rm -rf "$dest" && mkdir -p "$dest"
  cp -R "dist-apps/$app/." "$dest/"
  echo "==> $app app copied to $dest"
done
echo "Now rebuild the flavors, e.g. ./gradlew bundleSrRelease bundleStrRelease (see handoff doc for signing)."
