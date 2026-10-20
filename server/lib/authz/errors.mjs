// STEP 5A -- small HTTP-shaped errors for the authorization services (same contract the admin2 router uses).
export function svcError(statusCode, code, message) {
  const e = new Error(message)
  e.statusCode = statusCode
  e.code = code
  e.expose = true
  return e
}
export const badReq = (message, code = 'BAD_REQUEST') => svcError(400, code, message)
export const notFound = (message) => svcError(404, 'NOT_FOUND', message)
export const conflictErr = (message, code = 'CONFLICT') => svcError(409, code, message)
