// STEP 5F -- static guards over src/admin: the console talks only to /api/admin2, never fakes data, never stores secrets.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const files = []
const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : files.push(p) } }
walk('src/admin')
const src = Object.fromEntries(files.filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => [f, readFileSync(f, 'utf8')]))

test('network access goes through one client that only calls /api/admin2', () => {
  for (const [f, s] of Object.entries(src)) {
    if (f.endsWith('src/admin/api.ts')) { assert.match(s, /\/api\/admin2/); continue }
    assert.doesNotMatch(s, /\bfetch\(/, `${f} must not call fetch directly`)
    assert.doesNotMatch(s, /XMLHttpRequest|axios|WebSocket/, f)
  }
})

test('no invented data: no random numbers, no dangerous HTML, no hard-coded money in components', () => {
  for (const [f, s] of Object.entries(src)) {
    if (/fixtures(-data)?\.ts$/.test(f)) continue
    assert.doesNotMatch(s, /Math\.random/, f)
    assert.doesNotMatch(s, /dangerouslySetInnerHTML|innerHTML\s*=/, f)
    assert.doesNotMatch(s, /\$\s?\d[\d,]*\.\d\d|\bCAD\b|\bUSD\b/, `${f} must not hard-code amounts`)
  }
})

test('fixture data has exactly one door: loadFixtures(), which is dead code in production builds', () => {
  for (const [f, s] of Object.entries(src)) {
    if (/fixtures\.ts$/.test(f)) { assert.match(s, /import\.meta as any\)\.env\.DEV && /); continue }
    assert.doesNotMatch(s, /fixtures-data/, `${f} must not import fixture data directly`)
  }
})

test('the console never writes tokens or credentials anywhere', () => {
  for (const [f, s] of Object.entries(src)) {
    assert.doesNotMatch(s, /localStorage\.setItem|sessionStorage\.setItem\([^)]*(token|session)/i, `${f}`)
    assert.doesNotMatch(s, /console\.(log|debug)\(/, `${f} must not log`)
  }
  assert.doesNotMatch(src['src/admin/api.ts'], /setItem/, 'api.ts only reads the token')
})

test('operational actions that have no reviewed backend stay disabled', () => {
  const s = src['src/admin/pages/OrderDetail.tsx']
  for (const a of ['Contact Restaurant', 'Contact Courier', 'Open Support Case', 'Request Cancellation', 'Reassign Delivery']) assert.match(s, new RegExp(a))
  assert.match(s, /aria-disabled="true"/); assert.doesNotMatch(s, /adminFetch|useAdminGet/, 'the order page performs no writes and loads no order API that does not exist')
})

test('every interactive icon-only control has an accessible name', () => {
  const shell = src['src/admin/components/shell.tsx']
  for (const label of ['Open navigation', 'Search', 'Notifications', 'Account menu for', 'Change platform context']) assert.match(shell, new RegExp(label))
  assert.match(shell, /Skip to content/)
  assert.match(shell, /dir="ltr" lang="en"/, 'the console must not inherit the consumer site direction')
})
