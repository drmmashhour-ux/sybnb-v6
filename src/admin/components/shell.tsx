import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAdminGet, type ContextInfo, type Me, type NotificationsPage, type SearchResults, adminFetch, qs, type WorkSummary } from '../api'
import { visibleNav, isConsolePath, type NavItem } from '../nav'
import { splitPath, initials, ageLabel } from '../format'
import { legalEntityView, pageScope } from '../context'
import { ContextPanel } from './ContextPanel'
import { EmptyState, ErrorState, LoadingSkeleton, Link, SidePanel, usePopover } from './ui'
import { signOutStaff } from '../../shared/api/platformApi'

/* ---------- console context: who am I, what may I see, which platform scope is selected ---------- */
export type ConsoleState = {
  me: Me; ctx: ContextInfo | null; platform: string; setPlatform: (code: string) => void
  can: (perm: string) => boolean; platformName: (id: string | null) => string
}
const Ctx = createContext<ConsoleState | null>(null)
export function useConsole(): ConsoleState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useConsole outside AppShell')
  return v
}
const PLATFORM_KEY = 'sybnb.admin.platformScope'
const readScope = () => { try { return sessionStorage.getItem(PLATFORM_KEY) || 'ALL' } catch { return 'ALL' } }

/* ---------- sidebar ---------- */
function NavEntry({ item, pathname, count, depth = 0 }: { item: NavItem; pathname: string; count?: number; depth?: number }) {
  if (item.children) {
    return (
      <li>
        <div className="adm-nav-item" aria-hidden="false" style={{ cursor: 'default', fontWeight: 600 }}>{item.label}</div>
        <ul className="adm-nav-sub" aria-label={item.label}>{item.children.map((c) => <NavEntry key={c.key} item={c} pathname={pathname} depth={depth + 1} />)}</ul>
      </li>
    )
  }
  const current = item.href ? (item.href === '/admin' ? pathname === '/admin' : pathname === item.href || pathname.startsWith(`${item.href}/`)) : false
  if (!item.href) {
    return <li><span className="adm-nav-item" aria-disabled="true">{item.label}<span className="adm-nav-tag">Soon</span></span></li>
  }
  return (
    <li>
      <Link to={item.href} className="adm-nav-item" aria-current={current ? 'page' : undefined}>
        {item.label}{count ? <span className="adm-nav-count" aria-label={`${count} open`}>{count}</span> : null}
      </Link>
    </li>
  )
}

function Sidebar({ pathname, open, onClose, workCount }: { pathname: string; open: boolean; onClose: () => void; workCount: number }) {
  const c = useConsole()
  const groups = useMemo(() => visibleNav({ permissions: new Set(c.me.permissions), authorizedPlatforms: new Set(c.me.platforms.filter((p) => p.authorized).map((p) => p.code)) }), [c.me])
  return (
    <>
      <div className="adm-scrim" data-open={open} onClick={onClose} aria-hidden="true" />
      <aside className="adm-side" data-open={open} aria-label="Admin navigation" id="adm-sidebar">
        <Link to="/admin" className="adm-brand" onClick={onClose}><span className="adm-brand-mark" aria-hidden="true">S</span><span>SYBNB<small>Admin console</small></span></Link>
        <nav className="adm-nav" aria-label="Primary" onClick={(e) => { if ((e.target as HTMLElement).closest('a')) onClose() }}>
          {groups.map((g) => (
            <div className="adm-nav-group" key={g.key}>
              <div className="adm-nav-label" id={`nav-${g.key}`}>{g.label}</div>
              <ul aria-labelledby={`nav-${g.key}`}>
                {g.items.map((i) => <NavEntry key={i.key} item={i} pathname={pathname} count={i.key === 'work' ? workCount : undefined} />)}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
    </>
  )
}

/* ---------- global context switcher ----------
   Honest by construction: it offers only what the server really applies.
   - Legal entity: selection does not exist on the server, so it is shown as information, never as a choice.
   - Platform: a real choice only where the page sends it with its requests (Command Center, My Work).
     Elsewhere the radios are disabled and the page says what it actually covers. */
export function ContextSwitcher({ pathname }: { pathname: string }) {
  const c = useConsole()
  const { open, setOpen, wrap, btn } = usePopover()
  const legal = legalEntityView(c.ctx)
  const scope = pageScope(pathname)
  const authorized = c.me.platforms.filter((p) => p.authorized)
  const current = scope.kind === 'platform-filter' ? (c.platform === 'ALL' ? 'All platforms' : authorized.find((p) => p.code === c.platform)?.displayName ?? c.platform) : scope.label
  return (
    <div className="adm-pop-wrap" ref={wrap}>
      <button type="button" ref={btn} className="adm-ctx" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="adm-ctx-legal">{legal.label}</span><b className="adm-ctx-full">{current}</b><b className="adm-ctx-short" aria-hidden="true">{current === 'All platforms' ? 'All' : current}</b>{scope.kind === 'platform-filter' ? null : <span className="adm-ctx-fixed">fixed</span>}<span aria-hidden="true" className="adm-ctx-caret">▾</span>
        <span className="adm-sr">{scope.kind === 'platform-filter' ? `Context: ${current}. Change platform filter` : `Context: ${current}. Shows what this page covers`}</span>
      </button>
      {open ? (
        <div className="adm-pop" style={{ left: 0, top: 40 }}>
          <ContextPanel legal={legal} scope={scope} platform={c.platform} platforms={authorized} onPick={(code) => { c.setPlatform(code); setOpen(false) }} />
        </div>
      ) : null}
    </div>
  )
}

/* ---------- search entry ---------- */
const SECTION_LABEL: Record<string, string> = { parties: 'Parties', documents: 'Documents', supportCases: 'Support cases', workItems: 'Work items', users: 'Users' }
function toConsoleRoute(section: string, id: string, route: string): string | null {
  const to = section === 'parties' ? `/admin/parties/${id}` : route
  return isConsolePath(splitPath(to).pathname) ? to : null
}
function SearchPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t) }, [q])
  const res = useAdminGet<SearchResults>(open && debounced.length >= 2 ? `/search${qs({ q: debounced })}` : null)
  useEffect(() => { if (!open) { setQ(''); setDebounced('') } }, [open])
  const sections = res.data ? Object.entries(res.data.results).filter(([, v]) => v.length > 0) : []
  return (
    <SidePanel open={open} onClose={onClose} title="Search">
      <div>
        <label className="adm-sr" htmlFor="adm-search-input">Search parties, documents, support cases, work</label>
        <input id="adm-search-input" type="search" className="adm-input" style={{ width: '100%', height: 38 }} placeholder="Search parties, documents, cases, work…" value={q} onChange={(e) => setQ(e.target.value)} />
        <p className="adm-note">Results only include records your role may see.</p>
      </div>
      {debounced.length < 2 ? <p className="adm-note">Type at least 2 characters.</p>
        : res.loading ? <LoadingSkeleton rows={3} label="Searching" />
        : res.error ? <ErrorState error={res.error} onRetry={res.reload} />
        : sections.length === 0 ? <EmptyState title="No matches">Nothing you can access matches “{debounced}”.</EmptyState>
        : sections.map(([k, items]) => (
          <section key={k} aria-label={SECTION_LABEL[k] ?? k}>
            <h3>{SECTION_LABEL[k] ?? k}</h3>
            <ul className="adm-list" style={{ border: '1px solid var(--adm-border)', borderRadius: 8 }}>
              {items.map((it) => {
                const to = toConsoleRoute(k, it.id, it.route)
                return <li key={it.id}>{to ? <Link to={to} onClick={onClose}>{it.title}</Link> : <span>{it.title}</span>}<span className="adm-note">{to ? it.subtitle : `${it.subtitle} · screen coming soon`}</span></li>
              })}
            </ul>
          </section>
        ))}
    </SidePanel>
  )
}

/* ---------- notifications ---------- */
function NotificationIndicator() {
  const { open, setOpen, wrap, btn } = usePopover()
  const q = useAdminGet<NotificationsPage>('/notifications?pageSize=8')
  const unread = q.data?.unread ?? 0
  const markAll = async () => { try { await adminFetch('/notifications/read-all', { method: 'POST' }); q.reload() } catch { /* shown on next load */ } }
  return (
    <div className="adm-pop-wrap" ref={wrap}>
      <button type="button" ref={btn} className="adm-iconbtn" aria-haspopup="true" aria-expanded={open} aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} onClick={() => setOpen(!open)}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5a4 4 0 0 0-4 4c0 3-1.5 4-1.5 4.5h11C13.5 9.5 12 8.5 12 5.5a4 4 0 0 0-4-4zM6.5 12a1.5 1.5 0 0 0 3 0" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
        {unread ? <span className="adm-badge-dot" aria-hidden="true">{unread > 9 ? '9+' : unread}</span> : null}
      </button>
      {open ? (
        <div className="adm-pop" style={{ right: 0, top: 40, minWidth: 320 }} role="region" aria-label="Notifications">
          <div className="adm-pop-title" style={{ display: 'flex', justifyContent: 'space-between' }}><span>Notifications</span>{unread ? <button type="button" className="adm-rowbtn" onClick={markAll}>Mark all read</button> : null}</div>
          {q.loading ? <div style={{ padding: 10 }}><LoadingSkeleton rows={2} /></div>
            : q.error ? <p className="adm-note" style={{ padding: 10 }}>{q.error.status === 403 ? 'Notifications are not enabled for your role.' : q.error.message}</p>
            : q.data && q.data.items.length > 0 ? q.data.items.map((n) => (
              <div key={n.id} className="adm-pop-item" style={{ cursor: 'default', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                <span style={{ fontWeight: n.readAt ? 400 : 700 }}>{n.readAt ? '' : '● '}{n.title}</span>
                <small style={{ marginLeft: 0 }}>{ageLabel(n.createdAt)} ago</small>
              </div>
            )) : <p className="adm-note" style={{ padding: 10 }}>You’re all caught up.</p>}
        </div>
      ) : null}
    </div>
  )
}

/* ---------- user profile ---------- */
function UserMenu() {
  const c = useConsole()
  const { open, setOpen, wrap, btn } = usePopover()
  const out = async () => { try { await signOutStaff() } finally { window.location.hash = '/' } }
  return (
    <div className="adm-pop-wrap" ref={wrap}>
      <button type="button" ref={btn} className="adm-iconbtn" style={{ border: 0, gap: 8, display: 'inline-flex', padding: 0 }} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="adm-avatar" aria-hidden="true">{initials(c.me.user.displayName)}</span><span className="adm-sr">Account menu for {c.me.user.displayName}</span>
      </button>
      {open ? (
        <div className="adm-pop" style={{ right: 0, top: 40 }} role="region" aria-label="Account">
          <div style={{ padding: '8px 10px' }}><b>{c.me.user.displayName}</b><div className="adm-note">{c.me.user.email}</div><div className="adm-note">Sign-in strength: {c.me.authentication.strength.toLowerCase()}{c.me.authentication.mfaMethod ? ` (${c.me.authentication.mfaMethod.toLowerCase()})` : ''}</div></div>
          <button type="button" className="adm-pop-item" onClick={out}>Sign out</button>
        </div>
      ) : null}
    </div>
  )
}

/* ---------- app shell ---------- */
export function AppShell({ path, children }: { path: string; children: ReactNode }) {
  const { pathname } = splitPath(path)
  const meQ = useAdminGet<Me & { ok: true }>('/me')
  const ctxQ = useAdminGet<ContextInfo>('/context')
  const [platform, setPlatformState] = useState(readScope)
  const [menu, setMenu] = useState(false)
  const [searching, setSearching] = useState(false)
  const setPlatform = useCallback((code: string) => { setPlatformState(code); try { sessionStorage.setItem(PLATFORM_KEY, code) } catch { /* storage blocked */ } }, [])
  const canWork = meQ.data?.permissions.includes('work.view') ?? false
  const summary = useAdminGet<WorkSummary>(canWork ? '/work/summary' : null)
  useEffect(() => { setMenu(false) }, [pathname])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearching(true) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // A saved platform scope the user is no longer authorized for falls back to ALL.
  useEffect(() => {
    if (meQ.data && platform !== 'ALL' && !meQ.data.platforms.some((p) => p.authorized && p.code === platform)) setPlatform('ALL')
  }, [meQ.data, platform, setPlatform])

  if (meQ.loading) {
    return (
      <div className="adm" dir="ltr" lang="en">
        <div className="adm-shell">
          <aside className="adm-side" aria-hidden="true"><div className="adm-brand"><span className="adm-brand-mark">S</span><span>SYBNB<small>Admin console</small></span></div></aside>
          <div className="adm-main"><header className="adm-top" aria-hidden="true" /><main id="adm-main" className="adm-content" tabIndex={-1}><LoadingSkeleton rows={5} label="Loading console" /></main></div>
        </div>
      </div>
    )
  }
  if (meQ.error || !meQ.data) {
    return (
      <div className="adm" dir="ltr" lang="en" style={{ padding: 32, maxWidth: 560 }}>
        <main id="adm-main">
          {meQ.error ? <ErrorState error={meQ.error} onRetry={meQ.reload} /> : null}
          <p className="adm-note" style={{ marginTop: 12 }}>The admin console needs a staff account with console access. <Link to="/">Return to the site</Link></p>
        </main>
      </div>
    )
  }
  const me = meQ.data
  const state: ConsoleState = {
    me, ctx: ctxQ.data, platform, setPlatform,
    can: (p) => me.permissions.includes(p),
    platformName: (id) => (id && ctxQ.data?.platforms.find((p) => p.id === id)?.displayName) || (id ? 'Unknown platform' : 'Organization-wide'),
  }
  return (
    <Ctx.Provider value={state}>
      <div className="adm" dir="ltr" lang="en">
        <a className="adm-skip" href="#adm-main" onClick={(e) => { e.preventDefault(); document.getElementById('adm-main')?.focus() }}>Skip to content</a>
        <div className="adm-shell">
          <Sidebar pathname={pathname} open={menu} onClose={() => setMenu(false)} workCount={summary.data?.mine ?? 0} />
          <div className="adm-main">
            <header className="adm-top">
              <button type="button" className="adm-iconbtn adm-menu-btn" aria-label="Open navigation" aria-expanded={menu} aria-controls="adm-sidebar" onClick={() => setMenu(true)}>☰</button>
              <ContextSwitcher pathname={pathname} />
              <div className="adm-top-spacer" />
              <button type="button" className="adm-search" onClick={() => setSearching(true)} aria-label="Search">
                <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="m11 11 3.5 3.5" stroke="currentColor" strokeWidth="1.6" /></svg>
                <span>Search…</span><kbd>Ctrl K</kbd>
              </button>
              <NotificationIndicator />
              <UserMenu />
            </header>
            <main id="adm-main" className="adm-content" tabIndex={-1}>{children}</main>
          </div>
        </div>
        <SearchPanel open={searching} onClose={() => setSearching(false)} />
      </div>
    </Ctx.Provider>
  )
}
