// STEP 5D -- the generic bootstrap runner (any role code) must have no reachable production surface.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import * as publicSurface from '../../server/lib/authz/bootstrap.mjs'

const root = join(import.meta.dirname, '..', '..')
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === 'uploads') continue
    const p = join(dir, n); const s = statSync(p)
    if (s.isDirectory()) walk(p, out); else if (/\.(mjs|js|ts|tsx|cjs)$/.test(n)) out.push(p)
  }
  return out
}
const rel = (p) => relative(root, p).replaceAll('\\', '/')
const serverFiles = [...walk(join(root, 'server')), ...walk(join(root, 'scripts')), ...walk(join(root, 'src'))]

test('the public bootstrap module exposes only the OWNER entry point, constants and diagnostics', () => {
  assert.deepEqual(Object.keys(publicSurface).sort(), ['BOOTSTRAP_COMPLETED', 'BOOTSTRAP_REQUIRED', 'BOOTSTRAP_ROLE_CODE', 'SECRET_LEFT_CONFIGURED_WARNING', 'SECRET_LIFECYCLE_INSTRUCTION', 'bootstrapSecretDiagnostics', 'completeOwnerBootstrap', 'getBootstrapState'])
  assert.equal(Object.keys(publicSurface).some((k) => /testonly|runBootstrap/i.test(k)), false)
})

test('no production file imports bootstrap-core.mjs except the public bootstrap.mjs re-export', () => {
  const importers = serverFiles.filter((f) => /bootstrap-core/.test(readFileSync(f, 'utf8'))).map(rel)
  assert.deepEqual(importers.filter((f) => f !== 'server/lib/authz/bootstrap-core.mjs'), ['server/lib/authz/bootstrap.mjs'])
})

test('no TestOnly symbol, test-support import or dynamic import of bootstrap exists in production code', () => {
  for (const f of serverFiles) {
    const src = readFileSync(f, 'utf8')
    assert.equal(/TestOnly/.test(src), false, `${rel(f)} must not contain a TestOnly symbol`)
    assert.equal(/tests\/support|bootstrap-test-adapter/.test(src), false, `${rel(f)} must not import test support`)
  }
  const dyn = serverFiles.filter((f) => /import\s*\(/.test(readFileSync(f, 'utf8')) && /bootstrap/i.test(readFileSync(f, 'utf8'))).map(rel)
  assert.deepEqual(dyn, [], 'no dynamic import in a file that deals with bootstrap')
})

test('the HTTP routes call only completeOwnerBootstrap (role fixed to OWNER); the route table has no role parameter for bootstrap', () => {
  const route = readFileSync(join(root, 'server/routes/admin2/security.mjs'), 'utf8')
  assert.match(route, /completeOwnerBootstrap/)
  assert.equal(/runBootstrap|bootstrap-core/.test(route), false)
  assert.equal(/roleCode/.test(route.slice(route.indexOf('/security/bootstrap/owner'), route.indexOf('/security/privileged-users'))), false, 'the request cannot choose a role')
})

test('only the test adapter under tests/support imports the core', () => {
  const testFiles = walk(join(root, 'tests')).filter((f) => !f.endsWith('authz-bootstrap-surface.test.mjs') && /bootstrap-core/.test(readFileSync(f, 'utf8'))).map(rel)
  assert.deepEqual(testFiles, ['tests/support/bootstrap-test-adapter.mjs'])
})
