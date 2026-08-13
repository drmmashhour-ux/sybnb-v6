import { createHash, createHmac } from 'crypto'

// Minimal, dependency-free AWS Signature V4 client for S3-compatible object stores (AWS S3, GCS
// in S3-interop mode, MinIO, R2, ...). This is the REAL production upload/download/delete/presign
// path — it is not a placeholder. It fails closed when configuration is absent (s3Config() -> null),
// and callers must handle that by refusing the operation, never by silently using local disk.
//
// Config (all required for the s3 path to be considered configured):
//   STORAGE_S3_BUCKET, STORAGE_S3_REGION, STORAGE_S3_ACCESS_KEY_ID, STORAGE_S3_SECRET_ACCESS_KEY
// Optional:
//   STORAGE_S3_ENDPOINT  — custom endpoint for non-AWS S3-compatible stores (e.g. GCS/MinIO/R2).
//                          Defaults to https://<bucket>.s3.<region>.amazonaws.com
//   STORAGE_S3_FORCE_PATH_STYLE — 'true' to use path-style (endpoint/bucket/key), for MinIO etc.

export function s3Config() {
  const bucket = process.env.STORAGE_S3_BUCKET
  const region = process.env.STORAGE_S3_REGION
  const accessKeyId = process.env.STORAGE_S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.STORAGE_S3_SECRET_ACCESS_KEY
  if (!bucket || !region || !accessKeyId || !secretAccessKey) return null
  const forcePathStyle = process.env.STORAGE_S3_FORCE_PATH_STYLE === 'true'
  const endpoint = process.env.STORAGE_S3_ENDPOINT
  return { bucket, region, accessKeyId, secretAccessKey, endpoint, forcePathStyle, service: 's3' }
}

const sha256hex = (data) => createHash('sha256').update(data).digest('hex')
const hmac = (key, data) => createHmac('sha256', key).update(data).digest()
const hmacHex = (key, data) => createHmac('sha256', key).update(data).digest('hex')

function amzDates(now) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const amzDate = iso.slice(0, 15) + 'Z' // YYYYMMDDTHHMMSSZ
  return { amzDate, dateStamp: amzDate.slice(0, 8) }
}

function signingKey(secret, dateStamp, region, service) {
  const kDate = hmac('AWS4' + secret, dateStamp)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, service)
  return hmac(kService, 'aws4_request')
}

// Encode a path segment per RFC3986 but keep '/'. Object keys here are `uuid.ext` (no special
// chars), and the bucket/prefix are controlled, so this is straightforward.
function encodePath(p) {
  return p.split('/').map((seg) => encodeURIComponent(seg)).join('/')
}

function objectEndpoint(cfg, objectPath) {
  if (cfg.endpoint) {
    const base = cfg.endpoint.replace(/\/+$/, '')
    return cfg.forcePathStyle ? `${base}/${cfg.bucket}/${encodePath(objectPath)}` : `${base}/${encodePath(objectPath)}`
  }
  return `https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com/${encodePath(objectPath)}`
}

function hostOf(urlStr) {
  return new URL(urlStr).host
}

function canonicalUriOf(urlStr) {
  return new URL(urlStr).pathname
}

// Core SigV4 for a header-authenticated request. Exported for deterministic testing.
export function signV4({ method, url, headers, payloadHashHex, accessKeyId, secretAccessKey, region, service, now }) {
  const { amzDate, dateStamp } = amzDates(now)
  const host = hostOf(url)
  const allHeaders = { host, 'x-amz-content-sha256': payloadHashHex, 'x-amz-date': amzDate, ...headers }
  const sortedKeys = Object.keys(allHeaders).map((k) => k.toLowerCase()).sort()
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${String(allHeaders[Object.keys(allHeaders).find((h) => h.toLowerCase() === k)]).trim()}\n`).join('')
  const signedHeaders = sortedKeys.join(';')
  const canonicalRequest = [
    method,
    canonicalUriOf(url),
    '', // canonical query string (none for these object ops)
    canonicalHeaders,
    signedHeaders,
    payloadHashHex,
  ].join('\n')
  const scope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n')
  const signature = hmacHex(signingKey(secretAccessKey, dateStamp, region, service), stringToSign)
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  return { authorization, amzDate, signature, signedHeaders, 'x-amz-content-sha256': payloadHashHex }
}

async function s3Request(cfg, { method, objectPath, body, contentType }) {
  const url = objectEndpoint(cfg, objectPath)
  const payloadHashHex = body ? sha256hex(body) : sha256hex('')
  const extraHeaders = contentType ? { 'content-type': contentType } : {}
  const signed = signV4({
    method, url, headers: extraHeaders, payloadHashHex,
    accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey,
    region: cfg.region, service: cfg.service, now: new Date(),
  })
  const res = await fetch(url, {
    method,
    headers: {
      authorization: signed.authorization,
      'x-amz-date': signed.amzDate,
      'x-amz-content-sha256': payloadHashHex,
      ...extraHeaders,
    },
    body,
  })
  return { res, url }
}

export async function putObjectS3(cfg, objectPath, bytes, contentType) {
  const { res } = await s3Request(cfg, { method: 'PUT', objectPath, body: bytes, contentType })
  if (!res.ok) throw new Error(`S3 put failed: ${res.status}`)
}

export async function getObjectS3(cfg, objectPath) {
  const { res } = await s3Request(cfg, { method: 'GET', objectPath })
  if (!res.ok) throw new Error(`S3 get failed: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

export async function deleteObjectS3(cfg, objectPath) {
  const { res } = await s3Request(cfg, { method: 'DELETE', objectPath })
  if (!res.ok && res.status !== 404) throw new Error(`S3 delete failed: ${res.status}`)
}

// Query-string (presigned) GET URL for time-limited private retrieval directly from the store.
export function presignGetS3(cfg, objectPath, expiresInSec, now = new Date()) {
  const { amzDate, dateStamp } = amzDates(now)
  const url = objectEndpoint(cfg, objectPath)
  const host = hostOf(url)
  const canonicalUri = canonicalUriOf(url)
  const scope = `${dateStamp}/${cfg.region}/${cfg.service}/aws4_request`
  const params = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${cfg.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(Math.max(1, expiresInSec)),
    'X-Amz-SignedHeaders': 'host',
  })
  const canonicalRequest = [
    'GET', canonicalUri, params.toString(),
    `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD',
  ].join('\n')
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n')
  const signature = hmacHex(signingKey(cfg.secretAccessKey, dateStamp, cfg.region, cfg.service), stringToSign)
  params.set('X-Amz-Signature', signature)
  return `${url}?${params.toString()}`
}
