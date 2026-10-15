// SE (Eats) — food & grocery delivery, Phase 1 API (2026-10-15).
//
// One platform, three sides:
//   customer (GUEST)  — browses APPROVED merchants, places orders, cancels while still PLACED
//   merchant (owner)  — registers a store (admin-approved before it can sell), manages its menu,
//                       drives the kitchen side of the lifecycle (accept/reject → preparing → ready)
//   courier (DRIVER)  — same vetted fleet as SR rides: approved ID + approved vehicle required to
//                       claim; drives the road side (picked up → delivered)
//
// Money (Phase 1): CASH ON DELIVERY ONLY. Totals are computed server-side from the merchant's own
// menu rows and snapshotted into food_order_items — a client can never supply a price, and a later
// menu edit never changes what an existing order says it cost. Wallet/ledger integration is a
// LATER, explicit phase (AGENTS.md §6: financial semantics never change as a side effect).
//
// Lifecycle (role-gated, fail-closed — any transition not in this table is a 409):
//   PLACED → ACCEPTED | REJECTED (merchant)   PLACED → CANCELLED (customer, only while PLACED)
//   ACCEPTED → PREPARING → READY_FOR_PICKUP (merchant)
//   READY_FOR_PICKUP → PICKED_UP → DELIVERED (the assigned courier)
import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { defaultCurrency } from '../lib/country.mjs'
import { saveFoodPhoto, deleteFoodPhoto, signFoodPhotoUrl } from '../lib/food-photo-storage.mjs'
import { checkPhotoStandards } from '../lib/photo-standards.mjs'
import { getDriverLocation, etaMinutesBetween } from '../lib/live-map.mjs'

// Fees are operator-set, default OFF (fail-safe: a missing env never invents a charge).
// FOOD_DELIVERY_FEE_MINOR: flat per-order delivery fee. FOOD_SERVICE_FEE_PERCENT: % of subtotal.
const DELIVERY_FEE_MINOR = (() => {
  const raw = Number(process.env.FOOD_DELIVERY_FEE_MINOR)
  return Number.isInteger(raw) && raw >= 0 && raw <= 1_000_000 ? raw : 0
})()
const SERVICE_FEE_PERCENT = (() => {
  const raw = Number(process.env.FOOD_SERVICE_FEE_PERCENT)
  return Number.isFinite(raw) && raw >= 0 && raw <= 30 ? raw : 0
})()

const MAX_ORDER_LINES = 30
const MAX_LINE_QUANTITY = 20

function httpError(statusCode, code, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  return error
}

// status → { nextStatus → who may do it }. Single source of truth for the lifecycle.
const TRANSITIONS = {
  PLACED: { ACCEPTED: 'merchant', REJECTED: 'merchant', CANCELLED: 'customer' },
  ACCEPTED: { PREPARING: 'merchant' },
  PREPARING: { READY_FOR_PICKUP: 'merchant' },
  READY_FOR_PICKUP: { PICKED_UP: 'courier' },
  PICKED_UP: { DELIVERED: 'courier' },
}
const TRANSITION_TIMESTAMP = {
  ACCEPTED: 'acceptedAt',
  READY_FOR_PICKUP: 'readyAt',
  PICKED_UP: 'pickedUpAt',
  DELIVERED: 'deliveredAt',
  CANCELLED: 'cancelledAt',
  REJECTED: 'cancelledAt',
}

function trimmed(value, max) {
  return String(value || '').trim().slice(0, max)
}

// --- Menu Studio: promo + photo view helpers --------------------------------------------------
// A promo is ACTIVE only when a promo price is set and `now` sits inside its window (an unset
// bound is open-ended). The effective price — what an order actually costs — is always computed
// here, server-side, at order time.
function promoActive(item, now = new Date()) {
  if (!Number.isInteger(item.promoPriceMinor) || item.promoPriceMinor == null) return false
  if (item.promoStartsAt && now < item.promoStartsAt) return false
  if (item.promoEndsAt && now > item.promoEndsAt) return false
  return true
}

function effectivePriceMinor(item, now = new Date()) {
  return promoActive(item, now) ? item.promoPriceMinor : item.priceMinor
}

// Customer-visible photo URL: ONLY an APPROVED photo is ever signed for a non-owner (fail-closed
// moderation). The owner always sees their own upload plus its review status.
function photoFields(entity, { owner = false } = {}) {
  const approved = entity.photoStatus === 'APPROVED'
  const visible = entity.photoRef && (approved || owner)
  const base = { photoUrl: visible ? signFoodPhotoUrl(entity.photoRef) : null }
  if (!owner) return base
  return {
    ...base,
    photoStatus: entity.photoStatus || null,
    photoReviewNote: entity.photoReviewNote || null,
    photoMeta: entity.photoMeta || {},
  }
}

// The customer-facing shape: never the merchant owner's account details.
function publicMerchant(m, opts = {}) {
  return {
    id: m.id, name: m.name, nameAr: m.nameAr, category: m.category, city: m.city,
    address: m.address, phone: m.phone, status: m.status, active: m.active,
    // Order experience (068): position for the order map + the busy switch, so a paused store
    // shows as "busy" in browse instead of silently failing at checkout.
    lat: m.lat ?? null, lng: m.lng ?? null,
    acceptingOrders: m.acceptingOrders !== false,
    defaultPrepMinutes: m.defaultPrepMinutes ?? null,
    ...photoFields(m, opts),
  }
}

const MAX_SCHEDULE_AHEAD_MS = 7 * 24 * 3600 * 1000
const MIN_PREP_MINUTES = 5
const MAX_PREP_MINUTES = 240
const MAX_DELAY_MINUTES = 120

function validCoord(lat, lng) {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lng) && lng >= -180 && lng <= 180
}

// Menu item shape. Customers get the effective price (and the promo context when one is active);
// owners additionally get the raw promo window + photo review state for the Menu Studio.
function menuItemView(item, { owner = false, now = new Date() } = {}) {
  const active = promoActive(item, now)
  const base = {
    id: item.id, merchantId: item.merchantId, name: item.name, nameAr: item.nameAr,
    description: item.description, priceMinor: item.priceMinor, currency: item.currency,
    available: item.available, sortOrder: item.sortOrder,
    effectivePriceMinor: effectivePriceMinor(item, now),
    promoActive: active,
    promoLabel: active || owner ? item.promoLabel : null,
    promoEndsAt: active || owner ? item.promoEndsAt : null,
    ...photoFields(item, { owner }),
  }
  if (!owner) return base
  return { ...base, promoPriceMinor: item.promoPriceMinor, promoStartsAt: item.promoStartsAt }
}

export async function handleFood(req, res, url, context) {
  if (!url.pathname.startsWith('/api/food/')) return false

  // ---- Merchant registration + browsing -------------------------------------------------------
  if (url.pathname === '/api/food/merchants') {
    if (req.method === 'POST') {
      requireAuth(context)
      const body = await readJson(req)
      const name = trimmed(body.name, 80)
      const city = trimmed(body.city, 60)
      const address = trimmed(body.address, 160)
      if (!name || !city || !address) throw httpError(400, 'MERCHANT_FIELDS_REQUIRED', 'name, city and address are required.')
      const merchant = await db().merchant.create({
        data: {
          ownerId: context.user.id,
          name,
          nameAr: trimmed(body.nameAr, 80) || null,
          category: trimmed(body.category, 40) || 'restaurant',
          city,
          address,
          phone: trimmed(body.phone, 30) || null,
          // Fail-closed: every merchant starts PENDING_REVIEW; only an ADMIN approval makes it
          // sellable (mirrors vehicle review — an unvetted store must not take orders).
          status: 'PENDING_REVIEW',
        },
      })
      return json(res, 201, { ok: true, merchant: publicMerchant(merchant) })
    }
    if (req.method === 'GET') {
      requireAuth(context)
      const city = trimmed(url.searchParams.get('city'), 60)
      const merchants = await db().merchant.findMany({
        where: { status: 'APPROVED', active: true, ...(city ? { city } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
      return json(res, 200, { ok: true, merchants: merchants.map((m) => publicMerchant(m)) })
    }
    return methodNotAllowed(res, ['GET', 'POST'])
  }

  if (url.pathname === '/api/food/merchants/mine') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)
    const merchants = await db().merchant.findMany({ where: { ownerId: context.user.id }, orderBy: { createdAt: 'desc' } })
    return json(res, 200, { ok: true, merchants: merchants.map((m) => publicMerchant(m, { owner: true })) })
  }

  // ---- Order experience: merchant self-serve settings (owner) -----------------------------------
  // Busy mode ("stopped accepting orders"), store position for the order map, usual prep time.
  const settingsMatch = url.pathname.match(/^\/api\/food\/merchants\/([^/]+)\/settings$/)
  if (settingsMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context)
    const merchant = await db().merchant.findUnique({ where: { id: settingsMatch[1] } })
    if (!merchant) throw httpError(404, 'MERCHANT_NOT_FOUND', 'Merchant not found.')
    if (merchant.ownerId !== context.user.id) throw httpError(403, 'MERCHANT_NOT_OWNER', 'Only the merchant owner may change settings.')
    const body = await readJson(req)
    const data = {}
    if (body.acceptingOrders !== undefined) data.acceptingOrders = Boolean(body.acceptingOrders)
    if (body.defaultPrepMinutes !== undefined) {
      if (body.defaultPrepMinutes === null) data.defaultPrepMinutes = null
      else {
        const minutes = Number(body.defaultPrepMinutes)
        if (!Number.isInteger(minutes) || minutes < MIN_PREP_MINUTES || minutes > MAX_PREP_MINUTES) {
          throw httpError(400, 'MERCHANT_PREP_INVALID', `defaultPrepMinutes must be ${MIN_PREP_MINUTES}..${MAX_PREP_MINUTES}.`)
        }
        data.defaultPrepMinutes = minutes
      }
    }
    if (body.lat !== undefined || body.lng !== undefined) {
      const lat = Number(body.lat)
      const lng = Number(body.lng)
      if (!validCoord(lat, lng)) throw httpError(400, 'MERCHANT_LOCATION_INVALID', 'A valid lat/lng pair is required.')
      data.lat = lat
      data.lng = lng
    }
    const updated = await db().merchant.update({ where: { id: merchant.id }, data })
    return json(res, 200, { ok: true, merchant: publicMerchant(updated, { owner: true }) })
  }

  // ---- Menu Studio: photo uploads (owner) --------------------------------------------------------
  // Both uploads share the same pipeline: hard standards check (dimensions/aspect/validity — throws
  // 400 with the exact reason), private storage, then PENDING_REVIEW. Nothing a merchant uploads is
  // customer-visible until an admin approves it in the photo queue.
  const merchantPhotoMatch = url.pathname.match(/^\/api\/food\/merchants\/([^/]+)\/photo$/)
  const menuPhotoMatch = url.pathname.match(/^\/api\/food\/menu\/([^/]+)\/photo$/)
  if (merchantPhotoMatch || menuPhotoMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context)
    const body = await readJson(req)
    const fileBase64 = typeof body.fileBase64 === 'string' ? body.fileBase64 : ''
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType : ''
    if (!fileBase64 || !mimeType) throw httpError(400, 'PHOTO_REQUIRED', 'A photo file is required.')

    let target, isMenuItem
    if (menuPhotoMatch) {
      isMenuItem = true
      target = await db().menuItem.findUnique({ where: { id: menuPhotoMatch[1] }, include: { merchant: true } })
      if (!target) throw httpError(404, 'MENU_ITEM_NOT_FOUND', 'Menu item not found.')
      if (target.merchant.ownerId !== context.user.id) throw httpError(403, 'MERCHANT_NOT_OWNER', 'Only the merchant owner may upload photos.')
    } else {
      isMenuItem = false
      target = await db().merchant.findUnique({ where: { id: merchantPhotoMatch[1] } })
      if (!target) throw httpError(404, 'MERCHANT_NOT_FOUND', 'Merchant not found.')
      if (target.ownerId !== context.user.id) throw httpError(403, 'MERCHANT_NOT_OWNER', 'Only the merchant owner may upload photos.')
    }

    // Standards gate BEFORE storage: an invalid photo never lands on disk. The returned meta is the
    // reviewer's evidence (dimensions, size, editor-signature heuristic).
    const photoMeta = checkPhotoStandards(fileBase64, mimeType)
    const storageKey = await saveFoodPhoto(fileBase64, mimeType)
    const previousRef = target.photoRef

    const data = {
      photoRef: storageKey,
      photoMimeType: mimeType,
      photoStatus: 'PENDING_REVIEW',
      photoReviewNote: null,
      photoMeta,
      photoSubmittedAt: new Date(),
      photoReviewedAt: null,
    }
    const updated = isMenuItem
      ? await db().menuItem.update({ where: { id: target.id }, data })
      : await db().merchant.update({ where: { id: target.id }, data })

    // Old file removed only after the row points at the new one (driver-photo ordering).
    if (previousRef && previousRef !== storageKey) await deleteFoodPhoto(previousRef)

    return json(res, 200, {
      ok: true,
      ...(isMenuItem ? { item: menuItemView(updated, { owner: true }) } : { merchant: publicMerchant(updated, { owner: true }) }),
    })
  }

  // ---- Menu Studio: admin photo review queue -----------------------------------------------------
  if (url.pathname === '/api/food/admin/photos') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN'])
    const [merchants, items] = await Promise.all([
      db().merchant.findMany({ where: { photoStatus: 'PENDING_REVIEW' }, orderBy: { photoSubmittedAt: 'asc' }, take: 100 }),
      db().menuItem.findMany({ where: { photoStatus: 'PENDING_REVIEW' }, orderBy: { photoSubmittedAt: 'asc' }, take: 100, include: { merchant: { select: { name: true, city: true } } } }),
    ])
    const queue = [
      ...merchants.map((m) => ({
        kind: 'merchant', id: m.id, merchantName: m.name, itemName: null, city: m.city,
        photoUrl: m.photoRef ? signFoodPhotoUrl(m.photoRef) : null, photoMeta: m.photoMeta || {}, submittedAt: m.photoSubmittedAt,
      })),
      ...items.map((i) => ({
        kind: 'menu-item', id: i.id, merchantName: i.merchant?.name || '', itemName: i.name, city: i.merchant?.city || '',
        photoUrl: i.photoRef ? signFoodPhotoUrl(i.photoRef) : null, photoMeta: i.photoMeta || {}, submittedAt: i.photoSubmittedAt,
      })),
    ].sort((a, b) => new Date(a.submittedAt || 0) - new Date(b.submittedAt || 0))
    return json(res, 200, { ok: true, queue, count: queue.length })
  }

  const photoReviewMatch = url.pathname.match(/^\/api\/food\/admin\/photos\/(merchant|menu-item)\/([^/]+)$/)
  if (photoReviewMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const decision = String(body.decision || '')
    if (!['APPROVE', 'REJECT'].includes(decision)) throw httpError(400, 'PHOTO_DECISION_INVALID', 'decision must be APPROVE or REJECT.')
    const note = trimmed(body.note, 300) || null
    if (decision === 'REJECT' && !note) throw httpError(400, 'PHOTO_REJECT_NOTE_REQUIRED', 'A rejection must tell the merchant why (note).')
    const data = {
      photoStatus: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      photoReviewNote: note,
      photoReviewedAt: new Date(),
    }
    const [kind, id] = [photoReviewMatch[1], photoReviewMatch[2]]
    const existing = kind === 'merchant'
      ? await db().merchant.findUnique({ where: { id }, select: { photoRef: true } })
      : await db().menuItem.findUnique({ where: { id }, select: { photoRef: true } })
    if (!existing) throw httpError(404, 'PHOTO_TARGET_NOT_FOUND', 'No such photo to review.')
    if (!existing.photoRef) throw httpError(409, 'PHOTO_NONE', 'This record has no photo to review.')
    const updated = kind === 'merchant'
      ? await db().merchant.update({ where: { id }, data })
      : await db().menuItem.update({ where: { id }, data })
    return json(res, 200, { ok: true, kind, id, photoStatus: updated.photoStatus })
  }

  // Admin merchant review list (the UI behind merchant approval — the PATCH below already existed).
  if (url.pathname === '/api/food/admin/merchants') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN'])
    const status = trimmed(url.searchParams.get('status'), 30)
    const merchants = await db().merchant.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { owner: { select: { email: true, displayName: true } }, _count: { select: { menuItems: true, orders: true } } },
    })
    return json(res, 200, {
      ok: true,
      merchants: merchants.map((m) => ({
        ...publicMerchant(m, { owner: true }),
        ownerEmail: m.owner?.email || null,
        ownerName: m.owner?.displayName || null,
        menuItemCount: m._count.menuItems,
        orderCount: m._count.orders,
        createdAt: m.createdAt,
      })),
    })
  }

  // ---- Admin approval --------------------------------------------------------------------------
  const statusMatch = url.pathname.match(/^\/api\/food\/merchants\/([^/]+)\/status$/)
  if (statusMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const status = String(body.status || '')
    if (!['APPROVED', 'SUSPENDED', 'PENDING_REVIEW'].includes(status)) {
      throw httpError(400, 'MERCHANT_STATUS_INVALID', 'status must be APPROVED, SUSPENDED or PENDING_REVIEW.')
    }
    const merchant = await db().merchant.update({ where: { id: statusMatch[1] }, data: { status } }).catch(() => null)
    if (!merchant) throw httpError(404, 'MERCHANT_NOT_FOUND', 'Merchant not found.')
    return json(res, 200, { ok: true, merchant: publicMerchant(merchant) })
  }

  // ---- Menu management + viewing ---------------------------------------------------------------
  const menuMatch = url.pathname.match(/^\/api\/food\/merchants\/([^/]+)\/menu$/)
  if (menuMatch) {
    const merchant = await db().merchant.findUnique({ where: { id: menuMatch[1] } })
    if (!merchant) throw httpError(404, 'MERCHANT_NOT_FOUND', 'Merchant not found.')
    if (req.method === 'GET') {
      requireAuth(context)
      const isOwner = merchant.ownerId === context.user.id
      const items = await db().menuItem.findMany({
        where: { merchantId: merchant.id, ...(isOwner ? {} : { available: true }) },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      })
      const now = new Date()
      return json(res, 200, {
        ok: true,
        merchant: publicMerchant(merchant, { owner: isOwner }),
        items: items.map((item) => menuItemView(item, { owner: isOwner, now })),
      })
    }
    if (req.method === 'POST') {
      requireAuth(context)
      if (merchant.ownerId !== context.user.id) throw httpError(403, 'MERCHANT_NOT_OWNER', 'Only the merchant owner may edit the menu.')
      const body = await readJson(req)
      const name = trimmed(body.name, 80)
      const priceMinor = Number(body.priceMinor)
      if (!name) throw httpError(400, 'MENU_ITEM_NAME_REQUIRED', 'Menu item name is required.')
      if (!Number.isInteger(priceMinor) || priceMinor <= 0 || priceMinor > 100_000_000) {
        throw httpError(400, 'MENU_ITEM_PRICE_INVALID', 'priceMinor must be a positive whole amount.')
      }
      const item = await db().menuItem.create({
        data: {
          merchantId: merchant.id,
          name,
          nameAr: trimmed(body.nameAr, 80) || null,
          description: trimmed(body.description, 300) || null,
          priceMinor,
          currency: defaultCurrency(),
          available: body.available === undefined ? true : Boolean(body.available),
          sortOrder: Number.isInteger(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
        },
      })
      return json(res, 201, { ok: true, item: menuItemView(item, { owner: true }) })
    }
    return methodNotAllowed(res, ['GET', 'POST'])
  }

  const menuItemMatch = url.pathname.match(/^\/api\/food\/menu\/([^/]+)$/)
  if (menuItemMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context)
    const item = await db().menuItem.findUnique({ where: { id: menuItemMatch[1] }, include: { merchant: true } })
    if (!item) throw httpError(404, 'MENU_ITEM_NOT_FOUND', 'Menu item not found.')
    if (item.merchant.ownerId !== context.user.id) throw httpError(403, 'MERCHANT_NOT_OWNER', 'Only the merchant owner may edit the menu.')
    const body = await readJson(req)
    const data = {}
    if (body.name !== undefined) {
      const name = trimmed(body.name, 80)
      if (!name) throw httpError(400, 'MENU_ITEM_NAME_REQUIRED', 'Menu item name is required.')
      data.name = name
    }
    if (body.priceMinor !== undefined) {
      const priceMinor = Number(body.priceMinor)
      if (!Number.isInteger(priceMinor) || priceMinor <= 0 || priceMinor > 100_000_000) {
        throw httpError(400, 'MENU_ITEM_PRICE_INVALID', 'priceMinor must be a positive whole amount.')
      }
      data.priceMinor = priceMinor
    }
    if (body.available !== undefined) data.available = Boolean(body.available)
    if (body.description !== undefined) data.description = trimmed(body.description, 300) || null
    if (body.nameAr !== undefined) data.nameAr = trimmed(body.nameAr, 80) || null
    if (body.sortOrder !== undefined && Number.isInteger(Number(body.sortOrder))) data.sortOrder = Number(body.sortOrder)

    // Promotions (Menu Studio). promoPriceMinor: null clears the promo entirely; a number must be
    // a positive whole amount STRICTLY below the base price (a "promo" above base is deception).
    // The window is optional on both ends but must be ordered when both are set.
    if (body.promoPriceMinor !== undefined) {
      if (body.promoPriceMinor === null) {
        data.promoPriceMinor = null
        data.promoLabel = null
        data.promoStartsAt = null
        data.promoEndsAt = null
      } else {
        const promo = Number(body.promoPriceMinor)
        const basePrice = data.priceMinor !== undefined ? data.priceMinor : item.priceMinor
        if (!Number.isInteger(promo) || promo <= 0 || promo >= basePrice) {
          throw httpError(400, 'MENU_PROMO_PRICE_INVALID', 'promoPriceMinor must be a positive whole amount below the base price.')
        }
        data.promoPriceMinor = promo
      }
    }
    if (body.promoLabel !== undefined && body.promoPriceMinor !== null) data.promoLabel = trimmed(body.promoLabel, 40) || null
    const parseWhen = (value, field) => {
      if (value === null) return null
      const d = new Date(String(value))
      if (Number.isNaN(d.getTime())) throw httpError(400, 'MENU_PROMO_WINDOW_INVALID', `${field} is not a valid date.`)
      return d
    }
    if (body.promoStartsAt !== undefined && body.promoPriceMinor !== null) data.promoStartsAt = parseWhen(body.promoStartsAt, 'promoStartsAt')
    if (body.promoEndsAt !== undefined && body.promoPriceMinor !== null) data.promoEndsAt = parseWhen(body.promoEndsAt, 'promoEndsAt')
    const finalStarts = data.promoStartsAt !== undefined ? data.promoStartsAt : item.promoStartsAt
    const finalEnds = data.promoEndsAt !== undefined ? data.promoEndsAt : item.promoEndsAt
    if (finalStarts && finalEnds && finalEnds <= finalStarts) {
      throw httpError(400, 'MENU_PROMO_WINDOW_INVALID', 'promoEndsAt must be after promoStartsAt.')
    }

    const updated = await db().menuItem.update({ where: { id: item.id }, data })
    return json(res, 200, { ok: true, item: menuItemView(updated, { owner: true }) })
  }

  // ---- Orders ----------------------------------------------------------------------------------
  if (url.pathname === '/api/food/orders') {
    if (req.method === 'POST') {
      requireAuth(context, ['GUEST'])
      const body = await readJson(req)
      const merchantId = String(body.merchantId || '')
      // Order experience (068): 'pickup' = the customer collects (no courier, NO delivery fee);
      // the address is then the pickup marker, not a requirement.
      const fulfillment = body.fulfillment === 'pickup' ? 'pickup' : 'delivery'
      const deliveryAddress = fulfillment === 'pickup' ? (trimmed(body.deliveryAddress, 200) || 'PICKUP') : trimmed(body.deliveryAddress, 200)
      if (!deliveryAddress) throw httpError(400, 'DELIVERY_ADDRESS_REQUIRED', 'A delivery address is required.')
      const lines = Array.isArray(body.items) ? body.items : []
      if (!lines.length || lines.length > MAX_ORDER_LINES) {
        throw httpError(400, 'ORDER_ITEMS_INVALID', `Order must have 1..${MAX_ORDER_LINES} items.`)
      }
      if (String(body.paymentMethod || 'cash') !== 'cash') {
        // Phase 1 is cash-on-delivery only; refusing loudly beats silently booking an unpaid order.
        throw httpError(400, 'PAYMENT_METHOD_UNSUPPORTED', 'Only cash on delivery is available right now.')
      }
      // "Schedule for next time": a future order, at most 7 days ahead.
      let scheduledFor = null
      if (body.scheduledFor) {
        scheduledFor = new Date(String(body.scheduledFor))
        if (Number.isNaN(scheduledFor.getTime())) throw httpError(400, 'ORDER_SCHEDULE_INVALID', 'scheduledFor is not a valid date.')
        const ahead = scheduledFor.getTime() - Date.now()
        if (ahead < 15 * 60 * 1000 || ahead > MAX_SCHEDULE_AHEAD_MS) {
          throw httpError(400, 'ORDER_SCHEDULE_INVALID', 'Scheduled orders must be 15 minutes to 7 days ahead.')
        }
      }
      // Optional map pin for the courier (validated; never required).
      let deliveryLat = null, deliveryLng = null
      if (body.deliveryLat !== undefined || body.deliveryLng !== undefined) {
        const lat = Number(body.deliveryLat)
        const lng = Number(body.deliveryLng)
        if (validCoord(lat, lng)) { deliveryLat = lat; deliveryLng = lng }
      }

      const merchant = await db().merchant.findUnique({ where: { id: merchantId } })
      if (!merchant || merchant.status !== 'APPROVED' || !merchant.active) {
        throw httpError(403, 'MERCHANT_NOT_AVAILABLE', 'This merchant is not accepting orders.')
      }
      // Busy mode: a paused store refuses NEW immediate orders loudly — the client offers the
      // customer the real choices (another restaurant, or schedule for later, which stays allowed).
      if (merchant.acceptingOrders === false && !scheduledFor) {
        throw httpError(409, 'MERCHANT_BUSY', 'This restaurant has paused new orders. Choose another restaurant or schedule for later.')
      }

      // Server-side pricing from the merchant's OWN menu rows: quantity validated per line, item
      // must belong to this merchant and be available. Client prices are never read.
      const wanted = lines.map((line) => ({ menuItemId: String(line.menuItemId || ''), quantity: Number(line.quantity) }))
      for (const line of wanted) {
        if (!line.menuItemId || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_LINE_QUANTITY) {
          throw httpError(400, 'ORDER_ITEMS_INVALID', `Each line needs a menuItemId and a quantity of 1..${MAX_LINE_QUANTITY}.`)
        }
      }
      const menuItems = await db().menuItem.findMany({
        where: { id: { in: wanted.map((w) => w.menuItemId) }, merchantId: merchant.id, available: true },
      })
      const byId = new Map(menuItems.map((item) => [item.id, item]))
      for (const line of wanted) {
        if (!byId.has(line.menuItemId)) throw httpError(400, 'ORDER_ITEM_UNAVAILABLE', 'An item in this order is not available from this merchant.')
      }

      // EFFECTIVE pricing (Menu Studio promotions): an active promo price replaces the base price
      // at this moment, server-side, and is snapshotted below exactly like a base price. Which
      // lines got a promo is recorded in metadata.promoApplied — explicit, auditable money
      // semantics (AGENTS.md §6), covered by food-menu-studio.e2e.mjs.
      const pricedAt = new Date()
      const subtotalMinor = wanted.reduce((sum, line) => sum + effectivePriceMinor(byId.get(line.menuItemId), pricedAt) * line.quantity, 0)
      const promoApplied = wanted
        .filter((line) => promoActive(byId.get(line.menuItemId), pricedAt))
        .map((line) => {
          const item = byId.get(line.menuItemId)
          return { menuItemId: item.id, basePriceMinor: item.priceMinor, promoPriceMinor: item.promoPriceMinor }
        })
      const serviceFeeMinor = Math.round((subtotalMinor * SERVICE_FEE_PERCENT) / 100)
      // Explicit money rule (068): a PICKUP order charges no delivery fee.
      const deliveryFeeMinor = fulfillment === 'pickup' ? 0 : DELIVERY_FEE_MINOR
      const totalMinor = subtotalMinor + serviceFeeMinor + deliveryFeeMinor
      const currency = menuItems[0].currency || defaultCurrency()

      const order = await db().foodOrder.create({
        data: {
          merchantId: merchant.id,
          customerId: context.user.id,
          subtotalMinor,
          deliveryFeeMinor,
          serviceFeeMinor,
          totalMinor,
          currency,
          paymentMethod: 'cash',
          deliveryAddress,
          fulfillment,
          scheduledFor,
          deliveryLat,
          deliveryLng,
          notes: trimmed(body.notes, 300) || null,
          metadata: { feeFactors: { deliveryFeeMinor, serviceFeePercent: SERVICE_FEE_PERCENT, serviceFeeMinor }, ...(promoApplied.length ? { promoApplied } : {}) },
          items: {
            create: wanted.map((line) => {
              const item = byId.get(line.menuItemId)
              return { menuItemId: item.id, nameSnapshot: item.name, priceMinorSnapshot: effectivePriceMinor(item, pricedAt), quantity: line.quantity }
            }),
          },
        },
        include: { items: true },
      })
      return json(res, 201, { ok: true, order })
    }
    if (req.method === 'GET') {
      requireAuth(context)
      // Phase 2: the courier's own worklist (claimed, not yet delivered) for the driver dashboard.
      if (url.searchParams.get('courier') === '1') {
        const orders = await db().foodOrder.findMany({
          where: { courierId: context.user.id, status: { in: ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP'] } },
          orderBy: { createdAt: 'asc' },
          take: 50,
          include: { items: true, merchant: { select: { name: true, city: true, address: true } } },
        })
        return json(res, 200, { ok: true, orders })
      }
      const merchantId = String(url.searchParams.get('merchantId') || '')
      if (merchantId) {
        const merchant = await db().merchant.findUnique({ where: { id: merchantId } })
        if (!merchant || merchant.ownerId !== context.user.id) throw httpError(403, 'MERCHANT_NOT_OWNER', 'Only the merchant owner may list its orders.')
        const orders = await db().foodOrder.findMany({ where: { merchantId }, orderBy: { createdAt: 'desc' }, take: 100, include: { items: true } })
        return json(res, 200, { ok: true, orders })
      }
      const orders = await db().foodOrder.findMany({ where: { customerId: context.user.id }, orderBy: { createdAt: 'desc' }, take: 100, include: { items: true } })
      return json(res, 200, { ok: true, orders })
    }
    return methodNotAllowed(res, ['GET', 'POST'])
  }

  // ---- Order experience: merchant delays a live order --------------------------------------------
  // Not a status change: the promise (etaAt) moves and delayedCount increments, which reopens the
  // customer's cancel right (see the status route). The client tells the customer and offers the
  // real choices: wait, cancel, or order elsewhere.
  const delayMatch = url.pathname.match(/^\/api\/food\/orders\/([^/]+)\/delay$/)
  if (delayMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context)
    const body = await readJson(req)
    const extraMinutes = Number(body.extraMinutes)
    if (!Number.isInteger(extraMinutes) || extraMinutes < 5 || extraMinutes > MAX_DELAY_MINUTES) {
      throw httpError(400, 'ORDER_DELAY_INVALID', `extraMinutes must be 5..${MAX_DELAY_MINUTES}.`)
    }
    const order = await db().foodOrder.findUnique({ where: { id: delayMatch[1] }, include: { merchant: true } })
    if (!order) throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found.')
    const isMerchantOwner = order.merchant.ownerId === context.user.id
    if (!isMerchantOwner && !context.roles.includes('ADMIN')) {
      throw httpError(403, 'ORDER_DELAY_FORBIDDEN', 'Only the restaurant may delay its order.')
    }
    if (!['ACCEPTED', 'PREPARING'].includes(order.status)) {
      throw httpError(409, 'ORDER_DELAY_INVALID_STATUS', 'Only an accepted or preparing order can be delayed.')
    }
    const base = order.etaAt && order.etaAt > new Date() ? order.etaAt.getTime() : Date.now()
    const updated = await db().foodOrder.update({
      where: { id: order.id },
      data: { etaAt: new Date(base + extraMinutes * 60 * 1000), delayedCount: { increment: 1 } },
      include: { items: true },
    })
    return json(res, 200, { ok: true, order: updated })
  }

  // ---- Order experience: per-order chat (customer ↔ restaurant ↔ courier) ------------------------
  const messagesMatch = url.pathname.match(/^\/api\/food\/orders\/([^/]+)\/messages$/)
  if (messagesMatch) {
    requireAuth(context)
    const order = await db().foodOrder.findUnique({ where: { id: messagesMatch[1] }, include: { merchant: true } })
    if (!order) throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found.')
    const isMerchantOwner = order.merchant.ownerId === context.user.id
    const isCustomer = order.customerId === context.user.id
    const isAssignedCourier = Boolean(order.courierId) && order.courierId === context.user.id
    const isAdmin = context.roles.includes('ADMIN')
    if (!isMerchantOwner && !isCustomer && !isAssignedCourier && !isAdmin) {
      throw httpError(403, 'ORDER_FORBIDDEN', 'You are not a party to this order.')
    }
    const senderRole = isCustomer ? 'customer' : isMerchantOwner ? 'merchant' : isAssignedCourier ? 'courier' : 'admin'
    if (req.method === 'GET') {
      const rows = await db().foodOrderMessage.findMany({
        where: { orderId: order.id },
        orderBy: { createdAt: 'asc' },
        take: 100,
      })
      return json(res, 200, { ok: true, messages: rows, viewerRole: senderRole })
    }
    if (req.method === 'POST') {
      const body = await readJson(req)
      const text = trimmed(body.body, 500)
      if (!text) throw httpError(400, 'MESSAGE_BODY_REQUIRED', 'A message body is required.')
      const message = await db().foodOrderMessage.create({
        data: { orderId: order.id, senderId: context.user.id, senderRole, body: text },
      })
      return json(res, 201, { ok: true, message })
    }
    return methodNotAllowed(res, ['GET', 'POST'])
  }

  // Claimable queue for the courier fleet — DELIVERY orders only (a pickup order has no courier leg).
  if (url.pathname === '/api/food/courier/pending') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['DRIVER'])
    const orders = await db().foodOrder.findMany({
      where: { courierId: null, fulfillment: 'delivery', status: { in: ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'] } },
      orderBy: { createdAt: 'asc' },
      take: 50,
      include: { merchant: { select: { name: true, city: true, address: true, lat: true, lng: true } } },
    })
    return json(res, 200, { ok: true, orders })
  }

  const claimMatch = url.pathname.match(/^\/api\/food\/orders\/([^/]+)\/claim$/)
  if (claimMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['DRIVER'])
    // Same vetting bar as claiming a ride: a courier with no approved ID or vehicle must not carry
    // a live order (mirrors the SR claim gates in sr-rides.mjs).
    if (context.user.idDocumentStatus !== 'APPROVED') {
      throw httpError(403, 'DRIVER_ID_REQUIRED', 'Verify your identity (an approved ID document) before accepting deliveries.')
    }
    const profile = await db().driverProfile.findUnique({ where: { userId: context.user.id } })
    if (!profile || profile.vehicleStatus !== 'APPROVED') {
      throw httpError(403, 'DRIVER_VEHICLE_NOT_APPROVED', 'Your vehicle is awaiting review. You can accept deliveries once it is approved.')
    }
    // Atomic claim: only an unclaimed order in a claimable status gets this courier — a concurrent
    // second claim updates 0 rows and is refused, never double-assigned.
    const result = await db().foodOrder.updateMany({
      where: { id: claimMatch[1], courierId: null, fulfillment: 'delivery', status: { in: ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'] } },
      data: { courierId: context.user.id },
    })
    if (result.count === 0) throw httpError(409, 'ORDER_NOT_CLAIMABLE', 'This order is no longer available to claim.')
    const order = await db().foodOrder.findUnique({ where: { id: claimMatch[1] }, include: { items: true } })
    return json(res, 200, { ok: true, order })
  }

  const orderStatusMatch = url.pathname.match(/^\/api\/food\/orders\/([^/]+)\/status$/)
  if (orderStatusMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context)
    const body = await readJson(req)
    const nextStatus = String(body.status || '')
    const order = await db().foodOrder.findUnique({ where: { id: orderStatusMatch[1] }, include: { merchant: true } })
    if (!order) throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found.')

    const isMerchantOwner = order.merchant.ownerId === context.user.id
    const isCustomer = order.customerId === context.user.id
    const isAssignedCourier = Boolean(order.courierId) && order.courierId === context.user.id

    // Order experience (068) special cases, both fail-closed extensions of the base table:
    //  - A delayed order reopens the customer's cancel right until the food is ready — the
    //    merchant moved the promise, so the customer gets their choice back (wait or cancel).
    //  - A PICKUP order has no courier leg: the merchant hands it over, so the merchant (not a
    //    courier) completes READY_FOR_PICKUP → DELIVERED.
    const delayedCancel =
      nextStatus === 'CANCELLED' && isCustomer && order.delayedCount > 0 && ['ACCEPTED', 'PREPARING'].includes(order.status)
    const pickupHandover =
      nextStatus === 'DELIVERED' && order.fulfillment === 'pickup' && order.status === 'READY_FOR_PICKUP' && (isMerchantOwner || context.roles.includes('ADMIN'))

    const allowed = TRANSITIONS[order.status] || {}
    const requiredRole = allowed[nextStatus]
    if (!requiredRole && !delayedCancel && !pickupHandover) {
      throw httpError(409, 'ORDER_TRANSITION_INVALID', `Cannot go from ${order.status} to ${nextStatus || '(missing status)'}.`)
    }

    const permitted =
      delayedCancel ||
      pickupHandover ||
      (requiredRole === 'merchant' && isMerchantOwner) ||
      (requiredRole === 'customer' && isCustomer) ||
      (requiredRole === 'courier' && isAssignedCourier) ||
      context.roles.includes('ADMIN')
    if (!permitted) throw httpError(403, 'ORDER_TRANSITION_FORBIDDEN', 'You are not allowed to make this change on this order.')
    // A courier must exist before the food leaves the restaurant (delivery orders only).
    if (nextStatus === 'PICKED_UP' && !order.courierId) throw httpError(409, 'ORDER_NO_COURIER', 'No courier has claimed this order yet.')

    // Accepting sets the promise the customer sees: prepMinutes from the request, else the
    // merchant's usual prep time, else 30 minutes.
    let etaPatch = {}
    if (nextStatus === 'ACCEPTED') {
      let prepMinutes = order.merchant.defaultPrepMinutes || 30
      if (body.prepMinutes !== undefined) {
        const minutes = Number(body.prepMinutes)
        if (!Number.isInteger(minutes) || minutes < MIN_PREP_MINUTES || minutes > MAX_PREP_MINUTES) {
          throw httpError(400, 'ORDER_PREP_INVALID', `prepMinutes must be ${MIN_PREP_MINUTES}..${MAX_PREP_MINUTES}.`)
        }
        prepMinutes = minutes
      }
      etaPatch = { etaAt: new Date(Date.now() + prepMinutes * 60 * 1000) }
    }

    const timestampField = TRANSITION_TIMESTAMP[nextStatus]
    // Guarded update: the WHERE repeats the current status so two racing transitions can't both
    // win — the loser updates 0 rows and gets the 409 (same updateMany pattern as the claim).
    const result = await db().foodOrder.updateMany({
      where: { id: order.id, status: order.status },
      data: { status: nextStatus, ...etaPatch, ...(timestampField ? { [timestampField]: new Date() } : {}) },
    })
    if (result.count === 0) throw httpError(409, 'ORDER_TRANSITION_CONFLICT', 'The order changed while this update was in flight. Reload and retry.')
    const updated = await db().foodOrder.findUnique({ where: { id: order.id }, include: { items: true } })
    return json(res, 200, { ok: true, order: updated })
  }

  const orderMatch = url.pathname.match(/^\/api\/food\/orders\/([^/]+)$/)
  if (orderMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)
    const order = await db().foodOrder.findUnique({ where: { id: orderMatch[1] }, include: { items: true, merchant: true } })
    if (!order) throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found.')
    const visible =
      order.customerId === context.user.id ||
      order.merchant.ownerId === context.user.id ||
      order.courierId === context.user.id ||
      context.roles.includes('ADMIN')
    if (!visible) throw httpError(403, 'ORDER_FORBIDDEN', 'You are not a party to this order.')

    // Order experience (068): the order map. Restaurant pin + delivery pin always (when known);
    // the courier's live position only while they actually carry this order (claimed, not yet
    // delivered) — never before, never after (same discipline as SR's rider view).
    const tracking = {
      merchant: order.merchant.lat != null && order.merchant.lng != null
        ? { lat: order.merchant.lat, lng: order.merchant.lng }
        : null,
      delivery: order.deliveryLat != null && order.deliveryLng != null
        ? { lat: order.deliveryLat, lng: order.deliveryLng }
        : null,
      courier: null,
      courierEtaMinutes: null,
    }
    if (order.courierId && ['READY_FOR_PICKUP', 'PICKED_UP'].includes(order.status)) {
      const loc = await getDriverLocation(order.courierId).catch(() => null)
      if (loc) {
        tracking.courier = { lat: loc.lat, lng: loc.lng, updatedAt: loc.updatedAt }
        const target = order.status === 'PICKED_UP' ? tracking.delivery : tracking.merchant
        if (target) tracking.courierEtaMinutes = etaMinutesBetween(loc, target)
      }
    }
    return json(res, 200, { ok: true, order: { ...order, merchant: publicMerchant(order.merchant) }, tracking })
  }

  return false
}
