import { putObject, deleteObject, signObjectUrl } from './storage.mjs'

// Menu Studio photos (merchant covers + menu items). Private bucket, retrieved via short-lived
// signed URLs — exactly the driver-photo/KYC discipline. Nothing here is ever a public path;
// customer visibility is decided by photo_status (APPROVED only), not by URL knowledge.
const FOOD_PHOTO_BUCKET = 'food-photo'

export async function saveFoodPhoto(base64Data, mimeType) {
  const { key } = await putObject(FOOD_PHOTO_BUCKET, { base64: base64Data, contentType: mimeType })
  return key
}

export async function deleteFoodPhoto(storageKey) {
  await deleteObject(FOOD_PHOTO_BUCKET, storageKey)
}

export function signFoodPhotoUrl(storageKey, expiresInSec = 3600) {
  return signObjectUrl(FOOD_PHOTO_BUCKET, storageKey, expiresInSec)
}
