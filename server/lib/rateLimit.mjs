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
  return rows[0].count > max
}

export function clientIp(req) {
  const ipRaw = req.headers['x-forwarded-for']
  return (Array.isArray(ipRaw) ? ipRaw[0] : ipRaw || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown'
}
