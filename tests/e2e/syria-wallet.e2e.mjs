// SYBNB — Syria local-wallet CHARACTERIZATION test (governed). Locks the EXACT current inputs,
// outputs, statuses, errors, idempotency, verification hash, and financial amounts of the wallet
// module BEFORE and AFTER the Phase-4 move. It bundles through the import-path-stable barrel
// (src/engines/payments) so the same assertions hold across the relocation + compatibility shim.
//   node tests/e2e/syria-wallet.e2e.mjs
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const out = join(mkdtempSync(join(tmpdir(), 'sybnb-wallet-')), 'bundle.mjs')
execSync(`npx esbuild ${join(root, 'src/engines/payments/index.ts')} --bundle --format=esm --outfile=${out} --log-level=error`, { stdio: 'inherit' })
const w = await import(out)

let pass = 0, fail = 0
const eq = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (ok) { pass++; console.log(`   PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  -> got ${JSON.stringify(got)} want ${JSON.stringify(want)}`) } }

const inp = { bookingId: 'BK-2026-0042', userId: 'USR-1', amount: 10, transactionReference: 'slw-qr-2026-0001', senderName: 'Test Sender', senderPhone: '+963 998 191 422' }

console.log('=== CONSTANTS / PROVIDER IDENTITY ===')
eq('QR value constant', w.SYRIAN_LOCAL_WALLET_QR_VALUE, '40dbac039fd6e291915cdac5fbb733a0')
eq('recipient currency SYP', w.syrianLocalWalletRecipient.currency, 'SYP')

console.log('=== DETERMINISTIC DERIVATIONS (amounts/refs/hash) ===')
eq('idempotency key (booking:REF upper)', w.createWalletIdempotencyKey('BK-2026-0042', 'slw-qr-2026-0001'), 'BK-2026-0042:SLW-QR-2026-0001')
eq('QR payload (amount/currency/method preserved)', w.createSyrianLocalWalletQrPayload({ bookingId: 'BK-2026-0042', amount: 10, currency: 'syp', transactionReference: 'slw-qr-2026-0001' }),
  'SYBNB-V6-PAYMENT|BOOKING=BK-2026-0042|AMOUNT=10|CURRENCY=SYP|METHOD=SYRIAN_LOCAL_WALLET|WALLET=40dbac039fd6e291915cdac5fbb733a0|REFERENCE=SLW-QR-2026-0001')
eq('verification hash (FNV-1a, stable)', w.createWalletVerificationHash({ bookingId: 'BK-2026-0042', userId: 'USR-1', amount: 10, currency: 'SYP', transactionReference: 'slw-qr-2026-0001', senderName: 'Test Sender', senderPhone: '+963 998 191 422' }), 'f38f60cf')

console.log('=== SUBMISSION (status/currency/idempotency/method) ===')
const sub = w.createSyrianLocalWalletSubmission(inp)
eq('new submission status PENDING_REVIEW', sub.status, 'PENDING_REVIEW')
eq('currency forced SYP', sub.currency, 'SYP')
eq('method SYRIAN_LOCAL_WALLET', sub.paymentMethod, 'SYRIAN_LOCAL_WALLET')
eq('idempotency key on submission', sub.idempotencyKey, 'BK-2026-0042:SLW-QR-2026-0001')
eq('amount preserved (no reinterpretation)', sub.amount, 10)

console.log('=== VALIDATION ERRORS (exact codes) ===')
eq('duplicate reference detected', w.validateSyrianLocalWalletSubmission(inp, ['SLW-QR-2026-0001']).errors, ['duplicate_transaction_reference'])
eq('invalid amount', w.validateSyrianLocalWalletSubmission({ ...inp, amount: 0 }).errors, ['invalid_amount'])
eq('invalid reference pattern', w.validateSyrianLocalWalletSubmission({ ...inp, transactionReference: 'x' }).errors, ['invalid_transaction_reference'])
eq('invalid phone', w.validateSyrianLocalWalletSubmission({ ...inp, senderPhone: 'abc' }).errors, ['invalid_sender_phone'])
eq('missing proof -> warning only', w.validateSyrianLocalWalletSubmission(inp).warnings, ['proof_missing_manual_review_required'])

console.log('=== LIFECYCLE / APPROVAL SEMANTICS ===')
eq('approve pending -> APPROVED', w.approveSyrianLocalWalletPayment({ ...sub }).status, 'APPROVED')
eq('reject pending -> REJECTED', w.rejectSyrianLocalWalletPayment({ ...sub }, 'no').status, 'REJECTED')
eq('booking status map APPROVED->PAID', w.bookingPaymentStatusFromManualReview('APPROVED'), 'PAID')
eq('booking status map REJECTED->REJECTED', w.bookingPaymentStatusFromManualReview('REJECTED'), 'REJECTED')
eq('booking status map PENDING->PENDING_REVIEW', w.bookingPaymentStatusFromManualReview('PENDING_REVIEW'), 'PENDING_REVIEW')
let guard = ''
try { w.approveSyrianLocalWalletPayment({ ...sub, status: 'APPROVED' }) } catch (e) { guard = e.message }
eq('approve guard blocks non-pending', guard, 'Only pending payments can be approved')

console.log(`\n==== SYRIA WALLET CHARACTERIZATION: ${pass} passed, ${fail} failed ====`)
process.exit(fail ? 1 : 0)
