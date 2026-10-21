import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Rezekme Admin: the operator console for rezekme rides (live rides, drivers, vehicles, payment review, money flow,
// payouts, incidents, customers, promo codes, business accounts). Shares the platform API client, session and admin
// pages through the @platform alias. Build: `npm run build:rezekme-admin` -> dist-apps/rezekme-admin
export default defineConfig({
  root: __dirname,
  envDir: resolve(__dirname, '../..'),
  publicDir: resolve(__dirname, '../../public'),
  plugins: [react()],
  define: { 'import.meta.env.VITE_BRAND_NAME': JSON.stringify('Rezekme') },
  resolve: { alias: { '@platform': resolve(__dirname, '../../src') } },
  server: { host: '127.0.0.1', port: 5192 },
  build: { outDir: resolve(__dirname, '../../dist-apps/rezekme-admin'), emptyOutDir: true },
})
