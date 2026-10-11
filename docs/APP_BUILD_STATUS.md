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

## Update 2026-10-11 (evening)
- Android Studio 2026.2.1.8 installed via Homebrew (/Applications/Android Studio.app). Next: open it once (SDK setup), then `npx cap open android`.
- Web bundle rebuilt against live backend and `cap sync android` succeeded (5 plugins: app, geolocation, push-notifications, splash-screen, status-bar).
- iOS still blocked: full Xcode not installed (only Command Line Tools). After install: `sudo xcodebuild -license accept && bash fix-ios.sh && npx cap open ios`.
- Mobile fixes committed: f55ddf4 (Buy/Rent overflow), beb6810 (neutral protection copy + docs/HANDOFF_GAP_REPORT.md).
- Android remaining: emulator smoke test -> signed AAB (keystore outside git) -> Play Console closed test (>=12 testers, 14 days).
- Security note: never paste passwords into the terminal or chat; rotate any that were.

## Update 2026-10-11 (night) - Android Studio set up, disk full
- Android SDK installed (default location ~/Library/Android/sdk; platform 37.0, build-tools 36, platform-tools, emulator) and licenses accepted by the user.
- Gradle sync of android/ succeeded (BUILD SUCCESSFUL). Fix needed: use "Apply compatible Gradle JDK configuration" (Gradle 8.11.1 is incompatible with JDK 25). AGP/Kotlin upgrade prompts deliberately ignored.
- Emulator NOT created: Pixel 8 / API 36 Google Play ARM64 image (1.8 GB) failed with "No space left on device". Mac internal disk was 228G/229G used (394 MB free).
- Disk cleanup in progress: Archive (4.1G) and sybnb-extra (3.5G) copied and verified on Danny SSD at Mac_Offload_2026-10-11/ (127,386 and 17,809 files); originals to be removed by the user. Also clearing Cursor caches, com.docker.install (2.1G), brew + ~/Library caches.
- Unexplained: home folder is ~51G of 228G used; ~175G is outside ~ (check /Applications, /Library, /private/var, Docker).
- Resume: free >=10 GB (>=25 GB for Xcode), then Device Manager -> Add device -> Pixel 8, API 36 (stable) -> Run app.
