import { randomUUID } from 'node:crypto'

// Structured JSON logging with correlation ids and secret redaction. One line per event so it can
// be shipped to any log sink. NEVER logs credentials/OTP/tokens/secrets — values under sensitive
// keys are replaced with '[redacted]', and Authorization headers are never logged.

const SENSITIVE_KEY = /(pass(word)?|secret|token|authorization|api[-_]?key|code|otp|proof|card|cvv|ssn)/i

function redact(value, depth = 0) {
  if (value == null || depth > 4) return value
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1))
  if (typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1)
    }
    return out
  }
  return value
}

export function newRequestId() {
  return randomUUID()
}

function emit(level, event, fields) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...redact(fields || {}) })
  if (level === 'error') process.stderr.write(line + '\n')
  else process.stdout.write(line + '\n')
}

export const log = {
  info: (event, fields) => emit('info', event, fields),
  warn: (event, fields) => emit('warn', event, fields),
  error: (event, fields) => emit('error', event, fields),
}

// Log a completed request. Only method/path/status/duration/requestId — never headers or body.
export function logRequest({ requestId, method, path, status, durationMs }) {
  emit(status >= 500 ? 'error' : 'info', 'http_request', { requestId, method, path, status, durationMs })
}

// Redact + summarize an error for server-side logging without leaking sensitive context.
export function errorSummary(error) {
  return {
    code: error?.code || 'INTERNAL_ERROR',
    statusCode: error?.statusCode || 500,
    message: error?.expose ? error?.message : 'internal error',
  }
}
