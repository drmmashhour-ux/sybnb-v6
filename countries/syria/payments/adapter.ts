// SYBNB — Syria manual-payment ADAPTER. Implements the country-neutral ManualPaymentAdapter contract
// by delegating to the Syria local-wallet module. No behavior change: it wires existing functions to
// the neutral surface so master can resolve Syria explicitly (never import it implicitly).
import type { ManualPaymentAdapter } from '../../../src/engines/payments/manualPaymentAdapter'
import {
  syrianLocalWalletRecipient,
  syrianLocalWalletInstructions,
  createWalletIdempotencyKey,
  createSyrianLocalWalletQrPayload,
  createWalletVerificationHash,
  validateSyrianLocalWalletSubmission,
  createSyrianLocalWalletSubmission,
  approveSyrianLocalWalletPayment,
  rejectSyrianLocalWalletPayment,
  bookingPaymentStatusFromManualReview,
} from './localWallet'

export const syriaManualPaymentAdapter: ManualPaymentAdapter = {
  key: 'syria',
  recipient: syrianLocalWalletRecipient,
  instructions: syrianLocalWalletInstructions,
  createIdempotencyKey: createWalletIdempotencyKey,
  createQrPayload: createSyrianLocalWalletQrPayload,
  createVerificationHash: (input) => createWalletVerificationHash(input as any),
  validate: (input, existingReferences) => validateSyrianLocalWalletSubmission(input as any, existingReferences),
  createSubmission: (input, existingReferences) => createSyrianLocalWalletSubmission(input as any, existingReferences),
  approve: (submission, adminNote) => approveSyrianLocalWalletPayment(submission as any, adminNote),
  reject: (submission, adminNote) => rejectSyrianLocalWalletPayment(submission as any, adminNote),
  bookingStatusFromReview: bookingPaymentStatusFromManualReview,
}
