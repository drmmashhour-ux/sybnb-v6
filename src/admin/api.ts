// Admin console API client. Talks ONLY to /api/admin2 with the staff session token; the server is the
// authority for every decision. Nothing here gates access -- it just carries the token and reports errors.
import { useCallback, useEffect, useRef, useState } from 'react'
import { authStorage } from '../shared/api/authStorage'

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || 'http://127.0.0.1:3051'

export class AdminApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function staffToken(): string | null {
  try {
    const raw = authStorage.getItem('sybnb.v6.staffSession')
    return raw ? (JSON.parse(raw) as { token?: string }).token ?? null : null
  } catch {
    return null
  }
}

export function qs(params: Record<string, string | number | undefined | null>): string {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v))
  const s = u.toString()
  return s ? `?${s}` : ''
}

export async function adminFetch<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const token = staffToken()
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}/api/admin2${path}`, {
      method: init.method ?? 'GET',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new AdminApiError(0, 'NETWORK', 'The admin service could not be reached.')
  }
  let json: any = null
  try { json = await res.json() } catch { /* empty body */ }
  if (!res.ok || json?.ok === false) {
    throw new AdminApiError(res.status, json?.error?.code ?? 'ERROR', json?.error?.message ?? `Request failed (${res.status}).`)
  }
  return json as T
}

export type ApiState<T> = { data: T | null; error: AdminApiError | null; loading: boolean; reload: () => void }

/** GET with loading / error state. Pass null to skip. Aborts stale requests when the path changes. */
export function useAdminGet<T>(path: string | null): ApiState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<AdminApiError | null>(null)
  const [loading, setLoading] = useState(path !== null)
  const [tick, setTick] = useState(0)
  const seq = useRef(0)
  useEffect(() => {
    if (path === null) { setLoading(false); return }
    const ctl = new AbortController()
    const mine = ++seq.current
    setLoading(true)
    adminFetch<T>(path, { signal: ctl.signal })
      .then((d) => { if (mine === seq.current) { setData(d); setError(null) } })
      .catch((e) => { if (mine === seq.current && (e as Error).name !== 'AbortError') { setError(e as AdminApiError); setData(null) } })
      .finally(() => { if (mine === seq.current) setLoading(false) })
    return () => ctl.abort()
  }, [path, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading, reload }
}

// ---- response shapes (only what the screens read) ----
export type Me = {
  user: { id: string; displayName: string; email: string | null }
  permissions: string[]
  platforms: Array<{ code: string; displayName: string; route: string; status: string; authorized: boolean }>
  landing: unknown
  authentication: { strength: string; mfaMethod: string | null }
}
export type ContextInfo = {
  organizations: Array<{ id: string; code: string; name: string }>
  legalEntities: Array<{ id: string; code: string; name: string; organizationId: string }>
  businessUnits: Array<{ id: string; code: string; name: string; legalEntityId: string }>
  platforms: Array<{ id: string; code: string; displayName: string; businessUnitId: string | null; route: string; status: string }>
}
export type CommandCenter = {
  tiles: Partial<Record<'myOpenWork' | 'overdueWork' | 'pendingApprovals' | 'documentsNeedingReview' | 'openSupportCases' | 'pendingAccessApprovals' | 'securityEvents7d', number>>
  platforms: Array<{ code: string; displayName: string; route: string; status: string }>
  finance: { status: string; message: string }
}
export type Page<T> = { items: T[]; page: number; pageSize: number; total: number; totalPages: number }
export type WorkItem = {
  id: string; type: string; title: string; platformId: string | null; priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
  status: 'OPEN' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED'; assignedUserId: string | null; assignedTeam: string | null
  assignedUserName?: string | null; dueAt: string | null; overdue: boolean; linkedEntityType: string | null; linkedEntityId: string | null
  risk: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH'; createdAt: string; completedAt: string | null
}
export type WorkSummary = { mine: number; unassigned: number; overdue: number; blocked: number; urgent: number }
export type AuditEvent = { id: string; createdAt: string; action: string; entityType: string | null; entityId: string | null; reason: string | null; platformCode: string | null; actor: { id: string; displayName: string; email: string | null } | null }
export type Health = {
  system: { api: { status: string; uptimeSeconds: number }; database: { status: string; latencyMs?: number }; storage: { provider: string; status: string; durable: boolean } }
  platforms: Array<{ code: string; displayName: string; registryStatus: string; health: string }>
  integrations: { status: string; message: string }
}
export type PlatformShell = {
  platform: { id: string; code: string; displayName: string; status: string; route: string }
  counts: { openWork: number; openSupportCases: number; documentsNeedingReview: number; pendingApprovals: number }
  modules: unknown[]; note: string | null
}
export type PartyListItem = { id: string; kind: 'PERSON' | 'ORGANIZATION'; displayName: string; legalName: string | null; status: string; email: string | null; phone: string | null; roles: string[] }
export type PartyDetail = {
  party: { id: string; kind: 'PERSON' | 'ORGANIZATION'; displayName: string; legalName: string | null; status: string; createdAt: string; email: string | null; phone: string | null; contactMasked: boolean }
  roles: Array<{ id: string; roleType: string; platformId: string | null; status: string; effectiveFrom: string | null; effectiveTo: string | null }>
  addresses: Array<{ id: string; label: string | null; city?: string | null; region?: string | null; country?: string | null; line1?: string | null; postalCode?: string | null }>
  linkedAccounts: Array<{ userId: string; verified: boolean; effectiveTo: string | null }>
  documents: Array<{ id: string; title: string; documentType: string; status: string }>
  supportCases: Array<{ id: string; caseNumber: number; summary: string; status: string }>
}
export type Comment = { id: string; authorId: string; authorName: string | null; body: string; createdAt: string; resolvedAt: string | null }
export type TimelineEvent = { id: string; eventType: string; summary: string; actorUserId: string | null; actorName?: string | null; change?: import('./events').EventChange | null; createdAt: string }
export type NotificationsPage = Page<{ id: string; type: string; title: string; body: string | null; readAt: string | null; createdAt: string }> & { unread: number }
export type SearchResults = { query: string; results: Record<string, Array<{ id: string; title: string; subtitle: string; route: string }>> }
