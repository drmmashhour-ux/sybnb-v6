// STEP 5A -- reference catalogue for the admin authorization model (Step 3 section 5, Step 3A, and the
// locked management decisions 3A-4 / 3A-6 / 3A-10). Pure data + a content-hash helper. The seed script
// writes this into the database; the evaluator never reads it (it reads the database).
//
// Canonical permission namespace: <area>.<action> or <area>.<resource>.<action>, lowercase with
// underscores. This replaces the first-cut names (see permission-aliases.mjs and migration 081).
import { createHash } from 'node:crypto'
import { LEGACY_PERMISSION_ALIASES, permissionParts } from './permission-aliases.mjs'

export { permissionParts }

// Tiers: T1 read, T2 ordinary write, T3 sensitive, T4 critical (T4 is always high-risk).
// highRisk is DATA: it is written to permission_definitions.high_risk and every rule reads it from there
// (see risk.mjs). Adding a high-risk permission means adding a row here, never a code branch.
// noSelf: the actor may not perform this on a record that concerns themselves (segregation of duties).
// reserved: defined so policy and role design can refer to it, but no endpoint exists yet.
export const PERMISSIONS = [
  // console
  { code: 'console.access', tier: 1, description: 'Sign in to the admin console.' },
  { code: 'search.use', tier: 1, description: 'Use global search (results are filtered per permission).' },
  { code: 'notification.view_own', tier: 1, description: 'Read your own notifications.' },
  { code: 'report.view', tier: 1, description: 'See the report directory.' },
  { code: 'ai.view', tier: 1, description: 'See AI Controller suggestions.' },
  { code: 'finance.view', tier: 2, description: 'Open the finance shell (no data yet).' },
  { code: 'tax.view', tier: 2, description: 'Open the tax shell (no data yet).' },
  { code: 'accountant.view', tier: 2, description: 'Open the accountant center shell.' },
  { code: 'config.view', tier: 1, description: 'See configuration.' },
  { code: 'config.manage', tier: 3, description: 'Change configuration.' },
  { code: 'platform.view', tier: 1, description: 'Open a platform shell (needs platform coverage).' },
  { code: 'platform.manage', tier: 3, description: 'Change the platform registry.' },
  { code: 'platform_health.view', tier: 1, description: 'See platform and integration health.' },
  // work, approvals, records
  { code: 'work.view', tier: 1, description: 'See work items assigned to you or your team.' },
  { code: 'work.manage', tier: 2, description: 'Create, assign and complete work items.' },
  { code: 'approval.view', tier: 1, description: 'See approval requests you are involved in.' },
  { code: 'approval.decide', tier: 2, noSelf: true, description: 'Approve or reject a non-financial approval request.' },
  { code: 'party.view', tier: 1, description: 'See parties (customers, partners, vendors).' },
  { code: 'party.manage', tier: 2, description: 'Create or update parties.' },
  { code: 'party.contact_sensitive.view', tier: 3, description: 'See full contact details of a party.' },
  { code: 'document.view', tier: 1, description: 'See document metadata.' },
  { code: 'document.upload', tier: 2, description: 'Upload documents and corrected versions.' },
  { code: 'document.review', tier: 2, noSelf: true, description: 'Review and verify or reject documents.' },
  { code: 'document.download', tier: 3, description: 'Download the original file of a document.' },
  { code: 'support.view', tier: 1, description: 'See support cases.' },
  { code: 'support.manage', tier: 2, description: 'Update support cases and reply to customers.' },
  { code: 'support.note_internal', tier: 2, description: 'Read and write internal notes.' },
  { code: 'comment.write', tier: 2, description: 'Write internal comments on records you can see.' },
  // users, roles, access, sessions
  { code: 'user.view', tier: 1, description: 'See admin users and their access.' },
  { code: 'user.suspend', tier: 3, noSelf: true, description: 'Suspend a user account (standard, non-emergency).' },
  { code: 'user.suspend_emergency', tier: 4, highRisk: true, noSelf: true, description: 'Emergency suspension of a user: immediate, revokes sessions, raises a CRITICAL security event.' },
  { code: 'user.reactivate', tier: 3, noSelf: true, description: 'Reactivate a suspended user (separately authorized, never restores sessions).' },
  { code: 'role.view', tier: 1, description: 'See roles, role versions and their permissions.' },
  { code: 'role.manage', tier: 4, highRisk: true, description: 'Draft and submit role versions; register service accounts.' },
  { code: 'role.publish', tier: 4, highRisk: true, description: 'Activate (publish) an approved role version.' },
  { code: 'permission.view', tier: 1, description: 'See the permission catalogue.' },
  { code: 'access.view', tier: 1, description: 'See role assignments and scopes.' },
  { code: 'access.request', tier: 1, reserved: true, description: 'Request access for yourself or a team (not yet used).' },
  { code: 'access.assign', tier: 4, highRisk: true, noSelf: true, description: 'Request, change, migrate or revoke role assignments.' },
  { code: 'access.approve', tier: 4, highRisk: true, noSelf: true, description: 'Final (Owner) approval of a high-risk privilege grant.' },
  { code: 'delegation.create', tier: 3, reserved: true, description: 'Create a delegation (not yet used).' },
  { code: 'delegation.approve', tier: 4, highRisk: true, reserved: true, description: 'Approve a delegation (not yet used).' },
  { code: 'session.view_own', tier: 1, description: 'See your own sessions.' },
  { code: 'session.revoke_own', tier: 1, description: 'Revoke your own other sessions.' },
  { code: 'session.view', tier: 3, description: 'See sessions of other users.' },
  { code: 'session.revoke', tier: 3, description: 'Revoke sessions of other users.' },
  { code: 'service_account.view', tier: 2, description: 'See service accounts.' },
  { code: 'service_account.disable', tier: 3, description: 'Disable a service account.' },
  // security
  { code: 'security.view', tier: 2, description: 'See the Security Center overview, privileged users and MFA status.' },
  { code: 'security.manage', tier: 4, highRisk: true, description: 'Change security policies and settings.' },
  { code: 'security_event.view', tier: 2, description: 'See security events.' },
  { code: 'security_event.review', tier: 2, description: 'Acknowledge and review security events.' },
  { code: 'privileged_access.review', tier: 3, noSelf: true, description: 'Review holders of, and requests for, high-risk permissions.' },
  { code: 'break_glass.use', tier: 4, highRisk: true, description: 'Request emergency (break-glass) access.' },
  { code: 'break_glass.review', tier: 3, description: 'Review break-glass requests and use after the fact.' },
  { code: 'audit.view', tier: 2, description: 'Search and read the audit log.' },
  { code: 'audit.export', tier: 3, description: 'Export audit events.' },
  { code: 'audit.evidence.view', tier: 3, description: 'Read authorization evidence records.' },
  // financial authority: RESERVED. Defined so the high-risk registry and role segregation are real
  // today; no endpoint in Step 5/5A uses them. No role except OWNER receives them.
  { code: 'payment.release', tier: 4, highRisk: true, reserved: true, description: 'Release a payment (later step).' },
  { code: 'payout.release', tier: 4, highRisk: true, reserved: true, description: 'Release a payout (later step).' },
  { code: 'vendor.bank_change.approve', tier: 4, highRisk: true, reserved: true, description: 'Approve a vendor bank detail change (later step).' },
  { code: 'accounting.post', tier: 4, highRisk: true, reserved: true, description: 'Post an accounting entry (later step).' },
  { code: 'tax.approve', tier: 4, highRisk: true, reserved: true, description: 'Approve a tax return (later step).' },
  { code: 'accounting.period_reopen', tier: 4, highRisk: true, reserved: true, description: 'Reopen a closed accounting period (later step).' },
]

const LEGACY_CODES_CANONICAL = Object.values(LEGACY_PERMISSION_ALIASES)
const ALL_CODES = PERMISSIONS.map((p) => p.code)
const NEW_IN_5A = ALL_CODES.filter((c) => !LEGACY_CODES_CANONICAL.includes(c))

const READ_BASICS = ['console.access', 'work.view', 'approval.view', 'search.use', 'notification.view_own', 'session.view_own', 'session.revoke_own', 'report.view', 'config.view', 'platform_health.view']

// SUPER_ADMIN: broad operational administration with NO high-risk permission and NO security-review
// authority. Emergency suspension needs a separate, explicit grant (SECURITY_AUTHORITY or SECURITY_ADMIN).
const SECURITY_ONLY = new Set(['security_event.review', 'privileged_access.review', 'break_glass.review', 'user.reactivate'])
const SUPER_ADMIN_PERMISSIONS = PERMISSIONS.filter((p) => !p.highRisk && !p.reserved && !SECURITY_ONLY.has(p.code)).map((p) => p.code)

// Role versions are expressed as an initial set (v1) plus one-direction deltas (3A-3). The seed applies
// any missing version in order; a published version is never edited.
export const ROLES = [
  {
    code: 'OWNER', name: 'Owner', description: 'Full authority over the organization.', coverage: ['*'],
    versions: [
      { n: 1, permissions: LEGACY_CODES_CANONICAL, reason: 'Initial Step 5 version (all permissions of the first-cut catalogue).' },
      { n: 2, add: NEW_IN_5A, reason: 'STEP 5A: adds security administration, emergency suspension, role publish, access approval, break-glass and reserved financial authority permissions.' },
    ],
  },
  {
    code: 'SECURITY_ADMIN', name: 'Security administrator', description: 'Dedicated security administration. Holds NO financial authority and is distinct from SUPER_ADMIN.', coverage: ['*'],
    versions: [
      { n: 1, permissions: [...READ_BASICS, 'user.view', 'user.suspend', 'role.view', 'access.view', 'session.view', 'session.revoke', 'service_account.view', 'service_account.disable', 'security_event.view', 'audit.view', 'audit.evidence.view', 'platform.view'], reason: 'Initial Step 5 version.' },
      { n: 2, add: ['security.view', 'security.manage', 'user.suspend_emergency', 'user.reactivate', 'privileged_access.review', 'break_glass.review', 'security_event.review', 'permission.view'], reason: 'STEP 5A: locked decision 3A-10 -- dedicated SECURITY_ADMIN permission set.' },
    ],
  },
  {
    code: 'SECURITY_AUTHORITY', name: 'Security authority (add-on)', description: 'Explicit security authority that can be added to another role (for example SUPER_ADMIN) so that holder may emergency-suspend. Nothing else.', coverage: ['*'],
    versions: [{ n: 1, permissions: ['console.access', 'user.view', 'user.suspend_emergency', 'session.view', 'session.revoke', 'security_event.view', 'notification.view_own', 'session.view_own', 'session.revoke_own'], reason: 'STEP 5A: locked decision 3A-10.' }],
  },
  {
    code: 'SUPER_ADMIN', name: 'Super administrator', description: 'Broad operational administration without high-risk or security-review authority.', coverage: ['*'],
    versions: [{ n: 1, permissions: SUPER_ADMIN_PERMISSIONS, reason: 'STEP 5A: defined so the SUPER_ADMIN rule of 3A-10 is testable.' }],
  },
  {
    code: 'SUPPORT_AGENT', name: 'Support agent', description: 'Handles customer support cases.', coverage: ['*'],
    versions: [{ n: 1, permissions: [...READ_BASICS, 'work.manage', 'party.view', 'document.view', 'support.view', 'support.manage', 'support.note_internal', 'comment.write'], reason: 'Initial Step 5 version.' }],
  },
  {
    code: 'STR_MANAGER', name: 'SYBNB STR manager', description: 'Manages the STR platform only.', coverage: ['str'],
    versions: [{ n: 1, permissions: [...READ_BASICS, 'work.manage', 'party.view', 'document.view', 'support.view', 'platform.view', 'comment.write'], reason: 'Initial Step 5 version.' }],
  },
  {
    code: 'SR_MANAGER', name: 'SR manager', description: 'Manages SR Ride and SR Restaurants.', coverage: ['sr_ride', 'sr_restaurants'],
    versions: [{ n: 1, permissions: [...READ_BASICS, 'work.manage', 'party.view', 'document.view', 'support.view', 'platform.view', 'comment.write'], reason: 'Initial Step 5 version.' }],
  },
  {
    code: 'RESTAURANT_OPS', name: 'Restaurant operations', description: 'Runs SR Restaurants operations.', coverage: ['sr_restaurants'],
    versions: [{ n: 1, permissions: [...READ_BASICS, 'work.manage', 'party.view', 'support.view', 'platform.view'], reason: 'Initial Step 5 version.' }],
  },
  {
    code: 'FINANCE_VIEWER', name: 'Finance viewer', description: 'Opens finance and tax shells.', coverage: ['*'],
    versions: [{ n: 1, permissions: [...READ_BASICS, 'finance.view', 'tax.view', 'document.view', 'party.view'], reason: 'Initial Step 5 version.' }],
  },
  {
    code: 'EXTERNAL_ACCOUNTANT', name: 'External accountant', description: 'Sees only the accountant center.', coverage: ['*'],
    versions: [{ n: 1, permissions: ['console.access', 'notification.view_own', 'session.view_own', 'session.revoke_own', 'accountant.view', 'tax.view', 'comment.write'], reason: 'Initial Step 5 version.' }],
  },
]

/** Resolve a role's version list to full permission sets (deltas applied in order). */
export function resolveRoleVersions(role) {
  const out = []
  let prev = []
  for (const v of role.versions) {
    let permissions
    if (v.permissions) permissions = [...v.permissions]
    else permissions = [...new Set([...prev.filter((c) => !(v.remove || []).includes(c)), ...(v.add || [])])]
    if (v.add && v.remove?.length) throw new Error(`role ${role.code} v${v.n} mixes add and remove (3A-3)`)
    out.push({ n: v.n, permissions, reason: v.reason, add: v.add || [], remove: v.remove || [] })
    prev = permissions
  }
  return out
}

export function roleVersionContentHash({ roleCode, versionNumber, coverage, permissions }) {
  const canonical = JSON.stringify({ roleCode, versionNumber, coverage: [...coverage].sort(), permissions: [...permissions].sort() })
  return createHash('sha256').update(canonical).digest('hex')
}

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

// Policy v2 (STEP 5A). Values are management decisions 3A-4 and 3A-6.
export const POLICY_V2_CONFIG = Object.freeze({
  stepUpWindowMs: { 3: 15 * 60_000, 4: 5 * 60_000 },
  highRiskActivationDelayHours: 48,
  note: 'STEP 5A: 48-hour high-risk activation delay (3A-4); retention minimums live in retention_policies (3A-6).',
})
