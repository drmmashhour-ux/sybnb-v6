import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'

// SR Ride vs. Uber gap-closure: business/corporate accounts. No new auth role -- a "business
// admin" is just a signed-in GUEST whose id matches businessAccount.adminUserId, the same
// ownership-check pattern (rider owns their own ride, etc.) already used throughout this codebase.
async function loadOwnBusinessAccount(context) {
  const account = await db().businessAccount.findFirst({ where: { adminUserId: context.user.id } })
  if (!account) {
    const error = new Error('This account does not manage a business account.')
    error.statusCode = 403
    error.code = 'BUSINESS_ACCOUNT_NOT_ADMIN'
    error.expose = true
    throw error
  }
  if (!account.active) {
    const error = new Error('This business account has been deactivated.')
    error.statusCode = 403
    error.code = 'BUSINESS_ACCOUNT_INACTIVE'
    error.expose = true
    throw error
  }
  return account
}

export async function handleBusiness(req, res, url, context) {
  // Lightweight check for the ride-request form: is this rider (not necessarily the company's
  // admin) a member of an active business account they can bill a ride to?
  if (url.pathname === '/api/business/membership') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['GUEST'])
    const membership = await db().businessAccountMember.findFirst({
      where: { userId: context.user.id, businessAccount: { active: true } },
      include: { businessAccount: { select: { id: true, name: true } } },
    })
    return json(res, 200, {
      ok: true,
      isMember: Boolean(membership),
      businessAccountName: membership?.businessAccount.name || null,
    })
  }

  if (url.pathname === '/api/business/account') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['GUEST'])
    const account = await loadOwnBusinessAccount(context)
    const members = await db().businessAccountMember.findMany({
      where: { businessAccountId: account.id },
      include: { user: { select: { id: true, displayName: true, email: true } } },
      orderBy: { addedAt: 'asc' },
    })
    return json(res, 200, { ok: true, account, members })
  }

  if (url.pathname === '/api/business/members') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['GUEST'])
    const account = await loadOwnBusinessAccount(context)
    const body = await readJson(req)
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!email) {
      const error = new Error('An email is required.')
      error.statusCode = 400
      error.code = 'BUSINESS_MEMBER_EMAIL_REQUIRED'
      error.expose = true
      throw error
    }

    const user = await db().user.findUnique({ where: { email } })
    if (!user) {
      const error = new Error('No account exists with this email. The rider must sign up first.')
      error.statusCode = 404
      error.code = 'BUSINESS_MEMBER_USER_NOT_FOUND'
      error.expose = true
      throw error
    }

    try {
      const member = await db().businessAccountMember.create({
        data: { businessAccountId: account.id, userId: user.id },
        include: { user: { select: { id: true, displayName: true, email: true } } },
      })
      return json(res, 201, { ok: true, member })
    } catch (err) {
      if (err?.code === 'P2002') {
        const error = new Error('This rider is already a member of your business account.')
        error.statusCode = 409
        error.code = 'BUSINESS_MEMBER_DUPLICATE'
        error.expose = true
        throw error
      }
      throw err
    }
  }

  const removeMemberMatch = url.pathname.match(/^\/api\/business\/members\/([^/]+)$/)
  if (removeMemberMatch) {
    if (req.method !== 'DELETE') return methodNotAllowed(res, ['DELETE'])
    requireAuth(context, ['GUEST'])
    const account = await loadOwnBusinessAccount(context)
    await db().businessAccountMember.deleteMany({
      where: { businessAccountId: account.id, userId: removeMemberMatch[1] },
    })
    return json(res, 200, { ok: true })
  }

  if (url.pathname === '/api/business/usage') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['GUEST'])
    const account = await loadOwnBusinessAccount(context)
    const rides = await db().rideRequest.findMany({
      where: { businessAccountId: account.id },
      include: { rider: { select: { id: true, displayName: true, email: true } } },
      orderBy: { requestedAt: 'desc' },
      take: 200,
    })
    const totalMinor = rides.filter((ride) => ride.status === 'COMPLETED').reduce((sum, ride) => sum + (ride.fareMinor || 0), 0)
    return json(res, 200, { ok: true, rides, totalMinor })
  }

  return false
}
