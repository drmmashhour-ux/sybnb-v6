import webpush from 'web-push'
import { db } from './prisma.mjs'

// SR Ride vs. Uber gap-closure (P1 #7): standard Web Push, not a third-party provider SDK -- the
// VAPID keypair is self-generated local crypto (`npx web-push generate-vapid-keys`), never an
// external account signup. Optional infrastructure: if the keys aren't configured, sends are
// silently skipped rather than throwing -- a missing push config should never break a ride.
//
// A real bug caught by an independent re-audit: `webpush.setVapidDetails()` throws SYNCHRONOUSLY
// on a malformed (present but invalid) key -- a very plausible ops mistake (truncated copy-paste,
// swapped env vars), distinct from the already-handled "unset" case. Because this used to run
// inside an async function called fire-and-forget (`void sendPushNotification(...)`, never
// awaited/caught), that throw became an unhandled promise rejection and Node terminates the
// entire process on those by default -- one bad env var took down the whole API, not just push.
// Fixed by catching it here and treating "malformed" the same as "unset": disabled, logged once,
// never retried (a bad key doesn't self-heal mid-process), never thrown.
let configured = null // null = not yet attempted, false = attempted and failed, true = succeeded
function ensureConfigured() {
  if (configured !== null) return configured
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const contact = process.env.VAPID_CONTACT_EMAIL || 'mailto:support@sybnb.app'
  if (!publicKey || !privateKey) {
    configured = false
    return false
  }
  try {
    webpush.setVapidDetails(contact, publicKey, privateKey)
    configured = true
  } catch (err) {
    console.error('[push-notifications] invalid VAPID key configuration, push disabled:', err?.message)
    configured = false
  }
  return configured
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
