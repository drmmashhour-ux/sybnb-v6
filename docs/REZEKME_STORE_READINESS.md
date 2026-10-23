# Rezekme Stays + Rezekme Rides: store readiness (Google Play + Apple App Store)

_Last updated: 2026-10-23 (branch `feat/store-ready`)._

Two store apps, one codebase. The code side is ready to build; what is left is mostly **your** part
(accounts, signing, store forms, screenshots). Admin stays web-only (admin.rezekme.com), no app.

| | Rezekme Stays | Rezekme Rides |
|---|---|---|
| Android applicationId / iOS bundle ID | `com.rezekme.stay` | `com.rezekme.rides` |
| Name on the phone | Rezekme Stays | Rezekme Rides |
| Web app inside | `apps/rezekme-stay` (full platform, stays-only, brand Rezekme) | `apps/rezekme-rides` |
| Website (also Stripe return + share links) | https://stay.rezekme.com | https://rides.rezekme.com |
| API (absolute, baked in at build) | https://rezekme-api.onrender.com | same |
| Native projects | `native/rezekme-stay/android`, `native/rezekme-stay/ios` | `native/rezekme-rides/android`, `native/rezekme-rides/ios` |
| Version | 1.0.0 (Android versionCode 1, iOS build 1) | same |
| Android target / min SDK | 36 / 24 | 36 / 24 |
| iOS minimum | 15.0, iPhone only | same |

The old SYBNB apps (`android/`, `ios/`, `app.sybnb*`) are untouched and still build as before.

---

## 1. What is already done in code (no action needed)

- **Separate app identities**: own IDs, names, icons, splash screens (generated from the Rezekme "R" logo
  on rezekme.com; Stays = R under a coral roof on navy, Rides = the original R with two wheels on green).
  Regenerate any time: `npm run icons:rezekme` (script `scripts/rezekme-icons.py`; a designer can replace
  the PNGs with the same names and sizes).
- **One command per app builds the right web app with the live API and syncs the native project**:
  `npm run native:stay`, `npm run native:rides` (`scripts/rezekme-native.mjs`). It refuses to sync if the
  bundle still points at a localhost API, and it drops the 113 MB promo videos from the app.
- **Server CORS** already allows the app origins `capacitor://localhost` (iOS) and `https://localhost`
  (Android), hard-coded in `server/index.mjs` (`NATIVE_APP_ORIGINS`). Checked against the live API on
  2026-10-23: both origins get `access-control-allow-origin`.
- **Permissions: only what the code uses.**
  - Stays: location (host "use my location" when placing a listing). No camera/storage permission on
    Android (photo upload uses the system picker). iOS: location, camera, photo-library texts.
  - Rides: location (pickup, driver position, foreground only), microphone (optional in-ride safety
    recording). iOS: location, camera (driver ID photo), photos, microphone texts.
  - No push notifications, no background location, no tracking, no ads SDK, no analytics SDK.
- **In-app account deletion** (Apple 5.1.1(v), Google Play): Stays = account menu > Delete account
  (already existed; now shows an error instead of silently "succeeding" when the request fails).
  Rides = **new** Profile > Delete account. Both call `DELETE /api/me`.
  Web page for Google Play's "delete account URL": https://stay.rezekme.com/rezekme-account-deletion.html
  (new file `public/rezekme-account-deletion.html`, goes live with the next web deploy).
- **Privacy + terms reachable in-app**: Stays footer (already); Rides **new** footer links on every
  screen + a "Privacy and terms" card in Profile.
- **Rides now says "Rezekme" everywhere**: the sign-in and legal pages it borrows from the platform used
  to say "SYBNB" inside the Rides app. The same compile-time rename Stays already used now also runs for
  Rides (`apps/rezekmeBrandPlugin.ts`). This also changes rides.rezekme.com on its next deploy (wanted).
- **Leaving the app and coming back**: inside the app the page address is `capacitor://localhost`, so
  Stripe return links, ride share links and check-in QR codes now use the public website address
  (`src/shared/native/nativeShell.ts`). In a normal browser nothing changes.
  The apps also accept https://stay.rezekme.com / https://rides.rezekme.com links (Android App Links,
  iOS Universal Links) so that Stripe's "payment done" page re-opens the app; this needs step 6 below.
- **"Admin login" button is hidden inside the store apps** (still on the website).
- iOS: `armv7` requirement replaced by `arm64`, export-compliance key set (HTTPS only = exempt), iPhone
  only (so no iPad screenshots are needed).
- Android: Gradle/AGP and AndroidX versions aligned with Capacitor 8 (the copied SYBNB values failed
  to build: duplicate Kotlin classes). Release signing reads a local `keystore.properties` (never committed).

Verified here (Linux): typecheck (`npx tsc --noEmit -p .` and `-p apps`), `npm run test:unit` (365/365),
both web builds, `cap sync` for both apps, and **real Gradle builds of both apps**: debug APK + release
AAB, and a release AAB signed with a throwaway test key (`jarsigner -verify` OK). Package names, versions,
target SDK 36 and the permission lists were read back from the built APKs.
**Not verified here**: anything iOS (needs Xcode on the Mac), running on a phone, Stripe/App Links
round-trips.

---

## 2. Blockers, most important first

1. **Accounts** (you): Google Play Console and Apple Developer Program (section 3).
2. **Country availability (check before anything else)**: both apps target Syria (Damascus). Apple's
   App Store has historically **no Syrian storefront**, and Google Play has historically blocked Syria.
   Sanctions were eased in 2025, but confirm in App Store Connect (Pricing and Availability) and Play
   Console (Countries/regions) that **Syria can be selected**. If not, the apps can only be listed in
   other countries (e.g. for travellers/diaspora booking from abroad), and riders in Syria would install
   the Android APK from your website instead. This decides whether store publishing is worth it at all.
3. **Test/placeholder data on the live site**: the live Stays search shows listings named
   "REZEKME TEST ... اختبار الدفع". Apple rejects apps showing test content (guideline 2.1), and the
   screenshots must not show them. Remove or hide test listings and have a few real ones before review.
4. **Signing** (you, on the Mac): Android upload keystore; Apple team in Xcode (section 4).
5. **Xcode on the Mac**: still not installed. App Store uploads now require a current Xcode; it needs
   ~40 GB free disk (the Mac was almost full on 2026-10-11).
6. **Closed test on Google Play** (only for a *personal* Play account created after Nov 2023): 12+
   testers opted in for 14 days in a row before you can apply for production. Start it as early as possible.
7. **Reviewer account + payment path for reviewers** (section 9): reviewers must sign in and must not be
   forced to pay real money.
8. **Store forms**: listing texts (drafted below), data safety / privacy labels (drafted below),
   content rating, target audience 18+, screenshots.
9. **Privacy policy content**: the in-app policy is the SYBNB text with the name swapped to Rezekme. It
   does not yet mention in-ride audio recordings, driver documents, Stripe card payments, or the map
   providers (OpenStreetMap / OpenFreeMap receive the device IP). Update it (and name the company that
   runs Rezekme) before submitting. Store privacy URLs: https://stay.rezekme.com/#/privacy and
   https://rides.rezekme.com/#/privacy (the static `privacy.html` on those hosts still says SYBNB, do
   **not** use it).
10. **Support email**: inside the apps the legal/support text shows `info@sybnb.app` (shared constant).
    The store listing and the deletion page use `support@rezekme.com` (as on rezekme.com). Make sure that
    mailbox exists and is read; optionally switch the in-app address to it too (ask Claude).
11. **App Links / Universal Links files** (after the first upload; section 6). Without them, after paying
    on Stripe the user ends on the website and must switch back to the app by hand (payments still
    complete: the server is credited by Stripe's webhook).

## 3. Accounts (you)

- **Google Play Console**: https://play.google.com/console, one-time **US$25**.
  - *Personal* account: ID verification; new personal accounts must run the 14-day / 12-tester closed
    test (blocker 6).
  - *Organization* account (recommended if you publish under your company): needs a **D-U-N-S number**
    (free, from Dun & Bradstreet, can take 1-2 weeks) and a company website/email; no 12-tester rule,
    and the store shows the company name.
- **Apple Developer Program**: https://developer.apple.com/programs/enroll, **US$99 per year**.
  Individual (your name shown as seller) or Organization (company name; needs D-U-N-S). Install the
  Apple Developer app on your iPhone to enroll faster.
- Use the same email you will read for review messages. Turn on 2-step verification on both.

## 4. Signing (you; never commit or send these files)

### Android (one upload key can be used for both apps)
```bash
mkdir -p ~/rezekme-keys
keytool -genkeypair -v -keystore ~/rezekme-keys/rezekme-upload.jks -alias rezekme \
  -keyalg RSA -keysize 2048 -validity 10000
# choose a strong password; store it in your password manager
```
Then create `native/rezekme-stay/android/keystore.properties` and `native/rezekme-rides/android/keystore.properties`
(both are git-ignored):
```
storeFile=/Users/<your-mac-user>/rezekme-keys/rezekme-upload.jks
storePassword=<password>
keyAlias=rezekme
keyPassword=<password>
```
**Back up** `rezekme-upload.jks` + password (USB/SSD + password manager). In Play Console accept
**Play App Signing** (Google keeps the real app-signing key; if the upload key is lost Google can reset it).

### iOS
Nothing to create by hand: open the workspace in Xcode, target **App** > **Signing & Capabilities** >
Team = your developer team, keep "Automatically manage signing". Xcode registers `com.rezekme.stay` /
`com.rezekme.rides` and the Associated Domains capability.

## 5. Build on the Mac (exact commands)

One-time setup:
```bash
cd ~/sybnb-v6
git fetch && git checkout feat/store-ready     # or main, once this branch is merged
npm install
# Android: use Android Studio's own Java (Gradle 8.14 does not run on Java 25)
echo 'export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"' >> ~/.zshrc && source ~/.zshrc
# iOS: install Xcode from the App Store, open it once, then:
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer && sudo xcodebuild -license accept
brew install cocoapods
```

### Android AAB (upload file for Play)
```bash
npm run native:stay -- --android            # Rezekme Stays (use native:rides for Rezekme Rides)
cd native/rezekme-stay/android
echo "sdk.dir=$HOME/Library/Android/sdk" > local.properties   # first time only
./gradlew bundleRelease
# -> native/rezekme-stay/android/app/build/outputs/bundle/release/app-release.aab  (signed if keystore.properties exists)
```
Or in Android Studio: open `native/rezekme-stay/android`, Build > Generate Signed App Bundle.
Quick phone/emulator test: `./gradlew installDebug` with the phone connected, or Run in Android Studio.

### iOS IPA (upload to App Store Connect)
```bash
npm run native:stay -- --ios                # builds web + cap sync ios + pod install
open native/rezekme-stay/ios/App/App.xcworkspace
```
In Xcode: choose "Any iOS Device (arm64)" > **Product > Archive** > Distribute App > App Store Connect
> Upload. Then the build appears in App Store Connect > TestFlight after processing (~15 min).
Command-line alternative (needs the Team ID):
```bash
cd native/rezekme-stay/ios/App
xcodebuild -workspace App.xcworkspace -scheme App -configuration Release \
  -archivePath build/RezekmeStays.xcarchive -allowProvisioningUpdates archive
cat > build/ExportOptions.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>method</key><string>app-store-connect</string><key>teamID</key><string>YOUR_TEAM_ID</string><key>destination</key><string>upload</string></dict></plist>
EOF
xcodebuild -exportArchive -archivePath build/RezekmeStays.xcarchive \
  -exportOptionsPlist build/ExportOptions.plist -exportPath build/ipa -allowProvisioningUpdates
```

### Every new upload
- Android: raise `versionCode` (1, 2, 3...) and `versionName` in `native/<app>/android/app/build.gradle`.
- iOS: raise Build (`CURRENT_PROJECT_VERSION`) and Version (`MARKETING_VERSION`) in Xcode > target App > General.
- Web-only changes still need a new store build (the web app is packaged inside), so re-run `npm run native:...`.

## 6. App Links / Universal Links (after the first upload; Claude can do the file part)

So that Stripe's "payment done" page and shared links open the app:
1. Play Console > your app > Setup > **App signing** > copy the **SHA-256** of the *App signing key certificate*.
2. Apple developer account > Membership > copy your **Team ID**.
3. Send both to Claude (they are not secret). Claude fills `docs/store-assets/rezekme/well-known/assetlinks.json`
   and `apple-app-site-association`, copies them to `public/.well-known/`, adds the JSON content-type
   header in `vercel.json`, and you redeploy stay/rides on Vercel.
4. Test on a phone: open https://stay.rezekme.com/ from a note/message: it should offer/open the app.

## 7. Store listing texts (drafts; edit freely)

Category: **Stays** = Play *Travel & Local*, Apple *Travel*. **Rides** = Play *Maps & Navigation*, Apple *Travel*.
Contact email: support@rezekme.com. Website: https://rezekme.com. Privacy: see blocker 9.
Account deletion URL (Play): https://stay.rezekme.com/rezekme-account-deletion.html

### Rezekme Stays: English
- **App name** (≤30): `Rezekme Stays`
- **Apple subtitle** (≤30): `Book stays. Host your place.`
- **Play short description** (≤80): `Book daily stays in Damascus and across Syria, or list your own place.`
- **Apple keywords** (≤100): `stay,booking,apartment,rent,daily,hotel,guesthouse,host,Damascus,Syria,vacation,trip`
- **Apple promotional text** (≤170): `Find a place for tonight or next month: real photos, clear USD prices, secure booking and a team that checks payments and hosts.`
- **Full description**:
```
Rezekme Stays helps you find and book daily stays in Damascus and across Syria, and lets owners list their place in minutes.

FOR GUESTS
• Search by city, dates and guests, then filter by what matters: power backup, water, internet, room and bed type.
• Clear prices in US dollars before you book.
• Pay by card on a secure Stripe page, with Sham Cash, or with your Rezekme wallet balance.
• See your bookings, receipts and check-in details in one place.
• Save favourites and come back to them later.
• Report a listing that looks wrong; our team reviews every report.

FOR HOSTS
• List your apartment or room for daily stays in a few steps, with photos and your own price.
• Manage your calendar, booking requests, earnings and payouts from the host dashboard.
• Hosts are verified before their listings go live.

Arabic, English and French. One Rezekme account also works in the Rezekme Rides app.
Questions: support@rezekme.com
```

### Rezekme Stays: Arabic
- **اسم التطبيق**: `Rezekme Stays` (أو `Rezekme للإقامات`)
- **العنوان الفرعي (Apple)**: `احجز إقامتك أو أضف مكانك`
- **الوصف القصير (Play)**: `احجز إقامات يومية في دمشق وكل سوريا، أو أضف مكانك للإيجار.`
- **الكلمات المفتاحية (Apple)**: `إقامة,حجز,شقة,إيجار,يومي,فندق,ضيافة,مضيف,دمشق,سوريا,سفر`
- **الوصف الكامل**:
```
مع Rezekme Stays تجد إقامة يومية في دمشق وفي كل سوريا وتحجزها بسهولة، ويمكن لأصحاب العقارات إضافة أماكنهم خلال دقائق.

للضيوف
• ابحث حسب المدينة والتواريخ وعدد الضيوف، وصفِّ النتائج حسب ما يهمك: الكهرباء البديلة، المياه، الإنترنت، نوع الغرفة والسرير.
• أسعار واضحة بالدولار قبل الحجز.
• ادفع بالبطاقة عبر صفحة Stripe الآمنة، أو عبر شام كاش، أو من رصيد محفظتك في Rezekme.
• حجوزاتك وإيصالاتك وتفاصيل الوصول في مكان واحد.
• احفظ الأماكن المفضلة لديك وارجع إليها لاحقاً.
• أبلغ عن أي إعلان مشبوه، وفريقنا يراجع كل بلاغ.

للمضيفين
• أضف شقتك أو غرفتك للإيجار اليومي بخطوات قليلة، مع الصور والسعر الذي تختاره.
• أدر التقويم وطلبات الحجز والأرباح والتحويلات من لوحة المضيف.
• نتحقق من هوية المضيف قبل نشر إعلانه.

بالعربية والإنجليزية والفرنسية. حساب Rezekme واحد يعمل أيضاً في تطبيق Rezekme Rides.
للاستفسار: support@rezekme.com
```

### Rezekme Rides: English
- **App name**: `Rezekme Rides`
- **Apple subtitle**: `Upfront fares in Damascus`
- **Play short description**: `Request a ride in Damascus: upfront fare, approved drivers, live map, no cash.`
- **Apple keywords**: `ride,taxi,cab,driver,car,trip,transport,airport,Damascus,Syria,carpool,go`
- **Apple promotional text**: `See the fare before you ride, follow your driver live on the map and pay from your wallet or card. No cash needed.`
- **Full description**:
```
Rezekme Rides gets you around Damascus with upfront fares and approved drivers.

• See the price before you confirm. No haggling, no cash.
• Pay by card or from your Rezekme wallet (top up with Sham Cash).
• Follow your driver live on the map, check the car and plate, and confirm your driver with a pickup code.
• Share your trip with family, use the SOS button, or start an optional in-ride safety recording that only you can access.
• Schedule a ride, add stops, and keep your favourite places.
• Rate your trip and report a problem; our team answers every report.
• Business accounts for companies that pay for their team's rides.

Want to drive? Apply in the app: drivers are checked and approved before their first trip.

Arabic, English and French. One Rezekme account also works in Rezekme Stays.
Questions: support@rezekme.com
```

### Rezekme Rides: Arabic
- **اسم التطبيق**: `Rezekme Rides` (أو `Rezekme للتوصيل`)
- **العنوان الفرعي (Apple)**: `أجرة معروفة مسبقاً في دمشق`
- **الوصف القصير (Play)**: `اطلب رحلة في دمشق: أجرة معروفة مسبقاً، سائقون معتمدون، خريطة مباشرة، بدون نقد.`
- **الكلمات المفتاحية (Apple)**: `رحلة,تاكسي,سائق,سيارة,توصيل,مواصلات,مطار,دمشق,سوريا,مشوار`
- **الوصف الكامل**:
```
Rezekme Rides يوصلك داخل دمشق بأجرة معروفة مسبقاً وسائقين معتمدين.

• تعرف السعر قبل التأكيد. لا مساومة ولا نقد.
• ادفع بالبطاقة أو من محفظتك في Rezekme (اشحنها عبر شام كاش).
• تابع سائقك مباشرة على الخريطة، وتحقق من السيارة ورقم اللوحة، وأكّد هوية السائق برمز الاستلام.
• شارك رحلتك مع عائلتك، واستخدم زر الطوارئ، أو شغّل تسجيل الأمان الاختياري داخل الرحلة، ولا يصل إليه أحد غيرك.
• احجز رحلة مجدولة، وأضف محطات، واحفظ أماكنك المفضلة.
• قيّم رحلتك وأبلغ عن أي مشكلة، وفريقنا يرد على كل بلاغ.
• حسابات للشركات التي تدفع رحلات موظفيها.

تريد أن تعمل سائقاً؟ قدّم طلبك من التطبيق، ونتحقق من كل سائق ونعتمده قبل أول رحلة.

بالعربية والإنجليزية والفرنسية. حساب Rezekme واحد يعمل أيضاً في Rezekme Stays.
للاستفسار: support@rezekme.com
```
Check every claim against what is switched on in production before submitting (e.g. card payments
for rides are off while Stripe is off for SR; then remove "by card" from the Rides texts).

## 8. Store forms: answers based on what the code collects

### Content rating (Play IARC questionnaire) and Apple age rating
- Category in the questionnaire: "All other app types".
- Violence, sexual content, profanity, drugs/alcohol/tobacco, gambling, horror: **No** to all.
- Users can interact or exchange content: **Yes** (host/guest messages, reviews; rider/driver in Rides).
- Shares the user's location with other users: Stays **No**; Rides **Yes** (rider pickup and driver position).
- Digital purchases: **No** (stays and rides are real-world services).
- Unrestricted web browsing: **No**.
- Apple age rating: answer the same way; set the age to **18+** to match the Terms (service is for adults).
- Play "Target audience and content": **18 and over** only (keeps the apps out of the Families policy).
- Play "Ads": **No ads**. Play "Financial features": declare the in-app **wallet** (stored USD balance
  used to pay stays/rides). Play "Government apps": No. Play "News": No.

### Google Play Data safety / Apple App Privacy ("nutrition label")
General answers (both apps): data is **encrypted in transit** (HTTPS) = Yes; users **can request
deletion** = Yes (in-app + URL above); **no data sold**, **no tracking**, **no advertising**, no data
shared with third parties except service providers (hosting, email, Stripe), which both stores do not
count as "sharing". Apple: none of the data is "used to track you"; all of it is "linked to the user".

| Data type (Play name / Apple name) | Stays | Rides | Why (purpose: App functionality, Account management, Fraud prevention/security) |
|---|---|---|---|
| Name | Yes, required | Yes, required | Account, bookings/trips |
| Email address | Yes, required | Yes, required | Sign-in, receipts, codes |
| Phone number | Optional | Optional | Only if verified by SMS (stored hashed) |
| Other info / Other data (government ID) | Optional (hosts) | Optional (drivers) | Host/driver identity check |
| Precise location | Optional | **Required** | Stays: place a listing on the map. Rides: pickup point, live driver position, trip route |
| Approximate location | Optional | Required | Same |
| Photos | Optional | Optional | Listing photos, profile photo, payment receipts, driver documents |
| Voice or sound recordings / Audio data | No | Optional | In-ride safety recording, private, deleted after 7 days |
| Purchase history | Yes | Yes | Bookings, trips, receipts |
| Other financial info | Yes | Yes | Wallet balance and top-up proofs (Sham Cash reference/receipt), saved-card brand and last 4 digits |
| Payment info (card number) | **No** | **No** | Entered only on Stripe's page, never reaches Rezekme |
| Other in-app messages / Other user content | Yes | Optional | Host-guest messages, reviews, problem reports |
| Customer support | Yes | Yes | Support requests |
| App activity, web history, contacts, calendar, health, device IDs, crash logs | No | No | Not collected (no analytics/crash/ads SDKs, no push) |

If the privacy policy is updated with other items, keep this table and the policy in agreement.

## 9. Reviewer access and review notes

- Create one normal guest account per store review (see `docs/PLAY_REVIEW_ACCESS.md` for how), with a
  password, no admin/driver role. Put email + password in Play Console > App content > App access and in
  App Store Connect > App Review Information. Never commit the password.
- Payments: tell reviewers they can browse, open a listing/fare and reach the payment step, and that the
  booking/ride is a real-world service paid by card on Stripe's page or by Sham Cash transfer (physical
  service, outside in-app purchase rules). Do not require them to pay. If possible give the reviewer
  account a small wallet balance so they can complete one booking/ride without a card.
- Rides: explain that rides operate in Damascus; a reviewer abroad can see the map, fare and request
  flow but no driver will accept. Consider a short screen recording (upload as a private link) showing
  a real trip.
- Driver mode: drivers are approved by Rezekme; say it is not reviewable with a guest account.

## 10. Screenshots and graphics

Ready (in `docs/store-assets/rezekme/`): Play icons 512x512, Play feature graphics 1024x500, 1024x1024
icon masters for App Store Connect, for both apps.

Still needed (you, or Claude with `python3 scripts/rezekme-store-screenshots.py` once the test listings
are gone; it photographs the live sites in Arabic and English at both sizes):
- **Apple (iPhone only)**: 3 to 10 screenshots at **1290 x 2796** (6.9-inch). That one size is enough.
- **Google Play phone**: 2 to 8 screenshots, 9:16, e.g. **1080 x 1920** (min 320 px, max 3840 px per side).
  4+ screenshots of at least 1080 px are needed to be featured.
- Suggested set: Stays = search, results, listing page, booking summary, host dashboard.
  Rides = map with "Where to?", fare choice, driver on the way, trip summary, wallet.
- Arabic and English sets (upload per language in both consoles).

## 11. Order of work (shortest path)

1. Check country availability (blocker 2). Create both developer accounts.
2. Remove test listings; create the reviewer account; update the privacy policy.
3. Mac: `npm run native:stay -- --android`, create the keystore, `./gradlew bundleRelease`; same for Rides.
4. Play Console: create both apps, upload the AABs to **Closed testing**, fill the forms from sections 7-9,
   add 12+ testers, start the 14-day clock.
5. Install Xcode; `npm run native:stay -- --ios`; Archive; TestFlight; submit for review. Same for Rides.
6. After the first Play upload and Apple enrollment: App Links / Universal Links (section 6).
7. Day 15+: apply for Play production access.

## 12. Risks to know (Apple / Google review)

- **Web-wrapper apps (Apple 4.2 "minimum functionality")**: both apps are the websites inside a native
  shell. They have real accounts, bookings, location and payments, which usually passes, but Apple
  sometimes rejects "repackaged websites". Mitigation if rejected: explain the app-only conveniences
  (location, camera upload, links opening the app) or add native push notifications later.
- **"Buy MSH points" in the Stays wallet**: selling points is fine **only** because they pay for real
  stays/rides (Apple 3.1.3(e)/3.1.5 and Play payments policy exempt physical services). Apple reviewers
  sometimes read "points" as an in-app currency that requires In-App Purchase. Safer wording in the
  apps: "Add funds to your wallet (USD credit for stays and rides)". Never let MSH buy anything digital
  (ads, boosts, premium features) and never market it as a crypto token inside the store apps.
- **User-generated content (Apple 1.2)**: listings can be reported, but there is no "block this user"
  in messages. Apple can ask for it on apps with messaging between users.
- **Account deletion completeness**: `DELETE /api/me` removes name, email, phone hash, avatar and the
  identity document and ends all sessions, but listings, saved places, saved card reference and driver
  documents stay in the database. Acceptable with the retention wording on the deletion page; a fuller
  server-side cleanup is a follow-up.
- **Stripe and Syria**: `docs/REZEKME_LAUNCH_STEPS.md` notes Stripe's policy prohibits Syria-linked
  business; card payments shown in the app must match what is really enabled.
- **Map tiles**: the stays maps use tile.openstreetmap.org, whose usage policy limits heavy app traffic;
  move to a tile provider you control before large volumes. (Rides uses OpenFreeMap.)
- **Capacitor CLI is 7.6.9 while the native libraries are 8.5.x**: it works (verified here), but upgrade
  `@capacitor/cli` to 8.x together with `package-lock.json` when convenient.

## Countries (owner decision 2026-10-23)

- First check in App Store Connect (Pricing and Availability) and Google Play Console (Production → Countries/regions) whether **Syria** can be selected.
- If Syria is not available, publish in **Canada** (the company, 9375-7649 Québec Inc., is Canadian). Add other countries with Syrian communities later (e.g. Lebanon, Jordan, UAE, Turkey, Germany) if wanted.
- Guests in Syria can always use the websites (stay.rezekme.com, rides.rezekme.com) and add them to the home screen, whether or not the store apps are available there.
- Listing content: the apps are in Arabic, English and French; write the Canadian store listing in English and French (Canada requires neither, but French helps for Québec).

## Live data before review (2026-10-23)

- The two test stays were removed and the test booking cancelled on the live site. The stays search is now empty: list at least a few real stays (with real photos) before taking store screenshots and before submitting for review — reviewers reject apps that look empty or show test content.
