import test from 'node:test'
import assert from 'node:assert/strict'

process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'test-secret-for-media-urls'
const { publicListingMedia, publicMediaUrl } = await import('../../server/lib/listing-media-url.mjs')

const KEY = '4ba0c416-cfce-4ae0-8ae1-398b48daf52b.png'

test('private payment-proof reference becomes a signed storage URL', () => {
  const url = publicMediaUrl(`payment-proof://${KEY}`)
  assert.match(url, new RegExp(`^/api/storage/payment-proof/${KEY}\\?exp=\\d+&sig=`))
})

test('plain https URLs pass through, malformed private references are dropped', () => {
  assert.equal(publicMediaUrl('https://cdn.example.com/a.jpg'), 'https://cdn.example.com/a.jpg')
  assert.equal(publicMediaUrl('payment-proof://../../etc/passwd'), null)
  assert.equal(publicMediaUrl(undefined), null)
})

test('publicListingMedia never exposes a raw private reference', () => {
  const out = publicListingMedia([{ url: `payment-proof://${KEY}`, kind: 'image' }, { url: 'listing-media://nope', kind: 'image' }])
  assert.equal(out.length, 1)
  assert.ok(!JSON.stringify(out).includes('payment-proof://'))
})
