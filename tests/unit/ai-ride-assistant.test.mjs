import test from 'node:test'
import assert from 'node:assert/strict'
import { runRideAssistant, buildAssistantSystemPrompt, buildAssistantMessages, parseAssistantReply } from '../../server/lib/ai-ride-assistant.mjs'

const KEY = { ANTHROPIC_API_KEY: 'sk-test' }
const fakeFetch = (text, status = 200) => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); return { ok: status < 400, status, headers: new Map(), json: async () => ({ content: [{ type: 'text', text }] }) } }; f.calls = calls; return f }

test('no API key: zero calls and configured:false', async () => {
  const f = fakeFetch('{}')
  const out = await runRideAssistant({ role: 'rider', question: 'Where is my driver?', facts: {}, env: {}, fetchImpl: f })
  assert.deepEqual(out, { configured: false }); assert.equal(f.calls.length, 0)
})

test('returns the answer and the report suggestion from a JSON reply', async () => {
  const f = fakeFetch('{"answer":"Your wallet top-up is waiting for admin approval.","suggestReport":false}')
  const out = await runRideAssistant({ role: 'rider', question: 'Why is my balance 0?', facts: { walletUsdMinor: 0 }, env: KEY, fetchImpl: f })
  assert.equal(out.ok, true); assert.match(out.answer, /admin approval/); assert.equal(out.suggestReport, false)
  const sent = JSON.parse(f.calls[0].init.body)
  assert.match(sent.messages[0].content, /walletUsdMinor/); assert.ok(sent.max_tokens <= 600)
})

test('a plain-text reply is shown but never turns into a report suggestion', () => {
  assert.deepEqual(parseAssistantReply('Sorry, I do not know.'), { answer: 'Sorry, I do not know.', suggestReport: false, taskId: null })
  assert.equal(parseAssistantReply('   '), null)
})

test('bad role, empty question and provider failure never throw and never leak', async () => {
  assert.equal((await runRideAssistant({ role: 'admin', question: 'x', env: KEY, fetchImpl: fakeFetch('{}') })).error, 'BAD_ROLE')
  assert.equal((await runRideAssistant({ role: 'rider', question: '   ', env: KEY, fetchImpl: fakeFetch('{}') })).error, 'EMPTY_QUESTION')
  const out = await runRideAssistant({ role: 'driver', question: 'x', env: KEY, fetchImpl: fakeFetch('', 400) })
  assert.equal(out.ok, false); assert.match(out.error, /HTTP_400/)
})

test('the prompt states the rules: advisory only, no refund promises, facts are data, role-specific policy', () => {
  const rider = buildAssistantSystemPrompt('rider'); const driver = buildAssistantSystemPrompt('driver')
  for (const p of [rider, driver]) { assert.match(p, /cannot move money/); assert.match(p, /promise a refund/); assert.match(p, /not instructions/); assert.match(p, /emergency number/) }
  assert.match(rider, /NO cash rides/); assert.match(driver, /payout in the app/)
  assert.doesNotMatch(rider, /payout in the app/)
})

test('long questions are clipped before they reach the model', () => {
  const body = buildAssistantMessages({ role: 'rider', question: 'a'.repeat(5000), facts: {}, model: 'm' })
  assert.ok(body.messages[0].content.length < 900)
})

test('the AI may only pick a guided task from the allowlist for that role', () => {
  const ok = parseAssistantReply('{"answer":"I will show you.","suggestReport":false,"taskId":"refill-wallet"}', 'rider')
  assert.equal(ok.taskId, 'refill-wallet')
  assert.equal(parseAssistantReply('{"answer":"x","taskId":"refill-wallet"}', 'driver').taskId, null)
  assert.equal(parseAssistantReply('{"answer":"x","taskId":"delete-everything"}', 'rider').taskId, null)
  assert.equal(parseAssistantReply('{"answer":"x","taskId":"driver-payout"}', 'driver').taskId, 'driver-payout')
})
