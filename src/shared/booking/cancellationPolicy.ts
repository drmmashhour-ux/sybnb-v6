import { pick, type Lang } from '../../engines/language/languageEngine'
import { localeForLang } from '../country/presentation'

// Standard rate: free cancellation until this many days before check-in, then fees apply.
// Protected rate: free cancellation any time up to check-in (that is what the protection fee buys).
export const STANDARD_FREE_CANCELLATION_DAYS_BEFORE_CHECKIN = 3

// checkIn is a date-only string (e.g. "2026-07-20"). Parsing it with `new Date()` reads it as
// UTC midnight, and formatting in a timezone behind UTC then rolls the displayed day back by
// one — so every date here is computed and rendered in UTC to stay a plain calendar date.
export function cancellationCutoffDate(checkIn: string | undefined, protectedPlan: boolean): Date | null {
  if (!checkIn) return null
  const checkInDate = new Date(checkIn)
  if (Number.isNaN(checkInDate.getTime())) return null
  if (protectedPlan) return checkInDate

  const cutoff = new Date(checkInDate)
  cutoff.setUTCDate(cutoff.getUTCDate() - STANDARD_FREE_CANCELLATION_DAYS_BEFORE_CHECKIN)
  return cutoff
}

export function formatCancellationDate(date: Date, lang: Lang) {
  return date.toLocaleDateString(pick(lang, localeForLang('ar'), localeForLang('en'), 'fr-CA'), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export function freeCancellationLabel(checkIn: string | undefined, protectedPlan: boolean, lang: Lang) {
  const cutoff = cancellationCutoffDate(checkIn, protectedPlan)
  if (!cutoff) {
    return protectedPlan
      ? pick(lang, 'إلغاء مجاني حتى تاريخ الدخول', 'Free cancellation until check-in', 'Annulation gratuite jusqu’à l’arrivée')
      : pick(lang, 'إلغاء مجاني حتى 3 أيام قبل الدخول', 'Free cancellation until 3 days before check-in', 'Annulation gratuite jusqu’à 3 jours avant l’arrivée')
  }
  const dateText = formatCancellationDate(cutoff, lang)
  return pick(lang, `إلغاء مجاني حتى ${dateText}`, `Free cancellation until ${dateText}`, `Annulation gratuite jusqu’au ${dateText}`)
}

// Owner decision (Oct 8, 2026) -- plain-words cancellation rule shown before booking.
// Regular: full refund until 3 days before check-in, then 50%. Protected: full refund minus the
// protection fee until check-in day, then 50% (of the amount paid minus the protection fee).
export function cancellationRuleText(protectedPlan: boolean, lang: Lang) {
  return protectedPlan
    ? pick(
        lang,
        'استرداد كامل (عدا رسوم الحماية) حتى يوم الدخول، بعدها 50%',
        'Full refund (minus the protection fee) until check-in day, then 50%',
        'Remboursement complet (hors frais de protection) jusqu’au jour de l’arrivée, puis 50 %',
      )
    : pick(
        lang,
        'إلغاء مجاني حتى 3 أيام قبل الدخول، بعدها يُسترد 50%',
        'Free cancellation until 3 days before check-in, then 50% refund',
        'Annulation gratuite jusqu’à 3 jours avant l’arrivée, puis remboursement de 50 %',
      )
}
