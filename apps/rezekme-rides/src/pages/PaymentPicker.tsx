import type { CSSProperties } from 'react'
import type { Lang } from '@platform/engines/language/languageEngine'
import { pick } from '@platform/engines/language/languageEngine'
import { moneyText } from '@platform/shared/i18n/display'
import type { SavedCard } from '@platform/shared/api/platformApi'

export type PayMethod = 'wallet' | 'card' | 'shamcash' | 'msh' | null

type Props = {
  mode: 'guest' | 'client'
  lang: Lang
  walletBalanceMinor: number | null  // null = loading
  fareMinor: number
  currency: string
  savedCard: SavedCard | null
  value: PayMethod
  onChange: (m: PayMethod) => void
  shamCashRef: string
  onShamCashRefChange: (v: string) => void
  onShamCashSubmit: () => void
  shamCashStatus: 'idle' | 'saving' | 'submitted' | 'error'
}

const LOCAL_WALLET_QR = '/assets/payments/syrian-local-wallet-qr-clean.jpg'

const s: Record<string, CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 0' },
  label: { fontWeight: 600, fontSize: 14, marginBottom: 2 },
  tabs: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  tab: {
    padding: '7px 14px', borderRadius: 20, border: '1.5px solid #ccc',
    background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500,
  },
  tabActive: {
    padding: '7px 14px', borderRadius: 20, border: '1.5px solid #2563eb',
    background: '#eff6ff', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#2563eb',
  },
  body: { marginTop: 6, fontSize: 13 },
  hint: { color: '#555', fontSize: 12, lineHeight: 1.5 },
  ok: { color: '#16a34a', fontWeight: 600 },
  warn: { color: '#dc2626', fontWeight: 600 },
  input: {
    width: '100%', padding: '8px 10px', border: '1.5px solid #ddd',
    borderRadius: 8, fontSize: 13, boxSizing: 'border-box' as CSSProperties['boxSizing'],
  },
  btn: {
    marginTop: 8, padding: '8px 16px', borderRadius: 8, border: 'none',
    background: '#2563eb', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13,
  },
  btnDisabled: {
    marginTop: 8, padding: '8px 16px', borderRadius: 8, border: 'none',
    background: '#93c5fd', color: '#fff', fontWeight: 600, cursor: 'not-allowed', fontSize: 13,
  },
  qr: { width: 160, borderRadius: 8, marginBottom: 6 },
  guestCard: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
    border: '1.5px solid #2563eb', borderRadius: 10, background: '#eff6ff', cursor: 'pointer',
  },
  guestCardIcon: { fontSize: 22 },
  guestCardText: { flex: 1 },
  guestCardTitle: { fontWeight: 600, color: '#1d4ed8', fontSize: 14 },
  guestCardHint: { color: '#555', fontSize: 12 },
  notice: { color: '#16a34a', fontSize: 12, marginTop: 4 },
}

function Tab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button type="button" style={active ? s.tabActive : s.tab} onClick={onClick}>{label}</button>
}

export function PaymentPicker({
  mode, lang, walletBalanceMinor, fareMinor, currency, savedCard, value, onChange,
  shamCashRef, onShamCashRefChange, onShamCashSubmit, shamCashStatus,
}: Props) {
  const isAr = lang === 'ar'

  // ---------- GUEST: card only ----------
  if (mode === 'guest') {
    return (
      <div style={s.wrap}>
        <span style={s.label}>{pick(lang, 'طريقة الدفع', 'Payment method', 'Paiement')}</span>
        <div
          role="button"
          tabIndex={0}
          style={s.guestCard}
          onClick={() => onChange('card')}
          onKeyDown={(e) => e.key === 'Enter' && onChange('card')}
        >
          <span style={s.guestCardIcon}>💳</span>
          <div style={s.guestCardText}>
            <div style={s.guestCardTitle}>
              {pick(lang, 'الدفع ببطاقة ائتمان / دولية', 'Credit or international card', 'Carte bancaire / internationale')}
            </div>
            <div style={s.guestCardHint}>
              {pick(lang, 'ستُحوّل إلى Stripe لإتمام الدفع بأمان قبل البحث عن سائق.', "You'll be redirected to Stripe to pay securely before we look for a driver.", 'Vous serez redirigé vers Stripe avant la mise en relation avec un chauffeur.')}
            </div>
          </div>
          <span style={{ color: '#2563eb' }}>→</span>
        </div>
        {value === 'card' && (
          <span style={s.notice}>✓ {pick(lang, 'بطاقة محددة — اضغط "طلب الرحلة" للمتابعة', 'Card selected — tap Request ride to continue', 'Carte sélectionnée — appuyez sur Demander le trajet')}</span>
        )}
      </div>
    )
  }

  // ---------- CLIENT: wallet / card / sham cash / MSH ----------
  const walletSufficient = walletBalanceMinor !== null && walletBalanceMinor >= fareMinor

  return (
    <div style={s.wrap}>
      <span style={s.label}>{pick(lang, 'طريقة الدفع', 'Payment method', 'Paiement')}</span>
      <div style={s.tabs}>
        <Tab label={pick(lang, 'المحفظة', 'Wallet', 'Portefeuille')} active={value === 'wallet'} onClick={() => onChange('wallet')} />
        <Tab label={pick(lang, 'بطاقة', 'Card', 'Carte')} active={value === 'card'} onClick={() => onChange('card')} />
        <Tab label="Sham Cash" active={value === 'shamcash'} onClick={() => onChange('shamcash')} />
        <Tab label="MSH" active={value === 'msh'} onClick={() => onChange('msh')} />
      </div>

      {/* ---- Wallet ---- */}
      {value === 'wallet' && (
        <div style={s.body}>
          {walletBalanceMinor === null ? (
            <span style={s.hint}>{pick(lang, 'جارٍ التحقق من الرصيد…', 'Checking balance…', 'Vérification…')}</span>
          ) : (
            <span style={walletSufficient ? s.ok : s.warn}>
              {pick(lang, 'الرصيد', 'Balance', 'Solde')}: {moneyText(walletBalanceMinor, currency, lang)}
              {!walletSufficient && ' · ' + pick(lang, 'رصيد غير كافٍ — اشحن المحفظة أو اختر طريقة أخرى', 'Insufficient — top up via Sham Cash or choose another method', 'Solde insuffisant')}
            </span>
          )}
        </div>
      )}

      {/* ---- Card ---- */}
      {value === 'card' && (
        <div style={s.body}>
          {savedCard ? (
            <span style={s.ok}>
              ✓ {savedCard.brand ? savedCard.brand.toUpperCase() : 'CARD'} · {pick(lang, 'تنتهي بـ', 'ending', 'finissant par')} {savedCard.last4}
              {savedCard.expired && <span style={s.warn}> · {pick(lang, 'منتهية الصلاحية', 'Expired', 'Expirée')}</span>}
            </span>
          ) : (
            <span style={s.hint}>{pick(lang, 'لا توجد بطاقة محفوظة — أضف بطاقة من ملفك الشخصي ثم عد هنا.', 'No card saved — add one in your profile then return here.', 'Aucune carte — ajoutez-en une dans votre profil.')}</span>
          )}
        </div>
      )}

      {/* ---- Sham Cash ---- */}
      {value === 'shamcash' && (
        <div style={s.body}>
          {shamCashStatus === 'submitted' ? (
            <span style={s.ok}>✓ {pick(lang, 'تم إرسال إثبات الشحن. بعد الموافقة يُشحن رصيدك وتُطلب الرحلة.', 'Top-up proof sent. After approval your wallet is funded and the ride will be requested.', 'Preuve envoyée. Après approbation, votre portefeuille sera crédité.')}</span>
          ) : (
            <>
              <div style={s.hint}>
                {pick(lang, 'حوّل المبلغ إلى حساب Rezekme أدناه ثم أدخل رقم المرجع.', 'Transfer the amount to the Rezekme account below and enter the reference number.', 'Transférez le montant au compte Rezekme ci-dessous et entrez la référence.')}
              </div>
              <img src={LOCAL_WALLET_QR} alt="Sham Cash QR" style={s.qr} />
              <div style={{ marginBottom: 6, fontSize: 12, color: '#333' }}>
                {pick(lang, 'المبلغ المطلوب:', 'Amount due:', 'Montant dû:')} <strong>{moneyText(fareMinor, currency, lang)}</strong>
              </div>
              <input
                type="text"
                dir={isAr ? 'rtl' : 'ltr'}
                style={s.input}
                placeholder={pick(lang, 'رقم مرجع التحويل', 'Transfer reference number', 'Référence du transfert')}
                value={shamCashRef}
                onChange={(e) => onShamCashRefChange(e.target.value)}
              />
              <button
                type="button"
                style={shamCashStatus === 'saving' || !shamCashRef.trim() ? s.btnDisabled : s.btn}
                disabled={shamCashStatus === 'saving' || !shamCashRef.trim()}
                onClick={onShamCashSubmit}
              >
                {shamCashStatus === 'saving'
                  ? pick(lang, 'جارٍ الإرسال…', 'Sending…', 'Envoi…')
                  : pick(lang, 'إرسال إثبات الدفع', 'Submit payment proof', 'Envoyer la preuve')}
              </button>
            </>
          )}
        </div>
      )}

      {/* ---- MSH token ---- */}
      {value === 'msh' && (
        <div style={s.body}>
          <span style={s.hint}>{pick(lang, 'رمز MSH — قريباً', 'MSH token — coming soon', 'Jeton MSH — bientôt disponible')}</span>
        </div>
      )}
    </div>
  )
}
