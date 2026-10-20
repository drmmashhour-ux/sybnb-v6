import { useEffect, useMemo, useState } from 'react'
import { qs, useAdminGet, type AuditEvent, type Page, type PartyDetail, type PartyListItem } from '../api'
import { dateTime, humanize } from '../format'
import { DataTable, type Column, type SortState } from '../components/DataTable'
import {
  CommentPanel, EmptyState, EntityHeader, EntityTimeline, ErrorState, FilterBar, Link, LoadingSkeleton, PageHeader, SearchInput, StatusBadge, TabPanel, Tabs, Timeline, toneForParty, type TabDef,
} from '../components/ui'
import { useConsole } from '../components/shell'
import { ROLE_STATE_LABEL, groupRoles, roleState } from '../roles'

export function PartiesListPage() {
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState<SortState>(null)
  const [page, setPage] = useState(1)
  const sortParam = sort ? `${sort.key}:${sort.dir}` : undefined
  useEffect(() => setPage(1), [q, kind, status, sortParam])
  const list = useAdminGet<Page<PartyListItem>>(`/parties${qs({ q, kind, status, sort: sortParam, page, pageSize: 25 })}`)
  const columns: Array<Column<PartyListItem>> = useMemo(() => [
    { key: 'name', header: 'Name', sortKey: 'displayName', primary: true, render: (p) => <Link to={`/admin/parties/${p.id}`} className="adm-rowbtn">{p.displayName}</Link> },
    { key: 'kind', header: 'Type', render: (p) => (p.kind === 'PERSON' ? 'Person' : 'Company') },
    { key: 'roles', header: 'Roles', render: (p) => (p.roles.length ? <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{p.roles.map((r) => <span className="adm-chip" key={r}>{humanize(r)}</span>)}</span> : <span className="adm-faint">None</span>) },
    { key: 'contact', header: 'Contact', hideOnMobile: true, render: (p) => <span className="adm-mono">{p.email ?? p.phone ?? '—'}</span> },
    { key: 'status', header: 'Status', sortKey: 'status', render: (p) => <StatusBadge tone={toneForParty(p.status)}>{humanize(p.status)}</StatusBadge> },
  ], [])
  return (
    <>
      <PageHeader title="Parties" subtitle="People and companies the business deals with. One party can hold several roles." crumbs={[{ label: 'Command Center', to: '/admin' }, { label: 'Parties' }]} />
      <FilterBar label="Filter parties">
        <SearchInput value={q} onChange={setQ} label="Search parties by name or email" placeholder="Search name or email" />
        <label className="adm-sr" htmlFor="pf-kind">Type</label>
        <select id="pf-kind" className="adm-select" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">All types</option><option value="PERSON">Person</option><option value="ORGANIZATION">Company</option></select>
        <label className="adm-sr" htmlFor="pf-status">Status</label>
        <select id="pf-status" className="adm-select" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{['ACTIVE', 'INACTIVE', 'BLOCKED'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select>
      </FilterBar>
      <DataTable caption="Parties" columns={columns} rows={list.data?.items ?? []} rowKey={(p) => p.id} loading={list.loading} error={list.error} onRetry={list.reload}
        sort={sort} onSort={setSort} page={list.data?.page} totalPages={list.data?.totalPages} total={list.data?.total} onPage={setPage}
        empty={<EmptyState title="No parties found">{q || kind || status ? 'No party matches these filters.' : 'No parties have been recorded yet.'}</EmptyState>} />
    </>
  )
}

const TAB_LABELS: TabDef[] = [
  { key: 'overview', label: 'Overview' }, { key: 'roles', label: 'Roles' }, { key: 'contact', label: 'Contact' }, { key: 'addresses', label: 'Addresses' },
  { key: 'platforms', label: 'Platforms' }, { key: 'documents', label: 'Documents' }, { key: 'support', label: 'Support' }, { key: 'notes', label: 'Notes' },
  { key: 'activity', label: 'Activity' }, { key: 'audit', label: 'Audit' },
  // Finance is added only once a finance module exists AND the viewer is authorized. Neither is true yet.
  { key: 'finance', label: 'Finance', hidden: true },
]

function AuditTab({ id }: { id: string }) {
  const q = useAdminGet<Page<AuditEvent>>(`/audit/events${qs({ entityType: 'party', entityId: id, pageSize: 20 })}`)
  if (q.loading) return <LoadingSkeleton rows={3} />
  if (q.error) return q.error.status === 403 ? <EmptyState kind="no-permission" title="The audit trail is not available to your role">Roles with audit access can see technical audit events here.</EmptyState> : <ErrorState error={q.error} onRetry={q.reload} />
  if (!q.data || q.data.items.length === 0) return <EmptyState kind="no-data" title="No audit events">Nothing has been recorded in the audit trail for this party.</EmptyState>
  return <Timeline label="Audit events" rows={q.data.items.map((a) => ({ id: a.id, at: a.createdAt, title: humanize(a.action), detail: a.actor?.displayName ?? 'System' }))} />
}

type PartyRoleRow = PartyDetail['roles'][number]

function RoleCard({ r, platform }: { r: PartyRoleRow; platform: string }) {
  const st = roleState(r)
  return (
    <li className={`adm-rolecard is-${st.toLowerCase()}`}>
      <span><b>{humanize(r.roleType)}</b><br /><span className="adm-note">{platform}{r.effectiveFrom ? ` · from ${dateTime(r.effectiveFrom)}` : ''}{r.effectiveTo ? ` · until ${dateTime(r.effectiveTo)}` : ''}</span></span>
      <StatusBadge tone={st === 'ACTIVE' ? 'pos' : st === 'PENDING' ? 'info' : 'neu'}>{ROLE_STATE_LABEL[st]}</StatusBadge>
    </li>
  )
}

export function PartyDetailPage({ id }: { id: string }) {
  const c = useConsole()
  const [tab, setTab] = useState('overview')
  const q = useAdminGet<PartyDetail>(`/parties/${id}`)
  const crumbsLoading = [{ label: 'Command Center', to: '/admin' }, { label: 'Parties', to: '/admin/parties' }, { label: 'Party' }]
  if (q.loading) return <><PageHeader title="Party" crumbs={crumbsLoading} /><div className="adm-card adm-card-b"><LoadingSkeleton rows={5} label="Loading party" /></div></>
  if (q.error || !q.data) return <><PageHeader title="Party" crumbs={crumbsLoading} />{q.error ? <ErrorState error={q.error} onRetry={q.reload} /> : null}</>
  const { party, roles, addresses, documents, supportCases, linkedAccounts } = q.data
  const grouped = groupRoles(roles)
  const active = grouped.ACTIVE
  // Participation counts ACTIVE roles only: a retired role is history, not participation.
  const activePlatformIds = [...new Set(active.map((r) => r.platformId).filter((x): x is string => Boolean(x)))]
  const historyOnlyIds = [...new Set(roles.filter((r) => r.platformId && !activePlatformIds.includes(r.platformId)).map((r) => r.platformId as string))]
  const platformName = (pid: string | null) => c.platformName(pid)
  const tabs = TAB_LABELS.map((t) => ({
    ...t,
    count: t.key === 'roles' ? active.length : t.key === 'documents' ? documents.length : t.key === 'support' ? supportCases.length : t.key === 'addresses' ? addresses.length : undefined,
  }))
  return (
    <>
      <PageHeader crumbs={[{ label: 'Command Center', to: '/admin' }, { label: 'Parties', to: '/admin/parties' }, { label: party.displayName }]} />
      <EntityHeader
        name={party.displayName} kindLabel={party.kind === 'PERSON' ? 'Person' : 'Company'}
        badges={<>
          <StatusBadge tone={toneForParty(party.status)}>{humanize(party.status)}</StatusBadge>
          {active.length === 0 ? <span className="adm-chip">No active roles</span> : <span className="adm-chip">{active.length} active {active.length === 1 ? 'role' : 'roles'}</span>}
          {/* A risk badge is intentionally absent: the party record carries no risk assessment, and none is invented. */}
        </>}
        meta={<>
          {activePlatformIds.length > 0 ? <>On {activePlatformIds.map(platformName).join(', ')} · </> : <>Not active on any platform · </>}
          {party.legalName && party.legalName !== party.displayName ? <>Legal name: {party.legalName} · </> : null}Added {dateTime(party.createdAt)}
        </>}
      />
      <section className="adm-rolestrip" aria-label="Roles at a glance">
        <h2>Roles</h2>
        {active.length === 0 && grouped.PENDING.length === 0 ? <p className="adm-note" style={{ margin: 0 }}>This party has no active or pending roles.{grouped.HISTORICAL.length ? ` ${grouped.HISTORICAL.length} historical ${grouped.HISTORICAL.length === 1 ? 'role is' : 'roles are'} on the Roles tab.` : ''}</p> : (
          <ul className="adm-rolegrid" aria-label="Active and pending roles">
            {[...active, ...grouped.PENDING].map((r) => <RoleCard key={r.id} r={r} platform={platformName(r.platformId)} />)}
          </ul>
        )}
      </section>
      <Tabs tabs={tabs} value={tab} onChange={setTab} label="Party sections" idPrefix="party" />
      <TabPanel idPrefix="party" active={tab}>
        {tab === 'overview' ? (
          <div className="adm-grid adm-g2">
            <section className="adm-card" aria-label="Identity"><div className="adm-card-h"><h2>Identity</h2></div><div className="adm-card-b"><dl className="adm-dl"><dt>Type</dt><dd>{party.kind === 'PERSON' ? 'Person' : 'Company'}</dd><dt>Status</dt><dd>{humanize(party.status)}</dd><dt>Roles</dt><dd>{active.length} active · {grouped.PENDING.length} pending · {grouped.HISTORICAL.length} historical</dd><dt>Linked sign-in accounts</dt><dd>{linkedAccounts.length}</dd></dl></div></section>
            <section className="adm-card" aria-label="Open items"><div className="adm-card-h"><h2>Open items</h2></div><div className="adm-card-b"><dl className="adm-dl"><dt>Documents</dt><dd>{documents.length}</dd><dt>Support cases</dt><dd>{supportCases.length}</dd><dt>Active platforms</dt><dd>{activePlatformIds.length}</dd></dl></div></section>
          </div>
        ) : null}
        {tab === 'roles' ? (roles.length === 0 ? <EmptyState kind="no-data" title="No roles yet">This party has not been given any role. A party can hold several at once, for example Restaurant Owner and SR Courier.</EmptyState> : (
          <div className="adm-grid">
            {(['ACTIVE', 'PENDING', 'HISTORICAL'] as const).map((st) => grouped[st].length === 0 ? null : (
              <section key={st} aria-label={`${ROLE_STATE_LABEL[st]} roles`}>
                <h3 className="adm-tier" style={{ margin: '0 0 8px' }}>{ROLE_STATE_LABEL[st]} roles <span className="adm-tab-n">{grouped[st].length}</span></h3>
                <ul className="adm-rolegrid" aria-label={`${ROLE_STATE_LABEL[st]} roles`}>{grouped[st].map((r) => <RoleCard key={r.id} r={r} platform={platformName(r.platformId)} />)}</ul>
              </section>
            ))}
            <p className="adm-note" style={{ margin: 0 }}>Historical roles are kept for the record. They no longer grant anything and do not count as platform participation.</p>
          </div>
        )) : null}
        {tab === 'contact' ? (
          <div className="adm-card adm-card-b"><dl className="adm-dl"><dt>Email</dt><dd className="adm-mono">{party.email ?? '—'}</dd><dt>Phone</dt><dd className="adm-mono">{party.phone ?? '—'}</dd></dl>{party.contactMasked ? <p className="adm-note">Contact details are partly hidden. Full details need the sensitive-contact permission.</p> : null}</div>
        ) : null}
        {tab === 'addresses' ? (addresses.length === 0 ? <EmptyState kind="no-data" title="No addresses">No address has been recorded for this party.</EmptyState> : (
          <ul className="adm-list adm-card" aria-label="Addresses">{addresses.map((a) => (<li key={a.id}><span><b>{a.label ?? 'Address'}</b><br /><span className="adm-note">{[a.line1, a.city, a.region, a.postalCode, a.country].filter(Boolean).join(', ') || '—'}</span></span></li>))}</ul>
        )) : null}
        {tab === 'platforms' ? (activePlatformIds.length === 0 && historyOnlyIds.length === 0 ? <EmptyState kind="no-data" title="Not on any platform">Platforms appear here when one of the party’s roles is tied to a platform.</EmptyState> : (
          <div className="adm-grid">
            {activePlatformIds.length > 0 ? <ul className="adm-list adm-card" aria-label="Active platforms">{activePlatformIds.map((pid) => (<li key={pid}><span><b>{platformName(pid)}</b><br /><span className="adm-note">{active.filter((r) => r.platformId === pid).map((r) => humanize(r.roleType)).join(', ')}</span></span><StatusBadge tone="pos">Active</StatusBadge></li>))}</ul> : <p className="adm-note" style={{ margin: 0 }}>No active platform participation.</p>}
            {historyOnlyIds.length > 0 ? <ul className="adm-list adm-card" aria-label="Past platforms">{historyOnlyIds.map((pid) => (<li key={pid}><span><b>{platformName(pid)}</b><br /><span className="adm-note">{roles.filter((r) => r.platformId === pid).map((r) => humanize(r.roleType)).join(', ')}</span></span><StatusBadge tone="neu">Historical</StatusBadge></li>))}</ul> : null}
          </div>
        )) : null}
        {tab === 'documents' ? (documents.length === 0 ? <EmptyState kind="no-data" title="No documents">No documents are attached to this party.</EmptyState> : (
          <ul className="adm-list adm-card" aria-label="Documents">{documents.map((d) => (<li key={d.id}><span><b>{d.title}</b><br /><span className="adm-note">{humanize(d.documentType)}</span></span><StatusBadge tone={d.status === 'VERIFIED' ? 'pos' : d.status === 'REJECTED' ? 'crit' : d.status === 'NEEDS_REVIEW' ? 'warn' : 'neu'}>{humanize(d.status)}</StatusBadge></li>))}</ul>
        )) : null}
        {tab === 'support' ? (supportCases.length === 0 ? <EmptyState kind="no-data" title="No support cases">This party has no support history.</EmptyState> : (
          <ul className="adm-list adm-card" aria-label="Support cases">{supportCases.map((s) => (<li key={s.id}><span><b>#{s.caseNumber}</b> {s.summary}</span><StatusBadge tone={s.status === 'RESOLVED' || s.status === 'CLOSED' ? 'pos' : 'info'}>{humanize(s.status)}</StatusBadge></li>))}</ul>
        )) : null}
        {tab === 'notes' ? <div className="adm-card adm-card-b"><CommentPanel entityType="party" entityId={party.id} /></div> : null}
        {tab === 'activity' ? <div className="adm-card adm-card-b"><EntityTimeline entityType="party" entityId={party.id} /></div> : null}
        {tab === 'audit' ? <div className="adm-card adm-card-b"><p className="adm-note" style={{ marginTop: 0 }}>Technical audit trail. Unlike Activity, this view shows the system’s own action names.</p><AuditTab id={party.id} /></div> : null}
      </TabPanel>
    </>
  )
}
