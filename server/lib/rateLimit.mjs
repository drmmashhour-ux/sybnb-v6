import { db } from './prisma.mjs'

// Shared, cross-instance rate limiter backed by Postgres -- the same "DB as shared source of
// truth" pattern already used by otpAttemptLock/verificationCode (see security.mjs). A
// process-local Map only sees requests handled by ONE server instance; behind a load balancer
// with N instances the effective limit for the SAME configured value silently becomes
// limit * N, with no error or log signal. This table gives every instance the same view of the
// current fixed window.
//
// The INSERT ... ON CONFLICT DO UPDATE is a single round trip and is safe under concurrency:
// Postgres takes a row-level lock for the conflicting key during the upsert, so two simultaneous
// requests for the same bucket can't both read a stale count and both decide they're under the
// limit (the read-then-write race a hand-rolled check-then-increment would have).
export async function isRateLimited(bucketKey, windowMs, max) {
  const rows = await db().$queryRaw`
    INSERT INTO rate_limit_buckets (bucket_key, window_start, count, updated_at)
    VALUES (${bucketKey}, now(), 1, now())
    ON CONFLICT (bucket_key) DO UPDATE
    SET count = CASE
                  WHEN rate_limit_buckets.window_start <= now() - (${windowMs}::int * interval '1 millisecond')
                  THEN 1
                  ELSE rate_limit_buckets.count + 1
                END,
        window_start = CASE
                  WHEN rate_limit_buckets.window_start <= now() - (${windowMs}::int * interval '1 millisecond')
                  THEN now()
                  ELSE rate_limit_buckets.window_start
                END,
        updated_at = now()
    RETURNING count
  `
  maybeCleanupStaleBuckets()
  return rows[0].count > max
}

// No scheduler in this deployment (same constraint gift-lifecycle.mjs's expireStaleWalletGifts()
// documents), so old buckets are swept opportunistically from this same hot path instead -- but
// unlike that read-path sweep, isRateLimited() runs on every auth/otp/webhook request, so a DELETE
// on every call would add real overhead to a security-critical path for no benefit (every window in
// this codebase is 60s; nothing needs pruning that recently). Sampled at ~1%, and fire-and-forget:
// a cleanup failure must never affect the rate-limit decision that already returned above it.
const CLEANUP_SAMPLE_RATE = 0.01
const STALE_AFTER_MS = 60 * 60 * 1000 // every window in use today is 60s; 1h is a generous, safe margin
function maybeCleanupStaleBuckets() {
  if (Math.random() >= CLEANUP_SAMPLE_RATE) return
  db()
    .rateLimitBucket.deleteMany({ where: { updatedAt: { lt: new Date(Date.now() - STALE_AFTER_MS) } } })
    .catch(() => {})
}

export function clientIp(req) {
  const ipRaw = req.headers['x-forwarded-for']
  return (Array.isArray(ipRaw) ? ipRaw[0] : ipRaw || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown'
}
