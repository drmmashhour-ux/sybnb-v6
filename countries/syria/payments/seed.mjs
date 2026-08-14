// SYBNB — Syria wallet seed loader (country-scoped, fail-closed).
// The seed lives under countries/syria and MUST NOT load under any other country profile. This
// guard proves country scoping: it refuses unless the active country is 'syria'. No country inherits
// another country's seed/provider data.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

export function loadSyriaWalletSeed(env = process.env) {
  const country = String(env.SYBNB_COUNTRY || '').trim().toLowerCase()
  if (country !== 'syria') {
    throw new Error(`Syria wallet seed is country-scoped: refusing to load under SYBNB_COUNTRY='${country || '(unset)'}'`)
  }
  return JSON.parse(readFileSync(join(here, 'localWallet.seed.json'), 'utf8'))
}
