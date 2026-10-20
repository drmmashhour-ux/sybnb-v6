import { useEffect, useState } from 'react'
import { loadFixtures, FIXTURES_ENABLED, type OrderView } from '../fixtures'
import { elapsedLabel, dateTime } from '../format'
import { EmptyState, EntityHeader, LoadingSkeleton, PageHeader, StatusBadge, Timeline } from '../components/ui'
import { FixtureBanner } from './Restaurants'

const NOT_CONNECTED = 'Not connected yet'
const ACTIONS = ['Contact Restaurant', 'Contact Courier', 'Open Support Case', 'Request Cancellation', 'Reassign Delivery']

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="adm-card" aria-label={title}><div className="adm-card-h"><h2>{title}</h2></div><div className="adm-card-b">{children}</div></section>
}
const na = <p className="adm-note" style={{ margin: 0 }}>{NOT_CONNECTED}. Real data appears here when the SR Restaurants order module is connected.</p>

export function OrderDetailPage({ id }: { id: string }) {
  const [order, setOrder] = useState<OrderView | null>(null)
  const [ready, setReady] = useState(!FIXTURES_ENABLED)
  useEffect(() => {
    let alive = true
    loadFixtures().then((f) => { if (alive) { setOrder(f?.order(id) ?? null); setReady(true) } })
    return () => { alive = false }
  }, [id])
  if (!ready) return <LoadingSkeleton rows={5} label="Loading order" />
  const shortId = id.length > 14 ? `${id.slice(0, 8)}…` : id

  return (
    <div className="adm-domain-restaurants">
      <PageHeader identity crumbs={[{ label: 'Command Center', to: '/admin' }, { label: 'SR Restaurants', to: '/admin/sr/restaurants' }, { label: 'Order' }]} title={order ? `Order ${order.number}` : `Order ${shortId}`} />
      <FixtureBanner />
      {!order ? (
        <div className="adm-section" style={{ marginTop: 0 }}>
          <EmptyState title="Order data is not available">There is no order module connected to this console yet, so this order cannot be loaded. The layout below shows what each section will contain.</EmptyState>
        </div>
      ) : (
        <EntityHeader as="h2" name={order.restaurant} kindLabel={`Order ${order.number}`}
          badges={<><StatusBadge tone="info">{order.status}</StatusBadge><span className="adm-chip">Elapsed {elapsedLabel(order.placedAt)}</span>{order.amountMinor !== null ? <span className="adm-chip">{(order.amountMinor / 100).toFixed(2)} {order.currency} (fixture)</span> : null}</>}
          meta={<>{order.location} · placed {dateTime(order.placedAt)}</>} />
      )}
      <div className="adm-grid adm-g-main" style={{ marginTop: 12 }}>
        <div className="adm-grid">
          <div className="adm-grid adm-g2">
            <Section title="Restaurant state">{order ? <><StatusBadge tone={order.restaurantState.tone}>{order.restaurantState.label}</StatusBadge><p className="adm-note">{order.restaurantState.note}</p></> : na}</Section>
            <Section title="Delivery state">{order ? <><StatusBadge tone={order.deliveryState.tone}>{order.deliveryState.label}</StatusBadge><p className="adm-note">{order.deliveryState.note}</p></> : na}</Section>
            <Section title="Courier">{order ? (order.courier ? <dl className="adm-dl"><dt>Name</dt><dd>{order.courier.name}</dd><dt>Vehicle</dt><dd>{order.courier.vehicle}</dd><dt>Phone</dt><dd className="adm-mono">{order.courier.phoneMasked}</dd></dl> : <p className="adm-note">No courier assigned.</p>) : na}</Section>
            <Section title="Customer">{order ? <dl className="adm-dl"><dt>Name</dt><dd>{order.customer.name}</dd><dt>Area</dt><dd>{order.customer.area}</dd><dt>Phone</dt><dd className="adm-mono">{order.customer.phoneMasked}</dd></dl> : na}</Section>
          </div>
          <Section title="Order items">
            {order ? (
              <ul className="adm-list" style={{ margin: '-16px' }}>
                {order.items.map((it, i) => (<li key={i} style={{ display: 'block' }}><b>{it.qty} × {it.name}</b>{it.modifiers.length > 0 ? <ul className="mods" aria-label={`Modifiers for ${it.name}`} style={{ margin: '4px 0 0 18px', padding: 0, listStyle: 'none' }}>{it.modifiers.map((m) => <li key={m} style={{ display: 'block', padding: 0, border: 0 }} className="adm-muted">+ {m}</li>)}</ul> : null}</li>))}
              </ul>
            ) : na}
          </Section>
          <Section title="Timeline">{order ? <Timeline label="Order timeline" rows={order.timeline.map((t) => ({ id: t.key, at: t.at, title: t.label }))} /> : <p className="adm-note" style={{ margin: 0 }}>Only events that actually happened are shown. None are available because no order is loaded.</p>}</Section>
        </div>
        <aside className="adm-grid" aria-label="Actions and references">
          <Section title="Actions">
            <div className="adm-actionlist">{ACTIONS.map((a) => <button key={a} type="button" className="adm-btn" aria-disabled="true" onClick={(e) => e.preventDefault()}>{a}<span className="adm-note">Coming soon</span></button>)}</div>
            <p className="adm-note" style={{ marginBottom: 0 }}>Operational actions are intentionally disabled until each one has a reviewed, audited backend.</p>
          </Section>
          <Section title="Audit and support references">
            {order && (order.auditRefs.length > 0 || order.supportRefs.length > 0) ? (
              <dl className="adm-dl"><dt>Audit</dt><dd className="adm-mono">{order.auditRefs.join(', ') || '—'}</dd><dt>Support</dt><dd className="adm-mono">{order.supportRefs.join(', ') || 'None'}</dd></dl>
            ) : <p className="adm-note" style={{ margin: 0 }}>No audit or support references for this order.</p>}
          </Section>
        </aside>
      </div>
    </div>
  )
}
