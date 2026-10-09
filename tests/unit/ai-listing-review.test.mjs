// Unit tests for the AI listing pre-check (server/lib/ai-listing-review.mjs) -- owner decision of
// 2026-10-09. No database, no network: the Anthropic API is a fake `fetchImpl`.
// Run: node --test tests/unit/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AI_REVIEW_CHECK_KEYS,
  AI_REVIEW_MAX_IMAGE_BYTES,
  AI_REVIEW_MAX_PHOTOS,
  ANTHROPIC_MESSAGES_URL,
  ANTHROPIC_VERSION,
  DEFAULT_AI_REVIEW_MODEL,
  aiReviewModel,
  buildMessagesRequest,
  callAnthropic,
  extractJsonObject,
  imageFromBytes,
  parseMediaRef,
  parseReviewReply,
  runAiListingReview,
  sniffImageType,
} from '../../server/lib/ai-listing-review.mjs'
import { approvalActivationDecision } from '../../server/lib/host-activation-issue.mjs'

const NOW = () => new Date('2026-10-09T10:00:00.000Z')
const KEY_ENV = { ANTHROPIC_API_KEY: 'sk-test-not-real' }
const noSleep = async () => {}

const validReply = () => ({
  score: 82,
  recommendation: 'NEEDS_FIXES',
  checks: Object.fromEntries(AI_REVIEW_CHECK_KEYS.map((k) => [k, { ok: k !== 'noContactInfoInPhotosOrText', note: `note ${k}` }])),
  issuesForHost: ['أزل رقم الهاتف من الصورة الثانية.'],
  summaryForAdmin: 'Good apartment; a phone number is visible in photo 2.',
})

const listing = {
  id: 'L1',
  division: 'STAYS',
  titleAr: 'شقة مفروشة في المالكي',
  titleEn: 'Furnished flat in Malki',
  description: 'Two bedrooms, close to the park.',
  priceMinor: 500000,
  currency: 'SYP',
  location: { governorate: 'Damascus', city: 'Damascus', area: 'Malki' },
  metadata: { address: 'Shafik Jabri St 12', lat: 33.52, lng: 36.28, bedrooms: 2, bathrooms: 1, propertyType: 'apartment' },
}

function apiResponse(status, body, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h) => headers[h.toLowerCase()] ?? null },
    json: async () => body,
  }
}
const okMessage = (text, extra = {}) => apiResponse(200, { model: 'claude-sonnet-5-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', ...extra })

// ---- reply parsing -----------------------------------------------------------------------------

test('extractJsonObject: plain, fenced ```json, prose around it, braces inside strings', () => {
  const obj = JSON.stringify(validReply())
  assert.equal(extractJsonObject(obj), obj)
  assert.equal(extractJsonObject('```json\n' + obj + '\n```'), obj)
  assert.equal(extractJsonObject('Here is my review:\n' + obj + '\nThanks!'), obj)
  const tricky = '{"a": "x } y { z", "b": {"c": 1}}'
  assert.equal(extractJsonObject('noise ' + tricky + ' {"second": 2}'), tricky)
  assert.equal(extractJsonObject('{"q": "he said \\"}\\" ok"}'), '{"q": "he said \\"}\\" ok"}')
  // a broken first block is skipped, the next valid one wins
  assert.equal(extractJsonObject('{not json} then {"ok": true}'), '{"ok": true}')
})

test('extractJsonObject: nothing usable -> null', () => {
  assert.equal(extractJsonObject(''), null)
  assert.equal(extractJsonObject('no json here'), null)
  assert.equal(extractJsonObject('{"truncated": "never closed'), null)
  assert.equal(extractJsonObject(undefined), null)
})

test('parseReviewReply: valid reply is normalized', () => {
  const r = parseReviewReply('```json\n' + JSON.stringify({ ...validReply(), score: '77.6', recommendation: 'approve' }) + '\n```')
  assert.equal(r.ok, true)
  assert.equal(r.result.score, 78)
  assert.equal(r.result.recommendation, 'APPROVE')
  assert.deepEqual(Object.keys(r.result.checks), [...AI_REVIEW_CHECK_KEYS])
  assert.equal(r.result.checks.noContactInfoInPhotosOrText.ok, false)
})

test('parseReviewReply: malformed / missing / invalid fields -> reason', () => {
  assert.deepEqual(parseReviewReply('I cannot help with that.'), { ok: false, reason: 'NO_JSON_OBJECT' })
  const without = (field) => {
    const v = validReply()
    delete v[field]
    return JSON.stringify(v)
  }
  assert.equal(parseReviewReply(without('score')).reason, 'INVALID_FIELD:score')
  assert.equal(parseReviewReply(without('recommendation')).reason, 'INVALID_FIELD:recommendation')
  assert.equal(parseReviewReply(without('checks')).reason, 'MISSING_FIELD:checks')
  assert.equal(parseReviewReply(without('issuesForHost')).reason, 'MISSING_FIELD:issuesForHost')
  assert.equal(parseReviewReply(without('summaryForAdmin')).reason, 'MISSING_FIELD:summaryForAdmin')
  const v = validReply()
  delete v.checks.priceReasonable
  assert.equal(parseReviewReply(JSON.stringify(v)).reason, 'MISSING_FIELD:checks.priceReasonable')
  assert.equal(parseReviewReply(JSON.stringify({ ...validReply(), score: 140 })).reason, 'INVALID_FIELD:score')
  assert.equal(parseReviewReply(JSON.stringify({ ...validReply(), recommendation: 'AUTO_APPROVE' })).reason, 'INVALID_FIELD:recommendation')
  assert.equal(parseReviewReply('[1,2,3]').reason, 'NO_JSON_OBJECT')
})

// ---- prompt ------------------------------------------------------------------------------------

test('prompt builder: includes every listing field, the role and the never-decide rule', () => {
  const body = buildMessagesRequest({ listing, images: [], model: 'm', countryName: 'Syria', currency: 'SYP' })
  assert.equal(body.model, 'm')
  assert.equal(body.max_tokens, 1200)
  assert.match(body.system, /assistant to a HUMAN reviewer/)
  assert.match(body.system, /Syria short-stay rental platform/)
  assert.match(body.system, /quoted in SYP/)
  assert.match(body.system, /NEVER approve or reject/)
  assert.match(body.system, /UNTRUSTED/)
  for (const key of AI_REVIEW_CHECK_KEYS) assert.ok(body.system.includes(`"${key}"`), key)
  const text = body.messages[0].content.at(-1).text
  for (const needle of ['شقة مفروشة في المالكي', 'Furnished flat in Malki', 'Two bedrooms, close to the park.', '500000 SYP (per night)', 'STAYS', 'Damascus', 'Malki', 'Shafik Jabri St 12', '33.52, 36.28', 'Bedrooms: 2', 'apartment']) {
    assert.ok(text.includes(needle), `missing ${needle}`)
  }
  assert.match(text, /No photos could be attached/)
})

test('prompt builder: caps photos at 6, base64 and url blocks, before the text block', () => {
  const images = Array.from({ length: 9 }, (_, i) => (i % 2 ? { url: `https://cdn.example/p${i}.jpg` } : { mediaType: 'image/jpeg', base64: `QUJD${i}` }))
  const body = buildMessagesRequest({ listing, images, countryName: 'Syria', currency: 'SYP' })
  const content = body.messages[0].content
  const imgs = content.filter((b) => b.type === 'image')
  assert.equal(imgs.length, AI_REVIEW_MAX_PHOTOS)
  assert.deepEqual(imgs[0], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD0' } })
  assert.deepEqual(imgs[1], { type: 'image', source: { type: 'url', url: 'https://cdn.example/p1.jpg' } })
  assert.equal(content.at(-1).type, 'text')
  assert.match(content.at(-1).text, /6 listing photo\(s\) are attached/)
})

test('missing listing fields are stated as not provided, USD minor units become major', () => {
  const body = buildMessagesRequest({ listing: { id: 'x', division: 'STAYS', titleAr: 'عنوان', priceMinor: 4500, currency: 'USD', metadata: {} } })
  const text = body.messages[0].content.at(-1).text
  assert.match(text, /Street address: \(not provided\)/)
  assert.match(text, /Coordinates \(lat, lng\): \(not provided\)/)
  assert.match(text, /45 USD \(per night\)/)
})

test('model from env, default claude-sonnet-5-5', () => {
  assert.equal(aiReviewModel({}), DEFAULT_AI_REVIEW_MODEL)
  assert.equal(DEFAULT_AI_REVIEW_MODEL, 'claude-sonnet-5-5')
  assert.equal(aiReviewModel({ AI_REVIEW_MODEL: ' claude-x ' }), 'claude-x')
})

// ---- media -------------------------------------------------------------------------------------

test('parseMediaRef: private refs allowed only for listing/payment-proof buckets; https passes as url', () => {
  const key = '0f8fad5b-d9cb-469f-a165-70867728950e.jpg'
  assert.deepEqual(parseMediaRef(`payment-proof://${key}`), { kind: 'private', bucket: 'payment-proof', key })
  assert.deepEqual(parseMediaRef(`listing-media://${key}`), { kind: 'private', bucket: 'listing-media', key })
  assert.deepEqual(parseMediaRef(`/api/storage/payment-proof/${key}?exp=1&sig=x`), { kind: 'private', bucket: 'payment-proof', key })
  assert.equal(parseMediaRef(`kyc://${key}`), null, 'identity documents are never read')
  assert.equal(parseMediaRef(`/api/storage/kyc/${key}?exp=1&sig=x`), null)
  assert.equal(parseMediaRef('payment-proof://../../etc/passwd'), null)
  assert.deepEqual(parseMediaRef('https://images.example.com/a.jpg'), { kind: 'public', url: 'https://images.example.com/a.jpg' })
  assert.equal(parseMediaRef('http://insecure.example.com/a.jpg'), null)
  assert.equal(parseMediaRef('session://fake'), null)
  assert.equal(parseMediaRef(''), null)
})

test('images: magic-byte sniff, size cap, unsupported types skipped', () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)])
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)])
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)])
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(20)])
  assert.equal(sniffImageType(jpeg), 'image/jpeg')
  assert.equal(sniffImageType(png), 'image/png')
  assert.equal(sniffImageType(webp), 'image/webp')
  assert.equal(sniffImageType(pdf), null)
  assert.equal(imageFromBytes(jpeg).image.mediaType, 'image/jpeg')
  assert.equal(imageFromBytes(jpeg).image.base64, jpeg.toString('base64'))
  assert.equal(imageFromBytes(pdf).skip, 'UNSUPPORTED_TYPE')
  assert.equal(imageFromBytes(Buffer.alloc(0)).skip, 'EMPTY')
  const big = Buffer.alloc(Math.ceil(AI_REVIEW_MAX_IMAGE_BYTES) + 1)
  big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff
  assert.equal(imageFromBytes(big).skip, 'TOO_LARGE')
  assert.equal(imageFromBytes(jpeg, { totalBase64SoFar: 24 * 1024 * 1024 }).skip, 'REQUEST_SIZE_CAP')
})

// ---- HTTP + full run with a fake fetch -----------------------------------------------------------

test('no API key -> SKIPPED (NO_API_KEY), nothing is sent', async () => {
  let calls = 0
  const out = await runAiListingReview({ listing, env: {}, fetchImpl: async () => { calls++ }, now: NOW })
  assert.deepEqual(out, { status: 'SKIPPED', reason: 'NO_API_KEY', model: DEFAULT_AI_REVIEW_MODEL, at: '2026-10-09T10:00:00.000Z' })
  assert.equal(calls, 0)
})

test('success: correct endpoint + headers, DONE with the validated result', async () => {
  const seen = []
  const fetchImpl = async (url, init) => {
    seen.push({ url, init })
    return okMessage('Sure!\n```json\n' + JSON.stringify(validReply()) + '\n```')
  }
  const images = [{ mediaType: 'image/png', base64: 'iVBOR' }]
  const out = await runAiListingReview({ listing, images, env: { ...KEY_ENV, AI_REVIEW_MODEL: 'claude-sonnet-5-5' }, fetchImpl, now: NOW, sleep: noSleep, countryName: 'Syria', currency: 'SYP' })
  assert.equal(out.status, 'DONE')
  assert.equal(out.result.recommendation, 'NEEDS_FIXES')
  assert.equal(out.result.score, 82)
  assert.equal(out.photosSent, 1)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].url, ANTHROPIC_MESSAGES_URL)
  assert.equal(seen[0].init.method, 'POST')
  assert.equal(seen[0].init.headers['x-api-key'], 'sk-test-not-real')
  assert.equal(seen[0].init.headers['anthropic-version'], ANTHROPIC_VERSION)
  assert.equal(seen[0].init.headers['content-type'], 'application/json')
  assert.ok(seen[0].init.signal, 'AbortController signal attached')
  const sent = JSON.parse(seen[0].init.body)
  assert.equal(sent.model, 'claude-sonnet-5-5')
  assert.equal(sent.messages[0].content[0].source.data, 'iVBOR')
  assert.ok(!JSON.stringify(out).includes('sk-test'), 'the key never ends up in the stored record')
})

test('429 then success -> one retry, DONE', async () => {
  let calls = 0
  const sleeps = []
  const fetchImpl = async () => {
    calls++
    return calls === 1 ? apiResponse(429, { error: { type: 'rate_limit_error' } }, { 'retry-after': '2' }) : okMessage(JSON.stringify(validReply()))
  }
  const out = await runAiListingReview({ listing, env: KEY_ENV, fetchImpl, now: NOW, sleep: async (ms) => sleeps.push(ms) })
  assert.equal(out.status, 'DONE')
  assert.equal(calls, 2)
  assert.deepEqual(sleeps, [2000])
})

test('5xx twice -> FAILED HTTP_529 after exactly one retry', async () => {
  let calls = 0
  const out = await runAiListingReview({ listing, env: KEY_ENV, fetchImpl: async () => { calls++; return apiResponse(529, {}) }, now: NOW, sleep: noSleep })
  assert.equal(out.status, 'FAILED')
  assert.equal(out.error, 'HTTP_529')
  assert.equal(calls, 2)
})

test('400 is not retried -> FAILED with the error type', async () => {
  let calls = 0
  const out = await runAiListingReview({ listing, env: KEY_ENV, fetchImpl: async () => { calls++; return apiResponse(400, { error: { type: 'invalid_request_error' } }) }, now: NOW, sleep: noSleep })
  assert.equal(out.status, 'FAILED')
  assert.equal(out.error, 'HTTP_400:invalid_request_error')
  assert.equal(calls, 1)
})

test('timeout -> FAILED TIMEOUT (AbortController fires)', async () => {
  const fetchImpl = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const e = new Error('aborted')
        e.name = 'AbortError'
        reject(e)
      })
    })
  const started = Date.now()
  const out = await runAiListingReview({ listing, env: KEY_ENV, fetchImpl, now: NOW, sleep: noSleep, timeoutMs: 30 })
  assert.equal(out.status, 'FAILED')
  assert.equal(out.error, 'TIMEOUT')
  assert.ok(Date.now() - started < 2000)
})

test('unparseable / incomplete model reply -> FAILED with reason (truncation flagged)', async () => {
  const bad = await runAiListingReview({ listing, env: KEY_ENV, fetchImpl: async () => okMessage('I think it looks fine.'), now: NOW, sleep: noSleep })
  assert.equal(bad.status, 'FAILED')
  assert.equal(bad.error, 'UNPARSEABLE_REPLY:NO_JSON_OBJECT')
  const partial = { ...validReply() }
  delete partial.summaryForAdmin
  const missing = await runAiListingReview({ listing, env: KEY_ENV, fetchImpl: async () => okMessage(JSON.stringify(partial)), now: NOW, sleep: noSleep })
  assert.equal(missing.error, 'UNPARSEABLE_REPLY:MISSING_FIELD:summaryForAdmin')
  const cut = await runAiListingReview({ listing, env: KEY_ENV, fetchImpl: async () => okMessage('{"score": 80, "checks": {', { stop_reason: 'max_tokens' }), now: NOW, sleep: noSleep })
  assert.equal(cut.error, 'UNPARSEABLE_REPLY:NO_JSON_OBJECT:TRUNCATED')
})

test('network error is retried once, then FAILED NETWORK_ERROR; callAnthropic never throws', async () => {
  let calls = 0
  const r = await callAnthropic({ apiKey: 'k', body: {}, fetchImpl: async () => { calls++; throw new TypeError('fetch failed') }, sleep: noSleep })
  assert.deepEqual(r, { ok: false, error: 'NETWORK_ERROR' })
  assert.equal(calls, 2)
})

// ---- approval -> activation code decision ---------------------------------------------------------

test('approval issues a code only for an ACTIVE, unverified owner of a stay without a live code', () => {
  const stay = { id: 'L', division: 'STAYS' }
  const owner = { status: 'ACTIVE', hostVerifiedAt: null, email: 'h@example.test' }
  const now = new Date('2026-10-09T10:00:00Z')
  assert.deepEqual(approvalActivationDecision({ listing: stay, owner, latestCode: null, now }), { issue: true })
  assert.equal(approvalActivationDecision({ listing: stay, owner: { ...owner, hostVerifiedAt: now }, now }).reason, 'ALREADY_VERIFIED')
  assert.equal(approvalActivationDecision({ listing: { division: 'CARS' }, owner, now }).reason, 'DIVISION_NOT_GATED')
  assert.equal(approvalActivationDecision({ listing: stay, owner: { ...owner, status: 'SUSPENDED' }, now }).reason, 'ACCOUNT_NOT_ACTIVE')
  assert.equal(approvalActivationDecision({ listing: stay, owner: null, now }).reason, 'OWNER_NOT_FOUND')
  const live = { usedAt: null, attempts: 0, expiresAt: new Date('2026-10-12T00:00:00Z') }
  assert.equal(approvalActivationDecision({ listing: stay, owner, latestCode: live, now }).reason, 'ACTIVE_CODE_EXISTS')
  // an expired or locked code is replaced
  assert.equal(approvalActivationDecision({ listing: stay, owner, latestCode: { ...live, expiresAt: new Date('2026-10-01T00:00:00Z') }, now }).issue, true)
  assert.equal(approvalActivationDecision({ listing: stay, owner, latestCode: { ...live, attempts: 5 }, now }).issue, true)
})
