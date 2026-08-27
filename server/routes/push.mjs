import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { pushEnabled, vapidPublicKey } from '../lib/push-notifications.mjs'

// SR Ride vs. Uber gap-closure (P1 #7): push notifications, standard Web Push. Generic under
// /api/push/ rather than /api/sr/ -- the subscription mechanism itself isn't ride-specific, even
// though this arc only wires notification triggers into the SR Ride lifecycle.
export async function handlePush(req, res, url, context) {
  if (url.pathname === '/api/push/vapid-public-key') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    return json(res, 200, { ok: true, enabled: pushEnabled(), publicKey: vapidPublicKey() })
  }

  if (url.pathname === '/api/push/subscribe') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)
    const body = await readJson(req)
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint : ''
    const p256dhKey = typeof body.keys?.p256dh === 'string' ? body.keys.p256dh : ''
    const authKey = typeof body.keys?.auth === 'string' ? body.keys.auth : ''

    if (!endpoint || !p256dhKey || !authKey) {
      const error = new Error('A valid push subscription (endpoint + keys) is required.')
      error.statusCode = 400
      error.code = 'PUSH_SUBSCRIPTION_INVALID'
      error.expose = true
      throw error
    }

    // upsert by endpoint -- the same browser/device re-subscribing (e.g. after clearing storage)
    // should replace its old row, not create a duplicate the old row's user no longer owns.
    const subscription = await db().pushSubscription.upsert({
      where: { endpoint },
      create: { userId: context.user.id, endpoint, p256dhKey, authKey },
      update: { userId: context.user.id, p256dhKey, authKey },
    })
    return json(res, 201, { ok: true, subscriptionId: subscription.id })
  }

  if (url.pathname === '/api/push/unsubscribe') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)
    const body = await readJson(req)
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint : ''
    if (endpoint) {
      await db().pushSubscription.deleteMany({ where: { endpoint, userId: context.user.id } })
    }
    return json(res, 200, { ok: true })
  }

  return false
}
