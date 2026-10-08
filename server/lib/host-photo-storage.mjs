import { putObject, deleteObject, signObjectUrl } from './storage.mjs'

// Host profile photo. Private bucket (server/lib/storage.mjs), retrieved only via a short-lived
// signed URL -- same discipline as driver photos, KYC documents and listing media.
const HOST_PHOTO_BUCKET = 'host-photo'

export async function saveHostPhoto(base64Data, mimeType) {
  const { key } = await putObject(HOST_PHOTO_BUCKET, { base64: base64Data, contentType: mimeType })
  return key
}

export async function deleteHostPhoto(storageKey) {
  await deleteObject(HOST_PHOTO_BUCKET, storageKey)
}

export function signHostPhotoUrl(storageKey, expiresInSec = 3600) {
  return signObjectUrl(HOST_PHOTO_BUCKET, storageKey, expiresInSec)
}
