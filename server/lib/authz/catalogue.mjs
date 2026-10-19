// STEP 5 -- reference catalogue for the admin authorization model (Step 3 section 5, Step 3A).
// Pure data + a content-hash helper. The seed script writes this into the database; the evaluator
// never reads it (it reads the database), so editing this file changes nothing until a new role
// version is published through the controlled workflow.
import { createHash } from 'node:crypto'

// Tiers: T1 read, T2 ordinary write, T3 sensitive, T4 critical (always high-risk).
// code format: area.resource.action (enforced by a database CHECK).
// `noSelf`: the actor may not perform this on a record that concerns themselves (segregation of duties).
export const PERMISSIONS = [
  { code: 'admin.console.access', tier: 1, description: 'Sign in to the admin console.' },
  { code: 'work.item.read', tier: 1, description: 'See work items assigned to you or your team.' },
  { code: 'work.item.manage', tier: 2, description: 'Create, assign and complete work items.' },
  { code: 'approval.request.read', tier: 1, description: 'See approval requests you are involved in.' },
  { code: 'approval.request.decide', tier: 2, noSelf: true, description: 'Approve or reject a non-financial approval request.' },
  { code: 'party.party.read', tier: 1, description: 'See parties (customers, partners, vendors).' },
  { code: 'party.party.write', tier: 2, description: 'Create or update parties.' },
  { code: 'party.contact.read_sensitive', tier: 3, description: 'See full contact details of a party.' },
  { code: 'doc.document.read', tier: 1, description: 'See document metadata.' },
  { code: 'doc.document.upload', tier: 2, description: 'Upload documents and corrected versions.' },
  { code: 'doc.document.review', tier: 2, noSelf: true, description: 'Review and verify or reject documents.' },
  { code: 'doc.document.download', tier: 3, description: 'Download the original file of a document.' },
  { code: 'support.case.read', tier: 1, description: 'See support cases.' },
  { code: 'support.case.write', tier: 2, description: 'Update support cases and reply to customers.' },
  { code: 'support.note.internal', tier: 2, description: 'Read and write internal notes.' },
  { code: 'comment.internal.write', tier: 2, description: 'Write internal comments on records you can see.' },
  { code: 'iam.user.read', tier: 1, description: 'See admin users and their access.' },
  { code: 'iam.user.suspend', tier: 3, noSelf: true, description: 'Suspend or reactivate a user account.' },
  { code: 'iam.role.read', tier: 1, description: 'See roles, role versions and permissions.' },
  { code: 'iam.role.manage', tier: 4, highRisk: true, description: 'Create and publish role versions.' },
  { code: 'iam.role_assignment.read', tier: 1, description: 'See role assignments and scopes.' },
  { code: 'iam.role_assignment.assign', tier: 4, highRisk: true, noSelf: true, description: 'Grant, change or revoke role assignments.' },
  { code: 'iam.session.read_own', tier: 1, description: 'See your own sessions.' },
  { code: 'iam.session.revoke_own', tier: 1, description: 'Revoke your own other sessions.' },
  { code: 'iam.session.read_org', tier: 3, description: 'See sessions of other users.' },
  { code: 'iam.session.revoke_org', tier: 3, description: 'Revoke sessions of other users.' },
  { code: 'iam.service_account.read', tier: 2, description: 'See service accounts.' },
  { code: 'iam.service_account.disable', tier: 3, description: 'Disable a service account.' },
  { code: 'sec.event.read', tier: 2, description: 'See security events and privileged users.' },
  { code: 'sec.settings.manage', tier: 4, highRisk: true, description: 'Change security policies.' },
  { code: 'sec.break_glass.activate', tier: 4, highRisk: true, description: 'Activate emergency (break-glass) access.' },
  { code: 'audit.event.read', tier: 2, description: 'Search and read the audit log.' },
  { code: 'audit.event.export', tier: 3, description: 'Export audit events.' },
  { code: 'audit.evidence.read', tier: 3, description: 'Read authorization evidence records.' },
  { code: 'cfg.settings.read', tier: 1, description: 'See configuration.' },
  { code: 'cfg.settings.write', tier: 3, description: 'Change configuration.' },
  { code: 'platform.shell.read', tier: 1, description: 'Open a platform shell (needs platform coverage).' },
  { code: 'platform.health.read', tier: 1, description: 'See platform and integration health.' },
  { code: 'platform.registry.manage', tier: 3, description: 'Change the platform registry.' },
  { code: 'report.directory.read', tier: 1, description: 'See the report directory.' },
  { code: 'ai.controller.read', tier: 1, description: 'See AI Controller suggestions.' },
  { code: 'fin.shell.read', tier: 2, description: 'Open the finance shell (no data yet).' },
  { code: 'tax.shell.read', tier: 2, description: 'Open the tax shell (no data yet).' },
  { code: 'acct.center.read', tier: 2, description: 'Open the accountant center shell.' },
  { code: 'search.global.use', tier: 1, description: 'Use global search (results are filtered per permission).' },
  { code: 'notification.own.read', tier: 1, description: 'Read your own notifications.' },
]

export function permissionParts(code) {
  const [area, resource, action] = code.split('.')
  return { area, resource, action }
}

const ALL_CODES = PERMISSIONS.map((p) => p.code)
const READ_BASICS = ['admin.console.access', 'work.item.read', 'approval.request.read', 'search.global.use', 'notification.own.read', 'iam.session.read_own', 'iam.session.revoke_own', 'report.directory.read', 'cfg.settings.read', 'platform.health.read']

// Version-1 role definitions. coverage: platform codes or ['*'] (all). Owner is the only role that
// receives high-risk permissions at seed time; nothing else is granted them implicitly.
export const ROLES = [
  { code: 'OWNER', name: 'Owner', description: 'Full authority over the organization.', coverage: ['*'], permissions: ALL_CODES },
  {
    code: 'SECURITY_ADMIN', name: 'Security administrator', description: 'Operates access and security controls.', coverage: ['*'],
    permissions: [...READ_BASICS, 'iam.user.read', 'iam.user.suspend', 'iam.role.read', 'iam.role_assignment.read', 'iam.session.read_org', 'iam.session.revoke_org', 'iam.service_account.read', 'iam.service_account.disable', 'sec.event.read', 'audit.event.read', 'audit.evidence.read', 'platform.shell.read'],
  },
  {
    code: 'SUPPORT_AGENT', name: 'Support agent', description: 'Handles customer support cases.', coverage: ['*'],
    permissions: [...READ_BASICS, 'work.item.manage', 'party.party.read', 'doc.document.read', 'support.case.read', 'support.case.write', 'support.note.internal', 'comment.internal.write'],
  },
  {
    code: 'STR_MANAGER', name: 'SYBNB STR manager', description: 'Manages the STR platform only.', coverage: ['str'],
    permissions: [...READ_BASICS, 'work.item.manage', 'party.party.read', 'doc.document.read', 'support.case.read', 'platform.shell.read', 'comment.internal.write'],
  },
  {
    code: 'SR_MANAGER', name: 'SR manager', description: 'Manages SR Ride and SR Restaurants.', coverage: ['sr_ride', 'sr_restaurants'],
    permissions: [...READ_BASICS, 'work.item.manage', 'party.party.read', 'doc.document.read', 'support.case.read', 'platform.shell.read', 'comment.internal.write'],
  },
  {
    code: 'RESTAURANT_OPS', name: 'Restaurant operations', description: 'Runs SR Restaurants operations.', coverage: ['sr_restaurants'],
    permissions: [...READ_BASICS, 'work.item.manage', 'party.party.read', 'support.case.read', 'platform.shell.read'],
  },
  {
    code: 'FINANCE_VIEWER', name: 'Finance viewer', description: 'Opens finance and tax shells.', coverage: ['*'],
    permissions: [...READ_BASICS, 'fin.shell.read', 'tax.shell.read', 'doc.document.read', 'party.party.read'],
  },
  {
    code: 'EXTERNAL_ACCOUNTANT', name: 'External accountant', description: 'Sees only the accountant center.', coverage: ['*'],
    permissions: ['admin.console.access', 'notification.own.read', 'iam.session.read_own', 'iam.session.revoke_own', 'acct.center.read', 'tax.shell.read', 'comment.internal.write'],
  },
]

export function roleVersionContentHash({ roleCode, versionNumber, coverage, permissions }) {
  const canonical = JSON.stringify({ roleCode, versionNumber, coverage: [...coverage].sort(), permissions: [...permissions].sort() })
  return createHash('sha256').update(canonical).digest('hex')
}

// Initial organization registry (editable configuration; nothing in the evaluator reads these names).
export const REGISTRY_SEED = {
  organization: { code: 'ORG', name: 'Organization' },
  legalEntity: { code: 'LE-9375-7649', legalName: '9375-7649 Québec inc.' },
  businessUnits: [
    { code: 'BU_STAYS', name: 'Stays' },
    { code: 'BU_SR', name: 'SR' },
    { code: 'BU_SYNTRISE', name: 'Syntrise' },
    { code: 'BU_MARKETPLACE', name: 'Marketplace and Cars' },
    { code: 'BU_JOBLOOP', name: 'Jobloop' },
    { code: 'BU_MEDIA', name: 'Media' },
  ],
  platforms: [
    { code: 'str', displayName: 'SYBNB STR', bu: 'BU_STAYS', route: '/admin/str', flag: 'str.enabled', sortOrder: 1 },
    { code: 'sr_ride', displayName: 'SR Ride', bu: 'BU_SR', route: '/admin/sr/rides', flag: 'sr_rides.enabled', sortOrder: 2 },
    { code: 'sr_restaurants', displayName: 'SR Restaurants', bu: 'BU_SR', route: '/admin/sr/restaurants', flag: 'sr_restaurants.enabled', sortOrder: 3 },
    { code: 'syntrise', displayName: 'Syntrise', bu: 'BU_SYNTRISE', route: '/admin/syntrise', flag: 'syntrise.enabled', sortOrder: 4 },
    { code: 'marketplace', displayName: 'Marketplace', bu: 'BU_MARKETPLACE', route: '/admin/marketplace', flag: 'marketplace.enabled', sortOrder: 5 },
    { code: 'cars', displayName: 'Cars', bu: 'BU_MARKETPLACE', route: '/admin/cars', flag: 'cars.enabled', sortOrder: 6 },
    { code: 'jobloop', displayName: 'Jobloop', bu: 'BU_JOBLOOP', route: '/admin/jobloop', flag: 'jobloop.enabled', sortOrder: 7 },
    { code: 'radio_mailo', displayName: 'Radio Mailo', bu: 'BU_MEDIA', route: '/admin/radio', flag: 'radio_mailo.enabled', sortOrder: 8 },
  ],
  departments: [
    { code: 'SUPPORT', name: 'Support' },
    { code: 'FINANCE', name: 'Finance' },
    { code: 'OPERATIONS', name: 'Operations' },
    { code: 'SECURITY', name: 'Security' },
  ],
}
