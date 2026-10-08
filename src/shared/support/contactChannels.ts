import type { Lang } from '../../engines/language/languageEngine'
// Real SYBNB support contact channels, used as an alternative ID-submission path for guests who
// don't want to upload a document through the website. wa.me needs digits only (no +, no leading
// zeros), so the number is stored in local dial format and converted where needed.
export const SUPPORT_WHATSAPP_LOCAL = '00963998191422'
export const SUPPORT_WHATSAPP_INTL = SUPPORT_WHATSAPP_LOCAL.replace(/^00/, '')
export const SUPPORT_EMAIL = 'info@sybnb.app'

export function whatsappIdSubmissionLink(email: string, lang: Lang) {
  const text = lang === 'ar'
    ? `مرحباً، أرسل صورة إثبات الهوية لحسابي في SYBNB. البريد الإلكتروني لحسابي: ${email}`
    : `Hello, I'm sending my ID document for my SYBNB account. My account email: ${email}`
  return `https://wa.me/${SUPPORT_WHATSAPP_INTL}?text=${encodeURIComponent(text)}`
}

export function emailIdSubmissionLink(email: string, lang: Lang) {
  const subject = lang === 'ar' ? 'إثبات الهوية - SYBNB' : 'ID document - SYBNB'
  const body = lang === 'ar'
    ? `البريد الإلكتروني لحسابي: ${email}\n(أرفق صورة إثبات الهوية بهذه الرسالة)`
    : `My account email: ${email}\n(Attach your ID document photo to this message)`
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
