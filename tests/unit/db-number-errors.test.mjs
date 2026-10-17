import test from 'node:test'
import assert from 'node:assert/strict'
import { translateDbError } from '../../server/lib/responses.mjs'

test('integer overflow becomes a 400', () => {
  const e = Object.assign(new Error('Value out of range for the type. The column `amount_minor` ...'), { code: 'P2020' })
  const t = translateDbError(e)
  assert.equal(t.statusCode, 400)
  assert.equal(t.code, 'NUMBER_OUT_OF_RANGE')
})
test('postgres 22003 becomes a 400', () => {
  const e = Object.assign(new Error('Raw query failed'), { meta: { code: '22003', message: 'value "3000000000" is out of range for type integer' } })
  assert.equal(translateDbError(e).code, 'NUMBER_OUT_OF_RANGE')
})
test('float sent to an Int field becomes a 400', () => {
  const e = Object.assign(new Error('Argument `amountMinor`: Invalid value provided. Expected Int, provided Float.'), { name: 'PrismaClientValidationError' })
  const t = translateDbError(e)
  assert.equal(t.statusCode, 400)
  assert.equal(t.code, 'NUMBER_NOT_WHOLE')
})
test('unrelated validation errors are left alone', () => {
  const e = Object.assign(new Error('something else'), { name: 'Error' })
  assert.equal(translateDbError(e).statusCode, undefined)
})
