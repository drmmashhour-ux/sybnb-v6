// SYBNB — SMS provider integration E2E (governed evidence artifact)
//
// Certifies the REAL SMS 'http' provider adapter (server/lib/sms.mjs) against a local mock provider
// endpoint — proving that when a production SMS provider is configured, sendSms delivers the OTP to
// the provider with the right auth + payload, and fails closed when unconfigured. No real SMS, no
// real provider account. Run: node tests/e2e/sms-integration.e2e.mjs

import { createServer } from 'node:http'

let pass = 0, fail = 0
function check(label, cond, detail) { if (cond) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> ${detail}`) } }
async function expectThrow(label, fn, expectedCode) {
  try { await fn(); check(label, false, 'did not throw') } catch (e) { check(label, e?.code === expectedCode, `threw ${e?.code}`) }
}

const received = []
const mock = createServer((req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
    let body = {}; try { body = JSON.parse(Buffer.concat(chunks)) } catch {}
    received.push({ auth: req.headers['authorization'], body })
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: 'provider-msg-123' }))
  })
})
await new Promise((r) => mock.listen(0, '127.0.0.1', r))
const port = mock.address().port

console.log('=== FAIL CLOSED WHEN UNCONFIGURED ===')
process.env.SMS_PROVIDER = 'http'
delete process.env.SMS_HTTP_ENDPOINT
delete process.env.SMS_API_KEY
const sms = await import('../../server/lib/sms.mjs')
check('http provider reports not-configured', sms.smsProviderStatus().configured === false, JSON.stringify(sms.smsProviderStatus()))
await expectThrow('sendSms fails closed without endpoint/key (SMS_PROVIDER_NOT_CONFIGURED)', () => sms.sendSms({ to: '+963900000000', body: 'x', purpose: 'account-verify' }), 'SMS_PROVIDER_NOT_CONFIGURED')

console.log('\n=== CONFIGURED: DELIVERS TO PROVIDER WITH AUTH + PAYLOAD ===')
process.env.SMS_HTTP_ENDPOINT = `http://127.0.0.1:${port}`
process.env.SMS_API_KEY = 'sk_sms_sandbox'
process.env.SMS_SENDER_ID = 'SYBNB'
check('http provider now reports configured', sms.smsProviderStatus().configured === true, JSON.stringify(sms.smsProviderStatus()))
const result = await sms.sendSms({ to: '+963900111222', body: 'SYBNB verification code: 123456', purpose: 'account-verify' })
check('sendSms returns delivered + provider messageId', result.delivered === true && result.provider === 'http' && result.messageId === 'provider-msg-123', JSON.stringify(result))
check('provider received Bearer auth', received[0]?.auth === 'Bearer sk_sms_sandbox', received[0]?.auth)
check('provider received to + purpose + sender (delivery payload)', received[0]?.body?.to === '+963900111222' && received[0]?.body?.purpose === 'account-verify' && received[0]?.body?.sender === 'SYBNB', JSON.stringify(received[0]?.body))

console.log('\n=== SANDBOX PROVIDER SENDS NOTHING (default) ===')
process.env.SMS_PROVIDER = 'sandbox'
const before = received.length
const sandbox = await sms.sendSms({ to: '+963900333444', body: 'code 654321', purpose: 'account-verify' })
check('sandbox returns synthetic delivery, no external call', sandbox.provider === 'sandbox' && received.length === before, JSON.stringify(sandbox))

mock.close()
console.log(`\n==== SMS INTEGRATION E2E: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
