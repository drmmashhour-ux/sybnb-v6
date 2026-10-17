import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redactContactInfo, CONTACT_HIDDEN } from '../../server/lib/contact-redaction.mjs'

const hidden = (text) => redactContactInfo(text).includes(CONTACT_HIDDEN)

test('existing cases still hidden', () => {
  assert.ok(hidden('mail me at sara@gmail.com'))
  assert.ok(hidden('see https://example.com/x'))
  assert.ok(hidden('wa.me/963944123456'))
  assert.ok(hidden('call +963 944 123 456'))
  assert.ok(hidden('0944 123 456'))
  assert.ok(hidden('0944123456'))
})
test('Arabic-Indic and Persian digits are caught', () => {
  assert.ok(hidden('٠٩٤٤١٢٣٤٥٦'))
  assert.ok(hidden('۰۹۴۴۱۲۳۴۵۶'))
  assert.ok(hidden('رقمي +٩٦٣ ٩٤٤ ١٢٣ ٤٥٦'))
})
test('spelled-out numbers are caught (EN, FR, AR, spaced digits)', () => {
  assert.ok(hidden('zero nine four four one two three four five six'))
  assert.ok(hidden('zéro neuf quatre quatre un deux trois quatre cinq six'))
  assert.ok(hidden('صفر تسعة اربعة اربعة واحد اثنين ثلاثة اربعة خمسة ستة'))
  assert.ok(hidden('0 9 4 4 1 2 3 4 5 6'))
  assert.ok(hidden('0.9.4.4.1.2.3.4.5.6'))
})
test('grouped words, two-digit groups and separated app names are caught', () => {
  assert.ok(hidden('text me: nine four four, one two three, four five six'))
  assert.ok(hidden('my number is 09 44 12 34 56'))
  assert.ok(hidden('whats-app me'))
  assert.ok(hidden('add me on whats_app'))
})
test('obfuscated emails, app names and handles are caught', () => {
  assert.ok(hidden('sara at gmail dot com'))
  assert.ok(hidden('sara (at) gmail (dot) com'))
  assert.ok(hidden('add me on WhatsApp'))
  assert.ok(hidden('كلمني على واتساب'))
  assert.ok(hidden('كلمني تلغرام'))
  assert.ok(hidden('my insta is @sara_home'))
})
test('normal negotiation text is untouched', () => {
  for (const text of [
    'The price is 35000000 SYP, is that fine?',
    'Total 1,200,000 SYP for 3 nights',
    'Check-in at 2 pm, check-out at 11',
    'We are 4 adults and 2 kids, one car',
    'سعر الليلة ٣٥٠٠٠ ليرة',
    'Is the apartment on the 3rd floor? Two bedrooms and one bathroom?',
    'I will arrive at five, thanks',
    'Price 350 000 000 SYP or 1 200 000 000 total',
    'Dates 12 10 2026 to 15 10 2026, 3 nights',
  ]) {
    assert.equal(redactContactInfo(text), text, text)
  }
})
test('original characters outside matches are preserved', () => {
  assert.equal(redactContactInfo('Hi سارة call ٠٩٤٤١٢٣٤٥٦ ok'), `Hi سارة call ${CONTACT_HIDDEN} ok`)
})
test('empty and non-string inputs pass through', () => {
  assert.equal(redactContactInfo(''), '')
  assert.equal(redactContactInfo(null), null)
})
