import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// rezekme.com landing page: static, links to stay.rezekme.com and rides.rezekme.com.
// Build: `npm run build:rezekme-landing` -> dist-apps/rezekme-landing
export default defineConfig({
  root: __dirname,
  server: { host: '127.0.0.1', port: 5190 },
  build: { outDir: resolve(__dirname, '../../dist-apps/rezekme-landing'), emptyOutDir: true },
})
