import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { rezekmeBrand } from '../rezekmeBrandPlugin'

// Rezekme Rides app (copy of SR). Shares the platform's API client, auth/session, engines and shared UI through
// the @platform alias (one source of truth for money/account logic); the pages themselves are this
// app's own copies, restyled. Build: `npm run build:rezekme-rides` -> dist-apps/rezekme-rides
// Native (store) build: `npm run native:rides` (see docs/REZEKME_STORE_READINESS.md).
export default defineConfig({
  root: __dirname,
  envDir: resolve(__dirname, '../..'),
  publicDir: resolve(__dirname, '../../public'),
  // rezekmeBrand: platform pages reused here (sign-in, legal documents) say Rezekme, not SYBNB.
  plugins: [rezekmeBrand(), react()],
  define: {
    'import.meta.env.VITE_BRAND_NAME': JSON.stringify('Rezekme'),
    // Public web address (Stripe return links and share links from inside the store app).
    'import.meta.env.VITE_PUBLIC_WEB_URL': JSON.stringify(process.env.VITE_PUBLIC_WEB_URL || 'https://rides.rezekme.com'),
  },
  resolve: { alias: { '@platform': resolve(__dirname, '../../src') } },
  server: { host: '127.0.0.1', port: 5191 },
  build: { outDir: resolve(__dirname, '../../dist-apps/rezekme-rides'), emptyOutDir: true },
})
