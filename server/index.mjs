import { createServer } from 'node:http'
import { API_ENDPOINTS, PLATFORM_SECURITY_RULES } from './contracts.mjs'
import { getAuthContext } from './lib/auth-context.mjs'
import { loadEnv } from './lib/env.mjs'
import { checkDatabase, disconnectDb } from './lib/prisma.mjs'
import { handleRouteError, json, notFound, publicUrl } from './lib/responses.mjs'
import { handleAdmin } from './routes/admin.mjs'
import { handleAuth } from './routes/auth.mjs'
import { handleBookings } from './routes/bookings.mjs'
import { handleDriver } from './routes/driver.mjs'
import { handleHost } from './routes/host.mjs'
import { handleListings } from './routes/listings.mjs'
import { handleMe } from './routes/me.mjs'
import { handleMessages } from './routes/messages.mjs'
import { handleOtp } from './routes/otp.mjs'
import { handlePayments } from './routes/payments.mjs'
import { handleReviews } from './routes/reviews.mjs'
import { handleSrRides } from './routes/sr-rides.mjs'
import { handleWallet } from './routes/wallet.mjs'

loadEnv()

const PORT = Number(process.env.API_PORT || 3051)
const HOST = process.env.API_HOST || '127.0.0.1'
const DEFAULT_CORS_ORIGIN = [
  'http://127.0.0.1:3050',
  'http://127.0.0.1:3053',
  'http://127.0.0.1:3055',
  'http://127.0.0.1:5180',
  'http://localhost:5180',
].join(',')
const CORS_ORIGINS = (process.env.CORS_ORIGIN || DEFAULT_CORS_ORIGIN)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const server = createServer(async (req, res) => {
  const url = publicUrl(req)

  try {
    setCors(req, res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      return res.end()
    }

    if (url.pathname === '/api/health') {
      const db = await databaseStatus()
      return json(res, db.ok ? 200 : 503, {
        ok: db.ok,
        service: 'sybnb-v6-api',
        database: db,
      })
    }

    if (url.pathname === '/api/contracts') {
      return json(res, 200, {
        ok: true,
        endpoints: API_ENDPOINTS,
        securityRules: PLATFORM_SECURITY_RULES,
      })
    }

    const context = await getAuthContext(req)
    const handled = await dispatch(req, res, url, context)
    if (handled === false) return notFound(res)
  } catch (error) {
    handleRouteError(res, error)
  }
})

async function dispatch(req, res, url, context) {
  for (const handler of [
    handleAuth,
    handleOtp,
    handleListings,
    handleBookings,
    handlePayments,
    handleWallet,
    handleMe,
    handleHost,
    handleDriver,
    handleAdmin,
    handleSrRides,
    handleReviews,
    handleMessages,
  ]) {
    const handled = await handler(req, res, url, context)
    if (handled !== false) return handled
  }
  return false
}

async function databaseStatus() {
  if (!process.env.DATABASE_URL) {
    return {
      ok: false,
      code: 'DATABASE_URL_MISSING',
      message: 'Set DATABASE_URL before using database-backed V6 API routes.',
    }
  }

  try {
    await checkDatabase()
    return { ok: true, code: 'DATABASE_CONNECTED' }
  } catch (error) {
    return {
      ok: false,
      code: 'DATABASE_UNAVAILABLE',
      message: error.message,
    }
  }
}

function setCors(req, res) {
  const requestedOrigin = req.headers.origin
  const origin = requestedOrigin && CORS_ORIGINS.includes(requestedOrigin)
    ? requestedOrigin
    : CORS_ORIGINS[0] || DEFAULT_CORS_ORIGIN
  res.setHeader('access-control-allow-origin', origin)
  res.setHeader('vary', 'origin')
  res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type,authorization')
}

server.listen(PORT, HOST, () => {
  console.log(`SYBNB V6 API listening on http://${HOST}:${PORT}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await disconnectDb()
    server.close(() => process.exit(0))
  })
}
