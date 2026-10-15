import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Standalone Eats app (SE) — Yallago/Uber Eats-style customer app. Shares the platform's API
// client, auth/session and engines through the @platform alias (one source of truth for account
// and money logic), same pattern as apps/sr. Build: `npm run build:se` -> dist-apps/se
export default defineConfig({
  root: __dirname,
  envDir: resolve(__dirname, '../..'),
  publicDir: resolve(__dirname, '../../public'),
  plugins: [react()],
  resolve: { alias: { '@platform': resolve(__dirname, '../../src') } },
  // Own dep-optimizer cache: concurrent vite servers sharing node_modules/.vite serve each
  // other 503 'outdated optimize dep' responses.
  cacheDir: resolve(__dirname, '../../node_modules/.vite-se'),
  server: { host: '127.0.0.1', port: 5399, strictPort: true },
  build: { outDir: resolve(__dirname, '../../dist-apps/se'), emptyOutDir: true },
})
