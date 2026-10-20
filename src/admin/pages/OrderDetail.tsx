import { useEffect, useState, type ReactNode } from 'react'
import { qs, useAdminGet, type AuditEvent, type Page } from '../api'
import { loadFixtures, FIXTURES_ENABLED, type OrderView } from '../fixtures'
import { elapsedLabel, dateTime, humanize } from '../format'
import { ConnectionTag, EmptyState, EntityHeader, ErrorState, LoadingSkeleton, PageHeader, PlannedActions, StatusBadge, Timeline, type PlannedAction } from '../components/ui'
import { FixtureBanner } from './Restaurants'

// Not buttons: nothing here can be clicked until the matching backend exists, so nothing looks clickable.
const PLANNED: PlannedAction[] = [
  { key: 'contact-restaurant', label: 'Contact restaurant', reason: 'Coming later' },
  { key: 'contact-courier', label: 'Contact courier', reason: 'Requires delivery module' },
  { key: 'support-case', label: 'Open support case', reason: 'Requires support module' },
  { key: 'reassign', label: 'Reassign delivery', reason: 'Requires delivery module' },
  { key: 'cancel', label: 'Request cancellation', reason: 'Requires ordering module', danger: true },
]

/** A section of the order page. Not-yet-connected sections are quieter and say exactly what will appear. */
function Section({ title, state, willShow, children }: { title: string; state: 'connected' | 'fixture' | 'pending'; willShow?: string; children?: ReactNode }) {
  return (
    <section className={`adm-card adm-opscard${state === 'pending' ? ' is-pending' : ''}`} aria-label={title}>
      <div className="adm-card-h"><h2>{title}</h2><ConnectionTag state={state} /></div>
      <div className="adm-card-b">{state === 'pending' ? <p className="adm-note" style={{ margin: 0 }}>{willShow}</p> : children}</div>
    </section>
  )
}

function AuditRefs({ id }: { id: string }) {
  // Real: the audit trail is queried for this order. Orders are not recorded there yet, so it is normally empty.
  const q = useAdminGet<Page<AuditEvent>>(`/audit/events${qs({ entityType: 'restaurant_order', entityId: id, pageSize: 10 })}`)
  if (q.loading) return <LoadingSkeleton rows={2} label="Loading audit trail" />
  if (q.error) return q.error.status === 403 ? <EmptyState kind="no-permission" title="Audit trail is not available to your role">Roles with audit access can see changes recorded for this order.</EmptyState> : <ErrorState error={q.error} onRetry={q.reload} />
  if (!q.data || q.data.items.length === 0) return <EmptyState kind="no-data" title="No audit events for this order">Changes to this order will be recorded here once the ordering module writes to the audit trail.</EmptyState>
  return <Timeline label="Audit events for this order" rows={q.data.items.map((a) => ({ id: a.id, at: a.createdAt, title: humanize(a.action), detail: a.actor?.displayName ?? 'System' }))} />
}

export function OrderDetailPage({ id }: { id: string }) {
  const [order, setOrder] = useState<OrderView | null>(null)
  const [ready, setReady] = useState(!FIXTURES_ENABLED)
  useEffect(() => {
    let alive = true
    loadFixtures().then((f) => { if (alive) { setOrder(f?.order(id) ?? null); setReady(true) } })
    return () => { alive = false }
  }, [id])
  const shortId = id.length > 14 ? `${id.slice(0, 8)}…` : id
  const crumbs = [{ label: 'Command Center', to: '/admin' }, { label: 'SR Restaurants', to: '/admin/sr/restaurants' }, { label: 'Order' }]
  if (!ready) return <div className="adm-domain-restaurants"><PageHeader identity crumbs={crumbs} title={`Order ${shortId}`} /><LoadingSkeleton rows={5} label="Loading order" /></div>
  const fx = order ? 'fixture' : 'pending'

  return (
    <div className="adm-domain-restaurants">
      <PageHeader identity crumbs={crumbs} title={order ? `Order ${order.number}` : `Order ${shortId}`} />
      <FixtureBanner />
      {!order ? (
        <div className="adm-banner" style={{ background: 'var(--adm-domain-soft)', borderColor: 'var(--adm-border)' }} role="note">
          <b>This order cannot be loaded: the restaurant ordering module is not connected to this console yet.</b> The page below shows its structure. Sections tagged “Not yet connected” fill in when the module exists; the audit trail is live.
        </div>
      ) : (
        <EntityHeader as="h2" name={order.restaurant} kindLabel={`Order ${order.number}`}
          badges={<><StatusBadge tone="info">{order.status}</StatusBadge><span className="adm-chip">Elapsed {elapsedLabel(order.placedAt)}</span>{order.amountMinor !== null ? <span className="adm-chip">{(order.amountMinor / 100).toFixed(2)} {order.currency} (fixture)</span> : null}</>}
          meta={<>{order.location} · placed {dateTime(order.placedAt)}</>} />
      )}
      <div className="adm-grid adm-g-main" style={{ marginTop: 12 }}>
        <div className="adm-grid">
          <div className="adm-grid adm-g2">
            <Section title="Restaurant state" state={fx} willShow="Whether the restaurant accepted the order, is preparing it, or has it ready for pickup.">
              {order ? <><StatusBadge tone={order.restaurantState.tone}>{order.restaurantState.label}</StatusBadge><p className="adm-note">{order.restaurantState.note}</p></> : null}
            </Section>
            <Section title="Delivery state" state={fx} willShow="Where the delivery is: waiting for a courier, on the way, or delivered.">
              {order ? <><StatusBadge tone={order.deliveryState.tone}>{order.deliveryState.label}</StatusBadge><p className="adm-note">{order.deliveryState.note}</p></> : null}
            </Section>
            <Section title="Courier" state={fx} willShow="The assigned courier, their vehicle and a masked phone number.">
              {order ? (order.courier ? <dl className="adm-dl"><dt>Name</dt><dd>{order.courier.name}</dd><dt>Vehicle</dt><dd>{order.courier.vehicle}</dd><dt>Phone</dt><dd className="adm-mono">{order.courier.phoneMasked}</dd></dl> : <p className="adm-note" style={{ margin: 0 }}>No courier assigned.</p>) : null}
            </Section>
            <Section title="Customer" state={fx} willShow="The customer’s first name, delivery area and a masked phone number. Full details need the sensitive-contact permission.">
              {order ? <dl className="adm-dl"><dt>Name</dt><dd>{order.customer.name}</dd><dt>Area</dt><dd>{order.customer.area}</dd><dt>Phone</dt><dd className="adm-mono">{order.customer.phoneMasked}</dd></dl> : null}
            </Section>
          </div>
          <Section title="Order items" state={fx} willShow="Each item with its quantity, and any modifiers listed underneath it.">
            {order ? (
              <ul className="adm-list" style={{ margin: '-16px' }}>
                {order.items.map((it, i) => (<li key={i} style={{ display: 'block' }}><b>{it.qty} × {it.name}</b>{it.modifiers.length > 0 ? <ul className="mods" aria-label={`Modifiers for ${it.name}`} style={{ margin: '4px 0 0 18px', padding: 0, listStyle: 'none' }}>{it.modifiers.map((m) => <li key={m} style={{ display: 'block', padding: 0, border: 0 }} className="adm-muted">+ {m}</li>)}</ul> : null}</li>))}
              </ul>
            ) : null}
          </Section>
          <Section title="Timeline" state={fx} willShow="Order placed, accepted, preparing, courier offered and accepted, arrived, ready, picked up, delivered. Only events that really happened will be listed.">
            {order ? <Timeline label="Order timeline" rows={order.timeline.map((t) => ({ id: t.key, at: t.at, title: t.label }))} /> : null}
          </Section>
        </div>
        <aside className="adm-grid" aria-label="Actions and references">
          <section className="adm-card adm-opscard is-pending" aria-label="Actions">
            <div className="adm-card-h"><h2>Actions</h2><StatusBadge tone="neu">Not available yet</StatusBadge></div>
            <div className="adm-card-b">
              <PlannedActions label="Planned order actions" actions={PLANNED} />
              <p className="adm-note" style={{ marginBottom: 0 }}>Each action is switched on only after it has a reviewed, audited backend. Cancelling an order will always ask for confirmation.</p>
            </div>
          </section>
          <section className="adm-card adm-opscard" aria-label="Audit trail">
            <div className="adm-card-h"><h2>Audit trail</h2><ConnectionTag state="connected" /></div>
            <div className="adm-card-b"><AuditRefs id={id} /></div>
          </section>
          <Section title="Support cases" state={fx} willShow="Support cases opened about this order.">
            {order ? (order.supportRefs.length ? <p className="adm-mono" style={{ margin: 0 }}>{order.supportRefs.join(', ')}</p> : <p className="adm-note" style={{ margin: 0 }}>No support cases for this order.</p>) : null}
          </Section>
        </aside>
      </div>
    </div>
  )
}
