import { useEffect, useState } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import { BRAND_NAME } from '../../shared/brand'
import { fetchHostPayoutMethod, saveHostPayoutMethod, type HostPayoutMethod } from '../../shared/api/platformApi'
import { methodDetailsText, methodTypeLabel } from '../../shared/payouts/payoutLabels'

// "How we pay you" (owner decision 2026-10-22): a stay host gives their Sham Cash or bank details
// before submitting the stay. Same store as the payouts page (/api/host/payout-method), so it can be
// changed later from there. The server refuses to submit a stay without it (PAYOUT_METHOD_REQUIRED).
type Kind = 'SHAM_CASH' | 'BANK'

export function HostPayoutSetup({ lang, onReadyChange }: { lang: Lang; onReadyChange: (ready: boolean) => void }) {
  const [saved, setSaved] = useState<HostPayoutMethod | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading')
  const [editing, setEditing] = useState(false)
  const [kind, setKind] = useState<Kind>('SHAM_CASH')
  const [shamCashNumber, setShamCashNumber] = useState('')
  const [accountName, setAccountName] = useState('')
  const [bankName, setBankName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchHostPayoutMethod('seller')
      .then((method) => {
        if (cancelled) return
        setSaved(method)
        setEditing(!method)
        setState('ready')
        onReadyChange(Boolean(method))
      })
      .catch(() => {
        if (cancelled) return
        setEditing(true)
        setState('ready')
        onReadyChange(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save() {
    setError('')
    const method: HostPayoutMethod =
      kind === 'SHAM_CASH'
        ? { type: 'SHAM_CASH', shamCashNumber: shamCashNumber.trim(), accountName: accountName.trim() }
        : { type: 'BANK', bankName: bankName.trim(), accountName: accountName.trim(), accountNumber: accountNumber.trim() }
    const complete = kind === 'SHAM_CASH' ? method.shamCashNumber && method.accountName : method.bankName && method.accountName && method.accountNumber
    if (!complete) {
      setError(pick(lang, 'أكمل كل الحقول.', 'Fill in every field.', 'Remplissez tous les champs.'))
      return
    }
    setState('saving')
    try {
      const result = await saveHostPayoutMethod(method, 'seller')
      setSaved(result)
      setEditing(false)
      setState('ready')
      onReadyChange(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : pick(lang, 'تعذر الحفظ.', 'Could not save.', 'Enregistrement impossible.'))
      setState('ready')
    }
  }

  return (
    <div className="host-payout-setup" data-testid="wizard-payout" data-ready={saved && !editing ? '1' : '0'}>
      <strong>{pick(lang, 'كيف ندفع لك (مطلوب)', 'How we pay you (required)', 'Comment nous vous payons (obligatoire)')}</strong>
      <p>
        {pick(
          lang,
          `يحوّل ${BRAND_NAME} أرباحك إلى هذا الحساب بعد انتهاء إقامة الضيف. لا تظهر هذه المعلومات للضيوف.`,
          `${BRAND_NAME} sends your earnings to this account after each guest’s stay. Guests never see it.`,
          `${BRAND_NAME} verse vos gains sur ce compte après chaque séjour. Les voyageurs ne le voient jamais.`,
        )}
      </p>
      {state === 'loading' && <p>{pick(lang, 'جار التحميل…', 'Loading…', 'Chargement…')}</p>}
      {saved && !editing && (
        <div className="host-payout-saved">
          <span data-testid="wizard-payout-saved">
            ✓ {methodTypeLabel(saved.type, lang)} · {methodDetailsText(saved, lang)}
          </span>
          <button type="button" className="seller-secondary-button" onClick={() => setEditing(true)}>
            {pick(lang, 'تغيير', 'Change', 'Modifier')}
          </button>
        </div>
      )}
      {editing && state !== 'loading' && (
        <div className="host-payout-form">
          <div className="host-payout-kinds">
            {(['SHAM_CASH', 'BANK'] as Kind[]).map((item) => (
              <button key={item} type="button" className={kind === item ? 'active' : ''} data-testid={`payout-kind-${item}`} onClick={() => setKind(item)}>
                {item === 'SHAM_CASH' ? pick(lang, 'شام كاش', 'Sham Cash', 'Sham Cash') : pick(lang, 'حساب بنكي', 'Bank account', 'Compte bancaire')}
              </button>
            ))}
          </div>
          {kind === 'SHAM_CASH' ? (
            <label>
              <span>{pick(lang, 'رقم شام كاش', 'Sham Cash number', 'Numéro Sham Cash')}</span>
              <input data-testid="payout-shamcash" dir="ltr" inputMode="tel" value={shamCashNumber} onChange={(event) => setShamCashNumber(event.target.value)} />
            </label>
          ) : (
            <>
              <label>
                <span>{pick(lang, 'اسم البنك أو المؤسسة المالية', 'Bank or financial institution', 'Banque ou institution financière')}</span>
                <input data-testid="payout-bankname" value={bankName} onChange={(event) => setBankName(event.target.value)} />
              </label>
              <label>
                <span>{pick(lang, 'رقم الحساب أو IBAN', 'Account number or IBAN', 'Numéro de compte ou IBAN')}</span>
                <input data-testid="payout-accountnumber" dir="ltr" value={accountNumber} onChange={(event) => setAccountNumber(event.target.value)} />
              </label>
            </>
          )}
          <label>
            <span>{pick(lang, 'اسم صاحب الحساب', 'Account holder name', 'Titulaire du compte')}</span>
            <input data-testid="payout-accountname" value={accountName} onChange={(event) => setAccountName(event.target.value)} />
          </label>
          <div className="host-payout-actions">
            <button type="button" className="seller-primary-button" data-testid="payout-save" disabled={state === 'saving'} onClick={() => void save()}>
              {state === 'saving' ? pick(lang, 'جار الحفظ…', 'Saving…', 'Enregistrement…') : pick(lang, 'حفظ طريقة الدفع', 'Save payout method', 'Enregistrer')}
            </button>
            {saved && (
              <button type="button" className="seller-secondary-button" onClick={() => setEditing(false)}>
                {pick(lang, 'إلغاء', 'Cancel', 'Annuler')}
              </button>
            )}
          </div>
        </div>
      )}
      {error && <p className="stay-pricing-problem">{error}</p>}
    </div>
  )
}
