import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { adminFetch, qs, useAdminGet, type AuditEvent, type CommandCenter as CC, type Health, type Page, type PlatformShell, type WorkItem } from '../api'
import { dateTime, humanize } from '../format'
import { EmptyState, ErrorState, Link, LoadingSkeleton, MetricCard, PageHeader, PlatformCard, StatusBadge, PLATFORM_STATUS_LABEL, type Tone } from '../components/ui'
import { useConsole } from '../components/shell'
import { legalEntityView } from '../context'

const RANGES = [{ key: '1', label: 'Today' }, { key: '7', label: 'Last 7 days' }, { key: '30', label: 'Last 30 days' }]
/** Platforms whose operations screen exists in this release. */
const BUILT_SCREENS: Record<string, string> = { sr_restaurants: '/admin/sr/restaurants' }

function usePlatformCounts(codes: string[]) {
  const [counts, setCounts] = useState<Record<string, number | null>>({})
  const key = codes.join(',')
  useEffect(() => {
    let alive = true
    Promise.allSettled(codes.map((c) => adminFetch<PlatformShell>(`/platforms/${c}`))).then((rs) => {
      if (!alive) return
      const next: Record<string, number | null> = {}
      rs.forEach((r, i) => {
        // A platform the user may not read the shell of reports "no data", never a made-up zero.
        next[codes[i]] = r.status === 'fulfilled' ? Object.values(r.value.counts).reduce((a, b) => a + b, 0) : null
      })
      setCounts(next)
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return counts
}

function toneFor(v: string): Tone { return v === 'UP' || v === 'CONFIGURED' ? 'pos' : v === 'DOWN' ? 'crit' : 'neu' }

/** Total of a work-queue view, scoped to the chosen platform. A page of one row is enough: only `total` is read. */
function useQueueTotal(enabled: boolean, view: string, platformId: string | undefined) {
  const q = useAdminGet<Page<WorkItem>>(enabled ? `/work/items${qs({ view, platformId, pageSize: 1 })}` : null)
  return { total: q.data ? q.data.total : null, loading: q.loading && enabled, error: q.error }
}

function CountRow({ label, count, note, to, loading }: { label: string; count: number | null; note?: ReactNode; to?: string; loading?: boolean }) {
  return (
    <li className={count ? 'has-count' : undefined}>
      <span>{to ? <Link to={to}><b>{label}</b></Link> : <b>{label}</b>}{note ? <><br /><span className="adm-note">{note}</span></> : null}</span>
      {loading ? <span className="adm-skel" style={{ width: 28, height: 14 }} aria-label="Loading" /> : count === null ? <span className="adm-faint">Not available</span> : <span className="adm-count">{count}</span>}
    </li>
  )
}

export function CommandCenterPage() {
  const c = useConsole()
  const [range, setRange] = useState('7')
  const cc = useAdminGet<CC>('/command-center')
  const scoped = c.platform !== 'ALL'
  const platformId = scoped ? c.ctx?.platforms.find((p) => p.code === c.platform)?.id : undefined
  const shell = useAdminGet<PlatformShell>(scoped ? `/platforms/${c.platform}` : null)
  const from = useMemo(() => new Date(Date.now() - Number(range) * 86400_000).toISOString(), [range])
  const activity = useAdminGet<Page<AuditEvent>>(`/audit/events${qs({ pageSize: 8, from, platformCode: scoped ? c.platform : undefined })}`)
  const health = useAdminGet<Health>(c.can('platform_health.view') ? '/health' : null)
  const platforms = c.me.platforms.filter((p) => p.authorized && (!scoped || p.code === c.platform))
  const counts = usePlatformCounts(platforms.map((p) => p.code))
  const t = cc.data?.tiles ?? {}
  const scopeLabel = scoped ? platforms[0]?.displayName ?? c.platform : 'All platforms'
  const legal = legalEntityView(c.ctx)
  const canWork = c.can('work.view')
  const overdue = useQueueTotal(canWork, 'overdue', platformId)
  const urgent = useQueueTotal(canWork, 'priority', platformId)
  const blocked = useQueueTotal(canWork, 'blocked', platformId)
  const unassigned = useQueueTotal(canWork, 'unassigned', platformId)
  const mine = useQueueTotal(canWork, 'mine', platformId)

  // Platform-scoped figures come from the platform shell; organization-wide ones from the command-center tiles.
  const approvals = scoped ? shell.data?.counts.pendingApprovals ?? null : t.pendingApprovals ?? null
  const docs = scoped ? shell.data?.counts.documentsNeedingReview ?? null : t.documentsNeedingReview ?? null
  const support = scoped ? shell.data?.counts.openSupportCases ?? null : t.openSupportCases ?? null
  const security = scoped ? null : t.securityEvents7d ?? null

  type Urgent = { key: string; label: string; value: number | null; note: string; tone: 'warn' | 'crit'; to?: string }
  const urgentAll: Urgent[] = [
    { key: 'overdue', label: 'Overdue work', value: overdue.total, note: 'Past its due date', tone: 'crit', to: '/admin/work' },
    { key: 'urgent', label: 'High-priority work', value: urgent.total, note: 'Urgent or high, still open', tone: 'crit', to: '/admin/work' },
    { key: 'blocked', label: 'Blocked work', value: blocked.total, note: 'Something is in the way', tone: 'warn', to: '/admin/work' },
    { key: 'approvals', label: 'Pending approvals', value: approvals, note: 'Awaiting a decision', tone: 'warn' },
    { key: 'security', label: 'Security events', value: security, note: 'Last 7 days', tone: 'warn' },
  ]
  const urgentNow = urgentAll.filter((u) => (u.value ?? 0) > 0)
  const urgentLoading = cc.loading || (scoped && shell.loading) || overdue.loading || urgent.loading || blocked.loading
  const knownUrgent = urgentAll.filter((u) => u.value !== null)

  return (
    <>
      <PageHeader
        title="Command Center"
        subtitle={<>{legal.label} · <b>{scopeLabel}</b></>}
        actions={<>
          <label className="adm-sr" htmlFor="cc-range">Activity period</label>
          <select id="cc-range" className="adm-select" value={range} onChange={(e) => setRange(e.target.value)}>{RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select>
        </>}
      />

      <section className="adm-section" aria-labelledby="cc-urgent" style={{ marginTop: 0 }}>
        <h2 id="cc-urgent">Urgent attention</h2>
        {cc.error ? <ErrorState error={cc.error} onRetry={cc.reload} />
          : urgentLoading ? <div className="adm-card adm-card-b"><LoadingSkeleton rows={2} label="Loading urgent items" /></div>
          : urgentNow.length > 0 ? (
            <div className="adm-grid adm-g4">
              {urgentNow.map((u) => <MetricCard key={u.key} label={u.label} value={u.value} note={u.note} tone={u.tone} href={u.to} />)}
            </div>
          ) : knownUrgent.length > 0 ? (
            <div className="adm-calm" role="status"><StatusBadge tone="pos">All clear</StatusBadge><span>Nothing is overdue, blocked, urgent or waiting on an approval{scoped ? ` for ${scopeLabel}` : ''}.</span></div>
          ) : <EmptyState kind="no-permission" title="No attention counts for your role">Your role does not include work, approval or security counts.</EmptyState>}
      </section>

      <section className="adm-section" aria-labelledby="cc-exc">
        <h2 id="cc-exc">Operational exceptions</h2>
        <div className="adm-card">
          <ul className="adm-list adm-counts" aria-label="Queues that need triage">
            <CountRow label="Documents waiting for review" count={docs} loading={cc.loading || (scoped && shell.loading)} />
            <CountRow label="Open support cases" count={support} loading={cc.loading || (scoped && shell.loading)} />
            {canWork ? <CountRow label="Unassigned work" count={unassigned.total} loading={unassigned.loading} to="/admin/work" note="Nobody owns these yet" /> : null}
            {canWork ? <CountRow label="Assigned to you" count={mine.total} loading={mine.loading} to="/admin/work" /> : null}
          </ul>
          <p className="adm-note adm-card-b" style={{ borderTop: '1px solid var(--adm-border)', margin: 0 }}>Late orders, unassigned deliveries and courier exceptions will appear here once the restaurant ordering and delivery modules are connected.</p>
        </div>
      </section>

      <section className="adm-section" aria-labelledby="cc-plat">
        <h2 id="cc-plat">Platforms</h2>
        {platforms.length === 0 ? <EmptyState kind="no-permission" title="No platforms available">You are not authorized for any platform in this scope.</EmptyState> : (
          <div className="adm-grid adm-g4">
            {platforms.map((p) => {
              const href = BUILT_SCREENS[p.code]
              return <PlatformCard key={p.code} name={p.displayName} status={p.status} statusLabel={PLATFORM_STATUS_LABEL[p.status] ?? humanize(p.status)} attention={counts[p.code] ?? null} href={href} note={p.status === 'SETUP' ? 'Operations module not built yet' : undefined} />
            })}
          </div>
        )}
        <p className="adm-note" style={{ marginTop: 8 }}>Only platforms you are authorized for are shown. No platform reports revenue, orders or health to this console yet, so none are displayed.</p>
      </section>

      <div className="adm-grid adm-g-main adm-section">
        <section aria-labelledby="cc-act" className="adm-card">
          <div className="adm-card-h"><h2 id="cc-act">Recent activity</h2><span className="adm-note">{RANGES.find((r) => r.key === range)?.label}</span></div>
          {activity.loading ? <div className="adm-card-b"><LoadingSkeleton rows={4} label="Loading activity" /></div>
            : activity.error ? <div className="adm-card-b">{activity.error.status === 403 ? <EmptyState kind="no-permission" title="Activity is not available to your role">Recent activity is visible to roles with audit access.</EmptyState> : <ErrorState error={activity.error} onRetry={activity.reload} />}</div>
            : activity.data && activity.data.items.length > 0 ? (
              <ul className="adm-list" aria-label="Recent audit events">
                {activity.data.items.map((a) => (
                  <li key={a.id}>
                    <span><b>{humanize(a.action)}</b><br /><span className="adm-note">{a.actor?.displayName ?? 'System'}{a.platformCode ? ` · ${humanize(a.platformCode)}` : ''}</span></span>
                    <time className="adm-note" dateTime={a.createdAt}>{dateTime(a.createdAt)}</time>
                  </li>
                ))}
              </ul>
            ) : <div className="adm-card-b"><EmptyState kind="no-data" title="No activity in this period">Changes made in the console appear here as they happen.</EmptyState></div>}
        </section>

        <section className="adm-card" aria-labelledby="cc-health">
          <div className="adm-card-h"><h2 id="cc-health">System health</h2></div>
          <div className="adm-card-b">
            {!c.can('platform_health.view') ? <EmptyState kind="no-permission" title="Health is not available to your role">Health is visible to roles with platform-health access.</EmptyState>
              : health.loading ? <LoadingSkeleton rows={3} label="Loading system health" />
              : health.error ? <ErrorState error={health.error} onRetry={health.reload} />
              : health.data ? (
                <dl className="adm-dl">
                  <dt>API</dt><dd><StatusBadge tone={toneFor(health.data.system.api.status)}>{humanize(health.data.system.api.status)}</StatusBadge></dd>
                  <dt>Database</dt><dd><StatusBadge tone={toneFor(health.data.system.database.status)}>{humanize(health.data.system.database.status)}</StatusBadge>{health.data.system.database.latencyMs !== undefined ? <span className="adm-note"> {health.data.system.database.latencyMs} ms</span> : null}</dd>
                  <dt>Storage</dt><dd><StatusBadge tone={toneFor(health.data.system.storage.status)}>{humanize(health.data.system.storage.status)}</StatusBadge></dd>
                  <dt>Integrations</dt><dd><StatusBadge tone="neu">{humanize(health.data.integrations.status)}</StatusBadge><div className="adm-note">{health.data.integrations.message}</div></dd>
                </dl>
              ) : null}
          </div>
        </section>
      </div>

      <section className="adm-fin-strip" aria-labelledby="cc-fin">
        <h2 id="cc-fin">Financial snapshot</h2>
        <StatusBadge tone="neu">Not available</StatusBadge>
        <span><b>AVAILABLE AFTER ACCOUNTING ENGINE.</b> {cc.data?.finance.message ?? 'Financial figures appear here once the accounting engine exists.'}</span>
      </section>
    </>
  )
}
