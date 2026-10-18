import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Rezekme Rides app (copy of SR). Shares the platform's API client, auth/session, engines and shared UI through
// the @platform alias (one source of truth for money/account logic); the pages themselves are this
// app's own copies, restyled. Build: `npm run build:rezekme-rides` -> dist-apps/rezekme-rides
export default defineConfig({
  root: __dirname,
  envDir: resolve(__dirname, '../..'),
  publicDir: resolve(__dirname, '../../public'),
  plugins: [react()],
  resolve: { alias: { '@platform': resolve(__dirname, '../../src') } },
  server: { host: '127.0.0.1', port: 5191 },
  build: { outDir: resolve(__dirname, '../../dist-apps/rezekme-rides'), emptyOutDir: true },
})
