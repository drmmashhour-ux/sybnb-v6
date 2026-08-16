// SYBNB — R2 storage round-trip verification against the REAL bucket, using our storage code
// (server/lib/storage.mjs). Proves the R2 credentials + bucket work end-to-end: PUT -> GET (bytes
// match) -> DELETE (object gone). Uses a synthetic 1x1 PNG. Prints NO secrets.
//
//   set -a; . ./.env.production.local; set +a; node scripts/verify-r2.mjs
import { putObject, getObjectBytes, deleteObject, storageStatus } from '../server/lib/storage.mjs'

const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
let ok = true
const line = (l, good) => { console.log(`  ${good ? 'PASS' : 'FAIL'}  ${l}`); if (!good) ok = false }

console.log('=== R2 STORAGE ROUND-TRIP (real bucket) ===')
const status = storageStatus()
console.log('  provider status:', JSON.stringify(status))

try {
  const put = await putObject('listing-media', { base64: PNG_1x1, contentType: 'image/png' })
  line(`PUT object (${put.size} bytes, key ${String(put.key).slice(0, 8)}…)`, Boolean(put.key))

  const got = await getObjectBytes('listing-media', put.key)
  const match = Buffer.from(PNG_1x1, 'base64').equals(Buffer.from(got))
  line('GET returns identical bytes', match)

  await deleteObject('listing-media', put.key)
  let gone = false
  try { await getObjectBytes('listing-media', put.key) } catch { gone = true }
  line('DELETE removes the object', gone)
} catch (error) {
  line(`round-trip threw: ${error instanceof Error ? error.message : String(error)}`, false)
}

console.log(`\n==== R2 ROUND-TRIP: ${ok ? 'PASS' : 'FAIL'} ====`)
process.exit(ok ? 0 : 1)
