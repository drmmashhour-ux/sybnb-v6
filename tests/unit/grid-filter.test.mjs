import test from 'node:test'
import assert from 'node:assert/strict'
import { gridFilterCondition } from '../../server/lib/grid-filter.mjs'

test('exact option stays an exact match', () => {
  assert.deepEqual(gridFilterCondition('connectivity', 'fiber'), { metadata: { path: ['visualFilters', 'connectivity'], equals: 'fiber' } })
})
test('group ids match any of their values', () => {
  const c = gridFilterCondition('connectivity', 'has')
  assert.equal(c.OR.length, 2)
  assert.deepEqual(c.OR.map((x) => x.metadata.equals), ['fiber', 'router4g'])
  assert.deepEqual(gridFilterCondition('waterSystem', 'hasTank').OR.map((x) => x.metadata.equals), ['tank', 'both'])
  assert.equal(gridFilterCondition('powerSource', 'backup').OR.length, 3)
})
test('empty and any mean no constraint', () => {
  assert.equal(gridFilterCondition('connectivity', ''), null)
  assert.equal(gridFilterCondition('connectivity', 'any'), null)
})
