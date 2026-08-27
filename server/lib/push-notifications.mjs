import webpush from 'web-push'
import { db } from './prisma.mjs'

// SR Ride vs. Uber gap-closure (P1 #7): standard Web Push, not a third-party provider SDK -- the
// VAPID keypair is self-generated local crypto (`npx web-push generate-vapid-keys`), never an
// external account signup. Optional infrastructure: if the keys aren't configured, sends are
// silently skipped rather than throwing -- a missing push config should never break a ride.
let configured = false
function ensureConfigured() {
  if (configured) return true
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const contact = process.env.VAPID_CONTACT_EMAIL || 'mailto:support@sybnb.app'
  if (!publicKey || !privateKey) return false
  webpush.setVapidDetails(contact, publicKey, privateKey)
  configured = true
  return true
}

export function pushEnabled() {
  return ensureConfigured()
}

export function vapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null
}

// Sends to every device the user has subscribed on (a rider or driver may have more than one).
// A 404/410 response means the browser's push service considers the subscription gone (uninstalled,
// permission revoked, expired) -- pruned here rather than retried forever.
export async function sendPushNotification(userId, { title, body, url }) {
  if (!ensureConfigured() || !userId) return
  const subscriptions = await db().pushSubscription.findMany({ where: { userId } })
  if (subscriptions.length === 0) return

  const payload = JSON.stringify({ title, body, url })
  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dhKey, auth: subscription.authKey } },
          payload,
        )
      } catch (err) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await db().pushSubscription.delete({ where: { id: subscription.id } }).catch(() => {})
        }
        // Any other delivery failure (network blip, malformed payload) is swallowed, not
        // rethrown -- a push failure must never fail the ride action that triggered it.
      }
    }),
  )
}
