// SEC-002 — shared session-minting helper for the e2e suites.
//
// Before SEC-002, suites minted tokens by calling server/lib/security.mjs#createSessionToken()
// directly, because a token was a pure signature over {sub, roles} and needed no server state.
// Sessions are now server-backed: a token is only valid while its user_sessions row exists,
// is unrevoked, and its `epoch` claim still matches users.session_epoch. Minting a bare signed
// token would therefore produce a credential the API correctly refuses.
//
// This helper issues a REAL session through the same server code path production uses
// (issueUserSession), so the suites authenticate exactly the way a logged-in user does -- which is
// the point: a test fixture that could bypass the session table would be testing a door the
// product does not have.
//
// Signature is unchanged from the old createSessionToken(user) apart from being async, so suites
// only had to swap the import and add `await`.

import { randomUUID } from 'node:crypto'
import { createSessionToken as signToken } from '../../server/lib/security.mjs'
import { issueUserSession } from '../../server/lib/session-store.mjs'

export async function createSessionToken(user) {
  try {
    const session = await issueUserSession(user)
    return session.token
  } catch {
    // The user row does not exist (some suites deliberately mint tokens for absent accounts to
    // assert they are rejected). Sign a well-formed token whose session id matches no row, so the
    // API rejects it for the same reason it rejects any unknown session -- rather than the suite
    // dying here on a foreign-key error.
    return signToken(user, { sessionId: randomUUID(), epoch: 0 })
  }
}
