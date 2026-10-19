// STEP 5 -- role-aware landing (Step 5 section 10). Decided from PERMISSIONS the user actually holds
// (and the platforms they can open), never from a role name alone. Pure and unit-tested.
export function computeLanding({ permissions, authorizedPlatforms = [], configuredDefault = null }) {
  const has = (c) => permissions.has(c)
  if (has('iam.role.manage') || has('cfg.settings.write')) return { route: '/admin', reason: 'ORGANIZATION_LEVEL_ACCESS' }
  const onlyAccountant = has('acct.center.read') && !has('support.case.read') && !has('sec.event.read') && authorizedPlatforms.length === 0
  if (onlyAccountant) return { route: '/admin/accountant', reason: 'ACCOUNTANT_ONLY' }
  if (has('sec.event.read') && !has('support.case.write') && !has('support.case.read')) return { route: '/admin/security', reason: 'SECURITY_OPERATOR' }
  if ((has('support.case.write') || has('support.case.read')) && authorizedPlatforms.length === 0) return { route: '/admin/support', reason: 'SUPPORT_OPERATOR' }
  if (authorizedPlatforms.length === 1) return { route: authorizedPlatforms[0].route, reason: 'SINGLE_PLATFORM' }
  if (has('fin.shell.read') && authorizedPlatforms.length === 0) return { route: '/admin/finance', reason: 'FINANCE_ONLY' }
  if (configuredDefault && typeof configuredDefault === 'string' && configuredDefault.startsWith('/admin')) return { route: configuredDefault, reason: 'CONFIGURED_DEFAULT' }
  return { route: '/admin', reason: 'DEFAULT_COMMAND_CENTER' }
}
