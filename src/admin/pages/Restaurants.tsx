import { useEffect, useState } from 'react'
import { useAdminGet, type PlatformShell } from '../api'
import { loadFixtures, FIXTURES_ENABLED, type RestaurantFixtureSummary } from '../fixtures'
import { elapsedLabel, humanize } from '../format'
import { EmptyState, ErrorState, Link, LoadingSkeleton, MetricCard, PageHeader, StatusBadge, TabPanel, Tabs, PLATFORM_STATUS_LABEL, toneForPlatform, type TabDef } from '../components/ui'
import { useConsole } from '../components/shell'

export function FixtureBanner() {
  return FIXTURES_ENABLED ? <div className="adm-banner fixture" role="note"><b>DEVELOPMENT FIXTURE DATA.</b> The sample restaurants and orders below are not real and exist only because this dev build was started in fixture mode.</div> : null
}

const SETUP_COPY = 'The SR Restaurants operations module is not connected to this console yet, so there is nothing real to show here. This section fills in when that module is built.'

export function RestaurantsOverviewPage() {
  const c = useConsole()
  const [tab, setTab] = useState('restaurants')
  const shell = useAdminGet<PlatformShell>('/platforms/sr_restaurants')
  const [fx, setFx] = useState<RestaurantFixtureSummary | null>(null)
  useEffect(() => { let alive = true; loadFixtures().then((f) => { if (alive) setFx(f?.summary ?? null) }); return () => { alive = false } }, [])
  const tabs: TabDef[] = ['restaurants', 'onboarding', 'live', 'deliveries', 'support', 'configuration'].map((k) => ({ key: k, label: ({ restaurants: 'Restaurants', onboarding: 'Onboarding', live: 'Live Operations', deliveries: 'Deliveries', support: 'Support', configuration: 'Configuration' } as Record<string, string>)[k] }))
  const d = shell.data
  const setup = (title: string) => <EmptyState title={title}>{SETUP_COPY}</EmptyState>

  return (
    <div className="adm-domain-restaurants">
      <PageHeader
        identity
        crumbs={[{ label: 'Command Center', to: '/admin' }, { label: 'SR' }, { label: 'Restaurants' }]}
        title={<>SR Restaurants {d ? <StatusBadge tone={toneForPlatform(d.platform.status)}>{PLATFORM_STATUS_LABEL[d.platform.status] ?? humanize(d.platform.status)}</StatusBadge> : null}</>}
        subtitle="Restaurant onboarding, live orders, deliveries and exceptions."
      />
      <FixtureBanner />
      {shell.loading ? <div className="adm-card adm-card-b"><LoadingSkeleton rows={3} /></div> : shell.error ? <ErrorState error={shell.error} onRetry={shell.reload} /> : d ? (
        <>
          {d.note ? <div className="adm-banner" style={{ background: 'var(--adm-domain-soft)', borderColor: 'var(--adm-border)' }} role="note">{d.note}</div> : null}
          <section aria-label="Summary" className="adm-grid adm-g5">
            <MetricCard label="Restaurants" value={fx ? fx.restaurants.active + fx.restaurants.paused + fx.restaurants.onboarding : null} note={fx ? 'Fixture data' : 'Module not connected'} />
            <MetricCard label="Live orders" value={fx ? fx.liveOrders.length : null} note={fx ? 'Fixture data' : 'Module not connected'} />
            <MetricCard label="Deliveries in progress" value={fx ? fx.deliveries.assigned + fx.deliveries.unassigned : null} note={fx ? 'Fixture data' : 'Module not connected'} />
            <MetricCard label="Open support cases" value={d.counts.openSupportCases} note="SR Restaurants only" />
            <MetricCard label="Documents to review" value={d.counts.documentsNeedingReview} note="Onboarding documents" />
          </section>
          <div className="adm-section" style={{ marginTop: 20 }}>
            <Tabs tabs={tabs} value={tab} onChange={setTab} label="SR Restaurants sections" idPrefix="rest" />
            <TabPanel idPrefix="rest" active={tab}>
              {tab === 'restaurants' ? (fx ? (
                <div className="adm-card adm-card-b"><dl className="adm-dl"><dt>Active</dt><dd>{fx.restaurants.active}</dd><dt>Paused</dt><dd>{fx.restaurants.paused}</dd><dt>Onboarding</dt><dd>{fx.restaurants.onboarding}</dd></dl></div>
              ) : setup('No restaurant data yet')) : null}
              {tab === 'onboarding' ? (
                <div className="adm-card adm-card-b">
                  <dl className="adm-dl"><dt>Documents awaiting review</dt><dd><b>{d.counts.documentsNeedingReview}</b></dd><dt>Pending approvals</dt><dd><b>{d.counts.pendingApprovals}</b></dd><dt>Open work items</dt><dd><b>{d.counts.openWork}</b> {c.can('work.view') ? <Link to="/admin/work">Open My Work</Link> : null}</dd></dl>
                  <p className="adm-note">These counts are real and cover this platform only. The restaurant onboarding pipeline itself is not built yet.</p>
                </div>
              ) : null}
              {tab === 'live' ? (fx && fx.liveOrders.length > 0 ? (
                <ul className="adm-list adm-card" aria-label="Live orders (fixture)">
                  {fx.liveOrders.map((o) => (<li key={o.id}><span><Link to={`/admin/sr/restaurants/orders/${o.id}`}><b>{o.number}</b></Link><br /><span className="adm-note">{o.restaurant}</span></span><span><StatusBadge tone="info">{o.status}</StatusBadge> <span className="adm-note">{elapsedLabel(o.elapsedFrom)}</span></span></li>))}
                </ul>
              ) : setup('No live orders to show')) : null}
              {tab === 'deliveries' ? (fx ? <div className="adm-card adm-card-b"><dl className="adm-dl"><dt>Assigned</dt><dd>{fx.deliveries.assigned}</dd><dt>Unassigned</dt><dd>{fx.deliveries.unassigned}</dd></dl></div> : setup('No delivery data yet')) : null}
              {tab === 'support' ? (
                <div className="adm-card adm-card-b"><dl className="adm-dl"><dt>Open support cases</dt><dd><b>{d.counts.openSupportCases}</b></dd></dl><p className="adm-note">The Support screen is a later step; this is the real count for this platform.</p></div>
              ) : null}
              {tab === 'configuration' ? (
                <div className="adm-card adm-card-b"><dl className="adm-dl"><dt>Platform code</dt><dd className="adm-mono">{d.platform.code}</dd><dt>Registry status</dt><dd>{PLATFORM_STATUS_LABEL[d.platform.status] ?? humanize(d.platform.status)}</dd><dt>Admin route</dt><dd className="adm-mono">{d.platform.route}</dd></dl><p className="adm-note">Configuration changes are made by authorized administrators and are audited.</p></div>
              ) : null}
            </TabPanel>
          </div>
        </>
      ) : null}
    </div>
  )
}
