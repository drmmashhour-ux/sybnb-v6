import { randomUUID, createHmac, timingSafeEqual } from 'crypto'
import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { s3Config, putObjectS3, getObjectS3, deleteObjectS3, presignGetS3 } from './s3-client.mjs'

// Production object-storage abstraction. One seam so callers never touch the filesystem or a
// specific cloud SDK directly. Selected by env STORAGE_PROVIDER:
//   'local' (default) — dev/test adapter, writes under server/uploads/<bucket>/ (git-ignored).
//   's3'              — S3/GCS-compatible path. Env-gated (STORAGE_S3_BUCKET + STORAGE_S3_REGION +
//                       credentials). FAILS CLOSED (throws STORAGE_NOT_CONFIGURED) until real
//                       config is supplied — a reserved owner action; no bucket is provisioned here.
//
// Objects are private by default. Retrieval of private objects is via short-lived signed URLs
// (HMAC over bucket/key/expiry with AUTH_SECRET) — never a guessable public path. Keys are
// server-generated (random UUID + validated extension), so no user-controlled path/filename ever
// reaches the filesystem or object store (traversal-safe).

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOCAL_ROOT = path.join(__dirname, '..', 'uploads')

const KEY_RE = /^[a-f0-9-]{36}\.(jpg|png|pdf|webp)$/
const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

// Per-bucket policy: whether objects are private (signed retrieval only), allowed MIME types, and
// max size. KYC and payment proofs are always private; listing media is private-by-default here
// too (served via signed URL) — a deployment may front approved media with a public CDN separately.
const BUCKETS = {
  kyc: { private: true, mime: ['image/jpeg', 'image/png', 'application/pdf'], maxBytes: 8 * 1024 * 1024 },
  'payment-proof': { private: true, mime: ['image/jpeg', 'image/png', 'application/pdf'], maxBytes: 8 * 1024 * 1024 },
  'listing-media': { private: true, mime: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 5 * 1024 * 1024 },
  'driver-photo': { private: true, mime: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 5 * 1024 * 1024 },
}

function bucketPolicy(bucket) {
  const policy = BUCKETS[bucket]
  if (!policy) throw storageError(500, 'STORAGE_BUCKET_UNKNOWN', `Unknown storage bucket "${bucket}".`)
  return policy
}

function storageError(statusCode, code, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  return error
}

function provider() {
  return (process.env.STORAGE_PROVIDER || 'local').toLowerCase()
}

// Production must never silently persist private documents to local disk. If we are in production
// (NODE_ENV=production) the local adapter is refused unless explicitly opted in with
// STORAGE_ALLOW_LOCAL=true — so a missing STORAGE_PROVIDER=s3 config fails closed instead of
// falling back to disk.
function assertProviderAllowed() {
  if (provider() === 'local' && process.env.NODE_ENV === 'production' && process.env.STORAGE_ALLOW_LOCAL !== 'true') {
    throw storageError(503, 'STORAGE_LOCAL_DISALLOWED_IN_PRODUCTION', 'Local disk storage is not permitted in production. Configure the S3-compatible object store.')
  }
}

function s3Path(bucket, key) {
  return `${bucket}/${key}`
}

export function storageStatus() {
  const p = provider()
  if (p === 'local') return { provider: 'local', configured: true, durable: false }
  if (p === 's3') {
    return { provider: 's3', configured: Boolean(s3Config()), durable: true }
  }
  return { provider: p, configured: false, durable: false }
}

function requireS3Config() {
  if (!process.env.STORAGE_S3_BUCKET || !process.env.STORAGE_S3_REGION) {
    throw storageError(503, 'STORAGE_NOT_CONFIGURED', 'Object storage is not configured for durable delivery.')
  }
}

function validateKey(key) {
  if (!KEY_RE.test(key || '')) throw storageError(400, 'STORAGE_KEY_INVALID', 'Invalid object reference.')
  return key
}

// putObject(bucket, { base64, contentType }) -> { bucket, key, size }
export async function putObject(bucket, { base64, contentType }) {
  const policy = bucketPolicy(bucket)
  const ext = EXT_BY_MIME[contentType]
  if (!ext || !policy.mime.includes(contentType)) {
    throw storageError(400, 'STORAGE_TYPE_INVALID', 'Unsupported file type for this upload.')
  }
  const bytes = Buffer.from(base64 || '', 'base64')
  if (!bytes.length) throw storageError(400, 'STORAGE_EMPTY', 'The uploaded file is empty.')
  if (bytes.length > policy.maxBytes) throw storageError(400, 'STORAGE_TOO_LARGE', 'The uploaded file is too large.')

  const key = `${randomUUID()}.${ext}`
  assertProviderAllowed()

  if (provider() === 'local') {
    const dir = path.join(LOCAL_ROOT, bucket)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, key), bytes)
  } else if (provider() === 's3') {
    const cfg = s3Config()
    if (!cfg) requireS3Config() // throws STORAGE_NOT_CONFIGURED — fail closed
    await putObjectS3(cfg, s3Path(bucket, key), bytes, contentType)
  } else {
    throw storageError(500, 'STORAGE_PROVIDER_UNKNOWN', `Unknown storage provider "${provider()}".`)
  }

  return { bucket, key, size: bytes.length }
}

export async function getObjectBytes(bucket, key) {
  bucketPolicy(bucket)
  validateKey(key)
  assertProviderAllowed()
  if (provider() === 'local') {
    return readFile(path.join(LOCAL_ROOT, bucket, key))
  }
  const cfg = s3Config()
  if (!cfg) requireS3Config()
  return getObjectS3(cfg, s3Path(bucket, key))
}

export async function deleteObject(bucket, key) {
  bucketPolicy(bucket)
  if (!KEY_RE.test(key || '')) return
  assertProviderAllowed()
  if (provider() === 'local') {
    await unlink(path.join(LOCAL_ROOT, bucket, key)).catch(() => {})
    return
  }
  const cfg = s3Config()
  if (!cfg) requireS3Config()
  await deleteObjectS3(cfg, s3Path(bucket, key))
}

// --- Signed, time-limited retrieval for private objects ---
function signature(bucket, key, exp) {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw storageError(500, 'MISSING_SECRET', 'AUTH_SECRET is required for signed URLs.')
  return createHmac('sha256', secret).update(`storage:${bucket}/${key}:${exp}`).digest('base64url')
}

export function signObjectUrl(bucket, key, expiresInSec = 300) {
  bucketPolicy(bucket)
  validateKey(key)
  if (provider() === 's3') {
    const cfg = s3Config()
    if (!cfg) requireS3Config()
    // Real store-native presigned URL — retrieval goes directly to the object store, not the app.
    return presignGetS3(cfg, s3Path(bucket, key), expiresInSec)
  }
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, expiresInSec)
  return `/api/storage/${bucket}/${key}?exp=${exp}&sig=${signature(bucket, key, exp)}`
}

export function verifySignedObject(bucket, key, exp, sig) {
  if (!BUCKETS[bucket] || !KEY_RE.test(key || '')) return false
  const expNum = Number(exp)
  if (!Number.isFinite(expNum) || expNum < Math.floor(Date.now() / 1000)) return false
  const expected = Buffer.from(signature(bucket, key, expNum))
  const candidate = Buffer.from(String(sig || ''))
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

export function contentTypeForKey(key) {
  if (key.endsWith('.jpg')) return 'image/jpeg'
  if (key.endsWith('.png')) return 'image/png'
  if (key.endsWith('.webp')) return 'image/webp'
  if (key.endsWith('.pdf')) return 'application/pdf'
  return 'application/octet-stream'
}
