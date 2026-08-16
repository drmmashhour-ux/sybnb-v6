// SYBNB — production email verification via our real email adapter. Prints NO secret.
import { sendEmail, emailProviderStatus } from '../server/lib/email.mjs'
console.log('  provider status:', JSON.stringify(emailProviderStatus()))
try {
  const r = await sendEmail({
    to: 'info@sybnb.app',
    subject: 'SYBNB — production email verification',
    text: 'Controlled production-path email test through SYBNB. If this arrived in info@sybnb.app, Resend production delivery is working. No action needed.',
    purpose: 'verification',
  })
  console.log('  send:', JSON.stringify({ provider: r.provider, delivered: r.delivered, messageId: r.messageId ? 'present' : 'none' }))
  console.log(r.delivered ? 'RESEND SEND: ACCEPTED (confirm inbox/dashboard for delivered)' : 'RESEND SEND: NOT DELIVERED')
  process.exit(r.delivered ? 0 : 1)
} catch (e) {
  console.log('  FAIL:', e instanceof Error ? e.message : String(e))
  process.exit(1)
}
