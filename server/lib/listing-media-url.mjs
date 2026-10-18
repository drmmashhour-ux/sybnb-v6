import { signObjectUrl, deleteObject } from './storage.mjs'
import { db } from './prisma.mjs'

// Listing photos are stored as private references ('payment-proof://<key>' from the seller wizard
// upload, or 'listing-media://<key>'). A browser cannot open those, so every PUBLIC listing response
// swaps them for a short-lived signed URL. Callers only pass media of listings that are already
// publicly visible (APPROVED); owners/admins use their own routes. Anything that is not a recognised
// private reference (e.g. an https URL) passes through unchanged, and a malformed key is dropped
// rather than leaking the reference.
const PRIVATE_REF = /^(payment-proof|listing-media):\/\/([a-f0-9-]{36}\.(?:jpg|png|webp))$/

export function publicMediaUrl(url, expiresInSec = 6 * 3600) {
  if (typeof url !== 'string') return null
  const match = PRIVATE_REF.exec(url)
  if (!match) return /^payment-proof:\/\/|^listing-media:\/\//.test(url) ? null : url
  try {
    return signObjectUrl(match[1], match[2], expiresInSec)
  } catch {
    return null
  }
}

export function publicListingMedia(media) {
  if (!Array.isArray(media)) return media
  return media
    .map((item) => ({ ...item, url: publicMediaUrl(item?.url) }))
    .filter((item) => item.url)
}

// Host removed the listing: delete every photo from storage, then the media rows. A storage failure
// on one object never blocks the removal (the row is deleted regardless); returns how many rows went.
export async function deleteListingPhotos(listingId) {
  const rows = await db().listingMedia.findMany({ where: { listingId }, select: { id: true, url: true } })
  for (const row of rows) {
    const match = PRIVATE_REF.exec(row.url || '')
    if (match) await deleteObject(match[1], match[2]).catch(() => {})
  }
  await db().listingMedia.deleteMany({ where: { listingId } })
  return rows.length
}
