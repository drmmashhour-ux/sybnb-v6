// Shared helpers for the LIGHT SR / STR pages (sr.html, str.html). No React, no maps, no video:
// plain DOM + fetch so the first screen is a few KB on a weak connection. Uses the SAME API and the
// SAME session storage key as the full app, so a signed-in user stays signed in on the web.

export const API: string = (import.meta.env.VITE_API_BASE_URL as string) || 'http://127.0.0.1:3051'
const SESSION_KEY = 'sybnb.v6.guestSession'
const TOKEN_KEY = 'sybnb-v6-guest-token'

export type Lang = 'ar' | 'en'
export type Session = { token: string; user: { id: string; displayName: string; roles: string[] } }

export function store(key: string, value?: string | null): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key)
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch { /* storage blocked: the page still works, just without memory */ }
  return null
}

export function getSession(): Session | null {
  try {
    const s = JSON.parse(store(SESSION_KEY) || 'null')
    return s?.token && s?.user ? (s as Session) : null
  } catch { return null }
}
export function setSession(s: Session) {
  store(SESSION_KEY, JSON.stringify(s))
  store(TOKEN_KEY, s.token)
}
export function clearSession() {
  store(SESSION_KEY, null)
  store(TOKEN_KEY, null)
}

export class ApiError extends Error {
  status = 0
  code = ''
  offline = false
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; auth?: boolean; timeoutMs?: number } = {}): Promise<T> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 25000)
  const session = opts.auth ? getSession() : null
  try {
    const res = await fetch(`${API}${path}`, {
      method: opts.method || 'GET',
      headers: {
        ...(opts.body ? { 'content-type': 'application/json' } : {}),
        ...(session ? { authorization: `Bearer ${session.token}` } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctl.signal,
    })
    const payload = await res.json().catch(() => ({}))
    if (!res.ok || payload?.ok === false) {
      if (res.status === 401 && session) clearSession()
      const e = new ApiError(payload?.error?.message || `Request failed (${res.status})`)
      e.status = res.status
      e.code = payload?.error?.code || ''
      throw e
    }
    return payload as T
  } catch (err) {
    if (err instanceof ApiError) throw err
    const e = new ApiError('offline')
    e.offline = true
    throw e
  } finally {
    clearTimeout(timer)
  }
}

export function getLang(): Lang {
  const saved = store('sybnb.lite.lang')
  return saved === 'en' || saved === 'ar' ? saved : 'ar'
}
export function applyLang(lang: Lang) {
  document.documentElement.lang = lang
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
  store('sybnb.lite.lang', lang)
}

type Child = Node | string | null | undefined | false
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | ((e: Event) => void) | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v)
    else if (v === true) el.setAttribute(k, '')
    else el.setAttribute(k, v)
  }
  for (const c of children) if (c) el.append(c)
  return el
}

export function mount(root: HTMLElement, ...nodes: Node[]) {
  root.replaceChildren(...nodes.filter(Boolean))
}

export function money(minor: number | null | undefined, currency: string) {
  if (minor == null) return ''
  return `${(minor / 100).toLocaleString('en', { maximumFractionDigits: 2 })} ${currency}`
}

// Offline-friendly shell: register the tiny service worker only for the hosted PWA (the native app
// already ships its files locally).
export function registerShell(scopePath: string) {
  if (!('serviceWorker' in navigator)) return
  if (!/^https?:$/.test(location.protocol) || location.hostname === 'localhost') return
  navigator.serviceWorker.register('/sw-lite.js', { scope: scopePath }).catch(() => {})
}

export function langToggle(lang: Lang, rerender: () => void) {
  return h('button', {
    class: 'link', type: 'button',
    onclick: () => { applyLang(lang === 'ar' ? 'en' : 'ar'); rerender() },
  }, lang === 'ar' ? 'English' : 'العربية')
}

export function banner(text: string, kind: 'err' | 'info' = 'err') {
  return h('p', { class: `msg ${kind}`, role: 'alert' }, text)
}
