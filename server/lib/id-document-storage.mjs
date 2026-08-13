import { putObject, getObjectBytes, deleteObject, signObjectUrl } from './storage.mjs'

// KYC / ID documents. These now go through the storage abstraction (server/lib/storage.mjs) on the
// private 'kyc' bucket instead of writing directly to local disk, so production can serve them from
// durable object storage with no code change. The document bytes never leave the browser as a bare
// filename; they are validated (MIME allowlist, 8MB cap), stored under a random server-generated
// key (not the user id or original filename — no enumeration, no path traversal), and retrieved
// only by an authorized admin (optionally via a short-lived signed URL).
const KYC_BUCKET = 'kyc'

export const ALLOWED_ID_DOCUMENT_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
}

export const MAX_ID_DOCUMENT_BYTES = 8 * 1024 * 1024 // 8MB (enforced by the storage bucket policy)

export async function saveIdDocument(base64Data, mimeType) {
  const { key } = await putObject(KYC_BUCKET, { base64: base64Data, contentType: mimeType })
  return key
}

export async function readIdDocument(storageKey) {
  return getObjectBytes(KYC_BUCKET, storageKey)
}

export async function deleteIdDocument(storageKey) {
  await deleteObject(KYC_BUCKET, storageKey)
}

// Short-lived signed URL for an admin to fetch a KYC document out-of-band (private bucket).
export function signIdDocumentUrl(storageKey, expiresInSec = 300) {
  return signObjectUrl(KYC_BUCKET, storageKey, expiresInSec)
}
