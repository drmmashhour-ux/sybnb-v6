import { resolve } from 'node:path'
import type { Plugin } from 'vite'

const BRAND = 'Rezekme'
const PLATFORM_SRC = resolve(__dirname, '../src')
const BRAND_DIR = resolve(__dirname, '../src/shared/brand')

// The full platform app carries 'SYBNB' in hundreds of user-facing strings. For Rezekme builds only,
// rename the brand word in platform source at compile time -- whole word only. Left untouched:
//  - codes and keys ('SYBNB_..._V1', 'SYBNB-BANK-ADV', SYBNB_COUNTRY: next char is _ or -)
//  - a literal that is exactly 'SYBNB' (brand checks such as BRAND_NAME === 'SYBNB')
//  - the brand module itself, and lowercase domains/emails (sybnb.app)
// The Arabic name is replaced too. sybnb.app's own build is not affected.
// Used by Rezekme Stays and Rezekme Rides (the Rides app reuses platform pages such as sign-in and
// the legal documents, which must not say SYBNB inside a store app named Rezekme).
export function rezekmeBrand(): Plugin {
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
