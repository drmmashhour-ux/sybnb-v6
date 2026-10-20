import { useEffect, useState, type ReactNode } from 'react'
import { useAdminGet, type PlatformShell } from '../api'
import { loadFixtures, FIXTURES_ENABLED, type RestaurantFixtureSummary } from '../fixtures'
import { elapsedLabel, humanize } from '../format'
import { ConnectionTag, EmptyState, ErrorState, Link, LoadingSkeleton, PageHeader, StatusBadge, PLATFORM_STATUS_LABEL, toneForPlatform } from '../components/ui'
import { useConsole } from '../components/shell'

export function FixtureBanner() {
  return FIXTURES_ENABLED ? <div className="adm-banner fixture" role="note"><b>DEVELOPMENT FIXTURE DATA.</b> The sample restaurants and orders below are not real and exist only because this dev build was started in fixture mode.</div> : null
}

/** One card in the restaurant-operations hierarchy: a title, a connection tag, then either real content or a specific explanation. */
function OpsCard({ id, title, state, children, footer }: { id: string; title: string; state: 'connected' | 'fixture' | 'pending'; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className={`adm-card adm-opscard${state === 'pending' ? ' is-pending' : ''}`} aria-labelledby={id}>
      <div className="adm-card-h"><h3 id={id}>{title}</h3><ConnectionTag state={state} /></div>
      <div className="adm-card-b">{children}</div>
      {footer ? <div className="adm-card-f">{footer}</div> : null}
    </section>
  )
}
const Copy = ({ children }: { children: ReactNode }) => <p className="adm-note" style={{ margin: 0 }}>{children}</p>

export function RestaurantsOverviewPage() {
  const c = useConsole()
  const shell = useAdminGet<PlatformShell>('/platforms/sr_restaurants')
  const [fx, setFx] = useState<RestaurantFixtureSummary | null>(null)
  useEffect(() => { let alive = true; loadFixtures().then((f) => { if (alive) setFx(f?.summary ?? null) }); return () => { alive = false } }, [])
  const d = shell.data
  const fxTag = fx ? 'fixture' : 'pending'

  return (
    <div className="adm-domain-restaurants">
      <PageHeader
        identity
        crumbs={[{ label: 'Command Center', to: '/admin' }, { label: 'SR' }, { label: 'Restaurants' }]}
        title={<>Restaurant operations {d ? <StatusBadge tone={toneForPlatform(d.platform.status)}>{PLATFORM_STATUS_LABEL[d.platform.status] ?? humanize(d.platform.status)}</StatusBadge> : null}</>}
        subtitle="SR Restaurants: onboarding, live orders, deliveries and exceptions."
      />
      <FixtureBanner />
      {shell.loading ? <div className="adm-card adm-card-b"><LoadingSkeleton rows={4} label="Loading restaurant operations" /></div>
        : shell.error ? <ErrorState error={shell.error} onRetry={shell.reload} />
        : d ? (
          <>
            {!fx ? (
              <div className="adm-banner" style={{ background: 'var(--adm-domain-soft)', borderColor: 'var(--adm-border)' }} role="note">
                <b>The restaurant ordering and delivery modules are not connected to this console yet.</b> Cards tagged “Not yet connected” show what will appear and when. Cards tagged “Connected” show real numbers.{d.note ? ` ${d.note}` : ''}
              </div>
            ) : null}

            <h2 className="adm-tier">Operations now</h2>
            <div className="adm-grid adm-g4" role="group" aria-label="Operations now">
              <OpsCard id="rs-onb" title="Onboarding" state="connected" footer={c.can('work.view') ? <Link to="/admin/work">Open My Work →</Link> : undefined}>
                <dl className="adm-dl">
                  <dt>Documents to review</dt><dd><b>{d.counts.documentsNeedingReview}</b></dd>
                  <dt>Pending approvals</dt><dd><b>{d.counts.pendingApprovals}</b></dd>
                  <dt>Open work items</dt><dd><b>{d.counts.openWork}</b></dd>
                </dl>
                <Copy>Counts are real and cover SR Restaurants only. The step-by-step onboarding pipeline is not built yet.</Copy>
              </OpsCard>
              <OpsCard id="rs-live" title="Live orders" state={fxTag}>
                {fx && fx.liveOrders.length > 0 ? (
                  <ul className="adm-list" aria-label="Live orders (fixture)" style={{ margin: '-16px' }}>
                    {fx.liveOrders.map((o) => (<li key={o.id}><span><Link to={`/admin/sr/restaurants/orders/${o.id}`}><b>{o.number}</b></Link><br /><span className="adm-note">{o.restaurant}</span></span><span><StatusBadge tone="info">{o.status}</StatusBadge> <span className="adm-note">{elapsedLabel(o.elapsedFrom)}</span></span></li>))}
                  </ul>
                ) : <><b>No live orders yet.</b><Copy>Live restaurant orders will appear here after the ordering module is connected.</Copy></>}
              </OpsCard>
              <OpsCard id="rs-del" title="Deliveries" state={fxTag}>
                {fx ? <dl className="adm-dl"><dt>Assigned</dt><dd>{fx.deliveries.assigned}</dd><dt>Unassigned</dt><dd>{fx.deliveries.unassigned}</dd></dl>
                  : <><b>No deliveries yet.</b><Copy>Courier assignments and delivery progress will appear here after the delivery module is connected.</Copy></>}
              </OpsCard>
              <OpsCard id="rs-sup" title="Support and exceptions" state="connected">
                <dl className="adm-dl"><dt>Open support cases</dt><dd><b>{d.counts.openSupportCases}</b></dd></dl>
                <Copy>The support count is real. Order and delivery exceptions (late, rejected, undeliverable) will be listed here after those modules are connected.</Copy>
              </OpsCard>
            </div>

            <h2 className="adm-tier">Setup and reference</h2>
            <div className="adm-grid adm-g3" role="group" aria-label="Setup and reference">
              <OpsCard id="rs-rest" title="Restaurants and locations" state={fxTag}>
                {fx ? <dl className="adm-dl"><dt>Active</dt><dd>{fx.restaurants.active}</dd><dt>Paused</dt><dd>{fx.restaurants.paused}</dd><dt>Onboarding</dt><dd>{fx.restaurants.onboarding}</dd></dl>
                  : <><b>No restaurants yet.</b><Copy>Each restaurant and its locations will be listed here once onboarding is connected. Restaurant owners will also appear under Parties with the Restaurant Owner role.</Copy></>}
              </OpsCard>
              <OpsCard id="rs-doc" title="Documents" state="connected">
                <dl className="adm-dl"><dt>Waiting for review</dt><dd><b>{d.counts.documentsNeedingReview}</b></dd></dl>
                <Copy>Licences, tax registrations and menus uploaded during onboarding. The document review screen is a later step.</Copy>
              </OpsCard>
              <OpsCard id="rs-cfg" title="Configuration" state="connected">
                <dl className="adm-dl"><dt>Registry status</dt><dd>{PLATFORM_STATUS_LABEL[d.platform.status] ?? humanize(d.platform.status)}</dd><dt>Platform code</dt><dd className="adm-mono">{d.platform.code}</dd></dl>
                <Copy>Operating settings (service areas, hours, fees) are not editable here yet. Changes are made by authorized administrators and are audited.</Copy>
              </OpsCard>
            </div>
          </>
        ) : <EmptyState kind="not-configured" title="SR Restaurants is not configured">This platform is not registered for your organization.</EmptyState>}
    </div>
  )
}
