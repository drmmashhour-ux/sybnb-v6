// COMPATIBILITY SHIM (Phase 4). The Syria local-wallet module moved to
// countries/syria/payments/localWallet.ts as part of the country-neutral separation. This re-export
// preserves the original import path and every public export with NO behavior change — currencies,
// amounts, references, verification hash, statuses, idempotency, and approval semantics are
// unchanged. Master should reach the Syria wallet through the country-neutral resolver
// (manualPaymentAdapter.ts); this shim is temporary and is removed once importers are repointed.
// Do NOT add logic here.
export * from '../../../countries/syria/payments/localWallet'
