import { pick, type Lang } from '../../engines/language/languageEngine'

// Short-term rental guest agreement shown before a stay is booked (listing page and checkout).
// Wording and version are a legal DRAFT owned by SYBNB -- change them here only, never inline.
export const STAY_GUEST_AGREEMENT_VERSION = 'SYBNB_SHORT_TERM_RENTAL_GUEST_AGREEMENT_V1'

export function stayGuestAgreement(lang: Lang) {
  return {
    title: pick(lang, 'اتفاقية الإيجار اليومي', 'Short-Term Rental Agreement', 'Contrat de location de courte durée'),
    body: pick(
      lang,
      'أوافق على صحة بياناتي، احترام سياسة الحجز والإلغاء، الدفع داخل SYBNB فقط، عدم الاتفاق خارج المنصة، الالتزام بقواعد الاستضافة، وتحويل أي نزاع إلى فريق SYBNB قبل أي تصرف خارجي. أعلم أن SYBNB تخصم عمولة خدمة (12% من إجمالي قيمة الحجز، عدا رسوم الحماية) من مستحقات المضيف مقابل إدارة الحجز والدفع والحماية.',
      'I agree that my information is accurate, booking and cancellation rules apply, payment happens only inside SYBNB, no outside-platform agreement is allowed, stay rules must be respected, and disputes go to the SYBNB team before any outside action. I understand SYBNB deducts a service commission (12% of the total booking amount, excluding the protection fee) from the host payout for managing the booking, payment, and protection.',
      'Je confirme que mes informations sont exactes, que les règles de réservation et d’annulation s’appliquent, que le paiement s’effectue uniquement dans SYBNB, qu’aucun accord hors plateforme n’est autorisé, que les règles du logement doivent être respectées et que tout litige est soumis à l’équipe SYBNB avant toute démarche externe. Je comprends que SYBNB prélève une commission de service (12 % du montant total de la réservation, hors frais de protection) sur le versement à l’hôte pour la gestion de la réservation, du paiement et de la protection.',
    ),
    versionLabel: pick(lang, 'الإصدار 1', 'Version 1', 'Version 1'),
    version: STAY_GUEST_AGREEMENT_VERSION,
  }
}
