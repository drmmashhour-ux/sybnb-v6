import React from 'react'

import type { Lang } from '../../../engines/language/languageEngine'

type GiftRedeemedSuccessProps = {
  lang?: Lang
  amount?: string
  balance?: string
  walletCreated?: boolean
  reference?: string
  onWallet?: () => void
  onRide?: () => void
  onBrowse?: () => void
}

const T = {
  ar: {
    title: 'تمت إضافة الهدية إلى محفظتك',
    subtitle: 'الرصيد أصبح جاهزاً للاستخدام داخل SYBNB و SR.',
    amountAdded: 'المبلغ المضاف',
    newBalance: 'الرصيد الجديد',
    walletCreated: 'تم إنشاء محفظتك تلقائياً',
    ledger: 'سجل المحفظة',
    ref: 'رقم العملية',
    type: 'رصيد هدية',
    wallet: 'استخدام المحفظة',
    ride: 'حجز رحلة سير',
    browse: 'تصفح SYBNB',
  },
  en: {
    title: 'Gift added to your wallet',
    subtitle: 'Your credit is ready to use inside SYBNB and SR.',
    amountAdded: 'Amount added',
    newBalance: 'New balance',
    walletCreated: 'Your wallet was created automatically',
    ledger: 'Wallet ledger',
    ref: 'Reference',
    type: 'Gift credit',
    wallet: 'Use wallet',
    ride: 'Book SR ride',
    browse: 'Browse SYBNB',
  },
  fr: {
    title: 'Cadeau ajouté à votre portefeuille',
    subtitle: 'Votre crédit est prêt à être utilisé dans SYBNB et SR.',
    amountAdded: 'Montant ajouté',
    newBalance: 'Nouveau solde',
    walletCreated: 'Votre portefeuille a été créé automatiquement',
    ledger: 'Historique du portefeuille',
    ref: 'Référence',
    type: 'Crédit cadeau',
    wallet: 'Utiliser le portefeuille',
    ride: 'Réserver une course SR',
    browse: 'Parcourir SYBNB',
  },
}

export function GiftRedeemedSuccess({
  lang = 'ar',
  amount,
  balance,
  walletCreated = true,
  reference,
  onWallet,
  onRide,
  onBrowse,
}: GiftRedeemedSuccessProps) {
  const isAr = lang === 'ar'
  const t = T[lang]
  // No fabricated amounts/balances: this screen renders only from a real claim result (its parent
  // guards against rendering without one). Show a neutral placeholder if a field is ever missing.
  const amountText = amount || '—'
  const balanceText = balance || '—'
  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={{ minHeight: '100vh', background: '#0a0a0f', color: '#f7f7fb', padding: 20, fontFamily: '"Cairo","Tajawal",Inter,sans-serif' }}>
      <section style={{ maxWidth: 520, margin: '0 auto', paddingTop: 30 }}>
        <div style={{ width: 96, height: 96, borderRadius: 999, background: 'rgba(34,197,94,.15)', border: '1px solid rgba(34,197,94,.45)', display: 'grid', placeItems: 'center', color: '#22c55e', fontSize: 46, margin: '0 auto 20px' }}>✓</div>
        <h1 style={{ textAlign: 'center', margin: 0, fontSize: 30 }}>{t.title}</h1>
        <p style={{ textAlign: 'center', color: '#9aa6ba', lineHeight: 1.7 }}>{t.subtitle}</p>

        {walletCreated && (
          <div style={{ borderRadius: 16, border: '1px solid rgba(79,108,255,.35)', background: 'rgba(79,108,255,.12)', color: '#bfcaee', padding: 14, margin: '18px 0' }}>
            {t.walletCreated}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ borderRadius: 18, border: '1px solid rgba(34,197,94,.35)', background: 'rgba(34,197,94,.10)', padding: 16 }}>
            <div style={{ color: '#9aa6ba', fontSize: 12 }}>{t.amountAdded}</div>
            <strong dir={isAr ? 'rtl' : 'ltr'} style={{ color: '#22c55e', fontSize: 22 }}>{amountText}</strong>
          </div>
          <div style={{ borderRadius: 18, border: '1px solid rgba(213,169,21,.42)', background: 'rgba(213,169,21,.10)', padding: 16 }}>
            <div style={{ color: '#9aa6ba', fontSize: 12 }}>{t.newBalance}</div>
            <strong dir={isAr ? 'rtl' : 'ltr'} style={{ color: '#d5a915', fontSize: 22 }}>{balanceText}</strong>
          </div>
        </div>

        <div style={{ marginTop: 16, borderRadius: 18, border: '1px solid #1e1e2a', background: '#111118', padding: 16 }}>
          <div style={{ color: '#9aa6ba', fontSize: 12, marginBottom: 8 }}>{t.ledger}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <strong>{t.type}</strong>
            <span dir={isAr ? 'rtl' : 'ltr'} style={{ color: '#22c55e', fontWeight: 900 }}>+{amountText}</span>
          </div>
          <div style={{ marginTop: 8, color: '#9aa6ba' }}>{t.ref}: <span dir="ltr">{reference || '—'}</span></div>
        </div>

        <div style={{ display: 'grid', gap: 10, marginTop: 18 }}>
          <button onClick={onWallet} style={buttonStyle('#4f6cff')}>{t.wallet}</button>
          <button onClick={onRide} style={buttonStyle('#111827')}>{t.ride}</button>
          <button onClick={onBrowse} style={buttonStyle('#111827')}>{t.browse}</button>
        </div>
      </section>
    </main>
  )
}

function buttonStyle(background: string): React.CSSProperties {
  return {
    minHeight: 54,
    borderRadius: 16,
    border: background === '#111827' ? '1px solid #2c3448' : 0,
    background,
    color: '#fff',
    fontWeight: 900,
    fontSize: 16,
  }
}

export default GiftRedeemedSuccess
