import type { CSSProperties } from 'react'
import type { Lang } from '@platform/engines/language/languageEngine'
import { pick } from '@platform/engines/language/languageEngine'
import { moneyText } from '@platform/shared/i18n/display'

export type PayMethod = 'wallet' | 'card' | 'shamcash' | 'msh' | null

type Props = {
  mode: 'guest' | 'client'
  lang: Lang
  walletBalanceMinor: number | null  // null = loading
  fareMinor: number
  currency: string
  value: PayMethod
  onChange: (m: PayMethod) => void
  shamCashRef: string
  onShamCashRefChange: (v: string) => void
  onShamCashSubmit: () => void
  shamCashStatus: 'idle' | 'saving' | 'submitted' | 'error'
}

// The platform's OWN Sham Cash receiving QR. Set VITE_SHAMCASH_QR_URL to the Rezekme account's QR before launch; the fallback is
// the shared SYBNB asset and must not be used for Rezekme money.
const LOCAL_WALLET_QR = ((import.meta.env.VITE_SHAMCASH_QR_URL as string | undefined) || '').trim() || '/assets/payments/syrian-local-wallet-qr-clean.jpg'

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

function Tab({ label, active, onClick, guide }: { label: string; active: boolean; onClick: () => void; guide?: string }) {
  return <button type="button" data-guide={guide} style={active ? s.tabActive : s.tab} onClick={onClick}>{label}</button>
}

export function PaymentPicker({
  mode, lang, walletBalanceMinor, fareMinor, currency, value, onChange,
  shamCashRef, onShamCashRefChange, onShamCashSubmit, shamCashStatus,
}: Props) {
  const isAr = lang === 'ar'

  // ---------- GUEST: card or Sham Cash ----------
  if (mode === 'guest') {
    return (
      <div style={s.wrap}>
        <span style={s.label}>{pick(lang, 'طريقة الدفع', 'Payment method', 'Paiement')}</span>
        <div style={s.tabs}>
          <Tab label={pick(lang, 'بطاقة ائتمانية', 'Credit card', 'Carte bancaire')} active={value === 'card'} onClick={() => onChange('card')} />
          <Tab guide="pay-tab-shamcash" label="Sham Cash" active={value === 'shamcash'} onClick={() => onChange('shamcash')} />
        </div>

        {/* ---- Guest card ---- */}
        {value === 'card' && (
          <div style={s.body}>
            <div style={s.hint}>
              {pick(lang, 'ستُحوّل إلى Stripe لإتمام الدفع بأمان قبل البحث عن سائق.', "You'll be redirected to Stripe to pay securely before we look for a driver.", 'Vous serez redirigé vers Stripe avant la mise en relation avec un chauffeur.')}
            </div>
            <span style={s.notice}>→ {pick(lang, 'اضغط "طلب الرحلة" للمتابعة إلى Stripe', 'Tap Request ride to continue to Stripe', 'Appuyez sur Demander le trajet pour continuer vers Stripe')}</span>
          </div>
        )}

        {/* ---- Guest Sham Cash ---- */}
        {value === 'shamcash' && (
          <div style={s.body}>
            {shamCashStatus === 'submitted' ? (
              <span style={s.ok}>✓ {pick(lang, 'تم إرسال إثبات الشحن. بعد أن يؤكد المشرف التحويل يُشحن رصيدك ويُفعَّل زر طلب الرحلة (يتحدّث تلقائياً).', 'Top-up proof sent. Once an admin confirms the transfer your wallet is credited and Request ride unlocks (this page checks automatically).', 'Preuve envoyée. Dès que l’admin confirme le virement, votre portefeuille est crédité et le bouton Demander le trajet se débloque (vérification automatique).')}</span>
            ) : (
              <>
                <div style={s.hint}>
                  {pick(lang, 'حوّل المبلغ إلى حساب Rezekme أدناه ثم أدخل رقم المرجع.', 'Transfer the amount to the Rezekme account below and enter the reference number.', 'Transférez le montant au compte Rezekme ci-dessous et entrez la référence.')}
                </div>
                <img data-guide="shamcash-qr" src={LOCAL_WALLET_QR} alt="Sham Cash QR" style={s.qr} />
                <div style={{ marginBottom: 6, fontSize: 12, color: '#333' }}>
                  {pick(lang, 'المبلغ المطلوب:', 'Amount due:', 'Montant dû:')} <strong>{moneyText(fareMinor, currency, lang)}</strong>
                </div>
                <input
                  data-guide="shamcash-ref"
                  type="text"
                  dir={isAr ? 'rtl' : 'ltr'}
                  style={s.input}
                  placeholder={pick(lang, 'رقم مرجع التحويل', 'Transfer reference number', 'Référence du transfert')}
                  value={shamCashRef}
                  onChange={(e) => onShamCashRefChange(e.target.value)}
                />
                <button
                  data-guide="shamcash-submit"
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
        <Tab label={pick(lang, 'بطاقة ائتمانية', 'Credit card', 'Carte bancaire')} active={value === 'card'} onClick={() => onChange('card')} />
        <Tab guide="pay-tab-shamcash" label="Sham Cash" active={value === 'shamcash'} onClick={() => onChange('shamcash')} />
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

      {/* ---- Card (Stripe 3D redirect) ---- */}
      {value === 'card' && (
        <div style={s.body}>
          <div style={s.hint}>
            {pick(lang, 'ستُحوّل إلى Stripe لإتمام الدفع بأمان (3D Secure) قبل البحث عن سائق.', "You'll be redirected to Stripe to pay securely (3D Secure) before we look for a driver.", 'Vous serez redirigé vers Stripe pour un paiement sécurisé (3D Secure) avant la mise en relation.')}
          </div>
          <span style={s.notice}>→ {pick(lang, 'اضغط "طلب الرحلة" للمتابعة إلى Stripe', 'Tap Request ride to continue to Stripe', 'Appuyez sur Demander le trajet pour continuer vers Stripe')}</span>
        </div>
      )}

      {/* ---- Sham Cash ---- */}
      {value === 'shamcash' && (
        <div style={s.body}>
          {shamCashStatus === 'submitted' ? (
            <span style={s.ok}>✓ {pick(lang, 'تم إرسال إثبات الشحن. بعد موافقة المشرف يُشحن رصيدك ثم اضغط طلب الرحلة.', 'Top-up proof sent. After an admin approves it your wallet is funded; then tap Request ride.', 'Preuve envoyée. Après approbation, votre portefeuille sera crédité.')}</span>
          ) : (
            <>
              <div style={s.hint}>
                {pick(lang, 'حوّل المبلغ إلى حساب Rezekme أدناه ثم أدخل رقم المرجع.', 'Transfer the amount to the Rezekme account below and enter the reference number.', 'Transférez le montant au compte Rezekme ci-dessous et entrez la référence.')}
              </div>
              <img data-guide="shamcash-qr" src={LOCAL_WALLET_QR} alt="Sham Cash QR" style={s.qr} />
              <div style={{ marginBottom: 6, fontSize: 12, color: '#333' }}>
                {pick(lang, 'المبلغ المطلوب:', 'Amount due:', 'Montant dû:')} <strong>{moneyText(fareMinor, currency, lang)}</strong>
              </div>
              <input
                data-guide="shamcash-ref"
                type="text"
                dir={isAr ? 'rtl' : 'ltr'}
                style={s.input}
                placeholder={pick(lang, 'رقم مرجع التحويل', 'Transfer reference number', 'Référence du transfert')}
                value={shamCashRef}
                onChange={(e) => onShamCashRefChange(e.target.value)}
              />
              <button
                data-guide="shamcash-submit"
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
          <span style={s.hint}>{pick(lang, 'نقاط MSH هي رصيد محفظتك (1 نقطة = 1 دولار).', 'MSH points are your wallet balance (1 point = $1).', 'Les points MSH sont le solde de votre portefeuille (1 point = 1 $).')}{walletBalanceMinor !== null ? ` ${walletBalanceMinor} MSH` : ''}</span>
          <a href="#/wallet" style={{ display: 'inline-block', marginTop: 6, fontWeight: 700 }}>{pick(lang, 'شراء نقاط MSH', 'Buy MSH points', 'Acheter des points MSH')} →</a>
        </div>
      )}
    </div>
  )
}
