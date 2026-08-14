import type { Lang } from '../../engines/language/languageEngine'
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
  return date.toLocaleDateString(localeForLang(lang), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export function freeCancellationLabel(checkIn: string | undefined, protectedPlan: boolean, lang: Lang) {
  const cutoff = cancellationCutoffDate(checkIn, protectedPlan)
  if (!cutoff) {
    return lang === 'ar'
      ? (protectedPlan ? 'إلغاء مجاني حتى تاريخ الدخول' : 'إلغاء مجاني حتى 3 أيام قبل الدخول')
      : (protectedPlan ? 'Free cancellation until check-in' : 'Free cancellation until 3 days before check-in')
  }
  const dateText = formatCancellationDate(cutoff, lang)
  return lang === 'ar' ? `إلغاء مجاني حتى ${dateText}` : `Free cancellation until ${dateText}`
}
