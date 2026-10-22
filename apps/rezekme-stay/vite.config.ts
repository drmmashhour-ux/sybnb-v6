import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Standalone Stays app. Shares the platform's API client, auth/session, engines and shared UI through
// the @platform alias (one source of truth for money/account logic); the pages themselves are this
// app's own copies, restyled. Build: `npm run build:rezekme-stay` -> dist-apps/rezekme-stay
export default defineConfig({
  root: __dirname,
  envDir: resolve(__dirname, '../..'),
  publicDir: resolve(__dirname, '../../public'),
  plugins: [react()],
  define: {
    'import.meta.env.VITE_BRAND_NAME': JSON.stringify('Rezekme'),
    // hosts on Rezekme Stay list daily stays only (the listing wizard hides the other divisions)
    'import.meta.env.VITE_STAYS_ONLY': JSON.stringify('1'),
  },
  resolve: { alias: { '@platform': resolve(__dirname, '../../src') } },
  server: { host: '127.0.0.1', port: 5192 },
  build: { outDir: resolve(__dirname, '../../dist-apps/rezekme-stay'), emptyOutDir: true },
})
