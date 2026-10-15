import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { pick, type Lang } from '@platform/engines/language/languageEngine'
import { fetchMyFoodOrders, type FoodOrder } from '@platform/shared/api/platformApi'

// SE (Eats) — the customer's order history. Read-only list, newest first; live orders are managed
// from the main Eats screen.
type Props = { lang: Lang }

function money(minor: number, currency: string, lang: Lang) {
  try {
    return new Intl.NumberFormat(lang === 'ar' ? 'ar-SY' : lang === 'fr' ? 'fr-FR' : 'en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(minor)
  } catch {
    return `${minor} ${currency}`
  }
}

export function MyOrdersPage({ lang }: Props) {
  const t = useMemo(
    () => ({
      title: pick(lang, 'طلباتي', 'My orders', 'Mes commandes'),
      empty: pick(lang, 'لا توجد طلبات بعد.', 'No orders yet.', 'Aucune commande pour le moment.'),
      error: pick(lang, 'تعذر تحميل الطلبات.', 'Could not load orders.', 'Impossible de charger les commandes.'),
      st: {
        PLACED: pick(lang, 'بانتظار المطعم', 'Waiting for restaurant', 'En attente du restaurant'),
        ACCEPTED: pick(lang, 'مقبول', 'Accepted', 'Acceptée'),
        PREPARING: pick(lang, 'قيد التحضير', 'Preparing', 'En préparation'),
        READY_FOR_PICKUP: pick(lang, 'جاهز للاستلام', 'Ready for pickup', 'Prête pour enlèvement'),
        PICKED_UP: pick(lang, 'في الطريق', 'On the way', 'En route'),
        DELIVERED: pick(lang, 'تم التسليم', 'Delivered', 'Livrée'),
        CANCELLED: pick(lang, 'أُلغي', 'Cancelled', 'Annulée'),
        REJECTED: pick(lang, 'مرفوض', 'Rejected', 'Refusée'),
      } as Record<string, string>,
    }),
    [lang],
  )
  const [orders, setOrders] = useState<FoodOrder[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchMyFoodOrders().then(setOrders).catch(() => {
      setError(t.error)
      setOrders([])
    })
  }, [t.error])

  return (
    <main style={styles.page}>
      <h1 style={styles.h1}>{t.title}</h1>
      {error ? <p role="alert" style={styles.error}>{error}</p> : null}
      {orders === null ? null : orders.length === 0 ? (
        <p style={styles.muted}>{t.empty}</p>
      ) : (
        orders.map((order) => (
          <section key={order.id} style={styles.card}>
            <div style={styles.rowBetween}>
              <strong>{t.st[order.status] || order.status}</strong>
              <strong dir="ltr">{money(order.totalMinor, order.currency, lang)}</strong>
            </div>
            <div style={styles.muted} dir="auto">
              {(order.items || []).map((line) => `${line.quantity}× ${line.nameSnapshot}`).join(' · ')}
            </div>
            <div style={styles.mutedSmall} dir="auto">{order.deliveryAddress}</div>
          </section>
        ))
      )}
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { maxWidth: 520, margin: '0 auto', padding: 16, display: 'grid', gap: 12 },
  h1: { margin: 0, fontSize: 22, fontWeight: 800 },
  card: { border: '1.5px solid #e2e2e2', borderRadius: 14, padding: 14, display: 'grid', gap: 6, background: '#fff' },
  rowBetween: { display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 15 },
  muted: { color: '#555', fontSize: 13.5, margin: 0 },
  mutedSmall: { color: '#777', fontSize: 12.5 },
  error: { margin: 0, color: '#b91c1c', fontWeight: 700, fontSize: 13.5 },
}
