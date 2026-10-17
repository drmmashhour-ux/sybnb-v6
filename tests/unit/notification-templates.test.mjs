import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { renderNotification } from '../../server/lib/notifications.mjs'

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name)
    if (name.isDirectory()) walk(full, out)
    else if (name.name.endsWith('.mjs')) out.push(full)
  }
  return out
}

test('every notification kind used in server code has a template (all 3 languages render)', () => {
  const used = new Set()
  for (const file of walk('server')) {
    const src = fs.readFileSync(file, 'utf8')
    for (const m of src.matchAll(/notify(?:Admin|Booking|UserMulti|User)?\(\s*'([a-z_]+)'/g)) used.add(m[1])
  }
  assert.ok(used.size > 10)
  for (const kind of used) {
    for (const locale of ['ar', 'en', 'fr']) {
      assert.doesNotThrow(() => renderNotification(kind, locale, {}), `${kind}/${locale}`)
    }
  }
})
