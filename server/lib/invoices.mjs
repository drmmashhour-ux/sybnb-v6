// SYBNB-generated invoices. One SYBNB Stripe account bills everything, but each platform division
// gets its own branded invoice document with a division-prefixed, gapless number: SR-000045 (rides),
// STR-000123 (stays), CARS-/MKT-/NC-/RENT-/BUY-. Invoices are SYBNB's own records (not Stripe's).
import { db } from './prisma.mjs'
import { withTx } from './tx-scope.mjs'
import { expectedTotalMinor } from './finance-ledger.mjs'

// Division code -> label shown on the invoice. The code IS the number prefix.
export const INVOICE_DIVISIONS = {
  SR: 'SR Ride',
  STR: 'Stay (short-term rental)',
  CARS: 'Cars',
  MKT: 'Marketplace',
  NC: 'New construction',
  RENT: 'Rental',
  BUY: 'Property purchase',
}

function pad(n) {
  return String(n).padStart(6, '0')
}

// Atomically mint the next number for a division (gapless, unique). Runs inside the caller's tx.
async function nextInvoiceNumber(tx, division) {
  const counter = await tx.invoiceCounter.upsert({
    where: { division },
    create: { division, lastSeq: 1 },
    update: { lastSeq: { increment: 1 } },
  })
  const seq = counter.lastSeq
  return { seq, number: `${division}-${pad(seq)}` }
}

function moneyText(amountMinor, currency) {
  const n = Math.round(amountMinor || 0) // whole currency units (money model is whole units, not cents)
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(n)
  } catch {
    return `${(currency || 'USD')} ${n.toFixed(2)}`
  }
}

// Lazily mint (or fetch) the invoice for a COMPLETED / cancelled-with-fee ride. Idempotent per ride:
// the first call creates and numbers it, later calls return the same stored record. Only the ride's
// own rider, or an admin/support operator, may fetch it.
export async function getOrCreateRideInvoice({ rideId, requester }) {
  const ride = await db().rideRequest.findUnique({
    where: { id: rideId },
    select: {
      id: true, riderId: true, driverId: true, status: true, fareMinor: true, cancellationFeeMinor: true,
      discountMinor: true, currency: true, metadata: true, requestedAt: true,
      paymentProofs: { select: { provider: true, status: true, amountMinor: true }, orderBy: { createdAt: 'desc' }, take: 10 },
    },
  })
  if (!ride) {
    const e = new Error('Ride not found.'); e.statusCode = 404; e.code = 'RIDE_NOT_FOUND'; e.expose = true; throw e
  }
  const roles = requester?.roles || []
  const isStaff = roles.includes('ADMIN') || roles.includes('SUPPORT')
  if (!isStaff && ride.riderId !== requester?.id) {
    const e = new Error('This invoice is not available for this account.'); e.statusCode = 403; e.code = 'INVOICE_FORBIDDEN'; e.expose = true; throw e
  }
  const isCancellationFee = ride.status === 'CANCELLED'
  const fareMinor = (isCancellationFee ? ride.cancellationFeeMinor : ride.fareMinor) || 0
  if (!['COMPLETED', 'CANCELLED'].includes(ride.status) || fareMinor <= 0) {
    const e = new Error('An invoice is available only after the ride is completed (or cancelled with a fee).')
    e.statusCode = 409; e.code = 'INVOICE_NOT_READY'; e.expose = true; throw e
  }

  const existing = await db().invoice.findFirst({ where: { rideId: ride.id } })
  if (existing) return existing

  // Tips paid on this ride (approved tip proofs) are billed as a separate line, 100% to the driver.
  const tipMinor = (ride.paymentProofs || [])
    .filter((p) => p.status === 'APPROVED' && String(p.provider || '').startsWith('tip'))
    .reduce((sum, p) => sum + Math.round(p.amountMinor || 0), 0)
  const farePaidProof = (ride.paymentProofs || []).find(
    (p) => p.status === 'APPROVED' && !String(p.provider || '').startsWith('tip'),
  )
  const method = ride.metadata?.prepaid
    ? 'wallet'
    : farePaidProof
      ? (farePaidProof.provider === 'cash' ? 'cash' : farePaidProof.provider === 'stripe' ? 'card' : 'wallet/transfer')
      : 'unpaid'

  const meta = ride.metadata && typeof ride.metadata === 'object' ? ride.metadata : {}
  const discountMinor = Math.round(ride.discountMinor || 0)
  const totalMinor = fareMinor + tipMinor
  const currency = ride.currency || 'USD'

  const data = {
    division: 'SR',
    kind: isCancellationFee ? 'cancellation_fee' : 'ride_fare',
    category: meta.category || 'SR Ride',
    pickup: meta.pickup || null,
    dropoff: meta.dropoff || null,
    distanceKm: meta.distanceKm ?? null,
    method,
    lineItems: [
      { label: isCancellationFee ? 'Ride cancellation fee' : `Ride fare — ${meta.category || 'SR'}`, amountMinor: fareMinor },
      ...(discountMinor > 0 ? [{ label: 'Discount', amountMinor: -discountMinor }] : []),
      ...(tipMinor > 0 ? [{ label: 'Tip (100% to driver)', amountMinor: tipMinor }] : []),
    ],
    subtotalMinor: fareMinor - discountMinor,
    tipMinor,
    totalMinor,
    rideRef: ride.id.slice(0, 8).toUpperCase(),
    issuedFor: ride.riderId,
  }

  // Mint number + create the record atomically so the counter and the invoice move together.
  const created = await withTx(async (tx) => {
    const dup = await tx.invoice.findFirst({ where: { rideId: ride.id } })
    if (dup) return dup
    const { seq, number } = await nextInvoiceNumber(tx, 'SR')
    return tx.invoice.create({
      data: {
        number, division: 'SR', seq, rideId: ride.id, userId: ride.riderId,
        amountMinor: totalMinor, currency, data,
      },
    })
  })
  return created
}

// Lazily mint (or fetch) the STR invoice for a paid/confirmed booking. Idempotent per booking.
// The booking's own guest, or an admin/support operator, may fetch it. Total is the authoritative
// expectedTotalMinor (rent + service/cleaning/tax + protection) — the same figure every rail charges.
export async function getOrCreateBookingInvoice({ bookingId, requester }) {
  const booking = await db().booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true, guestId: true, status: true, amountMinor: true, currency: true, metadata: true,
      checkIn: true, checkOut: true,
      listing: { select: { titleAr: true, titleEn: true, division: true, metadata: true } },
      payments: { select: { provider: true, status: true, amountMinor: true }, orderBy: { createdAt: 'desc' }, take: 10 },
    },
  })
  if (!booking) { const e = new Error('Booking not found.'); e.statusCode = 404; e.code = 'BOOKING_NOT_FOUND'; e.expose = true; throw e }
  const roles = requester?.roles || []
  const isStaff = roles.includes('ADMIN') || roles.includes('SUPPORT')
  if (!isStaff && booking.guestId !== requester?.id) {
    const e = new Error('This invoice is not available for this account.'); e.statusCode = 403; e.code = 'INVOICE_FORBIDDEN'; e.expose = true; throw e
  }
  const approvedPayment = (booking.payments || []).find((p) => p.status === 'APPROVED')
  const ready = Boolean(approvedPayment) || ['CONFIRMED', 'COMPLETED'].includes(booking.status)
  if (!ready) {
    const e = new Error('An invoice is available only after the booking is paid or confirmed.')
    e.statusCode = 409; e.code = 'INVOICE_NOT_READY'; e.expose = true; throw e
  }

  const existing = await db().invoice.findFirst({ where: { bookingId: booking.id } })
  if (existing) return existing

  const totalMinor = expectedTotalMinor(booking)
  const rentMinor = Math.round(booking.amountMinor || 0)
  const extrasMinor = Math.max(0, totalMinor - rentMinor)
  const currency = booking.currency || 'SYP'
  const method = approvedPayment
    ? (approvedPayment.provider === 'cash' ? 'cash' : approvedPayment.provider === 'stripe' ? 'card' : 'wallet/transfer')
    : 'unpaid'
  const fmtDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null)
  const stayLabel = `Stay${booking.checkIn && booking.checkOut ? ` (${fmtDate(booking.checkIn)} \u2192 ${fmtDate(booking.checkOut)})` : ''}`
  const title = booking.listing?.titleEn || booking.listing?.titleAr || 'Stay'

  const data = {
    division: 'STR',
    kind: 'stay_booking',
    listingTitle: title,
    billedToLabel: 'Guest',
    referenceLabel: 'Booking',
    referenceValue: booking.id.slice(0, 8).toUpperCase(),
    method,
    checkIn: fmtDate(booking.checkIn),
    checkOut: fmtDate(booking.checkOut),
    lineItems: [
      { label: stayLabel, amountMinor: rentMinor },
      ...(extrasMinor > 0 ? [{ label: 'Service, cleaning, tax & protection', amountMinor: extrasMinor }] : []),
    ],
    subtotalMinor: rentMinor,
    totalMinor,
    issuedFor: booking.guestId,
  }

  const created = await withTx(async (tx) => {
    const dup = await tx.invoice.findFirst({ where: { bookingId: booking.id } })
    if (dup) return dup
    const { seq, number } = await nextInvoiceNumber(tx, 'STR')
    return tx.invoice.create({
      data: { number, division: 'STR', seq, bookingId: booking.id, userId: booking.guestId, amountMinor: totalMinor, currency, data },
    })
  })
  return created
}

// Branded, print-ready SYBNB invoice HTML (navy + cyan, contact info@sybnb.app). Self-contained so it
// can be opened in a tab and saved as PDF by the browser. `logoUrl` is optional (absolute).
export function renderInvoiceHtml(invoice, { logoUrl } = {}) {
  const d = invoice.data && typeof invoice.data === 'object' ? invoice.data : {}
  const cur = invoice.currency || 'USD'
  const rows = (d.lineItems || [])
    .map(
      (li) => `<tr><td>${escapeHtml(li.label)}</td><td class="num">${moneyText(li.amountMinor, cur)}</td></tr>`,
    )
    .join('')
  const issued = new Date(invoice.issuedAt || Date.now()).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' })
  const divisionLabel = INVOICE_DIVISIONS[invoice.division] || invoice.division
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>SYBNB Invoice ${escapeHtml(invoice.number)}</title>
<style>
  :root{--navy:#0b1220;--ink:#0b1220;--cyan:#19d7ff;--line:#e4e9f2;--dim:#6b7688;}
  *{box-sizing:border-box;} body{margin:0;background:#f4f6fb;color:var(--ink);font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;padding:24px;}
  .sheet{max-width:720px;margin:0 auto;background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;}
  .top{background:var(--navy);color:#fff;padding:22px 28px;display:flex;justify-content:space-between;align-items:center;}
  .brand{display:flex;align-items:center;gap:12px;}
  .brand img{height:38px;width:auto;border-radius:8px;}
  .brand .name{font-size:22px;font-weight:900;letter-spacing:.5px;}
  .brand .tag{color:var(--cyan);font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;}
  .inv{ text-align:right;} .inv .lbl{color:var(--cyan);font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;}
  .inv .no{font-size:20px;font-weight:900;} .inv .dt{color:#aeb9cc;font-size:12px;}
  .body{padding:24px 28px;}
  .meta{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;margin-bottom:18px;}
  .meta .b{font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--dim);margin-bottom:4px;}
  table{width:100%;border-collapse:collapse;margin-top:8px;}
  th{ text-align:left;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--dim);border-bottom:2px solid var(--line);padding:8px 0;}
  td{padding:10px 0;border-bottom:1px solid var(--line);} td.num,th.num{text-align:right;}
  .total{display:flex;justify-content:flex-end;margin-top:14px;}
  .total .box{min-width:240px;} .total .row{display:flex;justify-content:space-between;padding:4px 0;color:var(--dim);}
  .total .grand{display:flex;justify-content:space-between;padding:10px 0;border-top:2px solid var(--navy);margin-top:6px;font-size:18px;font-weight:900;color:var(--ink);}
  .pill{display:inline-block;border:1px solid var(--cyan);color:#0b6b85;background:rgba(25,215,255,.12);border-radius:999px;padding:2px 10px;font-size:12px;font-weight:800;text-transform:capitalize;}
  .foot{padding:18px 28px;border-top:1px solid var(--line);color:var(--dim);font-size:12px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;}
  @media print{body{background:#fff;padding:0;} .sheet{border:0;border-radius:0;}}
</style></head><body>
<div class="sheet">
  <div class="top">
    <div class="brand">
      ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="SYBNB"/>` : ''}
      <div><div class="name">SYBNB</div><div class="tag">${escapeHtml(divisionLabel)}</div></div>
    </div>
    <div class="inv"><div class="lbl">Invoice</div><div class="no">${escapeHtml(invoice.number)}</div><div class="dt">${escapeHtml(issued)}</div></div>
  </div>
  <div class="body">
    <div class="meta">
      <div><div class="b">Billed to</div><div>${escapeHtml(d.billedToLabel || 'Rider')} ${escapeHtml((d.issuedFor || invoice.userId || '').slice(0, 8).toUpperCase())}</div></div>
      <div><div class="b">Reference</div><div>${escapeHtml(d.referenceLabel || 'Ride')} ${escapeHtml(d.referenceValue || d.rideRef || '')}</div></div>
      <div><div class="b">Payment</div><div><span class="pill">${escapeHtml(d.method || '-')}</span></div></div>
    </div>
    ${d.pickup || d.dropoff ? `<div class="meta"><div><div class="b">From</div><div>${escapeHtml(d.pickup || '-')}</div></div><div><div class="b">To</div><div>${escapeHtml(d.dropoff || '-')}</div></div>${d.distanceKm != null ? `<div><div class="b">Distance</div><div>${escapeHtml(String(d.distanceKm))} km</div></div>` : ''}</div>` : ''}
    <table><thead><tr><th>Description</th><th class="num">Amount</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="total"><div class="box">
      ${d.tipMinor > 0 ? `<div class="row"><span>Subtotal</span><span>${moneyText(d.subtotalMinor, cur)}</span></div><div class="row"><span>Tip</span><span>${moneyText(d.tipMinor, cur)}</span></div>` : ''}
      <div class="grand"><span>Total</span><span>${moneyText(d.totalMinor ?? invoice.amountMinor, cur)}</span></div>
    </div></div>
  </div>
  <div class="foot"><span>SYBNB · ${escapeHtml(divisionLabel)}</span><span>info@sybnb.app</span></div>
</div>
</body></html>`
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
