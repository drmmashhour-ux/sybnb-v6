# SYBNB mobile (iOS + Android via Capacitor)

The same built web app (`dist/`) runs inside a native shell. One codebase → web + both stores.
These steps run on **your Mac** (the Cowork Linux VM can't run Xcode/CocoaPods/Android SDK).
Claude has already added the Capacitor dependencies, `capacitor.config.ts`, and the `cap:*` npm scripts.

## 0. One-time Mac prerequisites
- **Xcode** (App Store) + `xcode-select --install`
- **CocoaPods**: `sudo gem install cocoapods` (or `brew install cocoapods`)
- **Android Studio** + the Android SDK (first launch installs it); set `ANDROID_HOME`
- Node 20+ (you have it)

## 1. Install deps + generate the native projects
```bash
cd ~/sybnb-v6
npm install                 # pulls the new @capacitor/* packages
npm run build               # produces dist/ (tsc && vite build)
npx cap add ios
npx cap add android
npx cap sync                # copies dist/ into both native projects + installs native plugins
```
This creates `ios/` and `android/` folders — commit them (they are part of the app).

## 2. Wire these BEFORE the first real build (required)
1. **Absolute API base.** Inside the shell the origin is `capacitor://localhost` (iOS) /
   `https://localhost` (Android), not your web domain. Make the app call the backend at its
   absolute URL `https://sybnb-backend.onrender.com`. Check `API_BASE_URL` in
   `src/shared/api/platformApi.ts` is absolute in a native build (not same-origin/relative).
2. **Backend CORS** must allow `capacitor://localhost` and `https://localhost` origins (server CORS).
3. **Permissions strings:**
   - iOS `ios/App/App/Info.plist`: `NSLocationWhenInUseUsageDescription`,
     `NSLocationAlwaysAndWhenInUseUsageDescription` (driver GPS), and push entitlement.
   - Android `android/app/src/main/AndroidManifest.xml`: `ACCESS_FINE_LOCATION`,
     `ACCESS_COARSE_LOCATION`, `POST_NOTIFICATIONS`, `INTERNET`.
4. **Native plugins used:** `@capacitor/geolocation` (driver location), `@capacitor/push-notifications`
   (ride offers / arriving), `@capacitor/app`, `@capacitor/splash-screen`, `@capacitor/status-bar`.
   Wire the driver dashboard's location reporting to the Geolocation plugin on native, and push
   registration to Push Notifications (Phase 3 — Claude can do this next).
5. **Icons & splash:** drop a 1024×1024 icon + splash in `resources/` then
   `npx @capacitor/assets generate` to produce every size.
6. **In-app "Delete my account"** — both stores now require it. (Backend delete flow exists; expose it in the app's account screen.)

## 3. Run on device/simulator
```bash
npx cap open ios        # opens Xcode → pick a simulator or your iPhone → Run
npx cap open android    # opens Android Studio → Run
```
After any web change: `npm run build && npx cap sync`.

## 4. Submit
**iOS (App Store):** in Xcode set the Team + bundle id `app.sybnb`, Product → Archive →
Distribute → App Store Connect → TestFlight → submit for review. Add a demo rider + demo driver
login in App Review notes (email-OTP: provide a reviewer code path or test account).
**Android (Google Play):** build a signed **AAB** (Build → Generate Signed Bundle), upload to Play
Console. A **new personal** Play account must run a **closed test with ≥12 testers for 14 days**
before production — use your own team/drivers and start it early. An **Organization** account
(business/D-U-N-S verified) is exempt.

## Notes
- Payments: rides are a real-world service → exempt from Apple/Google in-app purchase; your
  cash/transfer/wallet rails are allowed. Do NOT sell purely-digital in-app credits via your own rail.
- Keep signing keys/certs on your Mac — never commit them. `ios/App/App.xcworkspace` and the
  Android keystore stay local.
- Bundle id `app.sybnb` and app name `SYBNB` are set in `capacitor.config.ts`; change before the
  first submit if you want something different (it's permanent per store listing afterwards).
