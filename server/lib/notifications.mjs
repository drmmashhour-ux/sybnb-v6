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
import { sendPushNotification } from './push-notifications.mjs'
import { log } from './logger.mjs'

const TWO_DECIMAL_CURRENCIES = new Set(['USD', 'EUR', 'CAD', 'GBP'])

export function formatMoney(minor, currency) {
  const code = String(currency || '').toUpperCase()
  const amount = Number(minor) || 0
  // Money model is whole currency units (not cents), so render verbatim with thousands separators.
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

// Absolute app link for templates ('' when PUBLIC_APP_URL is unset -- the email then has no link).
export const appLink = link

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
  // Owner decision 2026-10-09: the code comes at the END of onboarding -- emailed automatically when
  // the SYBNB team approves an unverified host's stay. Same no-store/no-log rule for the code.
  host_listing_approved_code: {
    ar: (d) => ({
      subject: 'تمت الموافقة على إعلانك — رمز التفعيل',
      body: `تمت الموافقة على إعلانك${d.listingTitle ? ` «${d.listingTitle}»` : ''} من فريق SYBNB.\nآخر خطوة: رمز تفعيل حسابك كمضيف هو: ${d.code}\nأدخله في لوحة المضيف ليظهر إعلانك للضيوف. صالح حتى ${d.expiresAt}. لا تشاركه مع أحد.`,
    }),
    en: (d) => ({
      subject: 'Your listing is approved — activation code',
      body: `The SYBNB team approved your listing${d.listingTitle ? ` "${d.listingTitle}"` : ''}.\nLast step: your host activation code is: ${d.code}\nEnter it in your host dashboard to make your listing visible to guests. Valid until ${d.expiresAt}. Do not share it.`,
    }),
    fr: (d) => ({
      subject: "Votre annonce est approuvée — code d'activation",
      body: `L'équipe SYBNB a approuvé votre annonce${d.listingTitle ? ` « ${d.listingTitle} »` : ''}.\nDernière étape : votre code d'activation hôte est : ${d.code}\nSaisissez-le dans votre tableau de bord hôte pour rendre votre annonce visible. Valable jusqu'au ${d.expiresAt}. Ne le partagez pas.`,
    }),
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
  // Safety Phase 1 (2026-10-10): an SOS/panic was pulled on an active ride. Routed to the admin
  // inbox so the incident console is not the only alerting channel. The incident id is the console
  // lookup key; no rider/driver PII beyond role is included in the email body.
  admin_sos_triggered: {
    ar: (d) => ({ subject: 'SYBNB: تنبيه طوارئ SOS على رحلة نشطة', body: `تم تفعيل زر الطوارئ من طرف ${d.reporterRole === 'DRIVER' ? 'السائق' : 'الراكب'} على الرحلة ${d.rideId} (الحالة: ${d.status}). رقم البلاغ: ${d.incidentId}. افتح لوحة البلاغات لمتابعته فوراً.` }),
    en: (d) => ({ subject: 'SYBNB admin: SOS triggered on an active ride', body: `SOS was pulled by the ${String(d.reporterRole || '').toLowerCase()} on ride ${d.rideId} (status: ${d.status}). Incident ${d.incidentId}. Open the incidents console to act immediately.` }),
    fr: (d) => ({ subject: 'SYBNB admin : SOS déclenché sur une course active', body: `Un SOS a été déclenché par le ${String(d.reporterRole || '').toLowerCase() === 'driver' ? 'chauffeur' : 'passager'} sur la course ${d.rideId} (statut : ${d.status}). Incident ${d.incidentId}. Ouvrez la console des incidents immédiatement.` }),
  },
  // Safety Phase 2 (2026-10-10): an automated anomaly (OVERTIME / DRIVER_SIGNAL_LOST) detected on an
  // active ride by detectRideAnomalies() (server/lib/ride-anomaly.mjs). Idempotency-keyed per
  // ride+anomaly so repeated sweeps of the same unresolved anomaly never re-send. The incident id
  // is the console lookup key; no rider/driver PII beyond the ride id is included.
  admin_ride_anomaly: {
    ar: (d) => ({ subject: 'SYBNB: شذوذ مكتشف على رحلة نشطة', body: `اكتشف النظام حالة «${d.anomaly}» على الرحلة ${d.rideId}. رقم البلاغ: ${d.incidentId}. افتح لوحة البلاغات لمراجعتها.` }),
    en: (d) => ({ subject: 'SYBNB admin: anomaly detected on an active ride', body: `The system detected ${d.anomaly} on ride ${d.rideId}. Incident ${d.incidentId}. Open the incidents console to review.` }),
    fr: (d) => ({ subject: 'SYBNB admin : anomalie détectée sur une course active', body: `Le système a détecté ${d.anomaly} sur la course ${d.rideId}. Incident ${d.incidentId}. Ouvrez la console des incidents pour vérifier.` }),
  },
  // Centris / SR-feature notifications (2026-10-11): sent to USERS via push + email, localized.
  // Subjects keep the "SYBNB:" prefix for email; renderPush() strips it for a clean push title.
  visit_requested: {
    ar: (d) => ({ subject: `SYBNB: طلب زيارة جديد`, body: `طلب أحدهم زيارة ${d.listingTitle}. افتح «الزيارات» للرد.` }),
    en: (d) => ({ subject: `SYBNB: new visit request`, body: `Someone asked to view ${d.listingTitle}. Open Visits to respond.` }),
    fr: (d) => ({ subject: `SYBNB : nouvelle demande de visite`, body: `Quelqu'un souhaite visiter ${d.listingTitle}. Ouvrez « Visites » pour répondre.` }),
  },
  visit_confirmed: {
    ar: (d) => ({ subject: `SYBNB: تم تأكيد الزيارة`, body: `تم تأكيد زيارتك لـ ${d.listingTitle}.` }),
    en: (d) => ({ subject: `SYBNB: visit confirmed`, body: `Your visit to ${d.listingTitle} is confirmed.` }),
    fr: (d) => ({ subject: `SYBNB : visite confirmée`, body: `Votre visite à ${d.listingTitle} est confirmée.` }),
  },
  visit_declined: {
    ar: (d) => ({ subject: `SYBNB: تم رفض طلب الزيارة`, body: `تم رفض طلب زيارتك لـ ${d.listingTitle}.` }),
    en: (d) => ({ subject: `SYBNB: visit request declined`, body: `Your visit request for ${d.listingTitle} was declined.` }),
    fr: (d) => ({ subject: `SYBNB : demande de visite refusée`, body: `Votre demande de visite pour ${d.listingTitle} a été refusée.` }),
  },
  visit_cancelled: {
    ar: () => ({ subject: `SYBNB: تم إلغاء زيارة`, body: `تم إلغاء أحد طلبات الزيارة.` }),
    en: () => ({ subject: `SYBNB: visit cancelled`, body: `A visit request was cancelled.` }),
    fr: () => ({ subject: `SYBNB : visite annulée`, body: `Une demande de visite a été annulée.` }),
  },
  auction_won: {
    ar: (d) => ({ subject: `SYBNB: فزت بالمزاد`, body: `لقد فزت بمزاد ${d.carName}.` }),
    en: (d) => ({ subject: `SYBNB: you won the auction`, body: `You won the auction for ${d.carName}.` }),
    fr: (d) => ({ subject: `SYBNB : vous avez gagné l'enchère`, body: `Vous avez gagné l'enchère pour ${d.carName}.` }),
  },
  auction_sold: {
    ar: (d) => ({ subject: `SYBNB: تم بيع مزادك`, body: `أُغلق مزاد ${d.carName} بمزايدة فائزة.` }),
    en: (d) => ({ subject: `SYBNB: your auction sold`, body: `Your auction for ${d.carName} closed with a winning bid.` }),
    fr: (d) => ({ subject: `SYBNB : votre enchère est vendue`, body: `Votre enchère pour ${d.carName} s'est terminée avec une offre gagnante.` }),
  },
  auction_outbid: {
    ar: () => ({ subject: `SYBNB: تمت المزايدة فوقك`, body: `قدّم أحدهم مزايدة أعلى. زايد مجدداً للبقاء في الصدارة.` }),
    en: () => ({ subject: `SYBNB: you were outbid`, body: `Someone placed a higher bid. Bid again to stay in front.` }),
    fr: () => ({ subject: `SYBNB : vous avez été surenchéri`, body: `Quelqu'un a surenchéri. Enchérissez à nouveau pour rester en tête.` }),
  },
  saved_search_match: {
    ar: (d) => ({ subject: `SYBNB: إعلانات جديدة تطابق بحثك`, body: d.searchLabel ? `${d.count} إعلان جديد يطابق بحثك المحفوظ «${d.searchLabel}».` : `${d.count} إعلان جديد يطابق بحثك المحفوظ.` }),
    en: (d) => ({ subject: `SYBNB: new listings match your search`, body: d.searchLabel ? `${d.count} new listing(s) match your saved search “${d.searchLabel}”.` : `${d.count} new listing(s) match your saved search.` }),
    fr: (d) => ({ subject: `SYBNB : de nouvelles annonces correspondent`, body: d.searchLabel ? `${d.count} nouvelle(s) annonce(s) correspondent à « ${d.searchLabel} ».` : `${d.count} nouvelle(s) annonce(s) correspondent à votre recherche enregistrée.` }),
  },
  new_message: {
    ar: (d) => ({ subject: `SYBNB: رسالة جديدة`, body: `${d.senderName}: ${d.preview}` }),
    en: (d) => ({ subject: `SYBNB: new message`, body: `${d.senderName}: ${d.preview}` }),
    fr: (d) => ({ subject: `SYBNB : nouveau message`, body: `${d.senderName}: ${d.preview}` }),
  },
  ride_driver_assigned: {
    ar: (d) => ({ subject: `SYBNB: تم تعيين سائق`, body: `${d.driverName} في الطريق إلى نقطة انطلاقك.` }),
    en: (d) => ({ subject: `SYBNB: driver assigned`, body: `${d.driverName} is on the way to your pickup.` }),
    fr: (d) => ({ subject: `SYBNB : chauffeur assigné`, body: `${d.driverName} est en route vers votre point de départ.` }),
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


// Push rendering (2026-10-11): the recipient's primary language only, with the "SYBNB:" email prefix
// stripped for a clean notification title. Returns { title, body, url }.
export function renderPush(kind, locale, data = {}) {
  const template = TEMPLATES[kind]
  if (!template) throw new Error(`Unknown notification kind '${kind}'.`)
  const lang = languagesForLocale(locale)[0]
  const part = (template[lang] || template.en)(data)
  const title = String(part.subject || '').replace(/^SYBNB\s*(?:admin)?\s*:?\s*/i, '').trim() || 'SYBNB'
  return { title, body: part.body, url: data.url || null }
}

// Multi-channel user notification (2026-10-11): localized web push AND a localized email fallback, so
// a user who never granted push permission (or is on a platform where push is unavailable) is still
// reached. Fire-and-forget by contract — never throws, never blocks the caller. Push failure never
// prevents the email, and vice versa.
export function notifyUserMulti(kind, userId, data = {}, idempotencyKey) {
  Promise.resolve()
    .then(async () => {
      const user = await db().user.findUnique({ where: { id: userId }, select: { email: true, locale: true } })
      if (!user) return
      try {
        const push = renderPush(kind, user.locale, data)
        await sendPushNotification(userId, { title: push.title, body: push.body, url: data.url })
      } catch (err) {
        log.warn('push_failed', { kind, message: err instanceof Error ? err.message : String(err) })
      }
      await deliver(kind, { to: user.email, locale: user.locale, data, idempotencyKey })
    })
    .catch((error) => {
      log.warn('notification_failed', { kind, code: error?.code, message: error instanceof Error ? error.message : String(error) })
    })
}
