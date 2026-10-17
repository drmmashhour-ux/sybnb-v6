import test from 'node:test'
import assert from 'node:assert/strict'
import { renderNotification } from '../../server/lib/notifications.mjs'

test('confirmation email carries the one-time link in every language only when provided', () => {
  const url = 'https://sybnb.app/#/open/abc123tokenabc123tokenabc123token'
  for (const locale of ['ar-SY', 'en-CA', 'fr-CA']) {
    const withLink = renderNotification('guest_request_received', locale, { verifyUrl: url })
    assert.ok(withLink.text.includes(url), `${locale} has link`)
    const without = renderNotification('guest_request_received', locale, {})
    assert.ok(!without.text.includes('/#/open/'), `${locale} no link by default`)
  }
})
