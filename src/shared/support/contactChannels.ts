import type { Lang } from '../../engines/language/languageEngine'
import { BRAND_NAME } from '../brand/brandName'
// Real SYBNB support contact channels, used as an alternative ID-submission path for guests who
// don't want to upload a document through the website. wa.me needs digits only (no +, no leading
// zeros), so the number is stored in local dial format and converted where needed.
// Owner decision 2026-10-23: support and feedback WhatsApp moved to +1 514 462 4457 (was +963 998 191 422).
export const SUPPORT_WHATSAPP_LOCAL = '0015144624457'
export const SUPPORT_WHATSAPP_INTL = SUPPORT_WHATSAPP_LOCAL.replace(/^00/, '')
// Rezekme builds (stay./rides.rezekme.com and the Rezekme store apps) use the rezekme.com mailbox,
// which ImprovMX forwards to the team inbox; sybnb.app keeps info@sybnb.app.
export const SUPPORT_EMAIL = BRAND_NAME === 'Rezekme' ? 'support@rezekme.com' : 'info@sybnb.app'

export function whatsappIdSubmissionLink(email: string, lang: Lang) {
  const text = lang === 'ar'
    ? `مرحباً، أرسل صورة إثبات الهوية لحسابي في ${BRAND_NAME}. البريد الإلكتروني لحسابي: ${email}`
    : `Hello, I'm sending my ID document for my ${BRAND_NAME} account. My account email: ${email}`
  return `https://wa.me/${SUPPORT_WHATSAPP_INTL}?text=${encodeURIComponent(text)}`
}

export function emailIdSubmissionLink(email: string, lang: Lang) {
  const subject = lang === 'ar' ? `إثبات الهوية - ${BRAND_NAME}` : `ID document - ${BRAND_NAME}`
  const body = lang === 'ar'
    ? `البريد الإلكتروني لحسابي: ${email}\n(أرفق صورة إثبات الهوية بهذه الرسالة)`
    : `My account email: ${email}\n(Attach your ID document photo to this message)`
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
