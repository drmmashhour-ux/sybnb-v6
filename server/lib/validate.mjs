// Small, dependency-free validation helpers (security audit finding F-09). Not a schema-library
// adoption across the whole API — that would be a much larger, non-narrow change. This covers the
// highest-risk unauthenticated endpoints (registration, login) as the first concrete adoption;
// see docs/security/SYBNB_V6_SECURITY_AUDIT_2026_07_10.md §5 for the scope decision.

function fail(code, message) {
  const error = new Error(message)
  error.statusCode = 400
  error.code = code
  error.expose = true
  throw error
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_PATTERN = /^\+?[\d\s()-]{6,20}$/

export function assertValidEmail(value, fieldName = 'email') {
  if (value == null) return undefined
  const trimmed = String(value).trim()
  if (!EMAIL_PATTERN.test(trimmed)) fail('VALIDATION_INVALID_EMAIL', `${fieldName} is not a valid email address.`)
  if (trimmed.length > 254) fail('VALIDATION_EMAIL_TOO_LONG', `${fieldName} is too long.`)
  return trimmed.toLowerCase()
}

export function assertValidPhone(value, fieldName = 'phone') {
  if (value == null) return undefined
  const trimmed = String(value).trim()
  if (!PHONE_PATTERN.test(trimmed)) fail('VALIDATION_INVALID_PHONE', `${fieldName} is not a valid phone number.`)
  return trimmed
}

// hashPassword() (server/lib/security.mjs) already enforces an 8-character minimum before
// hashing — this adds the same check earlier (a clean 400 instead of falling through to
// hashPassword's own error) plus a maximum length, which nothing previously enforced. The max
// exists so an arbitrarily large request body can't force an equally arbitrarily large input
// through scrypt; 256 characters is far beyond any real passphrase.
export function assertValidPassword(value, { fieldName = 'password', minLength = 8, maxLength = 256, required = true } = {}) {
  if (value == null || value === '') {
    if (required) fail('VALIDATION_PASSWORD_REQUIRED', `${fieldName} is required.`)
    return undefined
  }
  const str = String(value)
  if (str.length < minLength) fail('VALIDATION_PASSWORD_TOO_SHORT', `${fieldName} must be at least ${minLength} characters.`)
  if (str.length > maxLength) fail('VALIDATION_PASSWORD_TOO_LONG', `${fieldName} must be ${maxLength} characters or fewer.`)
  return str
}

export function assertEnum(value, allowed, fieldName) {
  if (!allowed.includes(value)) {
    fail('VALIDATION_INVALID_ENUM', `${fieldName} must be one of: ${allowed.join(', ')}.`)
  }
  return value
}

export function assertBoundedString(value, { fieldName, maxLength = 500, required = false }) {
  if (value == null || value === '') {
    if (required) fail('VALIDATION_REQUIRED', `${fieldName} is required.`)
    return undefined
  }
  const str = String(value)
  if (str.length > maxLength) fail('VALIDATION_TOO_LONG', `${fieldName} must be ${maxLength} characters or fewer.`)
  return str
}

// Rejects any key on the body that isn't in the allow-list — closes the door on a client
// smuggling an unexpected field into a route that (incorrectly, in the future) started spreading
// the raw body into a Prisma write instead of allow-listing fields explicitly. Every write path
// reviewed in the audit already allow-lists fields explicitly, so this is defense-in-depth against
// a future regression, not a fix for a currently-observed issue.
export function assertNoUnknownFields(body, allowedKeys, context = 'request body') {
  const unknown = Object.keys(body || {}).filter((key) => !allowedKeys.includes(key))
  if (unknown.length) {
    fail('VALIDATION_UNKNOWN_FIELDS', `${context} contains unexpected field(s): ${unknown.join(', ')}.`)
  }
}
