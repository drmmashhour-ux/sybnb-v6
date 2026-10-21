// Test-only preload (node --import): replaces the two Stripe Checkout calls the wallet top-up uses so NO real Stripe request is made.
// Sessions live in a JSON file (FAKE_STRIPE_FILE) the test can edit to mark a session paid.
import fs from 'node:fs'
import Stripe from 'stripe'
const file = process.env.FAKE_STRIPE_FILE || '/tmp/fake-stripe.json'
const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return {} } }
const write = (v) => fs.writeFileSync(file, JSON.stringify(v))
const sessions = Object.getPrototypeOf(new Stripe('sk_test_fake').checkout.sessions)
sessions.create = async function (params) {
  const id = `cs_test_${Math.random().toString(36).slice(2, 12)}`
  const all = read(); all[id] = { id, payment_status: 'unpaid', metadata: params.metadata, payment_intent: `pi_test_${id.slice(8)}`, amount: params.line_items?.[0]?.price_data?.unit_amount, success_url: params.success_url }
  write(all)
  return { id, url: `https://checkout.stripe.test/${id}` }
}
sessions.retrieve = async function (id) { const s = read()[id]; if (!s) throw new Error('no such session'); return s }
