import { useCallback, useEffect, useMemo, useState } from 'react'
import { AdminApiError, adminFetch, qs, useAdminGet, type Page, type WorkItem, type WorkSummary } from '../api'
import { ageLabel, dateTime, dueLabel, humanize, splitPath } from '../format'
import { DataTable, Pager, type Column, type SortState } from '../components/DataTable'
import {
  CommentPanel, EmptyState, EntityTimeline, FilterBar, Link, PageHeader, RiskBadge, SidePanel, StatusBadge, TabPanel, Tabs, TaskCard,
  toneForPriority, toneForWorkStatus, type TabDef,
} from '../components/ui'
import { useConsole } from '../components/shell'
import { ErrorState, LoadingSkeleton } from '../components/ui'

const VIEW_FOR_TAB: Record<string, string> = { mine: 'mine', team: 'team', unassigned: 'unassigned', high: 'priority', overdue: 'overdue', done: 'done' }
const TYPES = ['DOCUMENT_REVIEW', 'ACCESS_REQUEST', 'SECURITY_REVIEW', 'APPROVAL', 'SUPPORT_ESCALATION', 'PLATFORM_SETUP']
// Why a task of this type needs a person. This describes the TYPE; it is not data about the specific record.
const REASON: Record<string, string> = {
  DOCUMENT_REVIEW: 'A document is waiting for a person to verify or reject it.',
  ACCESS_REQUEST: 'A request to grant or change staff access needs review.',
  SECURITY_REVIEW: 'A security event or privileged-access change needs review.',
  APPROVAL: 'A request is waiting for an approver’s decision.',
  SUPPORT_ESCALATION: 'A support case was escalated and needs a decision.',
  PLATFORM_SETUP: 'A platform needs setup before it can operate.',
}

function useNarrow(): boolean {
  const q = '(max-width: 720px)'
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => { const mq = window.matchMedia(q); const f = () => setM(mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f) }, [])
  return m
}

function assigneeLabel(w: WorkItem, meId: string): string {
  if (w.assignedUserId) return w.assignedUserId === meId ? 'You' : w.assignedUserName ?? 'Another user'
  return w.assignedTeam ? `Team: ${w.assignedTeam}` : 'Unassigned'
}
function linkedLabel(w: WorkItem): string { return w.linkedEntityType ? humanize(w.linkedEntityType) : '—' }

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
  const open = !['DONE', 'CANCELLED'].includes(item.status)
  return (
    <SidePanel open onClose={onClose} title={item.title} subtitle={<>{humanize(item.type)} · {c.platformName(item.platformId)}</>}>
      <section aria-label="Summary">
        <h3>Summary</h3>
        <dl className="adm-dl">
          <dt>Status</dt><dd><StatusBadge tone={toneForWorkStatus(item.status)}>{humanize(item.status)}</StatusBadge></dd>
          <dt>Priority</dt><dd><StatusBadge tone={toneForPriority(item.priority)}>{humanize(item.priority)}</StatusBadge></dd>
          <dt>Assigned</dt><dd>{assigneeLabel(item, c.me.user.id)}</dd>
          <dt>Due</dt><dd>{due.text}{item.overdue ? <> <StatusBadge tone="crit">Overdue</StatusBadge></> : null}</dd>
          <dt>Created</dt><dd>{dateTime(item.createdAt)} ({ageLabel(item.createdAt)} ago)</dd>
        </dl>
      </section>
      <section aria-label="Why action is required"><h3>Why action is required</h3><p style={{ margin: 0 }}>{REASON[item.type] ?? 'This item needs a person to act.'}</p></section>
      <section aria-label="Linked entity">
        <h3>Linked entity</h3>
        {item.linkedEntityType && item.linkedEntityId
          ? <p style={{ margin: 0 }}>{humanize(item.linkedEntityType)} · {item.linkedEntityType === 'party' ? <Link to={`/admin/parties/${item.linkedEntityId}`} onClick={onClose}>Open party</Link> : <span className="adm-mono">{item.linkedEntityId}</span>}</p>
          : <p className="adm-note" style={{ margin: 0 }}>Not linked to a record.</p>}
      </section>
      <section aria-label="Documents"><h3>Documents</h3>{item.linkedEntityType === 'admin_document' ? <p style={{ margin: 0 }}>Linked document <span className="adm-mono">{item.linkedEntityId}</span></p> : <p className="adm-note" style={{ margin: 0 }}>No documents linked.</p>}</section>
      <section aria-label="Risk"><h3>Risk / AI finding</h3><RiskBadge risk={item.risk} /><p className="adm-note" style={{ margin: '6px 0 0' }}>No AI findings are recorded for this item.</p></section>
      <section aria-label="Comments"><h3>Comments</h3><CommentPanel entityType="work_item" entityId={item.id} /></section>
      <section aria-label="Activity"><h3>Activity</h3><EntityTimeline entityType="work_item" entityId={item.id} /></section>
      <section aria-label="Available actions">
        <h3>Available actions</h3>
        {!c.can('work.manage') ? <p className="adm-note" style={{ margin: 0 }}>Your role can view this item but not change it.</p>
          : !open ? <p className="adm-note" style={{ margin: 0 }}>This item is closed.</p>
          : (
            <div className="adm-actions">
              {item.assignedUserId !== c.me.user.id ? <button type="button" className="adm-btn" disabled={busy} onClick={() => act({ assignedUserId: c.me.user.id })}>Assign to me</button> : null}
              {item.status === 'OPEN' ? <button type="button" className="adm-btn" disabled={busy} onClick={() => act({ status: 'IN_PROGRESS' })}>Start work</button> : null}
              <button type="button" className="adm-btn adm-btn-primary" disabled={busy} onClick={() => act({ status: 'DONE' })}>Mark done</button>
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
  const [sort, setSort] = useState<SortState>(null)
  const [page, setPage] = useState(1)
  const narrow = useNarrow()
  const [openId, setOpenId] = useState<string | null>(() => splitPath(path).query.get('open'))
  const platformId = c.platform === 'ALL' ? undefined : c.ctx?.platforms.find((p) => p.code === c.platform)?.id
  const sortParam = sort ? `${sort.key}:${sort.dir}` : undefined
  useEffect(() => { setPage(1) }, [tab, type, priority, risk, sortParam, platformId])

  const summary = useAdminGet<WorkSummary>('/work/summary')
  const list = useAdminGet<Page<WorkItem>>(`/work/items${qs({ view: VIEW_FOR_TAB[tab], type, priority, risk, platformId, sort: sortParam, page, pageSize: 25 })}`)
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
    { key: 'assigned', header: 'Assigned', render: (w) => assigneeLabel(w, c.me.user.id) },
    { key: 'age', header: 'Age', sortKey: 'createdAt', render: (w) => ageLabel(w.createdAt) },
    { key: 'due', header: 'Due', sortKey: 'dueAt', render: (w) => { const d = dueLabel(w.dueAt); return d.overdue && !['DONE', 'CANCELLED'].includes(w.status) ? <StatusBadge tone="crit">{d.text} · overdue</StatusBadge> : <span className={w.dueAt ? undefined : 'adm-faint'}>{d.text}</span> } },
    { key: 'status', header: 'Status', sortKey: 'status', render: (w) => <StatusBadge tone={toneForWorkStatus(w.status)}>{humanize(w.status)}</StatusBadge> },
    { key: 'risk', header: 'Risk', hideOnMobile: true, render: (w) => <RiskBadge risk={w.risk} /> },
  ], [c])

  const idle = !list.loading && list.data && list.data.total === 0
  return (
    <>
      <PageHeader title="My Work" subtitle="Everything that needs a person, across the platforms you are authorized for." crumbs={[{ label: 'Command Center', to: '/admin' }, { label: 'My Work' }]} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} label="Work views" idPrefix="work" />
      <TabPanel idPrefix="work" active={tab}>
        <FilterBar label="Filter work items">
          <label className="adm-sr" htmlFor="wf-type">Type</label>
          <select id="wf-type" className="adm-select" value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option>{TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select>
          <label className="adm-sr" htmlFor="wf-pri">Priority</label>
          <select id="wf-pri" className="adm-select" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="">Any priority</option>{['URGENT', 'HIGH', 'NORMAL', 'LOW'].map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select>
          <label className="adm-sr" htmlFor="wf-risk">Risk</label>
          <select id="wf-risk" className="adm-select" value={risk} onChange={(e) => setRisk(e.target.value)}><option value="">Any risk</option>{['HIGH', 'MEDIUM', 'LOW', 'NONE'].map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select>
          {c.platform !== 'ALL' ? <span className="adm-note">Scoped to {c.platformName(platformId ?? null)}</span> : null}
        </FilterBar>

        {narrow ? (
          list.error ? <ErrorState error={list.error} onRetry={list.reload} />
          : list.loading && !list.data ? <div className="adm-card adm-card-b"><LoadingSkeleton rows={4} label="Loading work items" /></div>
          : !list.data || list.data.items.length === 0 ? <EmptyState title={tab === 'done' ? 'No completed work yet' : 'You’re all caught up'}>{tab === 'mine' ? 'Nothing is assigned to you.' : 'No work items match this view.'}</EmptyState>
          : (
            <>
            <div className="adm-grid" role="list" aria-label="Work items">
              {list.data.items.map((w) => (
                <div role="listitem" key={w.id}>
                  <TaskCard
                    title={w.title} onOpen={() => setOpenId(w.id)}
                    badges={<><StatusBadge tone={toneForPriority(w.priority)}>{humanize(w.priority)}</StatusBadge><StatusBadge tone={toneForWorkStatus(w.status)}>{humanize(w.status)}</StatusBadge>{w.overdue ? <StatusBadge tone="crit">Overdue</StatusBadge> : null}{w.risk !== 'NONE' ? <RiskBadge risk={w.risk} /> : null}</>}
                    meta={<>{c.platformName(w.platformId)} · {assigneeLabel(w, c.me.user.id)} · {ageLabel(w.createdAt)} old · due {dueLabel(w.dueAt).text}</>}
                  />
                </div>
              ))}
            </div>
            <Pager label="Work items" page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onPage={setPage} />
            </>
          )
        ) : <DataTable
          caption="Work items" columns={columns} rows={list.data?.items ?? []} rowKey={(w) => w.id} loading={list.loading} error={list.error} onRetry={list.reload}
          sort={sort} onSort={setSort} page={list.data?.page} totalPages={list.data?.totalPages} total={list.data?.total} onPage={setPage} selectedId={openId}
          empty={<EmptyState title={tab === 'done' ? 'No completed work yet' : 'You’re all caught up'}>{idle && tab === 'mine' ? 'Nothing is assigned to you. Items appear here when a document, access request or escalation needs you.' : 'No work items match this view and these filters.'}</EmptyState>}
        />}
      </TabPanel>
      {openId && openItem ? <ItemPanel item={openItem} onClose={closePanel} onChanged={reloadAll} /> : null}
      {openId && !openItem && !list.loading && !lookup.loading ? (
        <SidePanel open onClose={closePanel} title="Work item not found"><p className="adm-note">This item is not visible to you or no longer exists.</p></SidePanel>
      ) : null}
    </>
  )
}
