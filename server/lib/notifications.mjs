// SYBNB — transactional booking/payout email notifications (money-flow decision 8, 2026-10-08).
//
// Fire-and-forget by contract: notify() never throws and never awaits delivery on the caller's
// path. A failed or skipped email is logged (event + kind + reason only -- never the address body or
// any secret) and the HTTP request that triggered it completes normally.
//
// Delivery goes through the existing provider seam (server/lib/email.mjs sendEmail): EMAIL_PROVIDER
// 'sandbox' (default) sends nothing; 'resend' sends for real only when RESEND_API_KEY + EMAIL_FROM
// are configured. When 'resend' is selected but not configured, notifications are skipped with a log
// line instead of attempting a send (OTP keeps its own fail-closed behaviour; this module does not
// change sendEmail).
//
// Language: the recipient's users.locale picks the template -- 'en*' -> English, 'fr*' -> French,
// anything else (including the default 'ar-SY' and unknown) -> Arabic with English below it.
// Admin notifications go to ADMIN_NOTIFY_EMAIL (optional; skipped when unset) in Arabic + English.
// PUBLIC_APP_URL (optional) adds a link to the booking/payout page.

import { emailProviderStatus, sendEmail } from './email.mjs'
import { db } from './prisma.mjs'
import { log } from './logger.mjs'

const TWO_DECIMAL_CURRENCIES = new Set(['USD', 'EUR', 'CAD', 'GBP'])

export function formatMoney(minor, currency) {
  const code = String(currency || '').toUpperCase()
  const amount = Number(minor) || 0
  if (TWO_DECIMAL_CURRENCIES.has(code)) return `${(amount / 100).toFixed(2)} ${code}`
  return `${Math.round(amount).toLocaleString('en-US')} ${code}`
}

function formatDate(value) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

function link(path) {
  const base = String(process.env.PUBLIC_APP_URL || '').replace(/\/$/, '')
  return base ? `${base}${path}` : ''
}

// Each template: (data) => { subject, body } per language. `data` is plain, pre-formatted values.
const TEMPLATES = {
  guest_request_received: {
    ar: (d) => ({
      subject: `SYBNB: تم استلام طلب الحجز — ${d.listingTitle}`,
      body: `استلمنا طلب حجزك (${d.checkIn} → ${d.checkOut}). المبلغ المستحق: ${d.total}.\nيرجى الدفع خلال ${d.expiryHours} ساعة (قبل ${d.expiresAt}) وإلا يُلغى الطلب تلقائياً.\nطريقة الدفع: حوّل المبلغ بإحدى طرق الدفع المعروضة في صفحة الحجز ثم ارفع إيصال التحويل ليراجعه فريق SYBNB.`,
    }),
    en: (d) => ({
      subject: `SYBNB: booking request received — ${d.listingTitle}`,
      body: `We received your booking request (${d.checkIn} → ${d.checkOut}). Amount due: ${d.total}.\nPlease pay within ${d.expiryHours} hours (before ${d.expiresAt}) or the request is cancelled automatically.\nHow to pay: transfer the amount using one of the payment methods shown on your booking page, then upload the transfer receipt for SYBNB to review.`,
    }),
    fr: (d) => ({
      subject: `SYBNB : demande de réservation reçue — ${d.listingTitle}`,
      body: `Nous avons reçu votre demande de réservation (${d.checkIn} → ${d.checkOut}). Montant dû : ${d.total}.\nVeuillez payer dans les ${d.expiryHours} heures (avant ${d.expiresAt}), sinon la demande est annulée automatiquement.\nPaiement : effectuez le virement via l'un des moyens indiqués sur la page de réservation, puis téléversez le reçu pour vérification par SYBNB.`,
    }),
  },
  guest_payment_confirmed: {
    ar: (d) => ({ subject: `SYBNB: تم تأكيد الدفع — ${d.listingTitle}`, body: `تم التحقق من دفعتك (${d.amount}). ${d.instantBook ? 'تم تأكيد حجزك.' : 'أرسلنا الطلب إلى المضيف لقبوله.'}` }),
    en: (d) => ({ subject: `SYBNB: payment confirmed — ${d.listingTitle}`, body: `Your payment (${d.amount}) was verified. ${d.instantBook ? 'Your booking is confirmed.' : 'We sent the request to the host to accept.'}` }),
    fr: (d) => ({ subject: `SYBNB : paiement confirmé — ${d.listingTitle}`, body: `Votre paiement (${d.amount}) a été vérifié. ${d.instantBook ? 'Votre réservation est confirmée.' : "La demande a été transmise à l'hôte pour acceptation."}` }),
  },
  guest_host_accepted: {
    ar: (d) => ({ subject: `SYBNB: قبل المضيف حجزك — ${d.listingTitle}`, body: `حجزك مؤكد (${d.checkIn} → ${d.checkOut}).` }),
    en: (d) => ({ subject: `SYBNB: the host accepted your booking — ${d.listingTitle}`, body: `Your booking is confirmed (${d.checkIn} → ${d.checkOut}).` }),
    fr: (d) => ({ subject: `SYBNB : l'hôte a accepté votre réservation — ${d.listingTitle}`, body: `Votre réservation est confirmée (${d.checkIn} → ${d.checkOut}).` }),
  },
  guest_host_declined: {
    ar: (d) => ({ subject: `SYBNB: رفض المضيف طلبك — ${d.listingTitle}`, body: `رفض المضيف طلب الحجز. ${d.refund ? `سيُعاد لك المبلغ كاملاً: ${d.refund}.` : ''}` }),
    en: (d) => ({ subject: `SYBNB: the host declined your request — ${d.listingTitle}`, body: `The host declined your booking request. ${d.refund ? `You will be refunded in full: ${d.refund}.` : ''}` }),
    fr: (d) => ({ subject: `SYBNB : l'hôte a refusé votre demande — ${d.listingTitle}`, body: `L'hôte a refusé votre demande de réservation. ${d.refund ? `Vous serez remboursé intégralement : ${d.refund}.` : ''}` }),
  },
  guest_booking_cancelled: {
    ar: (d) => ({ subject: `SYBNB: تم إلغاء الحجز — ${d.listingTitle}`, body: `تم إلغاء حجزك (${d.checkIn} → ${d.checkOut}). ${d.refund ? `المبلغ المسترد: ${d.refund}.` : 'لا يوجد مبلغ للاسترداد.'}` }),
    en: (d) => ({ subject: `SYBNB: booking cancelled — ${d.listingTitle}`, body: `Your booking (${d.checkIn} → ${d.checkOut}) was cancelled. ${d.refund ? `Refund amount: ${d.refund}.` : 'There is nothing to refund.'}` }),
    fr: (d) => ({ subject: `SYBNB : réservation annulée — ${d.listingTitle}`, body: `Votre réservation (${d.checkIn} → ${d.checkOut}) a été annulée. ${d.refund ? `Montant remboursé : ${d.refund}.` : "Aucun montant à rembourser."}` }),
  },
  guest_request_expired: {
    ar: (d) => ({ subject: `SYBNB: انتهت صلاحية طلب الحجز — ${d.listingTitle}`, body: `لم يصلنا الدفع خلال ${d.expiryHours} ساعة، لذلك أُلغي طلب الحجز (${d.checkIn} → ${d.checkOut}) وأصبحت التواريخ متاحة لغيرك.` }),
    en: (d) => ({ subject: `SYBNB: booking request expired — ${d.listingTitle}`, body: `We did not receive payment within ${d.expiryHours} hours, so your request (${d.checkIn} → ${d.checkOut}) was cancelled and the dates were released.` }),
    fr: (d) => ({ subject: `SYBNB : demande de réservation expirée — ${d.listingTitle}`, body: `Nous n'avons pas reçu le paiement dans les ${d.expiryHours} heures ; votre demande (${d.checkIn} → ${d.checkOut}) a été annulée et les dates libérées.` }),
  },
  guest_stay_completed: {
    ar: (d) => ({ subject: `SYBNB: نأمل أنك استمتعت بإقامتك — ${d.listingTitle}`, body: 'شاركنا رأيك واكتب تقييماً لإقامتك من صفحة الحجز.' }),
    en: (d) => ({ subject: `SYBNB: we hope you enjoyed your stay — ${d.listingTitle}`, body: 'Tell other guests how it went: leave a review from your booking page.' }),
    fr: (d) => ({ subject: `SYBNB : nous espérons que votre séjour vous a plu — ${d.listingTitle}`, body: 'Partagez votre avis : laissez un commentaire depuis la page de réservation.' }),
  },
  host_new_paid_request: {
    ar: (d) => ({ subject: `SYBNB: ${d.instantBook ? 'حجز جديد مؤكد' : 'طلب حجز مدفوع بانتظار قبولك'} — ${d.listingTitle}`, body: `${d.checkIn} → ${d.checkOut}. ${d.instantBook ? '' : 'افتح لوحة المضيف لقبول الطلب أو رفضه.'}` }),
    en: (d) => ({ subject: `SYBNB: ${d.instantBook ? 'new confirmed booking' : 'new paid request to accept'} — ${d.listingTitle}`, body: `${d.checkIn} → ${d.checkOut}. ${d.instantBook ? '' : 'Open your host dashboard to accept or decline it.'}` }),
    fr: (d) => ({ subject: `SYBNB : ${d.instantBook ? 'nouvelle réservation confirmée' : 'nouvelle demande payée à accepter'} — ${d.listingTitle}`, body: `${d.checkIn} → ${d.checkOut}. ${d.instantBook ? '' : "Ouvrez votre tableau de bord hôte pour l'accepter ou la refuser."}` }),
  },
  host_booking_cancelled: {
    ar: (d) => ({ subject: `SYBNB: ألغى الضيف الحجز — ${d.listingTitle}`, body: `أُلغي الحجز (${d.checkIn} → ${d.checkOut}) والتواريخ متاحة مجدداً.` }),
    en: (d) => ({ subject: `SYBNB: the guest cancelled — ${d.listingTitle}`, body: `The booking (${d.checkIn} → ${d.checkOut}) was cancelled and the dates are available again.` }),
    fr: (d) => ({ subject: `SYBNB : le voyageur a annulé — ${d.listingTitle}`, body: `La réservation (${d.checkIn} → ${d.checkOut}) a été annulée ; les dates sont de nouveau disponibles.` }),
  },
  host_payout_paid: {
    ar: (d) => ({ subject: 'SYBNB: تم دفع طلب السحب', body: `دفعنا لك ${d.amount}. المرجع: ${d.reference}.` }),
    en: (d) => ({ subject: 'SYBNB: your withdrawal was paid', body: `We paid you ${d.amount}. Reference: ${d.reference}.` }),
    fr: (d) => ({ subject: 'SYBNB : votre retrait a été payé', body: `Nous vous avons versé ${d.amount}. Référence : ${d.reference}.` }),
  },
  host_payout_rejected: {
    ar: (d) => ({ subject: 'SYBNB: تم رفض طلب السحب', body: `رُفض طلب سحب ${d.amount}. السبب: ${d.note}` }),
    en: (d) => ({ subject: 'SYBNB: your withdrawal request was rejected', body: `Your withdrawal request for ${d.amount} was rejected. Reason: ${d.note}` }),
    fr: (d) => ({ subject: 'SYBNB : votre demande de retrait a été refusée', body: `Votre demande de retrait de ${d.amount} a été refusée. Motif : ${d.note}` }),
  },
  // Host verification (2026-10-08). The plaintext code is in the email by design -- that is the
  // delivery channel the admin chose (sendEmail: true); it is never stored or logged.
  host_activation_code: {
    ar: (d) => ({ subject: 'SYBNB: رمز تفعيل حساب المضيف', body: `رمز تفعيل حسابك كمضيف على SYBNB هو: ${d.code}\nأدخله في لوحة المضيف (قسم التحقق). صالح حتى ${d.expiresAt}. لا تشاركه مع أحد.` }),
    en: (d) => ({ subject: 'SYBNB: your host activation code', body: `Your SYBNB host activation code is: ${d.code}\nEnter it in your host dashboard (verification). Valid until ${d.expiresAt}. Do not share it.` }),
    fr: (d) => ({ subject: "SYBNB : votre code d'activation hôte", body: `Votre code d'activation hôte SYBNB : ${d.code}\nSaisissez-le dans votre tableau de bord hôte (vérification). Valable jusqu'au ${d.expiresAt}. Ne le partagez pas.` }),
  },
  admin_payment_proof: {
    ar: (d) => ({ subject: 'SYBNB: إثبات دفع جديد للمراجعة', body: `إثبات دفع ${d.amount} للحجز ${d.bookingId}.` }),
    en: (d) => ({ subject: 'SYBNB admin: new payment proof to review', body: `Payment proof of ${d.amount} for booking ${d.bookingId}.` }),
    fr: (d) => ({ subject: 'SYBNB admin : nouvelle preuve de paiement', body: `Preuve de paiement de ${d.amount} pour la réservation ${d.bookingId}.` }),
  },
  admin_payment_closed_booking: {
    ar: (d) => ({ subject: 'SYBNB: دفعة بطاقة لحجز مغلق — يلزم استرداد', body: `وصلت دفعة ${d.amount} عبر ${d.provider} للحجز ${d.bookingId} بعد إلغائه أو انتهاء مهلته. سُجّلت وفُتح طلب استرداد (${d.refundId}). نفّذ الاسترداد من لوحة مزوّد الدفع.` }),
    en: (d) => ({ subject: 'SYBNB admin: card payment for a closed booking — refund owed', body: `A ${d.amount} payment via ${d.provider} arrived for booking ${d.bookingId} after it was cancelled/expired/already paid. It was recorded and refund ${d.refundId} opened. Issue the refund in the provider dashboard.` }),
    fr: (d) => ({ subject: 'SYBNB admin : paiement carte pour une réservation close — remboursement dû', body: `Un paiement de ${d.amount} via ${d.provider} est arrivé pour la réservation ${d.bookingId} après son annulation/expiration. Il a été enregistré et le remboursement ${d.refundId} ouvert. Effectuez le remboursement dans le tableau de bord du prestataire.` }),
  },
  admin_payout_request: {
    ar: (d) => ({ subject: 'SYBNB: طلب سحب جديد من مضيف', body: `طلب سحب ${d.amount} (${d.method}) من ${d.hostName}.` }),
    en: (d) => ({ subject: 'SYBNB admin: new host payout request', body: `Payout request of ${d.amount} (${d.method}) from ${d.hostName}.` }),
    fr: (d) => ({ subject: 'SYBNB admin : nouvelle demande de retrait', body: `Demande de retrait de ${d.amount} (${d.method}) de ${d.hostName}.` }),
  },
}

export const NOTIFICATION_KINDS = Object.freeze(Object.keys(TEMPLATES))

export function languagesForLocale(locale) {
  const l = String(locale || '').toLowerCase()
  if (l.startsWith('en')) return ['en']
  if (l.startsWith('fr')) return ['fr']
  return ['ar', 'en']
}

// Pure renderer (exported for tests). Returns { subject, text }.
export function renderNotification(kind, locale, data = {}) {
  const template = TEMPLATES[kind]
  if (!template) throw new Error(`Unknown notification kind '${kind}'.`)
  const langs = languagesForLocale(locale)
  const parts = langs.map((lang) => template[lang](data))
  const url = data.url ? `\n${data.url}` : ''
  return {
    subject: parts[0].subject,
    text: parts.map((p) => `${p.body}${url}`).join('\n\n———\n\n'),
  }
}

function deliveryAvailable() {
  const status = emailProviderStatus()
  return status.configured
}

async function deliver(kind, { to, locale, data, idempotencyKey }) {
  if (!to) {
    log.info('notification_skipped', { kind, reason: 'no_recipient' })
    return
  }
  if (!deliveryAvailable()) {
    log.warn('notification_skipped', { kind, reason: 'email_provider_not_configured' })
    return
  }
  const { subject, text } = renderNotification(kind, locale, data)
  await sendEmail({ to, subject, text, purpose: `notify:${kind}`, idempotencyKey })
}

// Fire-and-forget entry point. Returns immediately; errors are logged, never thrown.
export function notify(kind, payload) {
  Promise.resolve()
    .then(() => deliver(kind, payload))
    .catch((error) => {
      log.warn('notification_failed', { kind, code: error?.code, message: error instanceof Error ? error.message : String(error) })
    })
}

// Convenience: notify the configured admin inbox (ADMIN_NOTIFY_EMAIL, optional).
export function notifyAdmin(kind, data, idempotencyKey) {
  const to = String(process.env.ADMIN_NOTIFY_EMAIL || '').trim()
  if (!to) return
  notify(kind, { to, locale: 'ar', data, idempotencyKey })
}

// Loads what booking emails need (guest + host contact, listing title) and sends. Fire-and-forget:
// the DB read also happens off the caller's path.
export function notifyBooking(kind, bookingId, extra = {}) {
  Promise.resolve()
    .then(async () => {
      const booking = await db().booking.findUnique({
        where: { id: bookingId },
        include: {
          guest: { select: { email: true, locale: true } },
          listing: { select: { titleAr: true, titleEn: true, instantBookEnabled: true, owner: { select: { email: true, locale: true } } } },
        },
      })
      if (!booking) return
      const toHost = kind.startsWith('host_')
      const recipient = toHost ? booking.listing?.owner : booking.guest
      const locale = recipient?.locale
      const data = {
        listingTitle: (languagesForLocale(locale)[0] === 'ar' ? booking.listing?.titleAr : booking.listing?.titleEn) || booking.listing?.titleAr || '',
        checkIn: formatDate(booking.checkIn),
        checkOut: formatDate(booking.checkOut),
        instantBook: booking.listing?.instantBookEnabled === true,
        url: link(`/#/booking/${booking.id}`),
        ...extra,
      }
      await deliver(kind, { to: recipient?.email, locale, data, idempotencyKey: `${kind}:${booking.id}:${extra.idempotencySuffix || ''}` })
    })
    .catch((error) => {
      log.warn('notification_failed', { kind, code: error?.code, message: error instanceof Error ? error.message : String(error) })
    })
}

// Same, for a user (host payout emails).
export function notifyUser(kind, userId, data = {}, idempotencyKey) {
  Promise.resolve()
    .then(async () => {
      const user = await db().user.findUnique({ where: { id: userId }, select: { email: true, locale: true } })
      if (!user) return
      await deliver(kind, { to: user.email, locale: user.locale, data, idempotencyKey })
    })
    .catch((error) => {
      log.warn('notification_failed', { kind, code: error?.code, message: error instanceof Error ? error.message : String(error) })
    })
}
