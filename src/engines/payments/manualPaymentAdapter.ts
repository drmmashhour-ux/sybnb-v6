// Country-neutral MANUAL PAYMENT ADAPTER contract + resolver (MASTER).
//
// The master platform does not import any country's manual-payment implementation directly. It
// resolves one EXPLICITLY by the active country. Unknown/missing/unsupported country → fail closed
// (throws), never a silent default. Adding a country = register its adapter here + ship it under
// countries/<country>/payments. No country inherits another's provider, currency, or lifecycle.

export type ManualPaymentStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED'

export type WalletSecurityResult = { ok: boolean; errors: string[]; warnings: string[] }

// The capability surface a country's manual-payment adapter must provide. Types mirror the existing
// behavior exactly (no reinterpretation of currency/amount/reference/lifecycle).
export interface ManualPaymentAdapter {
  key: string
  recipient: { name: Record<string, string>; maskedAccount: string; currency: string }
  instructions: Record<string, string>
  createIdempotencyKey(bookingId: string, transactionReference: string): string
  createQrPayload(input: { bookingId: string; amount: number; currency: string; transactionReference: string }): string
  createVerificationHash(input: Record<string, unknown>): string
  validate(input: Record<string, unknown>, existingReferences?: string[]): WalletSecurityResult
  createSubmission(input: Record<string, unknown>, existingReferences?: string[]): Record<string, unknown>
  approve(submission: Record<string, unknown>, adminNote?: string): Record<string, unknown>
  reject(submission: Record<string, unknown>, adminNote: string): Record<string, unknown>
  bookingStatusFromReview(status: ManualPaymentStatus): string
}

// Explicit registry — the ONLY sanctioned bridge from master to a country's payment adapter.
// (Static import is intentional and explicit; this file is the resolver seam, not an implicit dep.)
import { syriaManualPaymentAdapter } from '../../../countries/syria/payments/adapter'

const ADAPTERS: Record<string, ManualPaymentAdapter> = {
  syria: syriaManualPaymentAdapter,
}

// Resolve the manual-payment adapter for the active country. Fail closed on missing/unsupported.
export function resolveManualPaymentAdapter(country: string | undefined | null): ManualPaymentAdapter {
  const key = String(country || '').trim().toLowerCase()
  if (!key) throw new Error('manual payment adapter: no country selected (fail-closed)')
  const adapter = ADAPTERS[key]
  if (!adapter) throw new Error(`manual payment adapter: country '${key}' is not supported (fail-closed)`)
  return adapter
}

export function supportedManualPaymentCountries(): string[] {
  return Object.keys(ADAPTERS)
}
