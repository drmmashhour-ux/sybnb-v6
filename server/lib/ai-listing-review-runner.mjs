// SYBNB — I/O side of the automatic AI listing check (owner decision of 2026-10-09). The pure part
// (prompt, Anthropic call, reply validation) is server/lib/ai-listing-review.mjs.
//
//   scheduleAiListingReview(listingId, opts)  fire-and-forget, after the submit response
//   reviewListingNow(listingId, opts)         loads, reviews, stores; NEVER throws
//   serializeAiReview(row)                    the shape the admin API returns
//
// Photos: listing_media.url holds private references ('payment-proof://<key>', '<bucket>://<key>' or
// a signed '/api/storage/<bucket>/<key>?..' URL). They are read server-side with getObjectBytes()
// (local disk or the S3/R2 store, same seam as every other private object) and sent to the API as
// base64 image blocks. A public https URL (seed/demo/CDN) is passed to the API as a url image block
// instead of being fetched by this server. KYC/host/driver buckets are never read (see
// AI_REVIEW_READABLE_BUCKETS). Over-size or unsupported images are skipped, never fatal.

import { randomUUID } from 'node:crypto'
import { db } from './prisma.mjs'
import { log } from './logger.mjs'
import { getObjectBytes } from './storage.mjs'
import { loadCountryProfile } from './country.mjs'
import {
  AI_REVIEW_MAX_PHOTOS,
  aiReviewConfigured,
  aiReviewModel,
  imageFromBytes,
  parseMediaRef,
  runAiListingReview,
} from './ai-listing-review.mjs'

export function serializeAiReview(row) {
  if (!row) return null
  const base = { status: row.status, model: row.model || null, at: (row.completedAt || row.startedAt || row.updatedAt || null) }
  if (row.status === 'DONE') return { ...base, result: row.result || null }
  if (row.status === 'SKIPPED') return { ...base, reason: row.error || 'NO_API_KEY' }
  if (row.status === 'FAILED') return { ...base, error: row.error || 'UNKNOWN' }
  return base // PENDING
}

export async function resolveListingImages(media, { getBytes = getObjectBytes } = {}) {
  const images = []
  const skipped = []
  let totalBase64 = 0
  const sorted = [...(media || [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  for (const item of sorted) {
    if (images.length >= AI_REVIEW_MAX_PHOTOS) break
    if (item.kind && !['image', 'photo'].includes(String(item.kind))) continue
    const ref = parseMediaRef(item.url)
    if (!ref) {
      skipped.push('UNSUPPORTED_REF')
      continue
    }
    if (ref.kind === 'public') {
      images.push({ url: ref.url })
      continue
    }
    try {
      const bytes = await getBytes(ref.bucket, ref.key)
      const out = imageFromBytes(bytes, { totalBase64SoFar: totalBase64 })
      if (out.skip) {
        skipped.push(out.skip)
        continue
      }
      totalBase64 += out.image.base64.length
      images.push(out.image)
    } catch (error) {
      skipped.push(error?.code || 'READ_FAILED')
    }
  }
  return { images, skipped }
}

function countryContext() {
  const { profile } = loadCountryProfile()
  return { countryName: profile?.displayName?.en || 'the active country', currency: profile?.currencies?.default || 'the local currency' }
}

// Reviews one listing and stores the outcome. `trigger`: 'SUBMIT' | 'EDIT_RESUBMIT' | 'ADMIN_RERUN'.
// Ownership by run id: the row is claimed with a fresh runId first, and the final write only lands
// while the row still carries that runId -- so a slow older run never overwrites a newer one.
export async function reviewListingNow(listingId, { actorUserId = null, trigger = 'SUBMIT', fetchImpl, env = process.env } = {}) {
  const runId = randomUUID()
  const startedAt = new Date()
  try {
    const listing = await db().listing.findUnique({
      where: { id: listingId },
      include: { location: true, media: { orderBy: { sortOrder: 'asc' }, take: 20 } },
    })
    if (!listing) return null
    const model = aiReviewModel(env)
    await db().listingAiReview.upsert({
      where: { listingId },
      create: { listingId, status: 'PENDING', model, runId, trigger, startedAt },
      update: { status: 'PENDING', model, runId, trigger, startedAt, completedAt: null, error: null },
    })

    const { images, skipped } = aiReviewConfigured(env) ? await resolveListingImages(listing.media) : { images: [], skipped: [] }
    const outcome = await runAiListingReview({ listing, images, env, ...(fetchImpl ? { fetchImpl } : {}), ...countryContext() })

    const stored = await db().listingAiReview.updateMany({
      where: { listingId, runId },
      data: {
        status: outcome.status,
        model: outcome.model,
        result: outcome.status === 'DONE' ? outcome.result : undefined,
        error: outcome.status === 'DONE' ? null : outcome.error || outcome.reason || null,
        completedAt: new Date(outcome.at),
      },
    })
    const summary = {
      listingId,
      trigger,
      status: outcome.status,
      model: outcome.model,
      score: outcome.result?.score,
      recommendation: outcome.result?.recommendation,
      failure: outcome.status === 'DONE' ? undefined : outcome.error || outcome.reason,
      photosSent: outcome.photosSent || 0,
      photosSkipped: skipped.length,
      superseded: stored.count === 0,
      ms: Date.now() - startedAt.getTime(),
    }
    log.info('ai_listing_review', summary)
    if (stored.count > 0) {
      await db().adminAuditLog.create({
        data: {
          actorUserId,
          action: `LISTING_AI_REVIEW_${outcome.status}`,
          entityType: 'listings',
          entityId: listingId,
          // Advisory metadata only -- never the prompt, photos or API key.
          after: { trigger, model: outcome.model, score: outcome.result?.score ?? null, recommendation: outcome.result?.recommendation ?? null, failure: summary.failure ?? null, photosSent: summary.photosSent, photosSkipped: summary.photosSkipped },
        },
      })
    }
    return outcome
  } catch (error) {
    log.warn('ai_listing_review_failed', { listingId, trigger, code: error?.code, message: error instanceof Error ? error.message.slice(0, 200) : String(error) })
    try {
      await db().listingAiReview.updateMany({
        where: { listingId, runId },
        data: { status: 'FAILED', error: 'INTERNAL_ERROR', completedAt: new Date() },
      })
    } catch {
      /* best effort */
    }
    return null
  }
}

// Fire-and-forget: runs after the current request's response is written. Never throws.
export function scheduleAiListingReview(listingId, opts = {}) {
  setImmediate(() => {
    reviewListingNow(listingId, opts).catch(() => {})
  })
}
