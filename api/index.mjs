// Vercel serverless entry point. Every /api/* request is rewritten here by vercel.json (explicit
// rewrites, not filename-based catch-all matching -- that convention didn't reliably route
// multi-segment paths in production) and handed to the exact same handleRequest() the local dev
// server (server/index.mjs, `npm run api:dev`) uses -- one request-handling code path, two entry
// points, so there is no behavioral drift between local dev and this production deployment target.
import { validateProductionConfig } from '../server/lib/env.mjs'
import { handleRequest } from '../server/index.mjs'

// server/index.mjs only calls this inside its own isMainModule guard (which never runs when this
// file imports it, since server/index.mjs is not the process entrypoint on Vercel) -- so it must
// be called here instead. Runs once per cold start, not per request.
if (process.env.NODE_ENV === 'production') {
  validateProductionConfig()
}

export default async function handler(req, res) {
  return handleRequest(req, res)
}
