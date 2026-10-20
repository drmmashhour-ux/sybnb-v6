// Step 5G -- one place that decides which kind of "nothing here" a screen is showing, so the six cases are
// never confused: no data, no permission, not implemented, API unavailable, platform not configured, not found.
export type StateKind = 'no-data' | 'no-permission' | 'not-implemented' | 'api-unavailable' | 'not-configured' | 'not-found' | 'session-ended' | 'error'

export const STATE_LABEL: Record<StateKind, string> = {
  'no-data': 'No data yet', 'no-permission': 'No permission', 'not-implemented': 'Not implemented yet', 'api-unavailable': 'Service unavailable',
  'not-configured': 'Platform not configured', 'not-found': 'Record not found', 'session-ended': 'Signed out', error: 'Something went wrong',
}

export function classifyError(status: number, code?: string): StateKind {
  if (status === 401) return 'session-ended'
  if (status === 403) return 'no-permission'
  if (status === 404) return 'not-found'
  if (status === 501 || code === 'NOT_IMPLEMENTED') return 'not-implemented'
  if (status === 0 || status >= 500 || code === 'NETWORK') return 'api-unavailable'
  return 'error'
}

export function describeError(status: number, code: string | undefined, message: string): { kind: StateKind; title: string; text: string; retry: boolean } {
  const kind = classifyError(status, code)
  switch (kind) {
    case 'session-ended': return { kind, title: 'Your session has ended', text: 'Sign in again to continue.', retry: false }
    case 'no-permission': return { kind, title: 'You do not have access to this', text: 'Your role does not include this area. Nothing was changed. Ask an administrator if you need it.', retry: false }
    case 'not-found': return { kind, title: 'Record not found', text: 'It may have been removed, or it is outside what your role can see.', retry: false }
    case 'not-implemented': return { kind, title: 'Not implemented yet', text: 'This part of the console has not been built. It is not an error.', retry: false }
    case 'api-unavailable': return { kind, title: 'The admin service is unavailable', text: 'The console could not reach the service, or the service failed. Your data is unchanged. Try again in a moment.', retry: true }
    default: return { kind, title: 'Something went wrong', text: message, retry: true }
  }
}
