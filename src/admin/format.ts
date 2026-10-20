// Pure helpers (unit-tested). No React, no DOM.
export function ageLabel(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const s = Math.max(0, Math.floor((now - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`
  const h = Math.floor(m / 60); if (h < 48) return `${h}h`
  return `${Math.floor(h / 24)}d`
}
export function elapsedLabel(fromIso: string | null | undefined, now: number = Date.now()): string {
  if (!fromIso) return '—'
  const t = Date.parse(fromIso)
  if (Number.isNaN(t)) return '—'
  const s = Math.max(0, Math.floor((now - t) / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`
}
export function dueLabel(iso: string | null | undefined, now: number = Date.now()): { text: string; overdue: boolean } {
  if (!iso) return { text: 'No due date', overdue: false }
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return { text: 'No due date', overdue: false }
  const d = new Date(t)
  const text = d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
  return { text, overdue: t < now }
}
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })
}
export function humanize(code: string | null | undefined): string {
  if (!code) return '—'
  // Acronyms stay upper-case: SR_COURIER -> "SR courier", not "Sr courier".
  return code.toLowerCase().replace(/[._]+/g, ' ').replace(/\b(sr|str|ai|id|api|gst|qst)\b/g, (m) => m.toUpperCase()).replace(/^\w/, (c) => c.toUpperCase())
}
export function initials(name: string): string {
  // Words that start with a letter only, so "Demo Pizzeria (fixture)" gives "DP", never "D(".
  const p = name.trim().split(/\s+/).filter((w) => /^\p{L}/u.test(w))
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[Math.min(p.length - 1, 1)][0] : '')).toUpperCase() || '?'
}
export function splitPath(path: string): { pathname: string; query: URLSearchParams } {
  const i = path.indexOf('?')
  return { pathname: i === -1 ? path : path.slice(0, i), query: new URLSearchParams(i === -1 ? '' : path.slice(i + 1)) }
}
