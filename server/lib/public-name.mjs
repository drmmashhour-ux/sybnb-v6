// Public display names must never reveal an email address. Accounts created by email-code sign-in
// get their email as displayName, and that name is returned on public endpoints (listing reviews,
// host profiles). Mask anything email-shaped to its first letter + "***"; other names pass through.
export function publicDisplayName(name) {
  if (typeof name !== 'string') return name ?? null
  const trimmed = name.trim()
  if (!trimmed) return null
  if (trimmed.includes('@')) return `${[...trimmed][0]}***`
  return trimmed
}
