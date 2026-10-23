import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { rezekmeBrand } from '../rezekmeBrandPlugin'

// Standalone Stays app. Shares the platform's API client, auth/session, engines and shared UI through
// the @platform alias (one source of truth for money/account logic); the pages themselves are this
// app's own copies, restyled. Build: `npm run build:rezekme-stay` -> dist-apps/rezekme-stay
// Native (store) build: `npm run native:stay` (see docs/REZEKME_STORE_READINESS.md).
export default defineConfig({
  root: __dirname,
  envDir: resolve(__dirname, '../..'),
  publicDir: resolve(__dirname, '../../public'),
  plugins: [rezekmeBrand(), react()],
  define: {
    'import.meta.env.VITE_BRAND_NAME': JSON.stringify('Rezekme'),
    // hosts on Rezekme Stay list daily stays only (the listing wizard hides the other divisions)
    'import.meta.env.VITE_STAYS_ONLY': JSON.stringify('1'),
    // 'Admin login' link in the stays quick bar (the admin console is its own site)
    'import.meta.env.VITE_ADMIN_URL': JSON.stringify(process.env.VITE_ADMIN_URL || 'https://admin.rezekme.com'),
    // Public web address of this app. Inside the store app (Capacitor) the page origin is
    // capacitor://localhost / https://localhost, so Stripe return links and share links use this.
    'import.meta.env.VITE_PUBLIC_WEB_URL': JSON.stringify(process.env.VITE_PUBLIC_WEB_URL || 'https://stay.rezekme.com'),
  },
  resolve: { alias: { '@platform': resolve(__dirname, '../../src') } },
  server: { host: '127.0.0.1', port: 5192 },
  build: { outDir: resolve(__dirname, '../../dist-apps/rezekme-stay'), emptyOutDir: true },
})
