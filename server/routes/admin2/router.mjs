// STEP 5 -- tiny router + helpers for /api/admin2/*. Every handler must call r.require(...) (which is
// authorize()) before touching data: there is no route that is open by accident, and the router
// itself refuses anything that is not registered.
import { json, readJson, methodNotAllowed } from '../../lib/responses.mjs'
import { authorize, can, loadSnapshot } from '../../lib/authz/index.mjs'
import { holdsPermissionAnywhere } from '../../lib/authz/evaluate.mjs'
import { loadPermission } from '../../lib/authz/loader.mjs'

export const PREFIX = '/api/admin2'

export function badRequest(message, code = 'VALIDATION_ERROR', details) {
  const error = new Error(message)
  error.statusCode = 400
  error.code = code
  error.expose = true
  if (details) error.details = details
  return error
}
export function notFoundError(message = 'Not found.') {
  const error = new Error(message)
  error.statusCode = 404
  error.code = 'NOT_FOUND'
  error.expose = true
  return error
}
export function conflict(message, code = 'CONFLICT') {
  const error = new Error(message)
  error.statusCode = 409
  error.code = code
  error.expose = true
  return error
}

export function pageParams(query, { maxPageSize = 100, defaultPageSize = 25 } = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1)
  const pageSize = Math.min(maxPageSize, Math.max(1, Number.parseInt(query.pageSize, 10) || defaultPageSize))
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize }
}

/** Only whitelisted columns may be sorted on (no user-controlled column names reach the query). */
export function sortParam(query, allowed, fallback) {
  const raw = String(query.sort || '')
  const [field, dir] = raw.split(':')
  if (!allowed.includes(field)) return fallback
  return { [field]: dir === 'asc' ? 'asc' : 'desc' }
}

export function pageResult(items, total, p) {
  return { items, page: p.page, pageSize: p.pageSize, total, totalPages: Math.max(1, Math.ceil(total / p.pageSize)) }
}

export function createRouter() {
  const routes = []
  const add = (method) => (path, handler) => {
    const keys = []
    const re = new RegExp(`^${PREFIX}${path.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)' })}$`)
    routes.push({ method, re, keys, handler })
  }
  return {
    get: add('GET'), post: add('POST'), patch: add('PATCH'), put: add('PUT'),
    async handle(req, res, url, auth) {
      if (!(url.pathname === PREFIX || url.pathname.startsWith(`${PREFIX}/`))) return false
      const allowed = []
      for (const route of routes) {
        const m = route.re.exec(url.pathname)
        if (!m) continue
        if (route.method !== req.method) { allowed.push(route.method); continue }
        const params = {}
        route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]) })
        const requestId = res.getHeader('x-request-id') ? String(res.getHeader('x-request-id')) : null
        let cachedBody
        const r = {
          req, res, url, params, auth, requestId,
          query: Object.fromEntries(url.searchParams),
          body: async () => (cachedBody ??= await readJson(req)),
          require: (code, resource = {}, options = {}) => authorize(auth, code, resource, { requestId, ...options }),
          // Console-level gate: the user must hold the permission in at least one active scope. Used
          // for routes that are not about one resource (me, context, own sessions). Deny by default.
          requireAnywhere: async (code) => {
            if (!auth?.user) { const e = new Error('Authentication required.'); e.statusCode = 401; e.code = 'AUTH_REQUIRED'; e.expose = true; throw e }
            const snap = await loadSnapshot(auth, {})
            const permission = await loadPermission(snap.client, code)
            const ok = permission && holdsPermissionAnywhere({ user: { id: auth.user.id, status: auth.user.status }, permission, assignments: snap.assignments, suspensions: snap.suspensions, now: snap.now })
            if (!ok) { const e = new Error('You do not have permission to do this.'); e.statusCode = 403; e.code = 'PERMISSION_DENIED'; e.expose = true; throw e }
          },
          can: (code, resource = {}, options = {}) => can(auth, code, resource, { requestId, ...options }),
          ok: (payload = {}, status = 200) => json(res, status, { ok: true, ...payload }),
        }
        const result = await route.handler(r)
        return result === undefined ? true : result
      }
      if (allowed.length) return methodNotAllowed(res, [...new Set(allowed)])
      json(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'No admin API route matched this request.' } })
      return true
    },
  }
}
