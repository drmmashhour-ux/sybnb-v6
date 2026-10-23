import type { CapacitorConfig } from '@capacitor/cli'

// Capacitor (iOS/Android store apps). ONE config file, three apps, picked with CAP_APP:
//
//   (unset)          SYBNB            app.sybnb           web: dist/                     native: android/, ios/
//   rezekme-stay     Rezekme Stays    com.rezekme.stay    web: dist-apps/rezekme-stay/   native: native/rezekme-stay/{android,ios}
//   rezekme-rides    Rezekme Rides    com.rezekme.rides   web: dist-apps/rezekme-rides/  native: native/rezekme-rides/{android,ios}
//
// For the Rezekme apps do not run `npx cap ...` by hand; use `npm run native:stay` / `npm run native:rides`
// (scripts/rezekme-native.mjs), which builds the right web app with the live API URL and then syncs
// the right native project. See docs/REZEKME_STORE_READINESS.md.
//
// Inside the native shell the page origin is capacitor://localhost (iOS) / https://localhost (Android),
// NOT the web domain: every API call must use the ABSOLUTE API URL (VITE_API_BASE_URL) and the API's
// CORS must allow those two origins (server/index.mjs always does: NATIVE_APP_ORIGINS).

const sybnb: CapacitorConfig = {
  appId: 'app.sybnb',
  appName: 'SYBNB',
  webDir: 'dist',
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#07090f',
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
}

// The Rezekme web apps use no native plugin APIs (location goes through the WebView's
// navigator.geolocation, photos through <input type="file">, the ride recorder through getUserMedia).
// Only the plugins below are packaged: App = Android back button + https links opening the app;
// SplashScreen/StatusBar = launch look. Push and Geolocation are deliberately left out (no APNs/FCM
// set up, no extra permissions or entitlements to justify to the stores).
const REZEKME_PLUGINS = ['@capacitor/app', '@capacitor/splash-screen', '@capacitor/status-bar']

type RezekmeApp = { slug: 'rezekme-stay' | 'rezekme-rides'; appId: string; appName: string; splash: string; mode: string }

function rezekme(opts: RezekmeApp): CapacitorConfig {
  return {
    appId: opts.appId,
    appName: opts.appName,
    webDir: `dist-apps/${opts.slug}`,
    appendUserAgent: `RezekmeApp/${opts.mode}`,
    includePlugins: REZEKME_PLUGINS,
    android: { path: `native/${opts.slug}/android` },
    ios: { path: `native/${opts.slug}/ios` },
    plugins: {
      SplashScreen: {
        launchShowDuration: 1000,
        backgroundColor: opts.splash,
        showSpinner: false,
      },
    },
  }
}

const APPS: Record<string, CapacitorConfig> = {
  'rezekme-stay': rezekme({ slug: 'rezekme-stay', appId: 'com.rezekme.stay', appName: 'Rezekme Stays', splash: '#ff5a3c', mode: 'stay' }),
  'rezekme-rides': rezekme({ slug: 'rezekme-rides', appId: 'com.rezekme.rides', appName: 'Rezekme Rides', splash: '#0e0e10', mode: 'rides' }),
}

const which = (process.env.CAP_APP || '').trim()
if (which && !APPS[which]) {
  throw new Error(`Unknown CAP_APP "${which}". Use one of: ${Object.keys(APPS).join(', ')} (or leave it unset for SYBNB).`)
}

const config: CapacitorConfig = which ? APPS[which] : sybnb

export default config
