// STEP 5A -- legacy -> canonical permission codes. The Step 5 first cut used area.resource.action names
// that did not match the Step 3 namespace. Codes are renamed IN PLACE by migration 081 (same row, same
// id, so every role version membership, assignment and evidence reference stays intact). The old name
// is kept in permission_code_aliases so historical evidence written under the old name stays queryable.
// This file is the single source of truth for the mapping (used by the migration generator, the seed
// and the tests). Nothing at runtime resolves a legacy name to a grant: authorization uses canonical
// codes only.
export const LEGACY_PERMISSION_ALIASES = Object.freeze({
  'admin.console.access': 'console.access',
  'search.global.use': 'search.use',
  'notification.own.read': 'notification.view_own',
  'report.directory.read': 'report.view',
  'ai.controller.read': 'ai.view',
  'fin.shell.read': 'finance.view',
  'tax.shell.read': 'tax.view',
  'acct.center.read': 'accountant.view',
  'cfg.settings.read': 'config.view',
  'cfg.settings.write': 'config.manage',
  'platform.shell.read': 'platform.view',
  'platform.registry.manage': 'platform.manage',
  'platform.health.read': 'platform_health.view',
  'work.item.read': 'work.view',
  'work.item.manage': 'work.manage',
  'approval.request.read': 'approval.view',
  'approval.request.decide': 'approval.decide',
  'party.party.read': 'party.view',
  'party.party.write': 'party.manage',
  'party.contact.read_sensitive': 'party.contact_sensitive.view',
  'doc.document.read': 'document.view',
  'doc.document.upload': 'document.upload',
  'doc.document.review': 'document.review',
  'doc.document.download': 'document.download',
  'support.case.read': 'support.view',
  'support.case.write': 'support.manage',
  'support.note.internal': 'support.note_internal',
  'comment.internal.write': 'comment.write',
  'iam.user.read': 'user.view',
  'iam.user.suspend': 'user.suspend',
  'iam.role.read': 'role.view',
  'iam.role.manage': 'role.manage',
  'iam.role_assignment.read': 'access.view',
  'iam.role_assignment.assign': 'access.assign',
  'iam.session.read_own': 'session.view_own',
  'iam.session.revoke_own': 'session.revoke_own',
  'iam.session.read_org': 'session.view',
  'iam.session.revoke_org': 'session.revoke',
  'iam.service_account.read': 'service_account.view',
  'iam.service_account.disable': 'service_account.disable',
  'sec.event.read': 'security_event.view',
  'sec.settings.manage': 'security.manage',
  'sec.break_glass.activate': 'break_glass.use',
  'audit.event.read': 'audit.view',
  'audit.event.export': 'audit.export',
  'audit.evidence.read': 'audit.evidence.view',
})

export const CANONICAL_TO_LEGACY = Object.freeze(Object.fromEntries(Object.entries(LEGACY_PERMISSION_ALIASES).map(([o, n]) => [n, o])))

/** area / resource / action columns for a canonical code (2-part codes repeat the area as the resource). */
export function permissionParts(code) {
  const p = code.split('.')
  if (p.length === 2) return { area: p[0], resource: p[0], action: p[1] }
  return { area: p[0], resource: p[1], action: p.slice(2).join('.') }
}
