import test from 'node:test'
import assert from 'node:assert/strict'
import { contentMatchesType } from '../../server/lib/storage.mjs'

const png = Buffer.from('89504e470d0a1a0a0000', 'hex')
const jpg = Buffer.from('ffd8ffe000104a46', 'hex')
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')])
const pdf = Buffer.from('%PDF-1.7\n')

test('real files match their declared type', () => {
  assert.equal(contentMatchesType(png, 'image/png'), true)
  assert.equal(contentMatchesType(jpg, 'image/jpeg'), true)
  assert.equal(contentMatchesType(webp, 'image/webp'), true)
  assert.equal(contentMatchesType(pdf, 'application/pdf'), true)
})

test('a script or HTML payload renamed as an image is refused', () => {
  const html = Buffer.from('<script>alert(1)</script>')
  for (const t of ['image/png', 'image/jpeg', 'image/webp', 'application/pdf']) {
    assert.equal(contentMatchesType(html, t), false, t)
  }
  assert.equal(contentMatchesType(png, 'image/jpeg'), false)
})
