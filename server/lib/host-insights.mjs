import { db } from './prisma.mjs'
import { computePricingGapFacts } from './host-insight-facts.mjs'
import { generatePricingInsightMessage, requireAnthropic } from './ai-insights.mjs'
import { isMailerConfigured, sendHostInsightEmail } from './mailer.mjs'

const DEDUPE_WINDOW_HOURS = 24

// Free, zero-cost — safe to call opportunistically from any read path (e.g. GET /api/host/overview),
// exactly like completeExpiredBookings()/expireOldListings() already are.
export async function computeInsightSignal(hostId) {
  const facts = await computePricingGapFacts(hostId)
  return { listingsNeedingAttention: facts.length }
}

// Costs a real AI API call per insight-worthy listing — only ever invoked from a host-initiated
// manual action (POST /api/host/insights/generate), never opportunistically.
export async function generateHostInsights(hostId) {
  const facts = await computePricingGapFacts(hostId)
  if (!facts.length) return { generated: 0 }

  // Manual, host-initiated trigger only (see POST /api/host/insights/generate) — surface the real
  // "not configured" error to the button that was clicked, rather than silently no-op-ing.
  requireAnthropic()

  const dedupeSince = new Date(Date.now() - DEDUPE_WINDOW_HOURS * 60 * 60 * 1000)
  const recentInsights = await db().hostInsight.findMany({
    where: { hostId, kind: 'PRICING_GAP', createdAt: { gte: dedupeSince } },
    select: { listingId: true },
  })
  const recentListingIds = new Set(recentInsights.map((row) => row.listingId))
  const eligibleFacts = facts.filter((fact) => !recentListingIds.has(fact.listingId))
  if (!eligibleFacts.length) return { generated: 0 }

  const host = await db().user.findUnique({ where: { id: hostId }, select: { id: true, email: true, displayName: true } })

  let generated = 0
  for (const fact of eligibleFacts) {
    const message = await generatePricingInsightMessage(fact)
    const insight = await db().hostInsight.create({
      data: {
        hostId,
        listingId: fact.listingId,
        kind: 'PRICING_GAP',
        facts: fact,
        messageAr: message.messageAr,
        messageEn: message.messageEn,
        aiProvider: 'anthropic',
        aiModel: message.model,
      },
    })
    generated += 1

    if (isMailerConfigured() && host?.email) {
      try {
        await sendHostInsightEmail(host, insight)
        await db().hostInsight.update({ where: { id: insight.id }, data: { emailSentAt: new Date() } })
      } catch (error) {
        await db().hostInsight.update({ where: { id: insight.id }, data: { emailError: error instanceof Error ? error.message : 'Unknown email error' } })
      }
    }
  }

  return { generated }
}
