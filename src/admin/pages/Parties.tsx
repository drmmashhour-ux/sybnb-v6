import { useEffect, useMemo, useState } from 'react'
import { qs, useAdminGet, type AuditEvent, type Page, type PartyDetail, type PartyListItem } from '../api'
import { dateTime, humanize } from '../format'
import { DataTable, type Column, type SortState } from '../components/DataTable'
import {
  CommentPanel, EmptyState, EntityHeader, EntityTimeline, ErrorState, FilterBar, Link, LoadingSkeleton, PageHeader, SearchInput, StatusBadge, TabPanel, Tabs, Timeline, toneForParty, type TabDef,
} from '../components/ui'
import { useConsole } from '../components/shell'

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
  if (q.error) return q.error.status === 403 ? <p className="adm-note">The audit trail is visible to roles with audit access.</p> : <ErrorState error={q.error} onRetry={q.reload} />
  if (!q.data || q.data.items.length === 0) return <p className="adm-note">No audit events for this party.</p>
  return <Timeline label="Audit events" rows={q.data.items.map((a) => ({ id: a.id, at: a.createdAt, title: humanize(a.action), detail: a.actor?.displayName ?? 'System' }))} />
}

export function PartyDetailPage({ id }: { id: string }) {
  const c = useConsole()
  const [tab, setTab] = useState('overview')
  const q = useAdminGet<PartyDetail>(`/parties/${id}`)
  if (q.loading) return <><PageHeader title="Party" crumbs={[{ label: 'Parties', to: '/admin/parties' }, { label: 'Party' }]} /><div className="adm-card adm-card-b"><LoadingSkeleton rows={5} label="Loading party" /></div></>
  if (q.error || !q.data) return <><PageHeader title="Party" crumbs={[{ label: 'Parties', to: '/admin/parties' }, { label: 'Party' }]} />{q.error ? <ErrorState error={q.error} onRetry={q.reload} /> : null}</>
  const { party, roles, addresses, documents, supportCases, linkedAccounts } = q.data
  const active = roles.filter((r) => r.status === 'ACTIVE')
  const platformIds = [...new Set(roles.map((r) => r.platformId).filter((x): x is string => Boolean(x)))]
  const tabs = TAB_LABELS.map((t) => ({
    ...t,
    count: t.key === 'roles' ? roles.length : t.key === 'documents' ? documents.length : t.key === 'support' ? supportCases.length : t.key === 'addresses' ? addresses.length : undefined,
  }))
  return (
    <>
      <PageHeader crumbs={[{ label: 'Command Center', to: '/admin' }, { label: 'Parties', to: '/admin/parties' }, { label: party.displayName }]} />
      <EntityHeader
        name={party.displayName} kindLabel={party.kind === 'PERSON' ? 'Person' : 'Company'}
        badges={<>
          <StatusBadge tone={toneForParty(party.status)}>{humanize(party.status)}</StatusBadge>
          {active.length === 0 ? <span className="adm-chip">No active roles</span> : active.map((r) => <span className="adm-chip" key={r.id}>{humanize(r.roleType)}{r.platformId ? ` · ${c.platformName(r.platformId)}` : ''}</span>)}
        </>}
        meta={<>{party.legalName && party.legalName !== party.displayName ? <>Legal name: {party.legalName} · </> : null}Added {dateTime(party.createdAt)}</>}
      />
      <Tabs tabs={tabs} value={tab} onChange={setTab} label="Party sections" idPrefix="party" />
      <TabPanel idPrefix="party" active={tab}>
        {tab === 'overview' ? (
          <div className="adm-grid adm-g2">
            <section className="adm-card" aria-label="Identity"><div className="adm-card-h"><h2>Identity</h2></div><div className="adm-card-b"><dl className="adm-dl"><dt>Type</dt><dd>{party.kind === 'PERSON' ? 'Person' : 'Company'}</dd><dt>Status</dt><dd>{humanize(party.status)}</dd><dt>Roles</dt><dd>{active.length} active of {roles.length}</dd><dt>Linked sign-in accounts</dt><dd>{linkedAccounts.length}</dd></dl></div></section>
            <section className="adm-card" aria-label="Open items"><div className="adm-card-h"><h2>Open items</h2></div><div className="adm-card-b"><dl className="adm-dl"><dt>Documents</dt><dd>{documents.length}</dd><dt>Support cases</dt><dd>{supportCases.length}</dd><dt>Platforms</dt><dd>{platformIds.length}</dd></dl></div></section>
          </div>
        ) : null}
        {tab === 'roles' ? (roles.length === 0 ? <EmptyState title="No roles yet">This party has not been given any role. A party can hold several at once.</EmptyState> : (
          <ul className="adm-list adm-card" aria-label="Roles">{roles.map((r) => (<li key={r.id}><span><b>{humanize(r.roleType)}</b><br /><span className="adm-note">{c.platformName(r.platformId)}{r.effectiveFrom ? ` · from ${dateTime(r.effectiveFrom)}` : ''}{r.effectiveTo ? ` · until ${dateTime(r.effectiveTo)}` : ''}</span></span><StatusBadge tone={r.status === 'ACTIVE' ? 'pos' : 'neu'}>{humanize(r.status)}</StatusBadge></li>))}</ul>
        )) : null}
        {tab === 'contact' ? (
          <div className="adm-card adm-card-b"><dl className="adm-dl"><dt>Email</dt><dd className="adm-mono">{party.email ?? '—'}</dd><dt>Phone</dt><dd className="adm-mono">{party.phone ?? '—'}</dd></dl>{party.contactMasked ? <p className="adm-note">Contact details are partly hidden. Full details need the sensitive-contact permission.</p> : null}</div>
        ) : null}
        {tab === 'addresses' ? (addresses.length === 0 ? <EmptyState title="No addresses">No address has been recorded for this party.</EmptyState> : (
          <ul className="adm-list adm-card" aria-label="Addresses">{addresses.map((a) => (<li key={a.id}><span><b>{a.label ?? 'Address'}</b><br /><span className="adm-note">{[a.line1, a.city, a.region, a.postalCode, a.country].filter(Boolean).join(', ') || '—'}</span></span></li>))}</ul>
        )) : null}
        {tab === 'platforms' ? (platformIds.length === 0 ? <EmptyState title="Not on any platform">Platforms appear here when a role is tied to one.</EmptyState> : (
          <ul className="adm-list adm-card" aria-label="Platforms">{platformIds.map((pid) => (<li key={pid}><b>{c.platformName(pid)}</b><span className="adm-note">{roles.filter((r) => r.platformId === pid).map((r) => humanize(r.roleType)).join(', ')}</span></li>))}</ul>
        )) : null}
        {tab === 'documents' ? (documents.length === 0 ? <EmptyState title="No documents">No documents are attached to this party.</EmptyState> : (
          <ul className="adm-list adm-card" aria-label="Documents">{documents.map((d) => (<li key={d.id}><span><b>{d.title}</b><br /><span className="adm-note">{humanize(d.documentType)}</span></span><StatusBadge tone={d.status === 'VERIFIED' ? 'pos' : d.status === 'REJECTED' ? 'crit' : d.status === 'NEEDS_REVIEW' ? 'warn' : 'neu'}>{humanize(d.status)}</StatusBadge></li>))}</ul>
        )) : null}
        {tab === 'support' ? (supportCases.length === 0 ? <EmptyState title="No support cases">This party has no support history.</EmptyState> : (
          <ul className="adm-list adm-card" aria-label="Support cases">{supportCases.map((s) => (<li key={s.id}><span><b>#{s.caseNumber}</b> {s.summary}</span><StatusBadge tone={s.status === 'RESOLVED' || s.status === 'CLOSED' ? 'pos' : 'info'}>{humanize(s.status)}</StatusBadge></li>))}</ul>
        )) : null}
        {tab === 'notes' ? <div className="adm-card adm-card-b"><CommentPanel entityType="party" entityId={party.id} /></div> : null}
        {tab === 'activity' ? <div className="adm-card adm-card-b"><EntityTimeline entityType="party" entityId={party.id} /></div> : null}
        {tab === 'audit' ? <div className="adm-card adm-card-b"><AuditTab id={party.id} /></div> : null}
      </TabPanel>
    </>
  )
}
