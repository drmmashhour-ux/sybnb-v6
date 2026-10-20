import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { AdminApiError, adminFetch, qs, useAdminGet, type Comment, type TimelineEvent } from '../api'
import { dateTime, initials } from '../format'
import { describeError, STATE_LABEL, type StateKind } from '../states'
import { formatEvent } from '../events'

/* ---------- navigation helper (hash router) ---------- */
export function Link({ to, children, className, ...rest }: { to: string; children: ReactNode; className?: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  return <a href={`#${to}`} className={className} {...rest}>{children}</a>
}

/* ---------- status design: label + shape + colour, never colour alone ---------- */
export type Tone = 'pos' | 'info' | 'warn' | 'crit' | 'neu'
const SHAPES: Record<Tone, ReactNode> = {
  pos: <svg viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4.2" fill="currentColor" /></svg>,
  info: <svg viewBox="0 0 10 10" aria-hidden="true"><rect x="1.2" y="1.2" width="7.6" height="7.6" rx="1.2" fill="currentColor" /></svg>,
  warn: <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 .8 9.4 9H.6z" fill="currentColor" /></svg>,
  crit: <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 .5 9.5 5 5 9.5.5 5z" fill="currentColor" /></svg>,
  neu: <svg viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>,
}
export function StatusBadge({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return <span className={`adm-badge adm-t-${tone}`} title={title} data-tone={tone}>{SHAPES[tone]}{children}</span>
}

export const toneForWorkStatus = (s: string): Tone => ({ OPEN: 'info', IN_PROGRESS: 'info', BLOCKED: 'crit', DONE: 'pos', CANCELLED: 'neu' } as Record<string, Tone>)[s] ?? 'neu'
export const toneForPriority = (p: string): Tone => ({ URGENT: 'crit', HIGH: 'warn', NORMAL: 'neu', LOW: 'neu' } as Record<string, Tone>)[p] ?? 'neu'
export const toneForPlatform = (s: string): Tone => ({ ACTIVE: 'pos', SETUP: 'warn', DEGRADED: 'warn', DISABLED: 'neu', NO_DATA: 'neu' } as Record<string, Tone>)[s] ?? 'neu'
export const toneForParty = (s: string): Tone => ({ ACTIVE: 'pos', INACTIVE: 'neu', BLOCKED: 'crit' } as Record<string, Tone>)[s] ?? 'neu'
export const PLATFORM_STATUS_LABEL: Record<string, string> = { ACTIVE: 'Active', SETUP: 'Setup', DEGRADED: 'Degraded', DISABLED: 'Disabled', NO_DATA: 'No data' }

export function RiskBadge({ risk }: { risk: string | null | undefined }) {
  if (!risk || risk === 'NONE') return <span className="adm-faint" aria-label="No risk flagged">—</span>
  const tone: Tone = risk === 'HIGH' ? 'crit' : risk === 'MEDIUM' ? 'warn' : 'info'
  return <StatusBadge tone={tone}>{risk.charAt(0) + risk.slice(1).toLowerCase()} risk</StatusBadge>
}

/* ---------- page header, entity header ---------- */
export function PageHeader({ title, subtitle, crumbs, actions, identity, hideCrumbsOnPhone }: { title?: ReactNode; subtitle?: ReactNode; crumbs?: Array<{ label: string; to?: string }>; actions?: ReactNode; identity?: boolean; hideCrumbsOnPhone?: boolean }) {
  return (
    <header className="adm-ph">
      <div className={identity ? 'adm-identity' : undefined}>
        {identity ? <span className="adm-identity-bar" aria-hidden="true" /> : null}
        <div>
          {crumbs && crumbs.length > 0 ? (
            <nav className={`adm-crumbs${hideCrumbsOnPhone ? ' hide-phone' : ''}`} aria-label="Breadcrumb">
              {crumbs.map((c, i) => (<span key={c.label}>{i > 0 ? ' / ' : ''}{c.to ? <Link to={c.to}>{c.label}</Link> : c.label}</span>))}
            </nav>
          ) : null}
          {title ? <h1 className="adm-h1">{title}</h1> : null}
          {subtitle ? <p className="adm-sub">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="adm-actions">{actions}</div> : null}
    </header>
  )
}

export function EntityHeader({ name, kindLabel, badges, meta, actions, as: Heading = 'h1' }: { name: string; kindLabel: string; badges?: ReactNode; meta?: ReactNode; actions?: ReactNode; as?: 'h1' | 'h2' }) {
  return (
    <section className="adm-eh" aria-label={`${name} summary`}>
      <div className="adm-eh-av" aria-hidden="true">{initials(name)}</div>
      <div className="adm-eh-main">
        <div className="adm-note">{kindLabel}</div>
        <Heading>{name}</Heading>
        {badges ? <div className="adm-eh-meta">{badges}</div> : null}
        {meta ? <div className="adm-note" style={{ marginTop: 8 }}>{meta}</div> : null}
      </div>
      {actions ? <div className="adm-actions">{actions}</div> : null}
    </section>
  )
}

/* ---------- cards ---------- */
export function MetricCard({ label, value, note, href, tone }: { label: string; value?: number | string | null; note?: string; href?: string; tone?: 'warn' | 'crit' }) {
  const body = (
    <>
      <div className="adm-metric-l">{label}</div>
      {value === null || value === undefined ? <div className="adm-metric-v is-na">Not available</div> : <div className="adm-metric-v">{value}</div>}
      {note ? <div className="adm-metric-n">{note}</div> : null}
    </>
  )
  const cls = `adm-metric${tone ? ` tone-${tone}` : ''}`
  return href ? <Link to={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>
}

export function PlatformCard({ name, status, statusLabel, attention, href, note }: { name: string; status: string; statusLabel: string; attention: number | null; href?: string; note?: string }) {
  return (
    <article className="adm-pcard" aria-label={name}>
      <div className="adm-pcard-h"><h3>{name}</h3><StatusBadge tone={toneForPlatform(status)}>{statusLabel}</StatusBadge></div>
      <div>
        {attention === null ? <span className="adm-muted">No attention data reported</span> : <><b style={{ fontSize: 22 }}>{attention}</b> <span className="adm-muted">need attention</span></>}
        {note ? <div className="adm-note" style={{ marginTop: 4 }}>{note}</div> : null}
      </div>
      <div className="adm-pcard-f">{href ? <Link to={href}>Open {name} →</Link> : <span>Module coming soon</span>}</div>
    </article>
  )
}

/** Scan order: title, platform, priority/status (+ the few critical flags), then quiet metadata. */
export function TaskCard({ title, platform, meta, onOpen, badges }: { title: string; platform?: string; meta: ReactNode; onOpen: () => void; badges: ReactNode }) {
  return (
    <button type="button" className="adm-task" onClick={onOpen}>
      <span className="adm-task-title">{title}</span>
      {platform ? <span className="adm-task-plat">{platform}</span> : null}
      <span className="adm-task-badges">{badges}</span>
      <span className="adm-task-meta">{meta}</span>
    </button>
  )
}

/* ---------- states ---------- */
export function EmptyState({ title, children, action, kind }: { title: string; children?: ReactNode; action?: ReactNode; kind?: StateKind }) {
  return (
    <div className="adm-empty" role="status" data-state-kind={kind}>
      {kind ? <span className="adm-state-tag">{STATE_LABEL[kind]}</span> : null}
      <h3>{title}</h3>{children ? <p>{children}</p> : null}{action}
    </div>
  )
}
/** Distinguishes: no permission, not found, service unavailable, not implemented, signed out, other. */
export function ErrorState({ error, onRetry }: { error: AdminApiError | Error; onRetry?: () => void }) {
  const e = error as AdminApiError
  const d = describeError(e.status ?? -1, e.code, error.message)
  return (
    <div className={`adm-empty is-error${d.kind === 'no-permission' ? ' is-denied' : ''}`} role="alert" data-state-kind={d.kind}>
      <span className="adm-state-tag">{STATE_LABEL[d.kind]}</span>
      <h3>{d.title}</h3><p>{d.text}</p>
      {onRetry && d.retry ? <Button onClick={onRetry}>Try again</Button> : null}
    </div>
  )
}
export function LoadingSkeleton({ rows = 5, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="adm-sr">{label}…</span>
      {Array.from({ length: rows }, (_, i) => <span key={i} className="adm-skel" style={{ height: 14, marginBottom: 12, width: `${92 - (i % 3) * 14}%` }} />)}
    </div>
  )
}

/* ---------- buttons: one hierarchy used everywhere ----------
   primary   = the single main action on a screen         secondary = routine actions (default)
   tertiary  = low-emphasis text action                   danger    = destructive / hard-to-undo (always confirmed) */
export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger'
export function Button({ variant = 'secondary', className, type, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type ?? 'button'} className={`adm-btn adm-btn-${variant}${className ? ` ${className}` : ''}`} {...rest} />
}

/* ---------- connected / not yet connected ---------- */
export function ConnectionTag({ state }: { state: 'connected' | 'fixture' | 'pending' }) {
  if (state === 'connected') return <StatusBadge tone="pos">Connected</StatusBadge>
  if (state === 'fixture') return <StatusBadge tone="warn">Fixture data</StatusBadge>
  return <StatusBadge tone="neu">Not yet connected</StatusBadge>
}

/** Actions that are not available yet. They are rows of text, NOT buttons, so nothing looks clickable and does nothing. */
export type PlannedAction = { key: string; label: string; reason: string; danger?: boolean }
export function PlannedActions({ actions, label }: { actions: PlannedAction[]; label: string }) {
  return (
    <ul className="adm-planned" aria-label={label}>
      {actions.map((a) => (
        <li key={a.key} className={a.danger ? 'is-danger' : undefined}><span>{a.label}</span><span className="adm-state-tag">{a.reason}</span></li>
      ))}
    </ul>
  )
}

/* ---------- tabs (arrow-key navigation, roving tabindex) ---------- */
export type TabDef = { key: string; label: string; count?: number | null; hidden?: boolean }
export function Tabs({ tabs, value, onChange, label, idPrefix }: { tabs: TabDef[]; value: string; onChange: (k: string) => void; label: string; idPrefix: string }) {
  const list = tabs.filter((t) => !t.hidden)
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const strip = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  const measure = useCallback(() => {
    const el = strip.current
    if (el) setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 })
  }, [])
  useEffect(() => { measure(); window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure) }, [measure, list.length])
  // The selected tab is always brought fully into view, so it can never sit clipped off-screen.
  // Keep the selected tab fully inside the strip by moving the strip's own scroll position. scrollIntoView is avoided on
  // purpose: it moves the browser's keyboard starting point, so the first Tab press would skip past the skip link.
  useEffect(() => {
    const el = refs.current[value]; const box = strip.current
    if (el && box) {
      const a = el.getBoundingClientRect(); const b = box.getBoundingClientRect()
      if (a.left < b.left) box.scrollLeft -= b.left - a.left + 8
      else if (a.right > b.right) box.scrollLeft += a.right - b.right + 8
    }
    measure()
  }, [value, measure])
  const onKey = (e: React.KeyboardEvent) => {
    const i = list.findIndex((t) => t.key === value)
    let n = -1
    if (e.key === 'ArrowRight') n = (i + 1) % list.length
    else if (e.key === 'ArrowLeft') n = (i - 1 + list.length) % list.length
    else if (e.key === 'Home') n = 0
    else if (e.key === 'End') n = list.length - 1
    if (n >= 0) { e.preventDefault(); onChange(list[n].key); refs.current[list[n].key]?.focus() }
  }
  return (
    <div className="adm-tabs-wrap" data-more-left={edges.left} data-more-right={edges.right}>
      <div className="adm-tabs" role="tablist" aria-label={label} onKeyDown={onKey} ref={strip} onScroll={measure}>
        {list.map((t) => (
          <button key={t.key} ref={(el) => { refs.current[t.key] = el }} type="button" role="tab" id={`${idPrefix}-tab-${t.key}`} aria-controls={`${idPrefix}-panel`} aria-selected={t.key === value} tabIndex={t.key === value ? 0 : -1} className="adm-tab" onClick={() => onChange(t.key)}>
            {t.label}{t.count !== undefined && t.count !== null ? <span className="adm-tab-n">{t.count}</span> : null}
          </button>
        ))}
      </div>
    </div>
  )
}
export function TabPanel({ idPrefix, active, children }: { idPrefix: string; active: string; children: ReactNode }) {
  return <div role="tabpanel" id={`${idPrefix}-panel`} aria-labelledby={`${idPrefix}-tab-${active}`} tabIndex={0}>{children}</div>
}

/* ---------- filter bar ---------- */
export function FilterBar({ children, label }: { children: ReactNode; label: string }) {
  return <div className="adm-filters" role="search" aria-label={label}>{children}</div>
}
export function SearchInput({ value, onChange, label, placeholder }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string }) {
  const [local, setLocal] = useState(value)
  useEffect(() => setLocal(value), [value])
  useEffect(() => { if (local === value) return; const t = setTimeout(() => onChange(local), 300); return () => clearTimeout(t) }, [local, value, onChange])
  return <input type="search" className="adm-input" style={{ minWidth: 220 }} aria-label={label} placeholder={placeholder ?? 'Search'} value={local} onChange={(e) => setLocal(e.target.value)} />
}

/* ---------- timeline ---------- */
export type TimelineRow = { id: string; at: string | null; title: string; detail?: string }
export function Timeline({ rows, label }: { rows: TimelineRow[]; label: string }) {
  return (
    <ol className="adm-tl" aria-label={label}>
      {rows.map((r) => (<li key={r.id}><b>{r.title}</b>{r.detail ? <span className="adm-muted"> · {r.detail}</span> : null}<time dateTime={r.at ?? undefined}>{dateTime(r.at)}</time></li>))}
    </ol>
  )
}

/* ---------- dialog focus management: shared by the side panel and the confirm dialog ---------- */
const FOCUSABLE = 'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])'
function useDialogFocus(open: boolean, ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const node = ref.current
    node?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
      if (e.key !== 'Tab' || !node) return
      const f = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement)
      if (f.length === 0) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('keydown', onKey, true); prev?.focus?.() }
  }, [open, onClose, ref])
}
export function SidePanel({ open, onClose, title, subtitle, children, footer, variant = 'drawer' }: { open: boolean; onClose: () => void; title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; variant?: 'drawer' | 'sheet' }) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useDialogFocus(open, ref, onClose)
  if (!open) return null
  return (
    <>
      <div className="adm-panel-scrim" onClick={onClose} aria-hidden="true" />
      <div className={`adm-panel${variant === 'sheet' ? ' is-sheet' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="adm-panel-h">
          <div><h2 id={titleId}>{title}</h2>{subtitle ? <div className="adm-note" style={{ marginTop: 4 }}>{subtitle}</div> : null}</div>
          <button type="button" className="adm-iconbtn" data-autofocus aria-label="Close panel" onClick={onClose}>✕</button>
        </div>
        <div className="adm-panel-b">{children}</div>
        {footer ? <div className="adm-panel-f">{footer}</div> : null}
      </div>
    </>
  )
}

/** Confirmation for hard-to-undo actions. Focus starts on Cancel, Esc cancels, the consequence is spelled out. */
export function ConfirmDialog({ open, title, children, confirmLabel, onConfirm, onCancel, danger = true, busy = false }: { open: boolean; title: string; children: ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void; danger?: boolean; busy?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId(); const descId = useId()
  useDialogFocus(open, ref, onCancel)
  if (!open) return null
  return (
    <>
      <div className="adm-panel-scrim" onClick={onCancel} aria-hidden="true" />
      <div className="adm-confirm" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId} ref={ref}>
        <h2 id={titleId}>{title}</h2>
        <div id={descId} className="adm-confirm-body">{children}</div>
        <div className="adm-actions" style={{ justifyContent: 'flex-end' }}>
          <Button data-autofocus onClick={onCancel}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} className="is-solid" disabled={busy} onClick={onConfirm}>{busy ? 'Working…' : confirmLabel}</Button>
        </div>
      </div>
    </>
  )
}

/* ---------- popover helper (click outside + Esc) ---------- */
export function usePopover() {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus() } }
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open])
  return { open, setOpen, wrap, btn }
}

/* ---------- action menu: disabled items state why ---------- */
export type MenuAction = { key: string; label: string; onSelect?: () => void; disabledReason?: string }
export function ActionMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
  const { open, setOpen, wrap, btn } = usePopover()
  const id = useId()
  return (
    <div className="adm-menu" ref={wrap}>
      <button type="button" ref={btn} className="adm-btn adm-btn-secondary" aria-haspopup="menu" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{label} ▾</button>
      {open ? (
        <div className="adm-pop" role="menu" id={id}>
          {actions.map((a) => (
            <button key={a.key} type="button" role="menuitem" className="adm-pop-item" aria-disabled={a.disabledReason ? true : undefined} onClick={() => { if (!a.disabledReason) { a.onSelect?.(); setOpen(false) } }}>
              {a.label}{a.disabledReason ? <small>{a.disabledReason}</small> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/* ---------- comments (real API; the server decides whether the user may write) ---------- */
export function CommentPanel({ entityType, entityId }: { entityType: string; entityId: string }) {
  const q = useAdminGet<{ comments: Comment[] }>(`/comments${qs({ entityType, entityId })}`)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!body.trim()) return
    setBusy(true); setErr(null)
    try { await adminFetch('/comments', { method: 'POST', body: { entityType, entityId, body } }); setBody(''); q.reload() }
    catch (x) { setErr((x as AdminApiError).status === 403 ? 'You can read comments here but your role cannot add them.' : (x as Error).message) }
    finally { setBusy(false) }
  }, [body, entityType, entityId, q])
  return (
    <section aria-label="Comments">
      {q.loading ? <LoadingSkeleton rows={2} label="Loading comments" /> : q.error ? <ErrorState error={q.error} onRetry={q.reload} /> : (
        q.data && q.data.comments.length > 0
          ? q.data.comments.map((c) => (<div className="adm-comment" key={c.id}><b>{c.authorName ?? 'Unknown user'}</b><time dateTime={c.createdAt}>{dateTime(c.createdAt)}</time><div>{c.body}</div></div>))
          : <p className="adm-note">No comments yet.</p>
      )}
      <form onSubmit={submit} style={{ marginTop: 10 }}>
        <label className="adm-sr" htmlFor={`cmt-${entityId}`}>Add an internal comment</label>
        <textarea id={`cmt-${entityId}`} className="adm-input" style={{ width: '100%', height: 64, padding: 8 }} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} placeholder="Add an internal comment" />
        {err ? <div className="adm-note" role="alert" style={{ color: 'var(--adm-crit)' }}>{err}</div> : null}
        <div style={{ marginTop: 6 }}><button className="adm-btn adm-btn-secondary" type="submit" disabled={busy || !body.trim()}>{busy ? 'Posting…' : 'Add comment'}</button></div>
      </form>
    </section>
  )
}

/* ---------- entity timeline (real API) ---------- */
export function EntityTimeline({ entityType, entityId }: { entityType: string; entityId: string }) {
  const q = useAdminGet<{ events: TimelineEvent[] }>(`/timeline${qs({ entityType, entityId })}`)
  if (q.loading) return <LoadingSkeleton rows={3} label="Loading activity" />
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />
  if (!q.data || q.data.events.length === 0) return <p className="adm-note">No recorded activity yet.</p>
  return <Timeline label="Activity" rows={q.data.events.map((e) => { const f = formatEvent(e, entityType); return { id: e.id, at: e.createdAt, title: f.title, detail: f.detail } })} />
}
