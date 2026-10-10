import type { CapacitorConfig } from '@capacitor/cli'

// SYBNB mobile shell (Capacitor). The SAME built web app (dist/) runs inside a native iOS/Android
// container, so there is one codebase for web + both stores. The SPA uses hash routing, so no
// server-side routing/deep-link config is needed here.
//
// IMPORTANT (wire before the first real build): inside the native shell the app origin is the
// container (capacitor://localhost on iOS, https://localhost on Android), NOT your web domain — so
// every API call must target the ABSOLUTE backend URL (https://sybnb-backend.onrender.com), and the
// backend CORS must allow the capacitor/localhost origins. See docs/MOBILE.md.
const config: CapacitorConfig = {
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

export default config
