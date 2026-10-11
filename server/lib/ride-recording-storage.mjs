import { putObject, deleteObject, signObjectUrl } from './storage.mjs'

// SR in-ride audio recording. Private 'ride-recording' bucket (server/lib/storage.mjs), retrieved
// only via a short-lived signed URL — same discipline as KYC documents and driver photos. Never a
// public path. Access is additionally gated in the route: a recording's audio is reachable by
// admin/Safety only once it is attached to an Incident.
const RIDE_RECORDING_BUCKET = 'ride-recording'

export async function saveRideRecording(base64Data, mimeType) {
  const { key, size } = await putObject(RIDE_RECORDING_BUCKET, { base64: base64Data, contentType: mimeType })
  return { storageKey: key, sizeBytes: size }
}

export async function deleteRideRecording(storageKey) {
  await deleteObject(RIDE_RECORDING_BUCKET, storageKey)
}

export function signRideRecordingUrl(storageKey, expiresInSec = 300) {
  return signObjectUrl(RIDE_RECORDING_BUCKET, storageKey, expiresInSec)
}
