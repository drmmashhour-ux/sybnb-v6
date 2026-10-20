import { useCallback, useEffect, useMemo, useState } from 'react'
import { AdminApiError, adminFetch, qs, useAdminGet, type Page, type WorkItem, type WorkSummary } from '../api'
import { ageLabel, dateTime, dueLabel, humanize, splitPath } from '../format'
import { DataTable, Pager, type Column, type SortState } from '../components/DataTable'
import {
  Button, CommentPanel, EmptyState, EntityTimeline, FilterBar, Link, PageHeader, RiskBadge, SearchInput, SidePanel, StatusBadge, TabPanel, Tabs, TaskCard,
  toneForPriority, toneForWorkStatus, type TabDef,
} from '../components/ui'
import { BASIS_NOTE, assigneeLabel, cardModel, workGuidance, type CardBadge } from '../work'
import { useConsole } from '../components/shell'
import { ErrorState, LoadingSkeleton } from '../components/ui'

const VIEW_FOR_TAB: Record<string, string> = { mine: 'mine', team: 'team', unassigned: 'unassigned', high: 'priority', overdue: 'overdue', done: 'done' }
const TYPES = ['DOCUMENT_REVIEW', 'ACCESS_REQUEST', 'SECURITY_REVIEW', 'APPROVAL', 'SUPPORT_ESCALATION', 'PLATFORM_SETUP']
function useNarrow(): boolean {
  const q = '(max-width: 720px)'
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => { const mq = window.matchMedia(q); const f = () => setM(mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f) }, [])
  return m
}

function assigneeCell(w: WorkItem, meId: string): string {
  if (w.assignedUserId) return w.assignedUserId === meId ? 'You' : w.assignedUserName ?? 'Another user'
  return w.assignedTeam ? `Team: ${w.assignedTeam}` : 'Unassigned'
}
function linkedLabel(w: WorkItem): string { return w.linkedEntityType ? humanize(w.linkedEntityType) : '—' }

function BadgeRow({ badges }: { badges: CardBadge[] }) {
  return <>{badges.map((b) => <StatusBadge key={b.key} tone={b.tone}>{b.label}{b.srSuffix ? <span className="adm-sr">{b.srSuffix}</span> : null}</StatusBadge>)}</>
}

const SORTS: Array<{ key: string; label: string; value: SortState }> = [
  { key: 'newest', label: 'Newest', value: null },
  { key: 'priority', label: 'Priority', value: { key: 'priority', dir: 'desc' } },
  { key: 'due', label: 'Due date', value: { key: 'dueAt', dir: 'asc' } },
  { key: 'status', label: 'Status', value: { key: 'status', dir: 'asc' } },
]
const sortKeyOf = (s: SortState): string => SORTS.find((x) => (x.value === null ? s === null : s !== null && x.value.key === s.key && x.value.dir === s.dir))?.key ?? 'custom'

type Draft = { type: string; priority: string; risk: string; sort: string }
function FilterSheet({ open, onClose, applied, onApply }: { open: boolean; onClose: () => void; applied: Draft; onApply: (d: Draft) => void }) {
  const [d, setD] = useState<Draft>(applied)
  useEffect(() => { if (open) setD(applied) }, [open, applied])
  return (
    <SidePanel open={open} onClose={onClose} title="Filters and sort" variant="sheet"
      footer={<><Button variant="tertiary" onClick={() => setD({ type: '', priority: '', risk: '', sort: 'newest' })}>Clear all</Button><Button variant="primary" onClick={() => { onApply(d); onClose() }}>Apply</Button></>}>
      <div className="adm-field"><label htmlFor="mf-type">Type</label><select id="mf-type" className="adm-select" value={d.type} onChange={(e) => setD({ ...d, type: e.target.value })}><option value="">All types</option>{TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select></div>
      <div className="adm-field"><label htmlFor="mf-pri">Priority</label><select id="mf-pri" className="adm-select" value={d.priority} onChange={(e) => setD({ ...d, priority: e.target.value })}><option value="">Any priority</option>{['URGENT', 'HIGH', 'NORMAL', 'LOW'].map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select></div>
      <div className="adm-field"><label htmlFor="mf-risk">Risk</label><select id="mf-risk" className="adm-select" value={d.risk} onChange={(e) => setD({ ...d, risk: e.target.value })}><option value="">Any risk</option>{['HIGH', 'MEDIUM', 'LOW', 'NONE'].map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select></div>
      <div className="adm-field"><label htmlFor="mf-sort">Sort by</label><select id="mf-sort" className="adm-select" value={d.sort} onChange={(e) => setD({ ...d, sort: e.target.value })}>{SORTS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></div>
    </SidePanel>
  )
}

function ItemPanel({ item, onClose, onChanged }: { item: WorkItem; onClose: () => void; onChanged: () => void }) {
  const c = useConsole()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const act = async (body: Record<string, unknown>) => {
    setBusy(true); setErr(null)
    try { await adminFetch(`/work/items/${item.id}`, { method: 'PATCH', body }); onChanged(); onClose() }
    catch (e) { setErr((e as AdminApiError).status === 403 ? 'Your role cannot change this item.' : (e as Error).message) }
    finally { setBusy(false) }
  }
  const due = dueLabel(item.dueAt)
  const g = workGuidance(item, c.me.user.id)
  const hasDoc = item.linkedEntityType === 'admin_document'
  return (
    <SidePanel open onClose={onClose} title={item.title} subtitle={<span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}><BadgeRow badges={cardModel(item, c.me.user.id).badges} /></span>}>
      <section aria-label="Why this needs your attention" className="adm-callout">
        <h3>Why this needs your attention</h3>
        {g.why.map((t) => <p key={t} style={{ margin: '0 0 4px' }}>{t}</p>)}
        <p className="adm-note" style={{ margin: '6px 0 0' }}>{BASIS_NOTE}</p>
      </section>
      <section aria-label="What you need to do">
        <h3>What you need to do</h3>
        <ol className="adm-steps">{g.todo.map((t) => <li key={t}>{t}</li>)}</ol>
      </section>
      <section aria-label="Details">
        <h3>Details</h3>
        <dl className="adm-dl">
          <dt>Related record</dt>
          <dd>{item.linkedEntityType && item.linkedEntityId
            ? (item.linkedEntityType === 'party' ? <Link to={`/admin/parties/${item.linkedEntityId}`} onClick={onClose}>Open party record</Link> : <>{humanize(item.linkedEntityType)} <span className="adm-note">· detail screen coming soon</span></>)
            : <span className="adm-faint">Not linked to a record</span>}</dd>
          <dt>Platform</dt><dd>{c.platformName(item.platformId)}</dd>
          <dt>Priority</dt><dd><StatusBadge tone={toneForPriority(item.priority)}>{humanize(item.priority)}</StatusBadge></dd>
          <dt>Age / due</dt><dd>Created {ageLabel(item.createdAt)} ago · {due.text}{item.overdue ? <> <StatusBadge tone="crit">Overdue</StatusBadge></> : null}</dd>
          <dt>Assignment</dt><dd>{assigneeLabel(item, c.me.user.id)}</dd>
          <dt>Risk</dt><dd><RiskBadge risk={item.risk} />{item.risk === 'NONE' ? <span className="adm-note"> No risk flagged. No AI findings are recorded.</span> : <span className="adm-note"> No AI finding text is recorded.</span>}</dd>
        </dl>
      </section>
      {hasDoc ? <section aria-label="Documents"><h3>Documents</h3><p style={{ margin: 0 }}>1 linked document <span className="adm-note">· document screen coming soon</span></p></section> : null}
      <section aria-label="Comments"><h3>Comments</h3><CommentPanel entityType="work_item" entityId={item.id} /></section>
      <section aria-label="Activity"><h3>Activity</h3><EntityTimeline entityType="work_item" entityId={item.id} /></section>
      <section aria-label="Available actions">
        <h3>Available actions</h3>
        {!c.can('work.manage') ? <p className="adm-note" style={{ margin: 0 }}>Your role can view this item but not change it.</p>
          : g.closed ? <p className="adm-note" style={{ margin: 0 }}>This item is closed, so no actions are available.</p>
          : (
            <div className="adm-actions">
              {item.assignedUserId !== c.me.user.id ? <Button disabled={busy} onClick={() => act({ assignedUserId: c.me.user.id })}>Assign to me</Button> : null}
              {item.status === 'OPEN' ? <Button disabled={busy} onClick={() => act({ status: 'IN_PROGRESS' })}>Start work</Button> : null}
              <Button variant="primary" disabled={busy} onClick={() => act({ status: 'DONE' })}>Mark done</Button>
            </div>
          )}
        {err ? <p role="alert" className="adm-note" style={{ color: 'var(--adm-crit)' }}>{err}</p> : null}
      </section>
    </SidePanel>
  )
}

export function MyWorkPage({ path }: { path: string }) {
  const c = useConsole()
  const [tab, setTab] = useState('mine')
  const [type, setType] = useState('')
  const [priority, setPriority] = useState('')
  const [risk, setRisk] = useState('')
  const [q, setQ] = useState('')
  const [sheet, setSheet] = useState(false)
  const [sort, setSort] = useState<SortState>(null)
  const [page, setPage] = useState(1)
  const narrow = useNarrow()
  const [openId, setOpenId] = useState<string | null>(() => splitPath(path).query.get('open'))
  const platformId = c.platform === 'ALL' ? undefined : c.ctx?.platforms.find((p) => p.code === c.platform)?.id
  const sortParam = sort ? `${sort.key}:${sort.dir}` : undefined
  // The server needs at least 2 characters; a single character is held back rather than sent.
  const search = q.trim().length >= 2 ? q.trim() : undefined
  useEffect(() => { setPage(1) }, [tab, type, priority, risk, sortParam, platformId, search])

  const summary = useAdminGet<WorkSummary>('/work/summary')
  const list = useAdminGet<Page<WorkItem>>(`/work/items${qs({ view: VIEW_FOR_TAB[tab], type, priority, risk, platformId, q: search, sort: sortParam, page, pageSize: 25 })}`)
  // An item opened from search may not be on the current page: look it up once across all views.
  const fromList = list.data?.items.find((w) => w.id === openId) ?? null
  const lookup = useAdminGet<Page<WorkItem>>(openId && !fromList && !list.loading ? `/work/items${qs({ view: 'all', pageSize: 100 })}` : null)
  const openItem = fromList ?? lookup.data?.items.find((w) => w.id === openId) ?? null
  const closePanel = useCallback(() => setOpenId(null), [])
  const reloadAll = useCallback(() => { list.reload(); summary.reload() }, [list, summary])

  const s = summary.data
  const tabs: TabDef[] = [
    { key: 'mine', label: 'My Tasks', count: s?.mine }, { key: 'team', label: 'Team' }, { key: 'unassigned', label: 'Unassigned', count: s?.unassigned },
    { key: 'high', label: 'High Priority', count: null }, { key: 'overdue', label: 'Overdue', count: s?.overdue }, { key: 'done', label: 'Completed' },
  ]
  const columns: Array<Column<WorkItem>> = useMemo(() => [
    { key: 'priority', header: 'Priority', sortKey: 'priority', width: 110, hideOnMobile: true, render: (w) => <StatusBadge tone={toneForPriority(w.priority)}>{humanize(w.priority)}</StatusBadge> },
    { key: 'task', header: 'Task', primary: true, render: (w) => (<><button type="button" className="adm-rowbtn" onClick={() => setOpenId(w.id)} aria-label={`Open task: ${w.title}`}>{w.title}</button><span className="adm-note">{humanize(w.type)}</span></>) },
    { key: 'platform', header: 'Platform', render: (w) => c.platformName(w.platformId) },
    { key: 'linked', header: 'Linked entity', hideOnMobile: true, render: (w) => linkedLabel(w) },
    { key: 'assigned', header: 'Assigned', render: (w) => assigneeCell(w, c.me.user.id) },
    { key: 'age', header: 'Age', sortKey: 'createdAt', render: (w) => ageLabel(w.createdAt) },
    { key: 'due', header: 'Due', sortKey: 'dueAt', render: (w) => { const d = dueLabel(w.dueAt); return d.overdue && !['DONE', 'CANCELLED'].includes(w.status) ? <StatusBadge tone="crit">{d.text} · overdue</StatusBadge> : <span className={w.dueAt ? undefined : 'adm-faint'}>{d.text}</span> } },
    { key: 'status', header: 'Status', sortKey: 'status', render: (w) => <StatusBadge tone={toneForWorkStatus(w.status)}>{humanize(w.status)}</StatusBadge> },
    { key: 'risk', header: 'Risk', hideOnMobile: true, render: (w) => <RiskBadge risk={w.risk} /> },
  ], [c])

  const idle = !list.loading && list.data && list.data.total === 0
  const activeCount = [type, priority, risk].filter(Boolean).length
  return (
    <>
      <PageHeader title="My Work" subtitle="Everything that needs a person, across the platforms you are authorized for." crumbs={[{ label: 'Command Center', to: '/admin' }, { label: 'My Work' }]} hideCrumbsOnPhone />
      <Tabs tabs={tabs} value={tab} onChange={setTab} label="Work views" idPrefix="work" />
      <TabPanel idPrefix="work" active={tab}>
        {narrow ? (
          <div className="adm-mfilters">
            <FilterBar label="Search work items">
              <SearchInput value={q} onChange={setQ} label="Search work items by title, type or platform" placeholder="Search title, type or platform" />
            </FilterBar>
            <div className="adm-mfilters-row">
              <Button className="adm-filterbtn" aria-haspopup="dialog" onClick={() => setSheet(true)}>Filters{activeCount > 0 ? <span className="adm-count-badge" aria-label={`${activeCount} active`}>{activeCount}</span> : null}</Button>
              <Button variant="tertiary" aria-haspopup="dialog" onClick={() => setSheet(true)}>Sort: {SORTS.find((x) => x.key === sortKeyOf(sort))?.label ?? 'Custom'}</Button>
            </div>
            {activeCount > 0 || c.platform !== 'ALL' ? (
              <p className="adm-note adm-activefilters" aria-label="Active filters">
                {[type && humanize(type), priority && `${humanize(priority)} priority`, risk && `${humanize(risk)} risk`, c.platform !== 'ALL' ? `Platform: ${c.platformName(platformId ?? null)}` : ''].filter(Boolean).join(' · ')}
              </p>
            ) : null}
            {q.trim().length === 1 ? <p className="adm-note">Type at least 2 characters to search.</p> : null}
            <FilterSheet open={sheet} onClose={() => setSheet(false)} applied={{ type, priority, risk, sort: sortKeyOf(sort) }}
              onApply={(d) => { setType(d.type); setPriority(d.priority); setRisk(d.risk); setSort(SORTS.find((x) => x.key === d.sort)?.value ?? null) }} />
          </div>
        ) : (
          <FilterBar label="Search and filter work items">
            <SearchInput value={q} onChange={setQ} label="Search work items by title, type or platform" placeholder="Search title, type or platform" />
            <label className="adm-sr" htmlFor="wf-type">Type</label>
            <select id="wf-type" className="adm-select" value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option>{TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select>
            <label className="adm-sr" htmlFor="wf-pri">Priority</label>
            <select id="wf-pri" className="adm-select" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="">Any priority</option>{['URGENT', 'HIGH', 'NORMAL', 'LOW'].map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select>
            <label className="adm-sr" htmlFor="wf-risk">Risk</label>
            <select id="wf-risk" className="adm-select" value={risk} onChange={(e) => setRisk(e.target.value)}><option value="">Any risk</option>{['HIGH', 'MEDIUM', 'LOW', 'NONE'].map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select>
            {c.platform !== 'ALL' ? <span className="adm-note">Scoped to {c.platformName(platformId ?? null)}</span> : null}
            {q.trim().length === 1 ? <span className="adm-note">Type at least 2 characters to search.</span> : null}
          </FilterBar>
        )}

        {narrow ? (
          list.error ? <ErrorState error={list.error} onRetry={list.reload} />
          : list.loading && !list.data ? <div className="adm-card adm-card-b"><LoadingSkeleton rows={4} label="Loading work items" /></div>
          : !list.data || list.data.items.length === 0 ? <EmptyState kind="no-data" title={search ? 'No matching work items' : tab === 'done' ? 'No completed work yet' : 'You’re all caught up'}>{search ? `Nothing in this view matches “${search}”. Search looks at title, task type and platform name.` : tab === 'mine' ? 'Nothing is assigned to you.' : 'No work items match this view.'}</EmptyState>
          : (
            <>
            <ul className="adm-tasklist" aria-label="Work items">
              {list.data.items.map((w) => {
                const m = cardModel(w, c.me.user.id)
                return (
                  <li key={w.id}>
                    <TaskCard title={w.title} platform={c.platformName(w.platformId)} onOpen={() => setOpenId(w.id)} badges={<BadgeRow badges={m.badges} />} meta={m.meta.join(' · ')} />
                  </li>
                )
              })}
            </ul>
            <Pager label="Work items" page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onPage={setPage} />
            </>
          )
        ) : <DataTable
          caption="Work items" columns={columns} rows={list.data?.items ?? []} rowKey={(w) => w.id} loading={list.loading} error={list.error} onRetry={list.reload}
          sort={sort} onSort={setSort} page={list.data?.page} totalPages={list.data?.totalPages} total={list.data?.total} onPage={setPage} selectedId={openId}
          empty={<EmptyState kind="no-data" title={search ? 'No matching work items' : tab === 'done' ? 'No completed work yet' : 'You’re all caught up'}>{search ? `Nothing in this view matches “${search}”. Search looks at title, task type and platform name.` : idle && tab === 'mine' ? 'Nothing is assigned to you. Items appear here when a document, access request or escalation needs you.' : 'No work items match this view and these filters.'}</EmptyState>}
        />}
      </TabPanel>
      {openId && openItem ? <ItemPanel item={openItem} onClose={closePanel} onChanged={reloadAll} /> : null}
      {openId && !openItem && !list.loading && !lookup.loading ? (
        <SidePanel open onClose={closePanel} title="Work item not found"><EmptyState kind="not-found" title="This item is not available">It no longer exists, or it is outside what your role can see.</EmptyState></SidePanel>
      ) : null}
    </>
  )
}
