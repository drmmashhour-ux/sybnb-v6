import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import {
  fetchHostPayoutMethod,
  fetchHostPayouts,
  requestHostPayout,
  saveHostPayoutMethod,
  type HostDashboardMode,
  type HostPayoutMethod,
  type HostPayoutsSummary,
  type PayoutMethodType,
  type PayoutRequestStatus,
} from '../../shared/api/platformApi'
import { moneyText } from '../../shared/i18n/display'
import { localeForLang } from '../../shared/country/presentation'
import { methodDetailsText, methodTypeLabel, payoutStatusLabel } from '../../shared/payouts/payoutLabels'

type Props = {
  lang: Lang
  mode?: HostDashboardMode
}

// Host payouts (owner decision Oct 8, 2026): the host chooses how SYBNB pays them (Sham Cash, bank
// transfer, or cash at a SYBNB office) and requests a withdrawal of their released (available)
// balance. An admin pays outside the platform and marks the request PAID with a reference, or
// REJECTS it with a reason. Nothing here moves money automatically.

const METHOD_TYPES: PayoutMethodType[] = ['SHAM_CASH', 'BANK', 'CASH_OFFICE']

function formatDate(value: string | null | undefined, lang: Lang) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(pick(lang, localeForLang('ar'), localeForLang('en'), 'fr-CA'), { day: 'numeric', month: 'short', year: 'numeric' })
}

function emptyMethod(type: PayoutMethodType): HostPayoutMethod {
  return { type, shamCashNumber: '', accountName: '', bankName: '', accountNumber: '', officeCity: '' }
}

function cleanMethod(method: HostPayoutMethod): HostPayoutMethod {
  const trim = (value?: string) => (value || '').trim()
  if (method.type === 'SHAM_CASH') return { type: 'SHAM_CASH', shamCashNumber: trim(method.shamCashNumber), accountName: trim(method.accountName) }
  if (method.type === 'BANK') return { type: 'BANK', bankName: trim(method.bankName), accountName: trim(method.accountName), accountNumber: trim(method.accountNumber) }
  return { type: 'CASH_OFFICE', officeCity: trim(method.officeCity) }
}

function methodComplete(method: HostPayoutMethod) {
  const m = cleanMethod(method)
  if (m.type === 'SHAM_CASH') return Boolean(m.shamCashNumber && m.accountName)
  if (m.type === 'BANK') return Boolean(m.bankName && m.accountName && m.accountNumber)
  return Boolean(m.officeCity)
}

export function HostPayoutsPage({ lang, mode = 'host' }: Props) {
  const isAr = lang === 'ar'
  const colon = lang === 'fr' ? ' : ' : ': '
  const [savedMethod, setSavedMethod] = useState<HostPayoutMethod | null>(null)
  const [draft, setDraft] = useState<HostPayoutMethod>(emptyMethod('SHAM_CASH'))
  const [editing, setEditing] = useState(false)
  const [methodState, setMethodState] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'error'>('loading')
  const [methodError, setMethodError] = useState('')
  const [summary, setSummary] = useState<HostPayoutsSummary | null>(null)
  const [summaryState, setSummaryState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [summaryError, setSummaryError] = useState('')
  const [amountText, setAmountText] = useState('')
  const [withdrawState, setWithdrawState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle')
  const [withdrawError, setWithdrawError] = useState('')

  useEffect(() => {
    void loadMethod()
    void loadSummary()
  }, [])

  async function loadMethod() {
    setMethodState('loading')
    try {
      const method = await fetchHostPayoutMethod(mode)
      setSavedMethod(method)
      setDraft(method ? { ...emptyMethod(method.type), ...method } : emptyMethod('SHAM_CASH'))
      setEditing(!method)
      setMethodState('ready')
    } catch (error) {
      setMethodState('error')
      setMethodError(error instanceof Error ? error.message : '')
    }
  }

  async function loadSummary() {
    setSummaryState('loading')
    try {
      setSummary(await fetchHostPayouts(mode))
      setSummaryState('ready')
    } catch (error) {
      setSummaryState('error')
      setSummaryError(error instanceof Error ? error.message : '')
    }
  }

  async function saveMethod() {
    if (!methodComplete(draft)) {
      setMethodError(pick(lang, 'أكمل كل الحقول المطلوبة.', 'Fill in all required fields.', 'Remplissez tous les champs obligatoires.'))
      return
    }
    setMethodState('saving')
    setMethodError('')
    try {
      const saved = await saveHostPayoutMethod(cleanMethod(draft), mode)
      setSavedMethod(saved)
      setEditing(false)
      setMethodState('saved')
    } catch (error) {
      setMethodState('error')
      setMethodError(error instanceof Error ? error.message : '')
    }
  }

  const currency = summary?.currency || 'SYP'
  const maxMinor = Math.max(0, (summary?.availableMinor ?? 0) - (summary?.pendingMinor ?? 0))
  const amountMinor = Math.round(Number(amountText.replace(/[^\d]/g, '')) || 0)
  const amountInvalid = amountMinor <= 0 || amountMinor > maxMinor

  async function submitWithdraw() {
    if (!savedMethod) {
      setWithdrawState('error')
      setWithdrawError(pick(lang, 'اختر طريقة الاستلام أولاً.', 'Choose a payout method first.', 'Choisissez d’abord un mode de versement.'))
      return
    }
    if (amountInvalid) {
      setWithdrawState('error')
      setWithdrawError(
        pick(
          lang,
          `أدخل مبلغاً بين 1 و ${moneyText(maxMinor, currency, lang)}.`,
          `Enter an amount between 1 and ${moneyText(maxMinor, currency, lang)}.`,
          `Saisissez un montant entre 1 et ${moneyText(maxMinor, currency, lang)}.`,
        ),
      )
      return
    }
    setWithdrawState('saving')
    setWithdrawError('')
    try {
      await requestHostPayout(amountMinor, mode)
      setAmountText('')
      setWithdrawState('done')
      await loadSummary()
    } catch (error) {
      setWithdrawState('error')
      setWithdrawError(error instanceof Error ? error.message : '')
    }
  }

  function field(key: keyof HostPayoutMethod, label: string, options: { ltr?: boolean; placeholder?: string } = {}) {
    return (
      <label style={styles.field}>
        <span>{label}</span>
        <input
          style={styles.input}
          dir={options.ltr ? 'ltr' : undefined}
          value={(draft[key] as string) || ''}
          placeholder={options.placeholder}
          onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
        />
      </label>
    )
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <div style={styles.topLinks}>
        <button style={styles.back} onClick={() => (window.location.hash = '/host')}>
          {pick(lang, 'العودة للوحة الاستضافة', 'Back to host dashboard', 'Retour au tableau de bord hôte')}
        </button>
        <button style={styles.linkButton} onClick={() => (window.location.hash = '/host/earnings')}>
          {pick(lang, 'تقرير الأرباح', 'Earnings report', 'Rapport des revenus')}
        </button>
      </div>

      <section style={styles.hero}>
        <h1 style={styles.title}>{pick(lang, 'السحب والدفعات', 'Payouts', 'Versements')}</h1>
        <p style={styles.body}>
          {pick(
            lang,
            'اختر كيف تستلم أرباحك، ثم اطلب سحب رصيدك المتاح. يدفع فريق SYBNB المبلغ ويسجّل رقم العملية هنا.',
            'Choose how you receive your earnings, then request a withdrawal of your available balance. The SYBNB team pays it and records the transfer reference here.',
            'Choisissez comment recevoir vos revenus, puis demandez le retrait de votre solde disponible. L’équipe SYBNB effectue le paiement et inscrit ici la référence du virement.',
          )}
        </p>
      </section>

      <div style={styles.columns}>
        {/* Payout method */}
        <section style={styles.card} aria-labelledby="payout-method-title">
          <h2 id="payout-method-title" style={styles.cardTitle}>{pick(lang, 'طريقة الاستلام', 'Payout method', 'Mode de versement')}</h2>
          {methodState === 'loading' && <p style={styles.body}>{pick(lang, 'جار التحميل...', 'Loading...', 'Chargement...')}</p>}

          {methodState !== 'loading' && !editing && savedMethod && (
            <div style={styles.savedMethod}>
              <strong>{methodTypeLabel(savedMethod.type, lang)}</strong>
              <span dir="auto">{methodDetailsText(savedMethod, lang)}</span>
              {methodState === 'saved' && <small style={styles.ok}>✓ {pick(lang, 'تم الحفظ', 'Saved', 'Enregistré')}</small>}
              <button style={styles.secondaryButton} onClick={() => setEditing(true)}>
                {pick(lang, 'تغيير', 'Change', 'Modifier')}
              </button>
            </div>
          )}

          {methodState !== 'loading' && editing && (
            <div style={styles.form}>
              <div style={styles.methodChoices} role="radiogroup" aria-label={pick(lang, 'طريقة الاستلام', 'Payout method', 'Mode de versement')}>
                {METHOD_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={draft.type === type}
                    style={draft.type === type ? styles.choiceActive : styles.choice}
                    onClick={() => setDraft((current) => ({ ...emptyMethod(type), ...current, type }))}
                  >
                    {methodTypeLabel(type, lang)}
                  </button>
                ))}
              </div>
              {draft.type === 'SHAM_CASH' && (
                <>
                  {field('shamCashNumber', pick(lang, 'رقم شام كاش', 'Sham Cash number', 'Numéro Sham Cash'), { ltr: true })}
                  {field('accountName', pick(lang, 'اسم صاحب الحساب', 'Account name', 'Nom du titulaire'))}
                </>
              )}
              {draft.type === 'BANK' && (
                <>
                  {field('bankName', pick(lang, 'اسم البنك', 'Bank name', 'Nom de la banque'))}
                  {field('accountName', pick(lang, 'اسم صاحب الحساب', 'Account holder', 'Titulaire du compte'))}
                  {field('accountNumber', pick(lang, 'رقم الحساب / IBAN', 'Account number / IBAN', 'Numéro de compte / IBAN'), { ltr: true })}
                </>
              )}
              {draft.type === 'CASH_OFFICE' && (
                <>
                  {field('officeCity', pick(lang, 'المدينة / المكتب', 'City / office', 'Ville / bureau'))}
                  <small style={styles.body}>
                    {pick(
                      lang,
                      'تستلم المبلغ نقداً من مكتب SYBNB في المدينة المختارة بعد موافقة الإدارة، مع إبراز هويتك.',
                      'You collect the cash at the SYBNB office in the chosen city after admin approval, showing your ID.',
                      'Vous retirez les espèces au bureau SYBNB de la ville choisie après approbation, sur présentation de votre pièce d’identité.',
                    )}
                  </small>
                </>
              )}
              {methodError && <p style={styles.alert}>{methodError}</p>}
              <div style={styles.row}>
                <button style={styles.primaryButton} disabled={methodState === 'saving'} onClick={() => void saveMethod()}>
                  {methodState === 'saving' ? pick(lang, 'جار الحفظ...', 'Saving...', 'Enregistrement...') : pick(lang, 'حفظ طريقة الاستلام', 'Save payout method', 'Enregistrer le mode de versement')}
                </button>
                {savedMethod && (
                  <button
                    style={styles.secondaryButton}
                    onClick={() => {
                      setDraft({ ...emptyMethod(savedMethod.type), ...savedMethod })
                      setEditing(false)
                      setMethodError('')
                    }}
                  >
                    {pick(lang, 'إلغاء', 'Cancel', 'Annuler')}
                  </button>
                )}
              </div>
            </div>
          )}
          {methodState === 'error' && !editing && <p style={styles.alert}>{methodError}</p>}
        </section>

        {/* Withdraw */}
        <section style={styles.card} aria-labelledby="withdraw-title">
          <h2 id="withdraw-title" style={styles.cardTitle}>{pick(lang, 'سحب الرصيد', 'Withdraw', 'Retrait')}</h2>
          {summaryState === 'loading' && <p style={styles.body}>{pick(lang, 'جار التحميل...', 'Loading...', 'Chargement...')}</p>}
          {summaryState === 'error' && <p style={styles.alert}>{summaryError || pick(lang, 'تعذر تحميل الرصيد.', 'Could not load your balance.', 'Impossible de charger votre solde.')}</p>}
          {summary && (
            <>
              <div style={styles.stats}>
                <div style={styles.stat}>
                  <span>{pick(lang, 'الرصيد المتاح', 'Available', 'Disponible')}</span>
                  <b style={{ color: '#20d29b' }}>{moneyText(summary.availableMinor, currency, lang)}</b>
                </div>
                <div style={styles.stat}>
                  <span>{pick(lang, 'طلبات قيد المعالجة', 'Pending requests', 'Demandes en cours')}</span>
                  <b style={{ color: '#e5b80b' }}>{moneyText(summary.pendingMinor, currency, lang)}</b>
                </div>
                <div style={styles.stat}>
                  <span>{pick(lang, 'يمكنك سحب حتى', 'You can withdraw up to', 'Retrait possible jusqu’à')}</span>
                  <b>{moneyText(maxMinor, currency, lang)}</b>
                </div>
              </div>
              <div style={styles.form}>
                <label style={styles.field}>
                  <span>{pick(lang, 'المبلغ المطلوب', 'Amount to withdraw', 'Montant à retirer')} ({lang === 'ar' && currency === 'SYP' ? 'ل.س' : currency})</span>
                  <div style={styles.amountRow}>
                    <input
                      style={styles.input}
                      dir="ltr"
                      inputMode="numeric"
                      value={amountText}
                      placeholder="0"
                      onChange={(event) => {
                        setAmountText(event.target.value.replace(/[^\d]/g, ''))
                        if (withdrawState !== 'saving') setWithdrawState('idle')
                      }}
                    />
                    <button type="button" style={styles.secondaryButton} disabled={maxMinor <= 0} onClick={() => setAmountText(String(maxMinor))}>
                      {pick(lang, 'الحد الأقصى', 'Max', 'Max')}
                    </button>
                  </div>
                </label>
                {!savedMethod && methodState !== 'loading' && (
                  <small style={styles.warn}>{pick(lang, 'احفظ طريقة الاستلام قبل طلب السحب.', 'Save a payout method before requesting a withdrawal.', 'Enregistrez un mode de versement avant de demander un retrait.')}</small>
                )}
                {withdrawState === 'error' && <p style={styles.alert}>{withdrawError}</p>}
                {withdrawState === 'done' && (
                  <p style={styles.okBox}>
                    ✓ {pick(lang, 'تم إرسال طلب السحب. سيدفعه فريق SYBNB ويسجّل رقم العملية.', 'Withdrawal requested. The SYBNB team will pay it and record the reference.', 'Retrait demandé. L’équipe SYBNB effectuera le paiement et inscrira la référence.')}
                  </p>
                )}
                <button
                  style={styles.primaryButton}
                  disabled={withdrawState === 'saving' || !savedMethod || maxMinor <= 0 || amountInvalid}
                  onClick={() => void submitWithdraw()}
                >
                  {withdrawState === 'saving' ? pick(lang, 'جار الإرسال...', 'Sending...', 'Envoi...') : pick(lang, 'طلب سحب', 'Request withdrawal', 'Demander un retrait')}
                </button>
              </div>
            </>
          )}
        </section>
      </div>

      {/* Requests */}
      <section style={styles.card} aria-labelledby="requests-title">
        <h2 id="requests-title" style={styles.cardTitle}>{pick(lang, 'طلبات السحب', 'Withdrawal requests', 'Demandes de retrait')}</h2>
        {summary && summary.requests.length === 0 && (
          <p style={styles.body}>{pick(lang, 'لا توجد طلبات سحب بعد.', 'No withdrawal requests yet.', 'Aucune demande de retrait pour le moment.')}</p>
        )}
        <div style={styles.requestList}>
          {summary?.requests.map((request) => (
            <article key={request.id} style={styles.requestRow}>
              <div style={styles.requestMain}>
                <b>{moneyText(request.amountMinor, request.currency || currency, lang)}</b>
                <small style={styles.muted}>
                  {formatDate(request.createdAt, lang)} · {methodTypeLabel(request.method?.type, lang)}
                </small>
              </div>
              <div style={styles.requestStatus}>
                <span style={{ ...styles.pill, ...(request.status === 'PAID' ? styles.pillPaid : request.status === 'REJECTED' ? styles.pillRejected : styles.pillRequested) }}>
                  {payoutStatusLabel(request.status, lang)}
                </span>
                {request.status === 'PAID' && request.reference && (
                  <small style={styles.muted}>
                    {pick(lang, 'رقم العملية', 'Reference', 'Référence')}
                    {colon}
                    <span dir="ltr">{request.reference}</span>
                  </small>
                )}
                {request.status === 'REJECTED' && request.note && (
                  <small style={styles.rejectNote}>
                    {pick(lang, 'السبب', 'Reason', 'Motif')}
                    {colon}
                    <span dir="auto">{request.note}</span>
                  </small>
                )}
                {request.decidedAt && <small style={styles.muted}>{formatDate(request.decidedAt, lang)}</small>}
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#0a0a0f', color: '#fff', padding: '32px 16px 90px', display: 'grid', gap: 20, maxWidth: 1100, margin: '0 auto', alignContent: 'start' },
  topLinks: { display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'space-between' },
  back: { minHeight: 42, border: '1px solid #30384d', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  linkButton: { minHeight: 42, border: 0, background: 'transparent', color: '#8ea0ff', fontWeight: 900, padding: '0 6px', cursor: 'pointer' },
  hero: { border: '1px solid #1e1e2a', borderRadius: 8, padding: 18, background: '#111118', display: 'grid', gap: 10 },
  title: { margin: 0, fontSize: 28 },
  body: { color: '#9aa6ba', margin: 0, lineHeight: 1.6 },
  muted: { color: '#8d92a2' },
  columns: { display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', alignItems: 'start' },
  card: { border: '1px solid #242735', borderRadius: 10, background: '#101016', padding: 18, display: 'grid', gap: 14, minWidth: 0 },
  cardTitle: { margin: 0, fontSize: 20 },
  savedMethod: { display: 'grid', gap: 8, border: '1px solid rgba(32,210,155,.35)', borderRadius: 8, background: 'rgba(32,210,155,.06)', padding: 14, justifyItems: 'start' },
  form: { display: 'grid', gap: 12 },
  methodChoices: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))' },
  choice: { minHeight: 46, border: '1px solid #30384d', borderRadius: 8, background: '#171b29', color: '#dfe5ff', fontWeight: 800, padding: '6px 10px', cursor: 'pointer' },
  choiceActive: { minHeight: 46, border: '1px solid #20d29b', borderRadius: 8, background: 'rgba(32,210,155,.14)', color: '#b7ffe8', fontWeight: 950, padding: '6px 10px', cursor: 'pointer' },
  field: { display: 'grid', gap: 6, color: '#c8cfdd', fontSize: 14, fontWeight: 700 },
  input: { minHeight: 44, width: '100%', boxSizing: 'border-box', border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', color: '#fff', padding: '0 12px', fontSize: 16, fontFamily: 'inherit' },
  amountRow: { display: 'grid', gap: 8, gridTemplateColumns: '1fr auto' },
  row: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  stats: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' },
  stat: { border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', color: '#9aa6ba', display: 'grid', gap: 6, padding: 12, fontSize: 13 },
  primaryButton: { minHeight: 48, border: 0, borderRadius: 8, background: '#20d29b', color: '#06110e', fontWeight: 950, padding: '0 16px', cursor: 'pointer' },
  secondaryButton: { minHeight: 44, border: '1px solid #30384d', borderRadius: 8, background: '#171b29', color: '#fff', fontWeight: 900, padding: '0 14px', cursor: 'pointer' },
  alert: { margin: 0, border: '1px solid rgba(255,96,96,.45)', borderRadius: 8, background: 'rgba(255,96,96,.1)', color: '#ffd1d1', padding: 12 },
  warn: { color: '#e5b80b' },
  ok: { color: '#20d29b', fontWeight: 900 },
  okBox: { margin: 0, border: '1px solid rgba(32,210,155,.45)', borderRadius: 8, background: 'rgba(32,210,155,.1)', color: '#b7ffe8', padding: 12 },
  requestList: { display: 'grid', gap: 8 },
  requestRow: { display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10, border: '1px solid #242735', borderRadius: 8, background: '#0c1220', padding: 12 },
  requestMain: { display: 'grid', gap: 4 },
  requestStatus: { display: 'grid', gap: 4, justifyItems: 'end', alignContent: 'start', textAlign: 'end' },
  pill: { borderRadius: 999, padding: '4px 12px', fontWeight: 900, fontSize: 12, whiteSpace: 'nowrap' },
  pillRequested: { background: 'rgba(229,184,11,.13)', color: '#e5b80b', border: '1px solid rgba(229,184,11,.42)' },
  pillPaid: { background: 'rgba(32,210,155,.14)', color: '#20d29b', border: '1px solid rgba(32,210,155,.42)' },
  pillRejected: { background: 'rgba(255,96,96,.12)', color: '#ff9aac', border: '1px solid rgba(255,96,96,.42)' },
  rejectNote: { color: '#ffd1d1' },
}
