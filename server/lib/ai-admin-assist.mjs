// AI decision assistant for the admin review desk (disputes + manual payments).
//
// ADVISORY ONLY. This never moves money and never changes any booking/payment state. It asks Claude
// to read the facts a human admin is already looking at and return a structured recommendation the
// admin can accept or ignore — the actual approve/reject/hold still goes through the existing
// money-moving endpoints with their full Class-A re-authorization. It deliberately reuses the same
// Anthropic plumbing, model selection and key gating as the listing AI review
// (server/lib/ai-listing-review.mjs): with no ANTHROPIC_API_KEY set, it returns { configured:false }
// and the UI simply shows nothing, exactly like listing review's SKIPPED/NO_API_KEY path.
import {
  aiReviewConfigured,
  aiReviewModel,
  callAnthropic,
  extractJsonObject,
  replyText,
} from './ai-listing-review.mjs'

export const ADMIN_ASSIST_MAX_TOKENS = 900
export const ADMIN_ASSIST_RECOMMENDATIONS = Object.freeze(['APPROVE', 'REJECT', 'HOLD', 'NEEDS_INFO'])
export const ADMIN_ASSIST_CONFIDENCE = Object.freeze(['low', 'medium', 'high'])
export const ADMIN_ASSIST_KINDS = Object.freeze(['payment', 'dispute'])

export function buildAssistSystemPrompt(kind) {
  const subject = kind === 'dispute' ? 'a short-term-rental booking dispute' : 'a manually submitted payment proof'
  return [
    'You are an operations assistant for SYBNB, a short-term rental platform operating in Syria.',
    `A human administrator is deciding on ${subject}. Your job is to give a clear, cautious,`,
    'ADVISORY recommendation. You never make the decision and no money moves because of you — a',
    'human reviews your advice and acts separately.',
    '',
    'Rules:',
    '- Base everything strictly on the facts given. Never invent amounts, names, dates or history.',
    '- If the facts are insufficient to be confident, recommend HOLD or NEEDS_INFO and say what is missing.',
    '- Be especially careful with money: do not recommend APPROVE for a payment when the amount does not',
    '  clearly match the booking, when proof is missing, or when reconciliation is unconfirmed.',
    '- Keep reasons short, concrete and tied to the facts.',
    '',
    'Respond with ONLY a single JSON object and nothing else, in this exact shape:',
    '{"recommendation":"APPROVE|REJECT|HOLD|NEEDS_INFO","confidence":"low|medium|high",',
    '"summary":"one sentence","reasons":["short reason", "..."],"nextSteps":["short action", "..."]}',
  ].join('\n')
}

export function buildAssistMessages({ kind, facts, model }) {
  return {
    model,
    max_tokens: ADMIN_ASSIST_MAX_TOKENS,
    system: buildAssistSystemPrompt(kind),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Decision type: ${kind}\n\nFacts (JSON):\n${JSON.stringify(facts, null, 2)}\n\nReturn only the JSON object described in your instructions.`,
          },
        ],
      },
    ],
  }
}

export function parseAssistReply(text) {
  // extractJsonObject returns the matched JSON *string* (or null), not a parsed object.
  const raw = extractJsonObject(text)
  let obj = {}
  if (raw) {
    try {
      obj = JSON.parse(raw)
    } catch {
      obj = {}
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) obj = {}
  const rec = String(obj.recommendation || '').toUpperCase()
  const confidence = String(obj.confidence || '').toLowerCase()
  const asStrings = (value, max) =>
    Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim().slice(0, 300)).slice(0, max) : []
  return {
    recommendation: ADMIN_ASSIST_RECOMMENDATIONS.includes(rec) ? rec : 'HOLD',
    confidence: ADMIN_ASSIST_CONFIDENCE.includes(confidence) ? confidence : 'low',
    summary: typeof obj.summary === 'string' ? obj.summary.trim().slice(0, 400) : '',
    reasons: asStrings(obj.reasons, 6),
    nextSteps: asStrings(obj.nextSteps, 6),
  }
}

// Returns, without ever throwing:
//   { configured:false, model }                               — no API key; UI shows nothing
//   { configured:true, model, ok:false, error }               — the call failed
//   { configured:true, model, ok:true, recommendation }       — advisory recommendation
export async function runAdminAiAssist({ kind, facts, env = process.env, fetchImpl = globalThis.fetch, timeoutMs }) {
  const model = aiReviewModel(env)
  if (!aiReviewConfigured(env)) return { configured: false, model }

  const body = buildAssistMessages({ kind, facts, model })
  const response = await callAnthropic({ apiKey: String(env.ANTHROPIC_API_KEY).trim(), body, fetchImpl, timeoutMs })
  if (!response.ok) return { configured: true, model, ok: false, error: response.error }

  const text = replyText(response.data)
  const recommendation = parseAssistReply(text)
  return { configured: true, model, ok: true, recommendation }
}
