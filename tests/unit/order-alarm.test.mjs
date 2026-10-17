import test from 'node:test'
import assert from 'node:assert/strict'
import { pendingOrderCount, shouldRing } from '../../src/shared/lib/order-alarm.ts'

test('counts only PLACED orders', () => {
  assert.equal(pendingOrderCount([{ status: 'PLACED' }, { status: 'ACCEPTED' }, { status: 'PLACED' }, {}]), 2)
})
test('rings only when enabled and something is waiting', () => {
  assert.equal(shouldRing(true, [{ status: 'PLACED' }]), true)
  assert.equal(shouldRing(false, [{ status: 'PLACED' }]), false)
  assert.equal(shouldRing(true, [{ status: 'ACCEPTED' }]), false)
  assert.equal(shouldRing(true, []), false)
})
