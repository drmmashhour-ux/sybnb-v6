import { pick, type Lang } from '../../engines/language/languageEngine'
import type { HostPayoutMethod, PayoutMethodType, PayoutRequestStatus } from '../api/platformApi'

// Shared labels for host payout methods / withdrawal requests (host payouts page + admin money desk).

export function methodTypeLabel(type: PayoutMethodType | string | undefined, lang: Lang) {
  if (type === 'SHAM_CASH') return pick(lang, 'شام كاش', 'Sham Cash', 'Sham Cash')
  if (type === 'BANK') return pick(lang, 'تحويل بنكي', 'Bank transfer', 'Virement bancaire')
  if (type === 'CASH_OFFICE') return pick(lang, 'نقداً من مكتب SYBNB', 'Cash at a SYBNB office', 'Espèces dans un bureau SYBNB')
  return '-'
}

export function methodDetailsText(method: HostPayoutMethod | null | undefined, lang: Lang) {
  if (!method) return '-'
  const colon = lang === 'fr' ? ' : ' : ': '
  if (method.type === 'SHAM_CASH') {
    return [method.shamCashNumber, method.accountName].filter(Boolean).join(' · ')
  }
  if (method.type === 'BANK') {
    return [method.bankName, method.accountName, method.accountNumber].filter(Boolean).join(' · ')
  }
  if (method.type === 'CASH_OFFICE') {
    return `${pick(lang, 'المدينة', 'City', 'Ville')}${colon}${method.officeCity || '-'}`
  }
  return '-'
}

export function payoutStatusLabel(status: PayoutRequestStatus | string, lang: Lang) {
  if (status === 'REQUESTED') return pick(lang, 'قيد المعالجة', 'Requested', 'Demandé')
  if (status === 'PAID') return pick(lang, 'تم الدفع', 'Paid', 'Payé')
  if (status === 'REJECTED') return pick(lang, 'مرفوض', 'Rejected', 'Refusé')
  return status
}
