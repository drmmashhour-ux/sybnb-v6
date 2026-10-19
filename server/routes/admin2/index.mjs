// STEP 5 -- /api/admin2 entry. Mounted in server/index.mjs dispatch(). Every route lives behind the
// central authorization service; unknown routes 404 inside the prefix.
import { createRouter } from './router.mjs'
import { registerCore } from './core.mjs'

const router = createRouter()
registerCore(router)

export async function handleAdmin2(req, res, url, context) {
  return router.handle(req, res, url, context)
}
