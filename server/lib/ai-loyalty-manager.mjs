// AI loyalty manager — the AI "runs" the SYBNB loyalty program.
//
// Design (owner: "let AI manager control these points 100%", with the best-mix safeguards):
//   - The AI decides discretionary bonus points, suggests tier recognition, and flags fraud/anomalies.
//   - It acts AUTONOMOUSLY (its bonus is applied without a human click) — but inside DETERMINISTIC
//     safety caps enforced in server/lib/loyalty.mjs (per-review and per-day bonus ceilings), and the
//     points→wallet-credit conversion rate is fixed in code. So the AI is in charge of the program,
//     yet cannot be tricked (prompt injection, model error) into minting unlimited value.
//   - Every decision is recorded (loyalty ledger ADJUST + admin audit) and an admin can override.
// Reuses the same Anthropic plumbing / key gating as the other AI features. With no ANTHROPIC_API_KEY
// it returns { configured:false } and the caller simply does nothing.
import {
  aiReviewConfigured,
  aiReviewModel,
  callAnthropic,
  extractJsonObject,
  replyText,
} from './ai-listing-review.mjs'

export const LOYALTY_MANAGER_MAX_TOKENS = 700
export const LOYALTY_ACTIONS = Object.freeze(['GRANT_BONUS', 'HOLD', 'FLAG'])
export const LOYALTY_TIERS = Object.freeze(['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'])
const CONFIDENCE = Object.freeze(['low', 'medium', 'high'])

export function buildLoyaltyManagerPrompt({ caps }) {
  return [
    'You are the AI manager of the loyalty program for SYBNB, a short-term rental platform in Syria.',
    'You decide how to reward and protect loyalty members (both guests and hosts). You are in charge',
    'of discretionary bonuses and of flagging abuse — but the system enforces hard caps you cannot',
    'exceed, and points convert to wallet credit at a fixed rate you do not control.',
    '',
    'For the member whose facts are given, decide ONE action:',
    '- GRANT_BONUS: award extra points for genuine loyalty (consistent completed bookings, long',
    '  tenure, high lifetime value, recovery after a bad experience). Choose bonusPoints responsibly.',
    '- HOLD: do nothing now (nothing warrants a bonus, or the picture is unclear).',
    '- FLAG: mark a fraud/abuse concern (e.g. cancellations churn, self-dealing, impossible velocity).',
    '',
    'Rules:',
    '- Base everything strictly on the facts given. Never invent bookings, amounts or history.',
    `- bonusPoints must be between 0 and ${caps.perReview}. The system will clamp anything higher and`,
    `  will also refuse awards beyond ${caps.perDay} AI bonus points per member per day.`,
    '- Be conservative: when in doubt, HOLD. Reserve FLAG for concrete, fact-based concerns.',
    '- suggestTier is only a recognition hint; tier is otherwise earned by lifetime points.',
    '',
    'Respond with ONLY a single JSON object, exactly:',
    '{"action":"GRANT_BONUS|HOLD|FLAG","bonusPoints":0,"suggestTier":"BRONZE|SILVER|GOLD|PLATINUM|",',
    '"confidence":"low|medium|high","flags":["short concern", "..."],"summary":"one sentence"}',
  ].join('\n')
}

export function parseLoyaltyDecision(text, caps) {
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
  const action = String(obj.action || '').toUpperCase()
  const tier = String(obj.suggestTier || '').toUpperCase()
  const confidence = String(obj.confidence || '').toLowerCase()
  const n = Math.floor(Number(obj.bonusPoints) || 0)
  // Deterministic clamp — the model never sets the real ceiling.
  const bonusPoints = Math.max(0, Math.min(caps.perReview, Number.isFinite(n) ? n : 0))
  const flags = Array.isArray(obj.flags)
    ? obj.flags.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim().slice(0, 200)).slice(0, 6)
    : []
  const safeAction = LOYALTY_ACTIONS.includes(action) ? action : 'HOLD'
  return {
    action: safeAction,
    // A GRANT_BONUS with 0 points is effectively a HOLD.
    bonusPoints: safeAction === 'GRANT_BONUS' ? bonusPoints : 0,
    suggestTier: LOYALTY_TIERS.includes(tier) ? tier : null,
    confidence: CONFIDENCE.includes(confidence) ? confidence : 'low',
    flags,
    summary: typeof obj.summary === 'string' ? obj.summary.trim().slice(0, 400) : '',
  }
}

// Never throws. Returns:
//   { configured:false, model }                         — no API key
//   { configured:true, model, ok:false, error }         — call failed
//   { configured:true, model, ok:true, decision }       — the AI manager's decision (pre-clamped)
export async function runLoyaltyManager({ facts, caps, env = process.env, fetchImpl = globalThis.fetch, timeoutMs }) {
  const model = aiReviewModel(env)
  if (!aiReviewConfigured(env)) return { configured: false, model }
  const body = {
    model,
    max_tokens: LOYALTY_MANAGER_MAX_TOKENS,
    system: buildLoyaltyManagerPrompt({ caps }),
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: `Member facts (JSON):\n${JSON.stringify(facts, null, 2)}\n\nReturn only the JSON object.` }],
      },
    ],
  }
  const response = await callAnthropic({ apiKey: String(env.ANTHROPIC_API_KEY).trim(), body, fetchImpl, timeoutMs })
  if (!response.ok) return { configured: true, model, ok: false, error: response.error }
  const decision = parseLoyaltyDecision(replyText(response.data), caps)
  return { configured: true, model, ok: true, decision }
}
