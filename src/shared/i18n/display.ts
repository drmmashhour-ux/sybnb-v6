import type { Lang } from '../../engines/language/languageEngine'
import type { PlatformListing } from '../api/platformApi'
import { localeForLang } from '../country/presentation'

export const statusLabels: Record<Lang, Record<string, string>> = {
  ar: {
    ACTIVE: 'نشط',
    APPROVED: 'مقبول',
    CANCELLED: 'ملغى',
    CLAIM_PENDING: 'بانتظار المراجعة',
    CLAIMED: 'مستلمة',
    COMPLETED: 'مكتملة',
    CONFIRMED: 'مؤكد',
    CREDIT: 'إضافة رصيد',
    CREATED: 'تم الإنشاء',
    DEBIT: 'خصم رصيد',
    DRAFT: 'مسودة',
    DRIVER_ARRIVING: 'السائق في الطريق',
    DRIVER_ASSIGNED: 'تم تعيين السائق',
    DISPUTED: 'قيد النزاع',
    EXPIRED: 'منتهي الصلاحية',
    IN_PROGRESS: 'قيد التنفيذ',
    LOCKED: 'مقفلة',
    MATCHING: 'جاري البحث',
    PAUSED: 'متوقف',
    PAYMENT_APPROVED: 'الدفع مقبول',
    PAYMENT_PENDING: 'بانتظار إثبات الدفع',
    PENDING_ADMIN_REVIEW: 'بانتظار مراجعة فريق SYBNB',
    PENDING_PROOF: 'بانتظار الإثبات',
    PENDING_REVIEW: 'قيد المراجعة',
    RELEASE: 'تحرير رصيد',
    REFUNDED: 'مسترد',
    REJECTED: 'مرفوض',
    REQUESTED: 'تم إرسال الطلب',
    SENT: 'مرسلة',
  },
  en: {
    ACTIVE: 'Active',
    APPROVED: 'Approved',
    CANCELLED: 'Cancelled',
    CLAIM_PENDING: 'Pending review',
    CLAIMED: 'Claimed',
    COMPLETED: 'Completed',
    CONFIRMED: 'Confirmed',
    CREDIT: 'Credit',
    CREATED: 'Created',
    DEBIT: 'Debit',
    DRAFT: 'Draft',
    DRIVER_ARRIVING: 'Driver arriving',
    DRIVER_ASSIGNED: 'Driver assigned',
    DISPUTED: 'Disputed',
    EXPIRED: 'Expired',
    IN_PROGRESS: 'In progress',
    LOCKED: 'Locked',
    MATCHING: 'Matching',
    PAUSED: 'Paused',
    PAYMENT_APPROVED: 'Payment approved',
    PAYMENT_PENDING: 'Awaiting payment proof',
    PENDING_ADMIN_REVIEW: 'Pending SYBNB review',
    PENDING_PROOF: 'Pending proof',
    PENDING_REVIEW: 'Pending review',
    RELEASE: 'Release',
    REFUNDED: 'Refunded',
    REJECTED: 'Rejected',
    REQUESTED: 'Requested',
    SENT: 'Sent',
  },
}

export const divisionLabels: Record<Lang, Record<string, string>> = {
  ar: {
    STAYS: 'الإيجار اليومي',
    RENTALS: 'الإيجار الشهري',
    BUY: 'شراء عقار',
    CARS: 'السيارات',
    MARKETPLACE: 'السوق',
    NEW_CONSTRUCTION: 'مشاريع جديدة',
  },
  en: {
    STAYS: 'Daily stays',
    RENTALS: 'Monthly rentals',
    BUY: 'Buy property',
    CARS: 'Cars',
    MARKETPLACE: 'Marketplace',
    NEW_CONSTRUCTION: 'New construction',
  },
}

export const divisionDescriptions: Record<string, Record<Lang, string>> = {
  STAYS: {
    ar: 'ابحث بالتاريخ والضيوف ثم أرسل طلب الحجز.',
    en: 'Search by dates and guests, then request a stay.',
  },
  RENTALS: {
    ar: 'خيارات حسب المدينة، الميزانية، والغرف.',
    en: 'Filter by city, budget, and bedrooms.',
  },
  BUY: {
    ar: 'شاهد العقارات، أرسل عرضاً، أو احجز زيارة.',
    en: 'View properties, make an offer, or request a visit.',
  },
  CARS: {
    ar: 'ابحث عن السيارة، تحقق من التفاصيل، وتواصل مع البائع.',
    en: 'Find a car, inspect details, and contact the seller.',
  },
  MARKETPLACE: {
    ar: 'تصفح المنتجات وتواصل مع البائع بعد إنشاء حساب.',
    en: 'Browse items and contact sellers after account.',
  },
  NEW_CONSTRUCTION: {
    ar: 'شاهد المشروع على أقسام: الأسلوب، المخططات، الطوابق، التشطيب، والدفع.',
    en: 'View projects by sections: style, plans, floors, finishing, and terms.',
  },
}

export function hasArabic(value = '') {
  return /[\u0600-\u06ff]/.test(value)
}

export function statusText(status: string | null | undefined, lang: Lang) {
  if (!status) return '-'
  return statusLabels[lang][status] || status.replace(/_/g, ' ')
}

export function divisionText(division: string | null | undefined, lang: Lang) {
  if (!division) return '-'
  return divisionLabels[lang][division] || division.replace(/_/g, ' ')
}

export function moneyText(amountMinor: number | null | undefined, currency = 'SYP', lang: Lang) {
  const amount = Number(amountMinor || 0).toLocaleString(localeForLang(lang))
  const currencyText = lang === 'ar' && currency === 'SYP' ? 'ل.س' : currency
  return `${amount} ${currencyText}`
}

export function listingTitleText(
  listing: Pick<PlatformListing, 'id' | 'division' | 'titleAr' | 'titleEn'>,
  lang: Lang,
) {
  if (lang === 'en') return listing.titleEn || listing.titleAr
  if (hasArabic(listing.titleAr)) return listing.titleAr
  // A non-empty title with no Arabic (e.g. a car "BMW 320i 2020", "Kia Rio 2019") is still the
  // real, meaningful name — show it instead of a generic "{division} {id}" placeholder that hides
  // the make/model/year from Arabic users. Only fall back when no usable title text exists at all.
  const meaningfulTitle = (listing.titleAr || listing.titleEn || '').trim()
  if (meaningfulTitle) return meaningfulTitle
  return `${divisionText(listing.division, lang)} ${listing.id.slice(0, 8).toUpperCase()}`
}

export function listingDescriptionText(
  listing: Pick<PlatformListing, 'division' | 'description'>,
  lang: Lang,
) {
  if (lang === 'en') return listing.description || divisionDescriptions[listing.division]?.[lang] || ''
  if (listing.description && hasArabic(listing.description)) return listing.description
  return divisionDescriptions[listing.division]?.[lang] || ''
}

export function providerText(provider: string | null | undefined, lang: Lang) {
  if (!provider) return '-'
  if (lang === 'ar' && provider === 'syrian_local_wallet') return 'المحفظة المحلية السورية'
  return provider.replace(/_/g, ' ')
}
