import type { Lang } from '../../engines/language/languageEngine'

type PaymentCapsuleStatus = 'locked' | 'ready' | 'proof' | 'admin' | 'confirmed'

type PaymentCapsuleProps = {
  lang: Lang
  methodLabel: string
  amountLabel: string
  destinationCode: string
  followCode: string
  proofCount: number
  status: PaymentCapsuleStatus
}

const copy = {
  ar: {
    title: 'كبسولة الدفع',
    method: 'طريقة الدفع',
    amount: 'المبلغ',
    code: 'كود الدفع',
    follow: 'كود المتابعة',
    proof: 'إثباتات الدفع',
    files: 'ملف',
    locked: 'بانتظار تأكيد المبلغ',
    ready: 'جاهز للدفع',
    proofReady: 'جارٍ إرسال الإثبات...',
    admin: 'بانتظار تأكيد الإدارة',
    confirmed: 'تم تأكيد الدفع',
    stages: ['تأكيد المبلغ', 'اختيار الدفع', 'مراجعة الإثبات', 'تأكيد الإدارة', 'الدفع مؤكد'],
  },
  en: {
    title: 'Payment Capsule',
    method: 'Payment method',
    amount: 'Amount',
    code: 'Payment code',
    follow: 'Follow-up code',
    proof: 'Payment proofs',
    files: 'file',
    locked: 'Waiting for amount confirmation',
    ready: 'Ready to pay',
    proofReady: 'Submitting proof...',
    admin: 'Waiting for admin confirmation',
    confirmed: 'Payment confirmed',
    stages: ['Amount', 'Payment', 'Proof review', 'Admin review', 'Confirmed'],
  },
  fr: {
    title: 'Capsule de paiement',
    method: 'Mode de paiement',
    amount: 'Montant',
    code: 'Code de paiement',
    follow: 'Code de suivi',
    proof: 'Preuves de paiement',
    files: 'fichier(s)',
    locked: 'En attente de la confirmation du montant',
    ready: 'Prêt à payer',
    proofReady: 'Envoi de la preuve...',
    admin: 'En attente de la confirmation de l’administration',
    confirmed: 'Paiement confirmé',
    stages: ['Montant', 'Paiement', 'Vérification de la preuve', 'Vérification admin', 'Confirmé'],
  },
}

export function PaymentCapsule({ lang, methodLabel, amountLabel, destinationCode, followCode, proofCount, status }: PaymentCapsuleProps) {
  const t = copy[lang]
  const stageOrder: PaymentCapsuleStatus[] = ['locked', 'ready', 'proof', 'admin', 'confirmed']
  const activeIndex = Math.max(0, stageOrder.indexOf(status))
  const statusLabel =
    status === 'confirmed'
      ? t.confirmed
      : status === 'admin'
        ? t.admin
        : status === 'proof'
          ? t.proofReady
          : status === 'ready'
            ? t.ready
            : t.locked

  return (
    <section className={`payment-capsule ${status}`} aria-label={t.title}>
      <div className="payment-capsule-head">
        <strong>{t.title} / Payment Capsule</strong>
        <span>{statusLabel}</span>
      </div>
      <div className="payment-capsule-steps" aria-label={statusLabel}>
        {t.stages.map((label, index) => (
          <span
            className={[
              'payment-capsule-step',
              index < activeIndex ? 'complete' : '',
              index === activeIndex ? 'active' : '',
            ].filter(Boolean).join(' ')}
            key={label}
          >
            <i>{index + 1}</i>
            {label}
          </span>
        ))}
      </div>
      <div className="payment-capsule-grid">
        <div className="payment-capsule-method">
          <span>{t.method}</span>
          <strong>{methodLabel}</strong>
        </div>
        <div className="payment-capsule-amount">
          <span>{t.amount}</span>
          <strong>{amountLabel}</strong>
        </div>
        <div>
          <span>{t.code}</span>
          <strong dir="ltr">{destinationCode}</strong>
        </div>
        <div>
          <span>{t.follow}</span>
          <strong dir="ltr">{followCode}</strong>
        </div>
        <div>
          <span>{t.proof}</span>
          <strong>
            {proofCount} {t.files}
          </strong>
        </div>
      </div>
    </section>
  )
}
