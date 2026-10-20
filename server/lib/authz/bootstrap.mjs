// STEP 5D -- public surface of the one-time Owner bootstrap. This module re-exports ONLY the production entry
// point, the constants and the diagnostics. The generic runner (any role code) lives in
// the core module and is deliberately NOT re-exported: the role is fixed to OWNER for every production caller,
// and the only production importer of the core is this file. A static unit test
// (authz-bootstrap-surface) enforces both facts.
export {
  BOOTSTRAP_REQUIRED, BOOTSTRAP_COMPLETED, BOOTSTRAP_ROLE_CODE,
  SECRET_LEFT_CONFIGURED_WARNING, SECRET_LIFECYCLE_INSTRUCTION,
  bootstrapSecretDiagnostics, getBootstrapState, completeOwnerBootstrap,
} from './bootstrap-core.mjs'
