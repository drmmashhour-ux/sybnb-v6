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
  assert.deepEqual(Object.keys(publicSurface).sort(), ['BOOTSTRAP_COMPLETED', 'BOOTSTRAP_REQUIRED', 'BOOTSTRAP_ROLE_CODE', 'SECRET_LEFT_CONFIGURED_WARNING', 'SECRET_LIFECYCLE_INSTRUCTION', 'bootstrapSecretDiagnostics', 'completeOwnerBootstrap', 'getBootstrapState', 'resolveBootstrapOrganization'])
  assert.equal(Object.keys(publicSurface).some((k) => /testonly|runBootstrap/i.test(k)), false)
})

test('no production file imports bootstrap-core.mjs except the public bootstrap.mjs re-export and the constant-only bootstrap-context.mjs', () => {
  const importers = serverFiles.filter((f) => /bootstrap-core/.test(readFileSync(f, 'utf8'))).map(rel)
  assert.deepEqual(importers.filter((f) => f !== 'server/lib/authz/bootstrap-core.mjs'), ['server/lib/authz/bootstrap-context.mjs', 'server/lib/authz/bootstrap.mjs'])
})

test('no TestOnly symbol, test-support import or dynamic import of bootstrap exists in production code', () => {
  for (const f of serverFiles) {
    const src = readFileSync(f, 'utf8')
    assert.equal(/TestOnly/.test(src), false, `${rel(f)} must not contain a TestOnly symbol`)
    assert.equal(/tests\/support|bootstrap-test-adapter/.test(src), false, `${rel(f)} must not import test support`)
  }
  // dynamic imports are allowed only with a literal specifier that is not a bootstrap module
  const bad = serverFiles.filter((f) => { const src = readFileSync(f, 'utf8'); return /import\s*\(\s*['"`][^'"`]*bootstrap/i.test(src) || /import\s*\(\s*[^'"`\s)]/.test(src) }).map(rel)
  assert.deepEqual(bad, [], 'no dynamic import of a bootstrap module, and no computed dynamic import specifier')
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

test('STEP 5E: the bootstrap routes take no organization from the request (no query, body, header or route parameter)', () => {
  const route = readFileSync(join(root, 'server/routes/admin2/security.mjs'), 'utf8')
  const a = route.indexOf('const bootstrapOrg'); const b = route.indexOf("router.get('/security/privileged-users'")
  const section = route.slice(a, b)
  assert.ok(a > 0 && b > a)
  assert.equal(/r\.query|r\.params|searchParams|organizationId\s*[:=]\s*(body|r\.)/.test(section), false, 'no user-controlled organization source')
  assert.equal(/body\??\.organization|headers\[\s*['"]x-org/i.test(section), false)
  const headersRead = [...section.matchAll(/headers\[\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
  assert.deepEqual(headersRead, ['x-bootstrap-secret'], 'the only header read is the operator secret')
  assert.match(section, /resolveBootstrapOrganization\(db\(\), r\.auth\.user\.id\)/, 'organization comes from the authenticated user\'s own assignments')
})
