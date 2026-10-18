import test from 'node:test'
import assert from 'node:assert/strict'
import { parseFromAddress, sendEmail, emailProviderStatus } from '../../server/lib/email.mjs'

test('parseFromAddress handles named and bare senders', () => {
  assert.deepEqual(parseFromAddress('SYBNB <no-reply@notifications.sybnb.app>'), { name: 'SYBNB', email: 'no-reply@notifications.sybnb.app' })
  assert.deepEqual(parseFromAddress('no-reply@x.app'), { email: 'no-reply@x.app' })
})

test('brevo provider is unconfigured without key and throws 503', async () => {
  const prev = { ...process.env }
  process.env.EMAIL_PROVIDER = 'brevo'
  delete process.env.BREVO_API_KEY
  process.env.EMAIL_FROM = 'a@b.app'
  assert.equal(emailProviderStatus().configured, false)
  await assert.rejects(() => sendEmail({ to: 'x@y.com', subject: 's', text: 't' }), (e) => e.code === 'EMAIL_PROVIDER_NOT_CONFIGURED' || e.code === 'EMAIL_SUPPRESSED' || /prisma|database/i.test(String(e.message)))
  Object.assign(process.env, prev)
})
