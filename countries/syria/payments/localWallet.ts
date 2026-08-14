import type { Lang } from '../../../src/engines/language/languageEngine'

export const SYRIAN_LOCAL_WALLET_QR_VALUE = '40dbac039fd6e291915cdac5fbb733a0'

export const SYRIAN_LOCAL_WALLET_QR_NUMBER = SYRIAN_LOCAL_WALLET_QR_VALUE

export const SYRIAN_LOCAL_WALLET_QR_ASSET = '/assets/payments/syrian-local-wallet-qr-clean.jpg'

export type ManualPaymentStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED'

export type ManualPaymentMethod = 'SYRIAN_LOCAL_WALLET'

export type SyrianLocalWalletSubmission = {
  bookingId: string
  userId: string
  paymentMethod: ManualPaymentMethod
  amount: number
  currency: 'SYP'
  transactionReference: string
  senderName: string
  senderPhone: string
  proofUrl?: string
  status: ManualPaymentStatus
  createdAt: string
  adminNote?: string
  idempotencyKey: string
  verificationHash: string
  riskFlags: string[]
}

export type WalletSecurityResult = {
  ok: boolean
  errors: string[]
  warnings: string[]
}

const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{5,63}$/
const PHONE_PATTERN = /^\+?[0-9][0-9\s-]{7,18}$/
const SAFE_TEXT_PATTERN = /^[\p{L}\p{N}\s._@+\-:/()]+$/u

export const syrianLocalWalletRecipient = {
  name: {
    ar: 'ناظم كرمان',
    en: 'Nazem Karman',
    fr: 'Nazem Karman',
  },
  maskedAccount: '•••• 3188',
  currency: 'SYP',
}

export const syrianLocalWalletInstructions: Record<Lang | 'fr', string> = {
  ar: 'امسح رمز QR باستخدام تطبيق المحفظة المحلية، أكمل التحويل، ثم أدخل رقم العملية أو أرفق إثبات الدفع.',
  en: 'Scan the QR code with your local wallet app, complete the transfer, then upload or enter the transaction reference.',
  fr: 'Scannez le code QR avec votre application de portefeuille local, complétez le transfert, puis téléversez ou entrez la référence de transaction.',
}

export const mockSyrianLocalWalletSubmission: SyrianLocalWalletSubmission = {
  bookingId: 'BK-2026-0042',
  userId: 'USR-LOCAL-WALLET-001',
  paymentMethod: 'SYRIAN_LOCAL_WALLET',
  amount: 10,
  currency: 'SYP',
  transactionReference: 'SLW-QR-2026-0001',
  senderName: 'محمد معاذ المشهور',
  senderPhone: '+963 998 191 422',
  proofUrl: SYRIAN_LOCAL_WALLET_QR_ASSET,
  status: 'PENDING_REVIEW',
  createdAt: '2026-07-01T12:00:00.000Z',
  idempotencyKey: 'BK-2026-0042:SLW-QR-2026-0001',
  verificationHash: '5d83c7a96f',
  riskFlags: [],
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

export function createWalletIdempotencyKey(bookingId: string, transactionReference: string) {
  return `${normalizeText(bookingId)}:${normalizeText(transactionReference).toUpperCase()}`
}

export function createSyrianLocalWalletQrPayload(input: {
  bookingId: string
  amount: number
  currency: string
  transactionReference: string
}) {
  return [
    'SYBNB-V6-PAYMENT',
    `BOOKING=${normalizeText(input.bookingId)}`,
    `AMOUNT=${Math.max(Number(input.amount || 0), 0).toFixed(0)}`,
    `CURRENCY=${normalizeText(input.currency || 'SYP').toUpperCase()}`,
    `METHOD=SYRIAN_LOCAL_WALLET`,
    `WALLET=${SYRIAN_LOCAL_WALLET_QR_NUMBER}`,
    `REFERENCE=${normalizeText(input.transactionReference).toUpperCase()}`,
  ].join('|')
}

export function createWalletVerificationHash(
  input: Pick<
    SyrianLocalWalletSubmission,
    'bookingId' | 'userId' | 'amount' | 'currency' | 'transactionReference' | 'senderName' | 'senderPhone'
  >,
) {
  const payload = [
    input.bookingId,
    input.userId,
    input.amount.toFixed(2),
    input.currency,
    normalizeText(input.transactionReference).toUpperCase(),
    normalizeText(input.senderName),
    normalizeText(input.senderPhone),
    SYRIAN_LOCAL_WALLET_QR_VALUE,
  ].join('|')

  let hash = 0x811c9dc5
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function validateSyrianLocalWalletSubmission(
  input: Pick<
    SyrianLocalWalletSubmission,
    'bookingId' | 'userId' | 'amount' | 'transactionReference' | 'senderName' | 'senderPhone'
  > &
    Partial<Pick<SyrianLocalWalletSubmission, 'proofUrl'>>,
  existingReferences: string[] = [],
): WalletSecurityResult {
  const errors: string[] = []
  const warnings: string[] = []
  const normalizedReference = normalizeText(input.transactionReference)
  const normalizedName = normalizeText(input.senderName)
  const normalizedPhone = normalizeText(input.senderPhone)

  if (!input.bookingId || !input.userId) errors.push('missing_booking_or_user')
  if (!Number.isFinite(input.amount) || input.amount <= 0) errors.push('invalid_amount')
  if (!REFERENCE_PATTERN.test(normalizedReference)) errors.push('invalid_transaction_reference')
  if (!normalizedName || normalizedName.length < 3 || !SAFE_TEXT_PATTERN.test(normalizedName)) errors.push('invalid_sender_name')
  if (!PHONE_PATTERN.test(normalizedPhone)) errors.push('invalid_sender_phone')
  if (input.proofUrl && !SAFE_TEXT_PATTERN.test(input.proofUrl)) errors.push('invalid_proof_reference')
  if (existingReferences.map((item) => item.toUpperCase()).includes(normalizedReference.toUpperCase())) {
    errors.push('duplicate_transaction_reference')
  }
  if (!input.proofUrl) warnings.push('proof_missing_manual_review_required')

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  }
}

export function createSyrianLocalWalletSubmission(
  input: Pick<
    SyrianLocalWalletSubmission,
    'bookingId' | 'userId' | 'amount' | 'transactionReference' | 'senderName' | 'senderPhone'
  > &
    Partial<Pick<SyrianLocalWalletSubmission, 'proofUrl' | 'adminNote'>>,
  existingReferences: string[] = [],
): SyrianLocalWalletSubmission {
  const validation = validateSyrianLocalWalletSubmission(input, existingReferences)
  if (!validation.ok) {
    throw new Error(`Invalid Syrian local wallet payment: ${validation.errors.join(',')}`)
  }
  const normalized = {
    ...input,
    transactionReference: normalizeText(input.transactionReference),
    senderName: normalizeText(input.senderName),
    senderPhone: normalizeText(input.senderPhone),
  }
  const base = {
    ...normalized,
    paymentMethod: 'SYRIAN_LOCAL_WALLET' as const,
    currency: 'SYP' as const,
    proofUrl: input.proofUrl,
    status: 'PENDING_REVIEW' as const,
    createdAt: new Date().toISOString(),
    idempotencyKey: createWalletIdempotencyKey(input.bookingId, input.transactionReference),
    riskFlags: validation.warnings,
  }
  return {
    ...base,
    verificationHash: createWalletVerificationHash(base),
  }
}

export function approveSyrianLocalWalletPayment(
  submission: SyrianLocalWalletSubmission,
  adminNote?: string,
): SyrianLocalWalletSubmission {
  if (submission.status !== 'PENDING_REVIEW') {
    throw new Error('Only pending payments can be approved')
  }
  return {
    ...submission,
    status: 'APPROVED',
    adminNote,
  }
}

export function rejectSyrianLocalWalletPayment(
  submission: SyrianLocalWalletSubmission,
  adminNote: string,
): SyrianLocalWalletSubmission {
  if (submission.status !== 'PENDING_REVIEW') {
    throw new Error('Only pending payments can be rejected')
  }
  return {
    ...submission,
    status: 'REJECTED',
    adminNote,
  }
}

export function bookingPaymentStatusFromManualReview(status: ManualPaymentStatus) {
  if (status === 'APPROVED') return 'PAID'
  if (status === 'REJECTED') return 'REJECTED'
  return 'PENDING_REVIEW'
}
