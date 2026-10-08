import React, { useState } from 'react'
import { pick, type Lang } from '../../../engines/language/languageEngine'

type GiftRecipientLandingProps = {
  lang?: Lang
  amount?: string
  senderName?: string
  codeLast4?: string
  onContinue?: (payload: { phone: string }) => void
}

const T = {
  ar: {
    brand: 'SYBNB Wallet',
    title: 'استلام هدية رصيد',
    subtitle: 'هذه الهدية مقفلة على رقم الهاتف الذي استلم الرابط.',
    locked: 'مقفلة للمستلم',
    amount: 'قيمة الهدية',
    from: 'من',
    last4: 'آخر 4 رموز',
    phone: 'رقم الهاتف الذي استلم الهدية',
    phonePlaceholder: '+963 9XX XXX XXX',
    phoneNote: 'يجب استخدام نفس رقم الهاتف الذي استلم الهدية',
    noSell: 'لا يمكن بيع أو تحويل الهدية إلى رقم آخر',
    walletNote: 'إذا لم يكن لديك محفظة، سيتم إنشاؤها تلقائياً بعد التحقق.',
    securityTitle: 'حماية الهدية',
    securityOne: 'الرصيد يدخل إلى محفظة الرقم المطابق فقط.',
    securityTwo: 'لن تطلب SYBNB رمز الاستلام منك إلا في الشاشة التالية.',
    cta: 'التالي — إدخال رمز الاستلام',
  },
  en: {
    brand: 'SYBNB Wallet',
    title: 'Claim Gift Credit',
    subtitle: 'This gift is locked to the phone number that received the link.',
    locked: 'Locked to recipient',
    amount: 'Gift amount',
    from: 'From',
    last4: 'Last 4',
    phone: 'Phone number the gift was sent to',
    phonePlaceholder: '+963 9XX XXX XXX',
    phoneNote: 'Use the same phone number that received this gift',
    noSell: 'This gift cannot be sold or moved to another number',
    walletNote: 'If you do not have a wallet, one will be created after verification.',
    securityTitle: 'Gift protection',
    securityOne: 'Credit lands only in the wallet for the matching phone.',
    securityTwo: 'SYBNB only asks for the claim code on the next screen.',
    cta: 'Next — enter claim code',
  },
  fr: {
    brand: 'SYBNB Wallet',
    title: 'Réclamer un crédit cadeau',
    subtitle: 'Ce cadeau est associé au numéro de téléphone qui a reçu le lien.',
    locked: 'Réservé au destinataire',
    amount: 'Montant du cadeau',
    from: 'De',
    last4: '4 derniers',
    phone: 'Numéro de téléphone auquel le cadeau a été envoyé',
    phonePlaceholder: '+963 9XX XXX XXX',
    phoneNote: 'Utilisez le même numéro de téléphone que celui qui a reçu ce cadeau',
    noSell: 'Ce cadeau ne peut être ni vendu ni transféré vers un autre numéro',
    walletNote: 'Si vous n’avez pas de portefeuille, un portefeuille sera créé après la vérification.',
    securityTitle: 'Protection du cadeau',
    securityOne: 'Le crédit est versé uniquement dans le portefeuille du numéro correspondant.',
    securityTwo: 'SYBNB vous demande le code de réclamation uniquement à l’écran suivant.',
    cta: 'Suivant — saisir le code de réclamation',
  },
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#0a0a0f',
    color: '#f7f7fb',
    padding: 20,
    fontFamily: '"Cairo", "Tajawal", Inter, sans-serif',
  },
  wrap: { maxWidth: 480, margin: '0 auto', paddingBottom: 40 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  brand: { color: '#4f6cff', fontWeight: 900, letterSpacing: 0 },
  chip: {
    minHeight: 44,
    borderRadius: 999,
    border: '1px solid rgba(213,169,21,.38)',
    background: 'rgba(213,169,21,.12)',
    color: '#d5a915',
    padding: '7px 12px',
    fontSize: 13,
    fontWeight: 800,
  },
  card: {
    borderRadius: 22,
    border: '1px solid #1e1e2a',
    background: 'linear-gradient(145deg,#171b29,#101522)',
    padding: 20,
    boxShadow: '0 22px 80px rgba(0,0,0,.28)',
  },
  giftCard: {
    margin: '18px 0',
    borderRadius: 20,
    padding: 18,
    background: 'linear-gradient(135deg,#2a1e00,#111118 55%,#0a0a0f)',
    border: '1px solid rgba(213,169,21,.42)',
  },
  label: { display: 'block', marginBottom: 8, color: '#9aa6ba', fontSize: 13, fontWeight: 800 },
  input: {
    width: '100%',
    minHeight: 52,
    borderRadius: 14,
    border: '1px solid #2c3448',
    background: '#0d1320',
    color: '#fff',
    padding: '0 14px',
    fontSize: 16,
    boxSizing: 'border-box' as const,
  },
  note: {
    borderRadius: 14,
    border: '1px solid rgba(79,108,255,.3)',
    background: 'rgba(79,108,255,.10)',
    color: '#bfcaee',
    padding: 12,
    fontSize: 13,
    lineHeight: 1.7,
    marginTop: 12,
  },
  cta: {
    width: '100%',
    minHeight: 56,
    borderRadius: 16,
    border: 0,
    background: 'linear-gradient(135deg,#4f6cff,#19d7ff)',
    color: '#fff',
    fontWeight: 900,
    fontSize: 16,
    marginTop: 16,
  },
}

export function GiftRecipientLanding({
  lang = 'ar',
  amount,
  senderName,
  codeLast4,
  onContinue,
}: GiftRecipientLandingProps) {
  const [phone, setPhone] = useState('')
  const isAr = lang === 'ar'
  const t = T[lang]
  // No fabricated fallback: the caller is expected to always pass a real, fetched gift's amount —
  // a placeholder here would silently misrepresent a real gift's value.
  const amountText = amount || '—'
  const senderText = senderName || pick(lang, 'مُرسل غير معروف', 'Unknown sender', 'Expéditeur inconnu')
  const codeText = codeLast4 || '----'
  const canContinue = phone.trim().length >= 8

  const continueSecurely = () => {
    if (!canContinue) return
    onContinue?.({ phone })
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <section style={styles.wrap}>
        <header style={styles.header}>
          <div style={styles.brand}>{t.brand}</div>
          <div style={styles.chip}>{t.locked}</div>
        </header>

        <div style={styles.card}>
          <h1 style={{ margin: 0, fontSize: 30, lineHeight: 1.2 }}>{t.title}</h1>
          <p style={{ color: '#9aa6ba', lineHeight: 1.7 }}>{t.subtitle}</p>

          <div style={styles.giftCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: '#9aa6ba', fontSize: 13 }}>{t.amount}</span>
              <strong dir={isAr ? 'rtl' : 'ltr'} style={{ color: '#d5a915', fontSize: 24 }}>{amountText}</strong>
            </div>
            <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <div style={{ color: '#9aa6ba', fontSize: 12 }}>{t.from}</div>
                <strong>{senderText}</strong>
              </div>
              <div>
                <div style={{ color: '#9aa6ba', fontSize: 12 }}>{t.last4}</div>
                <strong dir="ltr">••••{codeText}</strong>
              </div>
            </div>
          </div>

          <label style={styles.label}>{t.phone}</label>
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder={t.phonePlaceholder}
            inputMode="tel"
            style={styles.input}
          />

          <div style={styles.note}>
            <strong>{t.phoneNote}</strong>
            <br />
            {t.noSell}
            <br />
            {t.walletNote}
          </div>

          <div style={{ ...styles.note, borderColor: 'rgba(213,169,21,.35)', background: 'rgba(213,169,21,.10)' }}>
            <strong>{t.securityTitle}</strong>
            <br />
            {t.securityOne}
            <br />
            {t.securityTwo}
          </div>

          <button
            type="button"
            disabled={!canContinue}
            onClick={continueSecurely}
            style={{ ...styles.cta, opacity: canContinue ? 1 : 0.45 }}
          >
            {t.cta}
          </button>
        </div>
      </section>
    </main>
  )
}

export default GiftRecipientLanding
