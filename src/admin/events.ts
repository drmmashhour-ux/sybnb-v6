// Step 5G -- turns a stored timeline event into business language. PRESENTATION ONLY: the stored event, its
// summary and its raw detail are never modified. Database column names, UUIDs and enum codes are not shown here;
// the technical Audit view is the place for those. Unknown events fall back to a neutral sentence, never raw JSON.
import { humanize } from './format'

export type EventChange = {
  status?: { from: string | null; to: string }
  priority?: { from: string | null; to: string }
  assigned?: { fromName: string | null; toName: string | null; unassigned: boolean }
}
export type FormatterEvent = { eventType: string; summary?: string | null; actorName?: string | null; change?: EventChange | null }
export type FormattedEvent = { title: string; detail?: string }

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
// A short name ends in a full stop ("Sarah M."); never let the sentence end with two.
const clean = (s: string): string => s.replace(UUID, 'a record').replace(/\.{2,}(\s|$)/g, '.$1')

/** "Sarah Mansour" -> "Sarah M."   A single name is kept as is. */
export function shortName(name: string | null | undefined): string | null {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]
  const last = parts[parts.length - 1]
  return `${parts[0]} ${last[0].toUpperCase()}.`
}

const NOUN: Record<string, string> = { work_item: 'work item', party: 'party', admin_document: 'document', support_case: 'support case', approval_request: 'approval request' }
// Only fields with a plain-language name are mentioned. Anything else is left out rather than shown raw.
const FIELD: Record<string, string> = {
  displayName: 'name', legalName: 'legal name', status: 'status', priority: 'priority', assignedUserId: 'assignee', dueAt: 'due date',
  risk: 'risk level', subject: 'subject', summary: 'summary', category: 'category', kind: 'type', email: 'email address', phone: 'phone number',
}
const list = (xs: string[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

export function formatEvent(ev: FormatterEvent, entityType?: string): FormattedEvent {
  const who = shortName(ev.actorName) ?? 'A team member'
  const noun = (entityType && NOUN[entityType]) || 'record'
  const summary = ev.summary ?? ''
  const out = (title: string, detail?: string): FormattedEvent => ({ title: clean(title), ...(detail ? { detail: clean(detail) } : {}) })

  if (ev.eventType === 'updated' && ev.change) {
    const lines: string[] = []
    const c = ev.change
    if (c.priority) lines.push(c.priority.from ? `Priority changed from ${humanize(c.priority.from)} to ${humanize(c.priority.to)}.` : `Priority set to ${humanize(c.priority.to)}.`)
    if (c.status) lines.push(c.status.from ? `Status changed from ${humanize(c.status.from)} to ${humanize(c.status.to)}.` : `Status set to ${humanize(c.status.to)}.`)
    if (c.assigned) lines.push(c.assigned.unassigned ? 'Unassigned.' : `Assigned to ${shortName(c.assigned.toName) ?? 'another user'}.`)
    if (lines.length) return out(lines.join(' '), `by ${who}`)
  }
  const fieldsMatch = /^Updated: (.+)$/.exec(summary)
  if (ev.eventType === 'updated') {
    const names = fieldsMatch ? [...new Set(fieldsMatch[1].split(',').map((f) => FIELD[f.trim()]).filter(Boolean))] : []
    return out(names.length ? `${who} updated the ${list(names)}.` : `${who} updated this ${noun}.`)
  }

  switch (ev.eventType) {
    case 'created': return out(`${who} created this ${noun}.`)
    case 'comment': return out(`${who} added an internal comment.`)
    case 'internal_note': return out(`${who} added an internal note.`)
    case 'opened': return out(`${who} opened this case.`)
    case 'reply_sent': return out(`${who} recorded a reply to the customer.`)
    case 'customer_message': return out('A customer message was recorded.')
    case 'requested': return out(`${who} requested approval.`)
    case 'withdrawn': return out(`${who} withdrew the request.`)
    case 'invalidated': return out('The approval was invalidated because the record changed after it was requested.')
    case 'approved': return out(`${who} approved the request.`, /^Approved: (.+)$/.exec(summary)?.[1] ? `Reason: ${/^Approved: (.+)$/.exec(summary)![1]}` : undefined)
    case 'rejected':
      if (entityType === 'admin_document') return out(`${who} rejected the document.`)
      return out(`${who} rejected the request.`, /^Rejected: (.+)$/.exec(summary)?.[1] ? `Reason: ${/^Rejected: (.+)$/.exec(summary)![1]}` : undefined)
    case 'verified': return out(`${who} verified the document.`)
    case 'uploaded': { const f = /^Uploaded (.+)$/.exec(summary)?.[1]; return out(f ? `${f} uploaded by ${who}.` : `A document was uploaded by ${who}.`) }
    case 'new_version': {
      const m = /^New version (\d+): (.*)$/.exec(summary)
      return out(m ? `Version ${m[1]} uploaded by ${who}.` : `A new version was uploaded by ${who}.`, m && m[2] ? `Reason: ${m[2]}` : undefined)
    }
    case 'status': {
      const m = /^([A-Z_]+) -> ([A-Z_]+)$/.exec(summary)
      return out(m ? `Document status changed from ${humanize(m[1])} to ${humanize(m[2])}.` : 'The document status changed.', `by ${who}`)
    }
    case 'role_added': { const r = /^Role added: ([A-Za-z_]+)$/.exec(summary)?.[1]; return out(r ? `${who} added the role ${humanize(r)}.` : `${who} added a role.`) }
    default:
      // Never echo the stored summary here: it may contain codes. A neutral sentence is always safe.
      return out(/^[a-z][a-z_]{1,40}$/.test(ev.eventType) ? `${humanize(ev.eventType)} recorded by ${who}.` : 'An update was recorded.')
  }
}
