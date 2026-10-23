import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

const BRAND = 'Rezekme'
const PLATFORM_SRC = resolve(__dirname, '../../src')
const BRAND_DIR = resolve(__dirname, '../../src/shared/brand')

// The full platform app carries 'SYBNB' in hundreds of user-facing strings. For this build only,
// rename the brand word in platform source at compile time -- whole word only. Left untouched:
//  - codes and keys ('SYBNB_..._V1', 'SYBNB-BANK-ADV', SYBNB_COUNTRY: next char is _ or -)
//  - a literal that is exactly 'SYBNB' (brand checks such as BRAND_NAME === 'SYBNB')
//  - the brand module itself, and lowercase domains/emails (sybnb.app)
// The Arabic name is replaced too. sybnb.app's own build is not affected.
function rezekmeBrand(): Plugin {
  return {
    name: 'rezekme-brand',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0]
      if (!file.startsWith(PLATFORM_SRC) || file.startsWith(BRAND_DIR) || !/\.(tsx?|jsx?)$/.test(file)) return null
      if (!code.includes('SYBNB') && !code.includes('سيبنب')) return null
      const out = code
        .replace(/SYBNB/g, (match, offset: number, all: string) => {
          const before = all[offset - 1] || ''
          const after = all[offset + match.length] || ''
          if (/[A-Za-z0-9_\-]/.test(before) || /[A-Za-z0-9_\-]/.test(after)) return match
          if (/['"`]/.test(before) && before === after) return match
          return BRAND
        })
        .replace(/سيبنب/g, BRAND)
      return { code: out, map: null }
    },
  }
}

// Standalone Stays app. Shares the platform's API client, auth/session, engines and shared UI through
// the @platform alias (one source of truth for money/account logic); the pages themselves are this
// app's own copies, restyled. Build: `npm run build:rezekme-stay` -> dist-apps/rezekme-stay
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
  },
  resolve: { alias: { '@platform': resolve(__dirname, '../../src') } },
  server: { host: '127.0.0.1', port: 5192 },
  build: { outDir: resolve(__dirname, '../../dist-apps/rezekme-stay'), emptyOutDir: true },
})
