# SYBNB App Build — Status & Resume Point

_Last updated: 2026-07-13 (step 1 run on mohameds-Mac-mini)_

## Where we are

| Piece | Status |
|---|---|
| Capacitor deps installed | ✅ done |
| Web app built (`VITE_API_BASE_URL` → live backend) | ✅ done |
| **Android** native project (`android/`) | ✅ **generated, synced, committed** |
| **iOS** native project (`ios/`) | ✅ files generated + committed · ⏳ `pod install` blocked |
| CORS: native app origins always allowed | ✅ in code (commit `8669be2`) |
| Native projects committed | ✅ commit `45a353b` (70 files) |

## The one blocker: iOS needs the full Xcode app

`pod install` failed with: *"xcodebuild requires Xcode, but active developer
directory is a command line tools instance."* This Mac has only the Command
Line Tools, not the full **Xcode** app. iOS cannot build without it.

**Fix (iOS):**
1. Install **Xcode** from the Mac App Store (free, ~7 GB). Open it once to finish setup.
2. `bash fix-ios.sh` — points the toolchain at Xcode, runs `pod install` via `cap sync ios`, commits.
3. `npx cap open ios` → pick a simulator → Run.

Also note: this Capacitor release (8.5.3) needed the Podfile iOS target bumped
to **15.0** (already done in `ios/App/Podfile`).

## Android is READY — do this now (it's the long pole)

Android has no blocker. Because a new personal Google Play account must run a
**14-day closed test with ≥12 testers** before production, start it immediately:

1. `npx cap open android` → Run in the emulator to sanity-check.
2. Android Studio → **Build → Generate Signed Bundle (AAB)** (create a keystore; keep it safe, never commit it).
3. Google Play Console → create app → **Closed testing** track → upload the AAB.
4. Add ≥12 testers (recruit 15+), fill store listing (`docs/STORE_LISTINGS.md`), start the test. The 14-day clock starts here.

## Still to push

Local commits not yet on GitHub: `8669be2` (CORS), `45a353b` (native projects),
plus the Capacitor-deps commit. Run `git push origin main`; then ask Claude to
deploy the backend (CORS) and, once iOS pods install, to wire native GPS + push.

## What Claude does next (after `ios/` pods install cleanly)

- Route driver location through `@capacitor/geolocation` (native) with the web
  `navigator.geolocation` fallback; add the Info.plist / AndroidManifest permission strings.
- Register the push token via `@capacitor/push-notifications` and POST it to the backend;
  wire the backend send-path (needs APNs `.p8` + Firebase `google-services.json` from you).
- Generate the app icon + splash from your logo → `npx @capacitor/assets generate`.
