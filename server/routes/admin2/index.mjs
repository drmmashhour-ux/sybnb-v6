// STEP 5 -- /api/admin2 entry. Mounted in server/index.mjs dispatch(). Every route lives behind the
// central authorization service; unknown routes 404 inside the prefix.
import { createRouter } from './router.mjs'
import { registerCore } from './core.mjs'
import { registerAccess } from './access.mjs'
import { registerSecurity } from './security.mjs'
import { registerWork } from './work.mjs'
import { registerRecords } from './records.mjs'
import { registerConfig } from './config.mjs'

const router = createRouter()
registerCore(router)
registerAccess(router)
registerSecurity(router)
registerWork(router)
registerRecords(router)
registerConfig(router)

export async function handleAdmin2(req, res, url, context) {
  return router.handle(req, res, url, context)
}
