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
  fr: {
    ACTIVE: 'Actif',
    APPROVED: 'Approuvé',
    CANCELLED: 'Annulé',
    CLAIM_PENDING: 'En attente de vérification',
    CLAIMED: 'Réclamé',
    COMPLETED: 'Terminé',
    CONFIRMED: 'Confirmé',
    CREDIT: 'Crédit',
    CREATED: 'Créé',
    DEBIT: 'Débit',
    DRAFT: 'Brouillon',
    DRIVER_ARRIVING: 'Chauffeur en route',
    DRIVER_ASSIGNED: 'Chauffeur assigné',
    DISPUTED: 'En litige',
    EXPIRED: 'Expiré',
    IN_PROGRESS: 'En cours',
    LOCKED: 'Verrouillé',
    MATCHING: 'Recherche en cours',
    PAUSED: 'En pause',
    PAYMENT_APPROVED: 'Paiement approuvé',
    PAYMENT_PENDING: 'Preuve de paiement en attente',
    PENDING_ADMIN_REVIEW: 'En attente de vérification par SYBNB',
    PENDING_PROOF: 'Preuve en attente',
    PENDING_REVIEW: 'En cours de vérification',
    RELEASE: 'Déblocage',
    REFUNDED: 'Remboursé',
    REJECTED: 'Refusé',
    REQUESTED: 'Demande envoyée',
    SENT: 'Envoyé',
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
  fr: {
    STAYS: 'Séjours à la nuitée',
    RENTALS: 'Locations au mois',
    BUY: 'Achat immobilier',
    CARS: 'Véhicules',
    MARKETPLACE: 'Marché',
    NEW_CONSTRUCTION: 'Projets neufs',
  },
}

export const divisionDescriptions: Record<string, Record<Lang, string>> = {
  STAYS: {
    ar: 'ابحث بالتاريخ والضيوف ثم أرسل طلب الحجز.',
    en: 'Search by dates and guests, then request a stay.',
    fr: 'Recherchez par dates et nombre de voyageurs, puis envoyez une demande de séjour.',
  },
  RENTALS: {
    ar: 'خيارات حسب المدينة، الميزانية، والغرف.',
    en: 'Filter by city, budget, and bedrooms.',
    fr: 'Filtrez par ville, budget et nombre de chambres.',
  },
  BUY: {
    ar: 'شاهد العقارات، أرسل عرضاً، أو احجز زيارة.',
    en: 'View properties, make an offer, or request a visit.',
    fr: 'Consultez des propriétés, faites une offre ou demandez une visite.',
  },
  CARS: {
    ar: 'ابحث عن السيارة، تحقق من التفاصيل، وتواصل مع البائع.',
    en: 'Find a car, inspect details, and contact the seller.',
    fr: 'Trouvez un véhicule, vérifiez les détails et contactez le vendeur.',
  },
  MARKETPLACE: {
    ar: 'تصفح المنتجات وتواصل مع البائع بعد إنشاء حساب.',
    en: 'Browse items and contact sellers after account.',
    fr: 'Parcourez les articles et contactez les vendeurs après avoir créé un compte.',
  },
  NEW_CONSTRUCTION: {
    ar: 'شاهد المشروع على أقسام: الأسلوب، المخططات، الطوابق، التشطيب، والدفع.',
    en: 'View projects by sections: style, plans, floors, finishing, and terms.',
    fr: 'Consultez les projets par section : style, plans, étages, finitions et modalités.',
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
  if (lang !== 'ar') return listing.titleEn || listing.titleAr
  if (hasArabic(listing.titleAr)) return listing.titleAr
  // A non-empty title with no Arabic (e.g. a car "BMW 320i 2020", "Kia Rio 2019") is still the
  // real, meaningful name — show it instead of a generic "{division} {id}" placeholder that hides
  // the make/model/year from Arabic users. Only fall back when no usable title text exists at all.
  const meaningfulTitle = (listing.titleAr || listing.titleEn || '').trim()
  if (meaningfulTitle) return meaningfulTitle
  return `${divisionText(listing.division, lang)} ${listing.id.slice(0, 8).toUpperCase()}`
}

export function listingDescriptionText(
  listing: Pick<PlatformListing, 'division' | 'description' | 'metadata'>,
  lang: Lang,
) {
  if (lang !== 'ar') {
    // Prefer an explicit English description carried in metadata (descriptionEn); the single
    // `description` column is Arabic-primary, so without this EN readers would see Arabic body text.
    const enDesc = (listing.metadata as { descriptionEn?: unknown } | null | undefined)?.descriptionEn
    if (typeof enDesc === 'string' && enDesc.trim()) return enDesc
    // A real bug caught by an independent re-audit: this used to collapse straight to the generic
    // per-division boilerplate whenever the seller's real description was Arabic (true for
    // essentially every listing), so every English-side listing in a division showed the exact
    // same sentence with zero listing-specific information. No translation pipeline exists here
    // to invent a real English sentence, and fabricating one would be worse than showing nothing
    // -- so, mirroring listingTitleText()'s own precedent, show the seller's real description
    // as-is rather than a generic placeholder; only fall back to the division default when there's
    // truly no description text at all.
    if (listing.description?.trim()) return listing.description
    return divisionDescriptions[listing.division]?.[lang] || ''
  }
  if (listing.description && hasArabic(listing.description)) return listing.description
  return divisionDescriptions[listing.division]?.[lang] || ''
}

export function providerText(provider: string | null | undefined, lang: Lang) {
  if (!provider) return '-'
  if (lang === 'ar' && provider === 'syrian_local_wallet') return 'المحفظة المحلية السورية'
  return provider.replace(/_/g, ' ')
}
