import { useEffect, useMemo, useState } from 'react'
import { adminFetch, qs, useAdminGet, type AuditEvent, type CommandCenter as CC, type Health, type Page, type PlatformShell } from '../api'
import { dateTime, humanize } from '../format'
import { EmptyState, ErrorState, LoadingSkeleton, MetricCard, PageHeader, PlatformCard, StatusBadge, PLATFORM_STATUS_LABEL, type Tone } from '../components/ui'
import { useConsole } from '../components/shell'

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

export function CommandCenterPage() {
  const c = useConsole()
  const [range, setRange] = useState('7')
  const cc = useAdminGet<CC>('/command-center')
  const scoped = c.platform !== 'ALL'
  const shell = useAdminGet<PlatformShell>(scoped ? `/platforms/${c.platform}` : null)
  const from = useMemo(() => new Date(Date.now() - Number(range) * 86400_000).toISOString(), [range])
  const activity = useAdminGet<Page<AuditEvent>>(`/audit/events${qs({ pageSize: 8, from, platformCode: scoped ? c.platform : undefined })}`)
  const health = useAdminGet<Health>(c.can('platform_health.view') ? '/health' : null)
  const platforms = c.me.platforms.filter((p) => p.authorized && (!scoped || p.code === c.platform))
  const counts = usePlatformCounts(platforms.map((p) => p.code))
  const t = cc.data?.tiles ?? {}
  const scopeLabel = scoped ? platforms[0]?.displayName ?? c.platform : 'All platforms'
  const le = c.ctx?.legalEntities[0]

  return (
    <>
      <PageHeader
        title="Command Center"
        subtitle={<>{le?.name ?? 'Organization'} · <b>{scopeLabel}</b></>}
        actions={<>
          <label className="adm-sr" htmlFor="cc-range">Activity period</label>
          <select id="cc-range" className="adm-select" value={range} onChange={(e) => setRange(e.target.value)}>{RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select>
        </>}
      />

      <section className="adm-section" aria-labelledby="cc-attn" style={{ marginTop: 0 }}>
        <h2 id="cc-attn">Attention required</h2>
        {cc.loading ? <div className="adm-card adm-card-b"><LoadingSkeleton rows={2} label="Loading attention counts" /></div>
          : cc.error ? <ErrorState error={cc.error} onRetry={cc.reload} />
          : scoped ? (
            shell.loading ? <div className="adm-card adm-card-b"><LoadingSkeleton rows={2} /></div>
            : shell.error ? <ErrorState error={shell.error} onRetry={shell.reload} />
            : shell.data ? (
              <div className="adm-grid adm-g4">
                <MetricCard label="Open work" value={shell.data.counts.openWork} note={`${scopeLabel} only`} />
                <MetricCard label="Pending approvals" value={shell.data.counts.pendingApprovals} />
                <MetricCard label="Document review" value={shell.data.counts.documentsNeedingReview} />
                <MetricCard label="Open support cases" value={shell.data.counts.openSupportCases} />
              </div>
            ) : null
          ) : (
            <div className="adm-grid adm-g5">
              {t.myOpenWork !== undefined ? <MetricCard label="My Work" value={t.myOpenWork} href="/admin/work" note={t.overdueWork ? `${t.overdueWork} overdue` : 'Assigned to you'} tone={t.overdueWork ? 'warn' : undefined} /> : null}
              {t.pendingApprovals !== undefined ? <MetricCard label="Approvals" value={t.pendingApprovals} note="Awaiting your decision" tone={t.pendingApprovals ? 'warn' : undefined} /> : null}
              {t.documentsNeedingReview !== undefined ? <MetricCard label="Document review" value={t.documentsNeedingReview} /> : null}
              {t.openSupportCases !== undefined ? <MetricCard label="Support" value={t.openSupportCases} note="Open cases" /> : null}
              {t.securityEvents7d !== undefined ? <MetricCard label="Security" value={t.securityEvents7d} note="Security events, 7 days" tone={t.securityEvents7d ? 'warn' : undefined} /> : null}
              {Object.keys(t).length === 0 ? <EmptyState title="Nothing to show">Your role does not include any attention counts.</EmptyState> : null}
            </div>
          )}
      </section>

      <section className="adm-section" aria-labelledby="cc-plat">
        <h2 id="cc-plat">Platform operations</h2>
        {platforms.length === 0 ? <EmptyState title="No platforms available">You are not authorized for any platform in this scope.</EmptyState> : (
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
            : activity.error ? <div className="adm-card-b">{activity.error.status === 403 ? <p className="adm-note">Activity is visible to roles with audit access.</p> : <ErrorState error={activity.error} onRetry={activity.reload} />}</div>
            : activity.data && activity.data.items.length > 0 ? (
              <ul className="adm-list" aria-label="Recent audit events">
                {activity.data.items.map((a) => (
                  <li key={a.id}>
                    <span><b>{humanize(a.action)}</b><br /><span className="adm-note">{a.actor?.displayName ?? 'System'}{a.platformCode ? ` · ${a.platformCode}` : ''}</span></span>
                    <time className="adm-note" dateTime={a.createdAt}>{dateTime(a.createdAt)}</time>
                  </li>
                ))}
              </ul>
            ) : <div className="adm-card-b"><p className="adm-note">No recorded activity in this period.</p></div>}
        </section>

        <div className="adm-grid">
          <section className="adm-card" aria-labelledby="cc-health">
            <div className="adm-card-h"><h2 id="cc-health">System health</h2></div>
            <div className="adm-card-b">
              {!c.can('platform_health.view') ? <p className="adm-note">Health is visible to roles with platform-health access.</p>
                : health.loading ? <LoadingSkeleton rows={3} />
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
          <section className="adm-card" aria-labelledby="cc-fin">
            <div className="adm-card-h"><h2 id="cc-fin">Financial snapshot</h2><StatusBadge tone="neu">Not available</StatusBadge></div>
            <div className="adm-card-b"><b>AVAILABLE AFTER ACCOUNTING ENGINE</b><p className="adm-note" style={{ margin: '6px 0 0' }}>{cc.data?.finance.message ?? 'Financial figures appear here once the accounting engine exists.'}</p></div>
          </section>
        </div>
      </div>
    </>
  )
}
