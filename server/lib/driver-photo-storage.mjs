import { putObject, deleteObject, signObjectUrl } from './storage.mjs'

// Driver profile photo. Private bucket (server/lib/storage.mjs), retrieved via a short-lived
// signed URL -- same discipline as KYC documents and listing media, never a bare public path.
const DRIVER_PHOTO_BUCKET = 'driver-photo'

export async function saveDriverPhoto(base64Data, mimeType) {
  const { key } = await putObject(DRIVER_PHOTO_BUCKET, { base64: base64Data, contentType: mimeType })
  return key
}

export async function deleteDriverPhoto(storageKey) {
  await deleteObject(DRIVER_PHOTO_BUCKET, storageKey)
}

export function signDriverPhotoUrl(storageKey, expiresInSec = 3600) {
  return signObjectUrl(DRIVER_PHOTO_BUCKET, storageKey, expiresInSec)
}
