import { useState } from 'react'
import { pick, type Lang } from '@platform/engines/language/languageEngine'
import { rateFoodOrder, type FoodOrder } from '@platform/shared/api/platformApi'

// Shown on a delivered order: 1..5 stars, once.
export function EatsRatingBox({ order, lang }: { order: FoodOrder; lang: Lang }) {
  const [stars, setStars] = useState(order.ratingStars ?? 0)
  const [done, setDone] = useState(Boolean(order.ratingStars))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(value: number) {
    setBusy(true)
    setError('')
    try {
      await rateFoodOrder(order.id, value)
      setStars(value)
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 6, margin: '10px 0' }}>
      <strong>
        {done
          ? pick(lang, 'شكراً لتقييمك!', 'Thanks for your rating!', 'Merci pour votre note !')
          : pick(lang, 'كيف كان طلبك؟', 'How was your order?', 'Comment était votre commande ?')}
      </strong>
      <div role="group" aria-label="rating" style={{ display: 'flex', gap: 4 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            disabled={busy || done}
            onClick={() => void submit(n)}
            aria-label={`${n}`}
            style={{ fontSize: 28, background: 'none', border: 'none', cursor: done ? 'default' : 'pointer', color: n <= stars ? '#f59e0b' : '#cbd5e1' }}
          >
            ★
          </button>
        ))}
      </div>
      {error ? <small role="alert">{error}</small> : null}
    </div>
  )
}
