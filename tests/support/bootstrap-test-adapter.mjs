// TEST SUPPORT ONLY (never imported by server code; enforced by tests/unit/authz-bootstrap-surface.test.mjs).
// Runs the real bootstrap guards against a throwaway role so a guard failure can be provoked without touching the
// shared OWNER role.
import { runBootstrap } from '../../server/lib/authz/bootstrap-core.mjs'

export function completeBootstrapForRole(client, roleCode, args) { return runBootstrap(client, roleCode, args) }
