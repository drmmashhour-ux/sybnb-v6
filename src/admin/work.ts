// Step 5G -- plain-language guidance for a work item, built ONLY from fields the queue really stores
// (type, status, priority, dates, assignment, risk, link). The backend has no per-item reason text yet, so this
// says what the type and current state mean; it never claims facts about the specific record.
import { ageLabel, dueLabel, humanize } from './format'

export type GuidanceItem = {
  type: string; status: string; priority: string; risk: string; dueAt: string | null
  assignedUserId: string | null; assignedTeam: string | null; linkedEntityType: string | null
}
const TYPE_WHY: Record<string, string> = {
  DOCUMENT_REVIEW: 'A document is waiting for someone to verify or reject it.',
  ACCESS_REQUEST: 'A request to grant or change staff access needs a decision.',
  SECURITY_REVIEW: 'A security event or a privileged-access change needs review.',
  APPROVAL: 'A request is waiting for an approver’s decision.',
  SUPPORT_ESCALATION: 'A support case was escalated and needs a decision.',
  PLATFORM_SETUP: 'A platform needs setup before it can operate.',
}
const TYPE_TODO: Record<string, string> = {
  DOCUMENT_REVIEW: 'Open the document, check it, then verify or reject it with a reason.',
  ACCESS_REQUEST: 'Review who is asking for access and why, then approve or reject.',
  SECURITY_REVIEW: 'Review the event or change and record your decision.',
  APPROVAL: 'Read the request and approve or reject it, giving a reason.',
  SUPPORT_ESCALATION: 'Read the case history, decide the next step and reply or reassign.',
  PLATFORM_SETUP: 'Complete the setup steps for this platform.',
}
export const BASIS_NOTE = 'No item-specific reason is recorded yet. This explanation comes from the task type, priority, dates and assignment.'

export function workGuidance(w: GuidanceItem, meId: string, now: number = Date.now()): { why: string[]; todo: string[]; closed: boolean } {
  if (w.status === 'DONE' || w.status === 'CANCELLED') return { why: [`This item is ${w.status === 'DONE' ? 'completed' : 'cancelled'}.`], todo: ['Nothing further is needed.'], closed: true }
  const why = [TYPE_WHY[w.type] ?? 'This item needs a person to act.']
  if (w.status === 'BLOCKED') why.push('It is marked Blocked, so something is preventing progress.')
  const due = dueLabel(w.dueAt, now)
  if (w.dueAt && due.overdue) why.push(`It was due ${due.text} and is now overdue.`)
  if (w.priority === 'URGENT' || w.priority === 'HIGH') why.push(`It is marked ${humanize(w.priority).toLowerCase()} priority.`)
  if (w.risk !== 'NONE') why.push(`A ${humanize(w.risk).toLowerCase()} risk is flagged on it.`)
  if (!w.assignedUserId && !w.assignedTeam) why.push('Nobody is assigned to it yet.')
  const todo = [TYPE_TODO[w.type] ?? 'Review the item and decide the next step.']
  if (!w.assignedUserId) todo.unshift('Assign it to yourself or a teammate so it has an owner.')
  else if (w.assignedUserId !== meId) todo.unshift('It is assigned to someone else. Check with them before changing it.')
  if (w.status === 'BLOCKED') todo.push('Find out what is blocking it and note it in a comment.')
  return { why, todo, closed: false }
}

/* ---------- mobile task card model ----------
   Badge order is fixed: 1 Priority, 2 Status, 3 Risk (only when HIGH), 4 Overdue (only when it really is).
   Everything else (lower risk, due date, assignment, age) goes in the quiet metadata line. */
export type CardItem = GuidanceItem & { id: string; title: string; platformId: string | null; createdAt: string; overdue: boolean; assignedUserName?: string | null }
export type CardBadge = { key: 'priority' | 'status' | 'risk' | 'overdue'; tone: 'pos' | 'info' | 'warn' | 'crit' | 'neu'; label: string; srSuffix?: string }

export function assigneeLabel(w: Pick<CardItem, 'assignedUserId' | 'assignedUserName' | 'assignedTeam'>, meId: string): string {
  if (w.assignedUserId) return w.assignedUserId === meId ? 'Assigned to you' : w.assignedUserName ? `Assigned to ${w.assignedUserName}` : 'Assigned to another user'
  return w.assignedTeam ? `Team: ${w.assignedTeam}` : 'Unassigned'
}
const PRIORITY_TONE: Record<string, CardBadge['tone']> = { URGENT: 'crit', HIGH: 'warn', NORMAL: 'neu', LOW: 'neu' }
const STATUS_TONE: Record<string, CardBadge['tone']> = { OPEN: 'info', IN_PROGRESS: 'info', BLOCKED: 'crit', DONE: 'pos', CANCELLED: 'neu' }

export function cardModel(w: CardItem, meId: string, now: number = Date.now()): { badges: CardBadge[]; meta: string[] } {
  const closed = w.status === 'DONE' || w.status === 'CANCELLED'
  const badges: CardBadge[] = [
    { key: 'priority', tone: PRIORITY_TONE[w.priority] ?? 'neu', label: humanize(w.priority), srSuffix: ' priority' },
    { key: 'status', tone: STATUS_TONE[w.status] ?? 'neu', label: humanize(w.status) },
  ]
  const riskAsBadge = w.risk === 'HIGH'
  if (riskAsBadge) badges.push({ key: 'risk', tone: 'crit', label: 'High risk' })
  const due = dueLabel(w.dueAt, now)
  if (w.overdue && !closed) badges.push({ key: 'overdue', tone: 'crit', label: 'Overdue' })
  const meta: string[] = []
  if (w.risk !== 'NONE' && !riskAsBadge) meta.push(`${humanize(w.risk)} risk`)
  meta.push(assigneeLabel(w, meId), `${ageLabel(w.createdAt, now)} old`)
  if (w.dueAt) meta.push(`Due ${due.text}`)
  return { badges, meta }
}
