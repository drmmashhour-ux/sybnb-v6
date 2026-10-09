import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import {
  decideAdminPayoutRequest,
  executeAdminRefund,
  fetchAdminPayoutRequests,
  fetchAdminPayouts,
  fetchAdminRefunds,
  finalizeAdminBookingCancellation,
  releaseAdminPayout,
  type AdminPayout,
  type AdminPayoutRequest,
  type AdminRefund,
  type PayoutRequestStatus,
} from '../../shared/api/platformApi'
import { moneyText } from '../../shared/i18n/display'
import { localeForLang } from '../../shared/country/presentation'
import { methodDetailsText, methodTypeLabel, payoutStatusLabel } from '../../shared/payouts/payoutLabels'

type Props = { lang: Lang }

// Admin money desk: host withdrawal requests (pay outside the platform, then mark PAID with a
// reference or REJECT with a reason), guest refunds (execute, then finalize the cancellation), and
// completed-stay payouts that are eligible for release. Every action is an explicit admin click.

function formatDate(value: string | null | undefined, lang: Lang) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(pick(lang, localeForLang('ar'), localeForLang('en'), 'fr-CA'), { day: 'numeric', month: 'short', year: 'numeric' })
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function AdminMoneyPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const colon = lang === 'fr' ? ' : ' : ': '

  // (a) payout requests
  const [requestFilter, setRequestFilter] = useState<PayoutRequestStatus | ''>('REQUESTED')
  const [requests, setRequests] = useState<AdminPayoutRequest[]>([])
  const [requestsState, setRequestsState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [requestsError, setRequestsError] = useState('')
  const [decision, setDecision] = useState<{ id: string; action: 'paid' | 'reject' } | null>(null)
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [decisionBusy, setDecisionBusy] = useState(false)
  const [decisionError, setDecisionError] = useState('')

  // (b) refunds
  const [refundFilter, setRefundFilter] = useState<'REQUESTED' | 'SUCCEEDED' | ''>('REQUESTED')
  const [refunds, setRefunds] = useState<AdminRefund[]>([])
  const [refundsState, setRefundsState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [refundsError, setRefundsError] = useState('')
  const [refundBusyId, setRefundBusyId] = useState<string | null>(null)
  const [refundRowMessage, setRefundRowMessage] = useState<Record<string, { ok: boolean; text: string }>>({})
  const [finalizedBookings, setFinalizedBookings] = useState<Set<string>>(new Set())

  // (c) completed-stay payouts
  const [payouts, setPayouts] = useState<AdminPayout[]>([])
  const [holdDays, setHoldDays] = useState<number | null>(null)
  const [payoutsState, setPayoutsState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [payoutsError, setPayoutsError] = useState('')
  const [releasingId, setReleasingId] = useState<string | null>(null)

  useEffect(() => {
    void loadRequests(requestFilter)
  }, [requestFilter])

  useEffect(() => {
    void loadRefunds(refundFilter)
  }, [refundFilter])

  useEffect(() => {
    void loadPayouts()
  }, [])

  async function loadRequests(status: PayoutRequestStatus | '') {
    setRequestsState('loading')
    try {
      setRequests(await fetchAdminPayoutRequests(status))
      setRequestsState('ready')
    } catch (error) {
      setRequestsState('error')
      setRequestsError(errorText(error))
    }
  }

  async function loadRefunds(status: string) {
    setRefundsState('loading')
    try {
      setRefunds(await fetchAdminRefunds(status))
      setRefundsState('ready')
    } catch (error) {
      setRefundsState('error')
      setRefundsError(errorText(error))
    }
  }

  async function loadPayouts() {
    setPayoutsState('loading')
    try {
      const response = await fetchAdminPayouts()
      setPayouts(response.payouts || [])
      setHoldDays(typeof response.holdDays === 'number' ? response.holdDays : null)
      setPayoutsState('ready')
    } catch (error) {
      setPayoutsState('error')
      setPayoutsError(errorText(error))
    }
  }

  function openDecision(id: string, action: 'paid' | 'reject') {
    setDecision({ id, action })
    setReference('')
    setNote('')
    setDecisionError('')
  }

  async function submitDecision() {
    if (!decision) return
    const ref = reference.trim()
    const reason = note.trim()
    if (decision.action === 'paid' && !ref) {
      setDecisionError(pick(lang, 'رقم العملية مطلوب.', 'A transfer reference is required.', 'Une référence de virement est requise.'))
      return
    }
    if (decision.action === 'reject' && !reason) {
      setDecisionError(pick(lang, 'سبب الرفض مطلوب.', 'A rejection reason is required.', 'Un motif de refus est requis.'))
      return
    }
    setDecisionBusy(true)
    setDecisionError('')
    try {
      await decideAdminPayoutRequest(
        decision.id,
        decision.action === 'paid' ? { action: 'paid', reference: ref, ...(reason ? { note: reason } : {}) } : { action: 'reject', note: reason },
      )
      setDecision(null)
      await loadRequests(requestFilter)
    } catch (error) {
      setDecisionError(errorText(error))
    } finally {
      setDecisionBusy(false)
    }
  }

  async function runExecuteRefund(refund: AdminRefund) {
    setRefundBusyId(refund.id)
    try {
      await executeAdminRefund(refund.id)
      setRefundRowMessage((current) => ({ ...current, [refund.id]: { ok: true, text: pick(lang, 'تم تنفيذ الاسترداد. الخطوة التالية: إنهاء الإلغاء.', 'Refund executed. Next: finalize the cancellation.', 'Remboursement exécuté. Étape suivante : finaliser l’annulation.') } }))
      setRefunds((current) => current.map((row) => (row.id === refund.id ? { ...row, status: 'SUCCEEDED' } : row)))
    } catch (error) {
      setRefundRowMessage((current) => ({ ...current, [refund.id]: { ok: false, text: errorText(error) } }))
    } finally {
      setRefundBusyId(null)
    }
  }

  async function runFinalize(refund: AdminRefund) {
    if (!refund.bookingId) return
    setRefundBusyId(refund.id)
    try {
      await finalizeAdminBookingCancellation(refund.bookingId)
      setFinalizedBookings((current) => new Set(current).add(refund.bookingId as string))
      setRefundRowMessage((current) => ({ ...current, [refund.id]: { ok: true, text: pick(lang, 'تم إنهاء الإلغاء وتسجيل القيود.', 'Cancellation finalized and ledger entries posted.', 'Annulation finalisée et écritures enregistrées.') } }))
    } catch (error) {
      setRefundRowMessage((current) => ({ ...current, [refund.id]: { ok: false, text: errorText(error) } }))
    } finally {
      setRefundBusyId(null)
    }
  }

  async function runRelease(bookingId: string) {
    setReleasingId(bookingId)
    try {
      await releaseAdminPayout(bookingId)
      await loadPayouts()
    } catch (error) {
      setPayoutsError(errorText(error))
    } finally {
      setReleasingId(null)
    }
  }

  const requestFilters: Array<[PayoutRequestStatus | '', string]> = [
    ['REQUESTED', payoutStatusLabel('REQUESTED', lang)],
    ['PAID', payoutStatusLabel('PAID', lang)],
    ['REJECTED', payoutStatusLabel('REJECTED', lang)],
    ['', pick(lang, 'الكل', 'All', 'Tous')],
  ]
  const refundFilters: Array<['REQUESTED' | 'SUCCEEDED' | '', string]> = [
    ['REQUESTED', pick(lang, 'بانتظار التنفيذ', 'Pending', 'En attente')],
    ['SUCCEEDED', pick(lang, 'منفّذ', 'Executed', 'Exécuté')],
    ['', pick(lang, 'الكل', 'All', 'Tous')],
  ]

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <div style={styles.topLinks}>
        <button style={styles.back} onClick={() => (window.location.hash = '/admin/review')}>
          {pick(lang, 'العودة للمراجعة', 'Back to review', 'Retour à la vérification')}
        </button>
      </div>
      <section style={styles.hero}>
        <h1 style={styles.title}>{pick(lang, 'الصرف والاسترداد', 'Payouts & refunds', 'Versements et remboursements')}</h1>
        <p style={styles.body}>
          {pick(
            lang,
            'كل مبلغ يُدفع خارج المنصة (شام كاش، بنك، أو نقداً) ثم يُسجَّل هنا. لا توجد حركة أموال تلقائية.',
            'Every amount is paid outside the platform (Sham Cash, bank, or cash) and then recorded here. No money moves automatically.',
            'Chaque montant est payé hors plateforme (Sham Cash, banque ou espèces), puis enregistré ici. Aucun mouvement d’argent automatique.',
          )}
        </p>
      </section>

      {/* (a) Payout requests */}
      <section style={styles.card} aria-labelledby="admin-payout-requests">
        <div style={styles.cardHead}>
          <h2 id="admin-payout-requests" style={styles.cardTitle}>{pick(lang, 'طلبات سحب المضيفين', 'Host payout requests', 'Demandes de versement des hôtes')}</h2>
          <div style={styles.filters} role="tablist">
            {requestFilters.map(([value, label]) => (
              <button key={value || 'all'} role="tab" aria-selected={requestFilter === value} style={requestFilter === value ? styles.filterActive : styles.filter} onClick={() => setRequestFilter(value)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {requestsState === 'loading' && <p style={styles.body}>{pick(lang, 'جار التحميل...', 'Loading...', 'Chargement...')}</p>}
        {requestsState === 'error' && <p style={styles.alert}>{requestsError}</p>}
        {requestsState === 'ready' && requests.length === 0 && (
          <p style={styles.body}>{pick(lang, 'لا توجد طلبات في هذه القائمة.', 'No requests in this list.', 'Aucune demande dans cette liste.')}</p>
        )}
        <div style={styles.list}>
          {requests.map((request) => (
            <article key={request.id} style={styles.row}>
              <div style={styles.rowGrid}>
                <div style={styles.cell}>
                  <small style={styles.label}>{pick(lang, 'المضيف', 'Host', 'Hôte')}</small>
                  <strong>{request.host?.displayName || request.host?.id?.slice(0, 8).toUpperCase() || '-'}</strong>
                  {request.host?.email && <small style={styles.muted} dir="ltr">{request.host.email}</small>}
                </div>
                <div style={styles.cell}>
                  <small style={styles.label}>{pick(lang, 'المبلغ', 'Amount', 'Montant')}</small>
                  <strong style={styles.amount}>{moneyText(request.amountMinor, request.currency, lang)}</strong>
                  <small style={styles.muted}>{formatDate(request.createdAt, lang)}</small>
                </div>
                <div style={styles.cell}>
                  <small style={styles.label}>{methodTypeLabel(request.method?.type, lang)}</small>
                  <span dir="auto">{methodDetailsText(request.method, lang)}</span>
                </div>
                <div style={{ ...styles.cell, justifyItems: 'end' }}>
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
                    <small style={styles.muted}>
                      {pick(lang, 'السبب', 'Reason', 'Motif')}
                      {colon}
                      <span dir="auto">{request.note}</span>
                    </small>
                  )}
                </div>
              </div>

              {request.status === 'REQUESTED' && decision?.id !== request.id && (
                <div style={styles.actions}>
                  <button style={styles.acceptButton} onClick={() => openDecision(request.id, 'paid')}>
                    {pick(lang, 'تم الدفع', 'Mark paid', 'Marquer payé')}
                  </button>
                  <button style={styles.rejectButton} onClick={() => openDecision(request.id, 'reject')}>
                    {pick(lang, 'رفض', 'Reject', 'Refuser')}
                  </button>
                </div>
              )}

              {decision?.id === request.id && (
                <div style={styles.decisionBox}>
                  {decision.action === 'paid' ? (
                    <>
                      <label style={styles.field}>
                        <span>{pick(lang, 'رقم العملية (مطلوب)', 'Transfer reference (required)', 'Référence du virement (obligatoire)')}</span>
                        <input style={styles.input} dir="ltr" value={reference} onChange={(event) => setReference(event.target.value)} autoFocus />
                      </label>
                      <label style={styles.field}>
                        <span>{pick(lang, 'ملاحظة (اختياري)', 'Note (optional)', 'Note (facultatif)')}</span>
                        <input style={styles.input} value={note} onChange={(event) => setNote(event.target.value)} />
                      </label>
                    </>
                  ) : (
                    <label style={styles.field}>
                      <span>{pick(lang, 'سبب الرفض (مطلوب، يراه المضيف)', 'Rejection reason (required, shown to the host)', 'Motif du refus (obligatoire, visible par l’hôte)')}</span>
                      <textarea style={styles.textarea} value={note} onChange={(event) => setNote(event.target.value)} autoFocus />
                    </label>
                  )}
                  {decisionError && <p style={styles.alert}>{decisionError}</p>}
                  <div style={styles.actions}>
                    <button style={decision.action === 'paid' ? styles.acceptButton : styles.rejectButton} disabled={decisionBusy} onClick={() => void submitDecision()}>
                      {decisionBusy
                        ? pick(lang, 'جار الحفظ...', 'Saving...', 'Enregistrement...')
                        : decision.action === 'paid'
                          ? pick(lang, 'تأكيد الدفع', 'Confirm paid', 'Confirmer le paiement')
                          : pick(lang, 'تأكيد الرفض', 'Confirm rejection', 'Confirmer le refus')}
                    </button>
                    <button style={styles.secondaryButton} disabled={decisionBusy} onClick={() => setDecision(null)}>
                      {pick(lang, 'إلغاء', 'Cancel', 'Annuler')}
                    </button>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      {/* (b) Refunds */}
      <section style={styles.card} aria-labelledby="admin-refunds">
        <div style={styles.cardHead}>
          <h2 id="admin-refunds" style={styles.cardTitle}>{pick(lang, 'استردادات الضيوف', 'Guest refunds', 'Remboursements des voyageurs')}</h2>
          <div style={styles.filters} role="tablist">
            {refundFilters.map(([value, label]) => (
              <button key={value || 'all'} role="tab" aria-selected={refundFilter === value} style={refundFilter === value ? styles.filterActive : styles.filter} onClick={() => setRefundFilter(value)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <p style={styles.body}>
          {pick(
            lang,
            'الخطوة 1: نفّذ الاسترداد (يُضاف المبلغ لمحفظة الضيف). الخطوة 2: أنهِ الإلغاء لتسجيل العمولة وحصة المضيف عن الجزء غير المسترد.',
            'Step 1: execute the refund (credits the guest’s wallet). Step 2: finalize the cancellation to post commission and host share for the retained part.',
            'Étape 1 : exécutez le remboursement (crédite le portefeuille du voyageur). Étape 2 : finalisez l’annulation pour enregistrer la commission et la part de l’hôte sur la partie retenue.',
          )}
        </p>
        {refundsState === 'loading' && <p style={styles.body}>{pick(lang, 'جار التحميل...', 'Loading...', 'Chargement...')}</p>}
        {refundsState === 'error' && <p style={styles.alert}>{refundsError}</p>}
        {refundsState === 'ready' && refunds.length === 0 && (
          <p style={styles.body}>{pick(lang, 'لا توجد استردادات في هذه القائمة.', 'No refunds in this list.', 'Aucun remboursement dans cette liste.')}</p>
        )}
        <div style={styles.list}>
          {refunds.map((refund) => {
            const executed = refund.status === 'SUCCEEDED'
            const finalized = Boolean(refund.bookingId && finalizedBookings.has(refund.bookingId))
            const rowMessage = refundRowMessage[refund.id]
            return (
              <article key={refund.id} style={styles.row}>
                <div style={styles.rowGrid}>
                  <div style={styles.cell}>
                    <small style={styles.label}>{pick(lang, 'الضيف', 'Guest', 'Voyageur')}</small>
                    <strong>{refund.guest?.displayName || '-'}</strong>
                    {refund.guest?.email && <small style={styles.muted} dir="ltr">{refund.guest.email}</small>}
                  </div>
                  <div style={styles.cell}>
                    <small style={styles.label}>{pick(lang, 'المبلغ', 'Amount', 'Montant')}</small>
                    <strong style={styles.amount}>{moneyText(refund.amountMinor, refund.currency, lang)}</strong>
                    <small style={styles.muted}>{formatDate(refund.createdAt, lang)}</small>
                  </div>
                  <div style={styles.cell}>
                    <small style={styles.label}>{pick(lang, 'الحجز', 'Booking', 'Réservation')}</small>
                    {refund.bookingId ? (
                      <span dir="ltr">{refund.bookingId.slice(0, 8).toUpperCase()}</span>
                    ) : (
                      <span>-</span>
                    )}
                  </div>
                  <div style={{ ...styles.cell, justifyItems: 'end' }}>
                    <span style={{ ...styles.pill, ...(executed ? styles.pillPaid : styles.pillRequested) }}>{refund.status}</span>
                  </div>
                </div>
                <div style={styles.actions}>
                  {!executed && (
                    <button style={styles.acceptButton} disabled={refundBusyId === refund.id} onClick={() => void runExecuteRefund(refund)}>
                      {refundBusyId === refund.id ? pick(lang, 'جار التنفيذ...', 'Working...', 'En cours...') : pick(lang, 'تنفيذ الاسترداد', 'Execute refund', 'Exécuter le remboursement')}
                    </button>
                  )}
                  {executed && refund.bookingId && !finalized && (
                    <button style={styles.acceptButton} disabled={refundBusyId === refund.id} onClick={() => void runFinalize(refund)}>
                      {refundBusyId === refund.id ? pick(lang, 'جار التنفيذ...', 'Working...', 'En cours...') : pick(lang, 'إنهاء الإلغاء', 'Finalize cancellation', 'Finaliser l’annulation')}
                    </button>
                  )}
                  {finalized && <span style={styles.ok}>✓ {pick(lang, 'مكتمل', 'Done', 'Terminé')}</span>}
                </div>
                {rowMessage && <p style={rowMessage.ok ? styles.okBox : styles.alert}>{rowMessage.text}</p>}
              </article>
            )
          })}
        </div>
      </section>

      {/* (c) Completed-stay payouts eligible for release (same endpoints as /admin/review → Finance) */}
      <section style={styles.card} aria-labelledby="admin-stay-payouts">
        <div style={styles.cardHead}>
          <h2 id="admin-stay-payouts" style={styles.cardTitle}>{pick(lang, 'صرف الإقامات المكتملة', 'Completed-stay payouts', 'Versements des séjours terminés')}</h2>
        </div>
        <p style={styles.body}>
          {holdDays !== null
            ? pick(
                lang,
                `يُحرَّر نصيب المضيف إلى رصيده المتاح بعد ${holdDays} يوماً من انتهاء الإقامة دون نزاع.`,
                `The host share is released to their available balance ${holdDays} days after the stay ends with no dispute.`,
                `La part de l’hôte est versée sur son solde disponible ${holdDays} jours après la fin du séjour, sans litige.`,
              )
            : pick(lang, 'يُحرَّر نصيب المضيف إلى رصيده المتاح بعد فترة الحجز.', 'The host share is released to their available balance after the hold window.', 'La part de l’hôte est versée sur son solde disponible après la période de retenue.')}
        </p>
        {payoutsState === 'loading' && <p style={styles.body}>{pick(lang, 'جار التحميل...', 'Loading...', 'Chargement...')}</p>}
        {payoutsError && <p style={styles.alert}>{payoutsError}</p>}
        {payoutsState === 'ready' && payouts.length === 0 && (
          <p style={styles.body}>{pick(lang, 'لا توجد مبالغ بانتظار التحرير.', 'Nothing is waiting for release.', 'Rien n’est en attente de versement.')}</p>
        )}
        <div style={styles.list}>
          {payouts.map((payout) => (
            <article key={payout.bookingId} style={styles.row}>
              <div style={styles.rowGrid}>
                <div style={styles.cell}>
                  <small style={styles.label}>{pick(lang, 'الإعلان', 'Listing', 'Annonce')}</small>
                  <strong>{payout.listingTitle || payout.bookingId.slice(0, 8).toUpperCase()}</strong>
                </div>
                <div style={styles.cell}>
                  <small style={styles.label}>{pick(lang, 'المضيف', 'Host', 'Hôte')}</small>
                  <span>{payout.hostName || payout.hostId?.slice(0, 8).toUpperCase() || '-'}</span>
                </div>
                <div style={styles.cell}>
                  <small style={styles.label}>{pick(lang, 'نصيب المضيف', 'Host share', 'Part de l’hôte')}</small>
                  <strong style={styles.amount}>{moneyText(payout.hostPayoutMinor, payout.currency, lang)}</strong>
                </div>
                <div style={{ ...styles.cell, justifyItems: 'end' }}>
                  <small style={styles.muted}>
                    {payout.eligibleNow
                      ? pick(lang, 'جاهز للتحرير الآن', 'Eligible now', 'Admissible maintenant')
                      : `${pick(lang, 'يفتح في', 'Opens', 'Disponible le')} ${formatDate(payout.eligibleAt, lang)}`}
                  </small>
                  <button
                    style={payout.eligibleNow ? styles.acceptButton : styles.secondaryButton}
                    disabled={!payout.eligibleNow || releasingId === payout.bookingId}
                    onClick={() => void runRelease(payout.bookingId)}
                  >
                    {releasingId === payout.bookingId ? pick(lang, 'جار التحرير...', 'Releasing...', 'Versement...') : pick(lang, 'تحرير', 'Release', 'Verser')}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: 'radial-gradient(1000px 480px at 12% -8%, rgba(91,116,255,.14), transparent 60%), radial-gradient(820px 440px at 92% 2%, rgba(25,215,255,.08), transparent 55%), #070b16', color: '#f2f5ff', padding: '32px 24px 90px', display: 'grid', gap: 20, maxWidth: 1180, margin: '0 auto', alignContent: 'start' },
  topLinks: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  back: { minHeight: 44, border: '1px solid rgba(130,150,200,.14)', borderRadius: 12, background: 'rgba(130,150,200,.06)', color: '#f2f5ff', padding: '0 16px', fontWeight: 700 },
  hero: { border: '1px solid rgba(130,150,200,.14)', borderRadius: 16, padding: 22, background: 'linear-gradient(180deg,#111b2e,#0c1322)', display: 'grid', gap: 10, boxShadow: '0 1px 0 rgba(255,255,255,.05) inset, 0 18px 40px -22px rgba(0,0,0,.8)' },
  title: { margin: 0, fontSize: 28, letterSpacing: '-.01em' },
  body: { color: '#9aa7bd', margin: 0, lineHeight: 1.6 },
  muted: { color: '#6c7b96' },
  label: { color: '#6c7b96', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.12em' },
  card: { border: '1px solid rgba(130,150,200,.14)', borderRadius: 16, background: 'linear-gradient(180deg,#111b2e,#0c1322)', padding: 20, display: 'grid', gap: 14, minWidth: 0, boxShadow: '0 1px 0 rgba(255,255,255,.05) inset, 0 18px 40px -22px rgba(0,0,0,.8)' },
  cardHead: { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { margin: 0, fontSize: 20 },
  filters: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  filter: { minHeight: 38, border: '1px solid rgba(130,150,200,.14)', borderRadius: 999, background: 'rgba(130,150,200,.06)', color: '#9aa7bd', fontWeight: 700, padding: '0 15px', cursor: 'pointer' },
  filterActive: { minHeight: 38, border: '1px solid rgba(123,144,255,.6)', borderRadius: 999, background: 'linear-gradient(135deg, rgba(91,116,255,.28), rgba(91,116,255,.12))', color: '#fff', fontWeight: 800, padding: '0 15px', cursor: 'pointer', boxShadow: '0 8px 22px -12px rgba(91,116,255,.9)' },
  list: { display: 'grid', gap: 11 },
  row: { border: '1px solid rgba(130,150,200,.14)', borderRadius: 13, background: '#0c1322', padding: 15, display: 'grid', gap: 12 },
  rowGrid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', alignItems: 'start' },
  cell: { display: 'grid', gap: 4, minWidth: 0, overflowWrap: 'anywhere', alignContent: 'start' },
  amount: { fontSize: 18, fontWeight: 900 },
  actions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  decisionBox: { display: 'grid', gap: 10, borderTop: '1px solid rgba(130,150,200,.14)', paddingTop: 13 },
  field: { display: 'grid', gap: 6, color: '#9aa7bd', fontSize: 14, fontWeight: 700 },
  input: { minHeight: 44, width: '100%', boxSizing: 'border-box', border: '1px solid rgba(130,150,200,.22)', borderRadius: 12, background: '#070b16', color: '#fff', padding: '0 14px', fontSize: 15, fontFamily: 'inherit' },
  textarea: { minHeight: 80, width: '100%', boxSizing: 'border-box', border: '1px solid rgba(130,150,200,.22)', borderRadius: 12, background: '#070b16', color: '#fff', padding: 12, fontSize: 15, fontFamily: 'inherit' },
  acceptButton: { minHeight: 44, border: 0, borderRadius: 12, background: 'linear-gradient(135deg,#22d6a0,#14b98a)', color: '#042018', fontWeight: 900, padding: '0 18px', cursor: 'pointer', boxShadow: '0 10px 24px -14px rgba(34,214,160,.9)' },
  rejectButton: { minHeight: 44, border: 0, borderRadius: 12, background: 'linear-gradient(135deg,#ff5c7a,#e23f61)', color: '#fff', fontWeight: 900, padding: '0 18px', cursor: 'pointer', boxShadow: '0 10px 24px -16px rgba(255,92,122,.9)' },
  secondaryButton: { minHeight: 44, border: '1px solid rgba(130,150,200,.14)', borderRadius: 12, background: 'rgba(130,150,200,.06)', color: '#f2f5ff', fontWeight: 700, padding: '0 16px', cursor: 'pointer' },
  pill: { borderRadius: 999, padding: '5px 13px', fontWeight: 800, fontSize: 12, whiteSpace: 'nowrap' },
  pillRequested: { background: 'rgba(232,189,42,.14)', color: '#e8bd2a', border: '1px solid rgba(232,189,42,.4)' },
  pillPaid: { background: 'rgba(34,214,160,.14)', color: '#22d6a0', border: '1px solid rgba(34,214,160,.4)' },
  pillRejected: { background: 'rgba(255,92,122,.14)', color: '#ff9aac', border: '1px solid rgba(255,92,122,.4)' },
  alert: { margin: 0, border: '1px solid rgba(255,92,122,.4)', borderRadius: 14, background: 'linear-gradient(90deg, rgba(255,92,122,.16), rgba(255,92,122,.05))', color: '#ffd1d9', padding: '14px 16px' },
  ok: { color: '#22d6a0', fontWeight: 800, alignSelf: 'center' },
  okBox: { margin: 0, border: '1px solid rgba(34,214,160,.45)', borderRadius: 14, background: 'linear-gradient(90deg, rgba(34,214,160,.12), rgba(34,214,160,.03))', color: '#8affda', padding: '14px 16px' },
}
